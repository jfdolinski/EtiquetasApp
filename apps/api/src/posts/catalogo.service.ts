import { BadGatewayException, BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { normalizarCodigoBarras, type ImagemCatalogo, type ProdutoCatalogo, type ResultadoConsulta } from '@etiquetas/shared';
import { config } from '../config';
import { decifrar } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';

const TEMPO_LIMITE_MS = 8000;
const MAX_IMAGEM = 15_000_000;

/** Tipo real pelos primeiros bytes: SVG e o resto ficam de fora, venha o que vier no cabeçalho. */
export function tipoDaImagem(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

interface RespostaProduto {
  name?: string;
  is_medicine?: boolean;
  images?: { url?: string; placeholder?: boolean; ai_generated?: boolean }[];
}

const AVISOS_SIMULTANEOS = 4;
const AVISO_VALE_MS = 24 * 3_600_000;
const MAX_AVISOS_POR_CONSULTA = 1000;
const MAX_AVISOS_NA_FILA = 20_000;

/**
 * Código de barras da linha na forma do catálogo: sem os zeros que o ERP põe à esquerda e com os
 * 13 dígitos do EAN (o catálogo guarda assim), mantendo EAN-8 e DUN-14. Código interno fica de fora.
 */
export function codigoParaCatalogo(valor: unknown): string | null {
  const bruto = String(valor ?? '').replace(/[\s-]/g, '');
  if (!/^\d{8,14}$/.test(bruto)) return null;
  const base = bruto.replace(/^0+/, '');
  if (base.length < 7) return null;
  return base.length === 8 || base.length === 14 ? base : base.padStart(13, '0');
}

/** Sistema de catálogo: fonte das imagens dos posts. A chave de cada empresa fica cifrada e nunca vai ao navegador. */
@Injectable()
export class CatalogoService {
  private readonly log = new Logger(CatalogoService.name);
  /** Até quando cada `empresa:código` não precisa de novo aviso. Só em memória: a API tem uma réplica. */
  private readonly avisados = new Map<string, number>();
  private readonly fila: { empresaId: string; codigo: string; cabecalhos: Record<string, string> }[] = [];
  private ativos = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conta ao catálogo os produtos que a consulta devolveu: é o que registra a conexão da empresa e
   * cadastra o código que ele ainda não conhece. Roda em segundo plano e nunca atrapalha a consulta.
   * Sem chave não avisa: não daria para saber de qual empresa é. Cada aviso conta no consumo da
   * empresa no catálogo, por isso o mesmo código só é avisado uma vez por dia, mesmo com agendamento.
   */
  avisarConsulta(empresaId: string, resultado: Pick<ResultadoConsulta, 'colunas' | 'linhas'>, termo?: string): void {
    void this.enfileirar(empresaId, resultado, termo).catch((erro) => this.log.warn(`Aviso ao catálogo não enviado: ${(erro as Error).message}`));
  }

  private async enfileirar(empresaId: string, { colunas, linhas }: Pick<ResultadoConsulta, 'colunas' | 'linhas'>, termo?: string) {
    if (!config().catalogoUrl) return;
    const indices = colunas.flatMap((c, i) => (/ean|gtin|barra|codbar/i.test(c.nome) ? [i] : []));
    if (!indices.length) return;
    // A busca pode ler linhas a mais quando o banco recusa o filtro: só conta o que tem o termo.
    const alvo = termo ? linhas.filter((l) => l.some((v) => String(v ?? '').toLowerCase().includes(termo.toLowerCase()))) : linhas;
    const agora = Date.now();
    const codigos = new Set<string>();
    for (const linha of alvo) {
      for (const i of indices) {
        const codigo = codigoParaCatalogo(linha[i]);
        if (codigo && (this.avisados.get(`${empresaId}:${codigo}`) ?? 0) <= agora) codigos.add(codigo);
      }
      if (codigos.size >= MAX_AVISOS_POR_CONSULTA) break;
    }
    if (!codigos.size) return;
    const cabecalhos = await this.cabecalhos(empresaId);
    if (!cabecalhos['X-Api-Key']) return;
    for (const [chave, validade] of this.avisados) if (validade <= agora) this.avisados.delete(chave);
    for (const codigo of codigos) {
      if (this.fila.length >= MAX_AVISOS_NA_FILA) break;
      this.avisados.set(`${empresaId}:${codigo}`, agora + AVISO_VALE_MS);
      this.fila.push({ empresaId, codigo, cabecalhos });
    }
    this.processarFila();
  }

  private processarFila() {
    while (this.ativos < AVISOS_SIMULTANEOS && this.fila.length) {
      const item = this.fila.shift()!;
      this.ativos++;
      void this.enviarAviso(item).finally(() => {
        this.ativos--;
        this.processarFila();
      });
    }
  }

  private async enviarAviso({ empresaId, codigo, cabecalhos }: { empresaId: string; codigo: string; cabecalhos: Record<string, string> }) {
    const base = config().catalogoUrl;
    const chave = `${empresaId}:${codigo}`;
    try {
      const r = await fetch(`${base}/api/v1/barcodes/${codigo}`, { headers: cabecalhos, signal: AbortSignal.timeout(TEMPO_LIMITE_MS), redirect: 'error' });
      await r.body?.cancel().catch(() => undefined);
      if (r.status === 401 || r.status === 403) {
        // Chave recusada vale para todos: não insiste, e a próxima consulta tenta de novo.
        this.log.warn(`O catálogo recusou a chave da empresa ${empresaId} (HTTP ${r.status}).`);
        this.avisados.delete(chave);
        for (let i = this.fila.length - 1; i >= 0; i--) {
          if (this.fila[i].empresaId === empresaId) this.avisados.delete(`${empresaId}:${this.fila.splice(i, 1)[0].codigo}`);
        }
      } else if (!r.ok && r.status !== 404) this.avisados.delete(chave); // 404: o catálogo não aceita este código, não adianta repetir
    } catch {
      this.avisados.delete(chave); // catálogo fora do ar: a próxima consulta avisa de novo
    }
  }

  private async cabecalhos(empresaId: string): Promise<Record<string, string>> {
    const marca = await this.prisma.marcaPost.findUnique({ where: { empresaId }, select: { chaveCatalogoCifrada: true } });
    return marca?.chaveCatalogoCifrada ? { 'X-Api-Key': decifrar(marca.chaveCatalogoCifrada, config().chaveCriptografia) } : {};
  }

  /** O ERP pode trazer o EAN com zeros à esquerda: se não achar, tenta sem eles. */
  async produto(empresaId: string, codigo: string): Promise<ProdutoCatalogo> {
    const vazio = (aviso: string | null): ProdutoCatalogo => ({ encontrado: false, nome: null, medicamento: false, imagens: [], aviso });
    const base = config().catalogoUrl;
    if (!base) return vazio('O catálogo não está configurado neste servidor. Use uma imagem própria.');
    const cabecalhos = await this.cabecalhos(empresaId);
    for (const tentativa of new Set([codigo.trim(), normalizarCodigoBarras(codigo)])) {
      if (!tentativa) continue;
      let r: Response;
      try {
        r = await fetch(`${base}/api/v1/barcodes/${encodeURIComponent(tentativa)}`, { headers: cabecalhos, signal: AbortSignal.timeout(TEMPO_LIMITE_MS), redirect: 'error' });
      } catch {
        return vazio('O catálogo não respondeu. Use uma imagem própria ou tente de novo.');
      }
      if (r.status === 404) continue;
      if (r.status === 401 || r.status === 403) return vazio('O catálogo recusou a chave de acesso. Confira em Posts, Marca da empresa.');
      if (!r.ok) return vazio('O catálogo não respondeu. Use uma imagem própria ou tente de novo.');
      const p = (await r.json().catch(() => null)) as RespostaProduto | null;
      if (!p) return vazio('O catálogo respondeu de um jeito inesperado.');
      const imagens: ImagemCatalogo[] = (p.images ?? []).filter((i) => i.url && !i.placeholder).map((i) => ({ url: i.url!, ia: !!i.ai_generated }));
      return { encontrado: true, nome: p.name ?? null, medicamento: !!p.is_medicine, imagens, aviso: null };
    }
    return vazio(null);
  }

  /** Só baixa arquivos do próprio catálogo: o endereço vem do navegador e não pode virar acesso à rede interna. */
  async imagem(empresaId: string, endereco: string): Promise<{ tipo: string; bytes: Buffer }> {
    const base = config().catalogoUrl;
    if (!base) throw new ServiceUnavailableException('O catálogo não está configurado neste servidor.');
    let url: URL;
    try {
      url = new URL(endereco);
    } catch {
      throw new BadRequestException('Endereço de imagem inválido.');
    }
    if (url.origin !== new URL(base).origin || !/^\/(files|img)\//.test(url.pathname)) throw new BadRequestException('Esta imagem não é do catálogo.');
    let r: Response;
    try {
      r = await fetch(url, { headers: await this.cabecalhos(empresaId), signal: AbortSignal.timeout(TEMPO_LIMITE_MS * 2), redirect: 'error' });
    } catch {
      throw new BadGatewayException('O catálogo não respondeu.');
    }
    if (!r.ok) throw new BadGatewayException('O catálogo não entregou a imagem.');
    if (Number(r.headers.get('content-length') ?? 0) > MAX_IMAGEM) throw new BadGatewayException('A imagem do catálogo é grande demais.');
    const bytes = Buffer.from(await r.arrayBuffer());
    const tipo = bytes.length <= MAX_IMAGEM ? tipoDaImagem(bytes) : null;
    if (!tipo) throw new BadGatewayException('O catálogo não entregou uma imagem aceita.');
    return { tipo, bytes };
  }
}
