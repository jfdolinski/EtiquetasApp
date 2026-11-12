import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { caminhoFotoProdutoTela, type ItemConteudoTela, type ResumoFotosConteudo } from '@etiquetas/shared';
import { config } from '../config';
import { CatalogoService, codigoParaCatalogo } from '../posts/catalogo.service';
import { PrismaService } from '../prisma/prisma.service';

const DIA_MS = 24 * 3_600_000;
/** Cada busca conta no consumo da empresa no catálogo: quem tem foto é conferido por mês. */
const REVER_COM_FOTO_MS = 30 * DIA_MS;
/** Nome e categoria (Pedidos) mudam no catálogo mais do que a foto: com os dois, confere uma vez por dia. */
const REVER_DADOS_MS = DIA_MS;
/**
 * Quem não tem foto pode ganhar uma: o próprio aviso de consulta cadastra o código novo por lá, ao mesmo
 * tempo que esta busca. Por isso as primeiras tentativas voltam logo, e só depois passam a uma por dia.
 */
const REVER_SEM_FOTO_MS = [10 * 60_000, 3_600_000, 6 * 3_600_000, DIA_MS];

function esperaSemFoto(tentativas: number): number {
  return REVER_SEM_FOTO_MS[Math.min(Math.max(tentativas - 1, 0), REVER_SEM_FOTO_MS.length - 1)];
}

/** A foto existe, mas não deu para trazer. Fica como sem foto, e quem está editando precisa saber. */
class FotoNaoBaixada extends Error {}
const SIMULTANEAS = 4;
/** Uma TV barata abre poucas fotos muito pesadas ao mesmo tempo. */
const TAMANHO_MAXIMO_FOTO = 5_000_000;
/** Na pré-visualização, quem edita espera por estas; as outras chegam depois. */
const MAX_NA_PREVIA = 24;

export const SEM_CATALOGO = 'O catálogo não está configurado neste servidor: os produtos aparecem sem foto.';

export interface FotoGuardada {
  id: string;
  mime: string | null;
  urlOrigem: string | null;
  medicamento: boolean;
  tentativasSemFoto: number;
  verificadoEm: Date;
  nome: string | null;
  categoria: string | null;
  dadosEm: Date | null;
  tentativasSemDados: number;
}

/**
 * Fotos dos produtos nas telas. Vêm do catálogo pelo código de barras e ficam guardadas por empresa:
 * catálogo fora do ar não apaga a foto de ninguém, e a TV baixa daqui, sem precisar da chave.
 */
@Injectable()
export class FotosProdutoTelaService {
  private readonly log = new Logger('FotosProdutoTela');
  /** Dois conteúdos com o mesmo produto não buscam duas vezes. */
  private readonly buscando = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
  ) {}

  private async guardadas(empresaId: string, codigos: string[]): Promise<Map<string, FotoGuardada>> {
    const lista = await this.prisma.fotoProdutoTela.findMany({
      where: { empresaId, codigo: { in: codigos } },
      select: { id: true, codigo: true, mime: true, urlOrigem: true, medicamento: true, tentativasSemFoto: true, verificadoEm: true, nome: true, categoria: true, dadosEm: true, tentativasSemDados: true },
    });
    return new Map(lista.map((f) => [f.codigo, f]));
  }

  /**
   * Coloca nos itens as fotos já guardadas e diz quais códigos procurar no catálogo. Com `comDados`
   * (Pedidos), também procura quem ainda não tem nome e categoria lidos, no mesmo ritmo das sem foto.
   */
  async aplicar(empresaId: string, itens: ItemConteudoTela[], agora = new Date(), reverSemFoto = false, comDados = false) {
    const codigoDe = (i: ItemConteudoTela) => codigoParaCatalogo(i.codigo);
    const codigos = [...new Set(itens.flatMap((i) => codigoDe(i) ?? []))];
    const guardadas = codigos.length ? await this.guardadas(empresaId, codigos) : new Map<string, FotoGuardada>();
    const comFotos = itens.map(({ foto: _antiga, ...item }): ItemConteudoTela => {
      const codigo = codigoDe(item);
      const guardada = codigo ? guardadas.get(codigo) : undefined;
      return guardada?.mime ? { ...item, foto: caminhoFotoProdutoTela(guardada.id) } : item;
    });
    const faltam = config().catalogoUrl
      ? codigos.filter((codigo) => {
          const g = guardadas.get(codigo);
          if (!g || (reverSemFoto && !g.mime)) return true;
          if (comDados) {
            // Pedido na hora ("Atualizar agora"): relê nome e categoria de todos, para valer o que mudou no catálogo.
            if (!g.dadosEm || reverSemFoto) return true;
            const incompleto = !g.nome || !g.categoria;
            const desde = agora.getTime() - g.dadosEm.getTime();
            if (desde >= (incompleto ? esperaSemFoto(g.tentativasSemDados) : REVER_DADOS_MS)) return true;
          }
          return agora.getTime() - g.verificadoEm.getTime() >= (g.mime ? REVER_COM_FOTO_MS : esperaSemFoto(g.tentativasSemFoto));
        })
      : [];
    return { itens: comFotos, faltam, guardadas };
  }

  /** Procura no catálogo, poucos por vez. Catálogo fora do ar ou chave recusada valem para todos: para na primeira, e devolve o motivo. */
  async buscar(empresaId: string, codigos: string[]): Promise<string | null> {
    const fila = codigos.filter((c) => !this.buscando.has(`${empresaId}:${c}`));
    for (const c of fila) this.buscando.add(`${empresaId}:${c}`);
    const guardadas = fila.length ? await this.guardadas(empresaId, fila).catch(() => new Map<string, FotoGuardada>()) : new Map<string, FotoGuardada>();
    let aviso: string | null = null;
    let naoBaixadas = 0;
    let proximo = 0;
    const trabalhador = async () => {
      while (!aviso && proximo < fila.length) {
        const codigo = fila[proximo++];
        try {
          aviso = await this.buscarUma(empresaId, codigo, guardadas.get(codigo));
        } catch (e) {
          naoBaixadas++;
          if (!(e instanceof FotoNaoBaixada)) this.log.warn(`Foto de ${codigo}: ${(e as Error).message}`);
        } finally {
          this.buscando.delete(`${empresaId}:${codigo}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, fila.length) }, trabalhador));
    // Parou antes do fim: os que sobraram tentam na próxima atualização.
    for (const c of fila.slice(proximo)) this.buscando.delete(`${empresaId}:${c}`);
    return aviso ?? (naoBaixadas ? `${naoBaixadas} foto(s) do catálogo não puderam ser trazidas. O sistema tenta de novo sozinho.` : null);
  }

  private async buscarUma(empresaId: string, codigo: string, atual: FotoGuardada | undefined): Promise<string | null> {
    const produto = await this.catalogo.produto(empresaId, codigo);
    // Sem conferir de verdade, nada muda: a foto que já está guardada continua valendo.
    if (produto.aviso) return produto.aviso;
    const agora = new Date();
    const completo = !!produto.nome && !!produto.categoria;
    const comum = {
      medicamento: produto.medicamento,
      verificadoEm: agora,
      tentativasSemFoto: 0,
      nome: produto.nome,
      categoria: produto.categoria,
      dadosEm: agora,
      tentativasSemDados: completo ? 0 : (atual?.tentativasSemDados ?? 0) + 1,
    };
    // De IA não entra: num post sai com aviso na arte, e na vitrine pareceria a foto do produto.
    const escolhida = produto.imagens.find((i) => !i.ia);
    if (escolhida && atual?.mime && atual.urlOrigem === escolhida.url) {
      await this.prisma.fotoProdutoTela.update({ where: { id: atual.id }, data: comum });
      return null;
    }
    const arquivo = escolhida ? await this.baixar(empresaId, escolhida.url) : null;
    // Foto nova que não veio: fica com a antiga, se houver. Sem nenhuma, tenta de novo amanhã.
    if (escolhida && !arquivo && atual?.mime) {
      await this.prisma.fotoProdutoTela.update({ where: { id: atual.id }, data: comum });
      return null;
    }
    const tentativas = (atual?.mime ? 0 : (atual?.tentativasSemFoto ?? 0)) + 1;
    const dados = arquivo ? { mime: arquivo.tipo, conteudo: Uint8Array.from(arquivo.bytes), urlOrigem: escolhida!.url, ...comum } : { mime: null, conteudo: null, urlOrigem: null, ...comum, tentativasSemFoto: tentativas };
    await this.prisma.fotoProdutoTela.upsert({
      where: { empresaId_codigo: { empresaId, codigo } },
      create: { empresaId, codigo, ...dados },
      // Id novo com arquivo novo: o antigo fica em cache para sempre nas TVs.
      update: { ...dados, ...(arquivo ? { id: randomUUID() } : {}) },
    });
    if (escolhida && !arquivo) throw new FotoNaoBaixada();
    return null;
  }

  private async baixar(empresaId: string, url: string) {
    try {
      const arquivo = await this.catalogo.imagem(empresaId, url);
      return arquivo.bytes.length <= TAMANHO_MAXIMO_FOTO ? arquivo : null;
    } catch (e) {
      this.log.warn(`Foto do catálogo não baixada: ${(e as Error).message}`);
      return null;
    }
  }

  /** Quem edita quer ver o resultado: espera as primeiras e deixa as outras em segundo plano. */
  async paraPrevia(empresaId: string, itens: ItemConteudoTela[]): Promise<{ itens: ItemConteudoTela[]; fotos: ResumoFotosConteudo }> {
    // Pediu para carregar agora: quem está sem foto é procurado de novo, sem esperar o prazo.
    const inicio = await this.aplicar(empresaId, itens, new Date(), true);
    const agora = inicio.faltam.slice(0, MAX_NA_PREVIA);
    const depois = inicio.faltam.slice(MAX_NA_PREVIA);
    const aviso = agora.length ? await this.buscar(empresaId, agora) : null;
    if (depois.length && !aviso) void this.buscar(empresaId, depois).catch(() => undefined);
    const { itens: comFotos, guardadas } = await this.aplicar(empresaId, itens);
    const com = comFotos.filter((i) => i.foto).length;
    const medicamentos = itens.filter((i) => {
      const codigo = codigoParaCatalogo(i.codigo);
      return codigo && guardadas.get(codigo)?.medicamento;
    }).length;
    const pendentes = aviso ? 0 : new Set(depois).size;
    return {
      itens: comFotos,
      fotos: { com, sem: comFotos.length - com, pendentes, medicamentos, aviso: aviso ?? (config().catalogoUrl ? null : SEM_CATALOGO) },
    };
  }

  async arquivo(id: string): Promise<{ mime: string; conteudo: Buffer }> {
    const f = await this.prisma.fotoProdutoTela.findUnique({ where: { id }, select: { mime: true, conteudo: true } });
    if (!f?.mime || !f.conteudo) throw new NotFoundException('Foto não encontrada.');
    return { mime: f.mime, conteudo: Buffer.from(f.conteudo) };
  }
}
