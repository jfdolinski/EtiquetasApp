import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { normalizarCodigoBarras, type ImagemCatalogo, type ProdutoCatalogo } from '@etiquetas/shared';
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

/** Sistema de catálogo: fonte das imagens dos posts. A chave de cada empresa fica cifrada e nunca vai ao navegador. */
@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}

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
