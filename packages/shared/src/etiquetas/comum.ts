import { corEscura, FONTE_PADRAO } from './design';
import { emPaginas, paginar } from './layout';
import { dadosCodigoBarras, mmParaPontos, textoDoElemento, type ContextoValor } from './valores';
import type { ElementoEtiqueta, LayoutEtiqueta, Registro, Rotacao, Simbologia } from './tipos';

export interface OpcoesGeracao {
  dpi: number;
  /** AAAA-MM-DD no fuso da empresa (datas e validades). */
  hoje: string;
  /** Posição da primeira etiqueta no lote completo (o contador continua entre trabalhos). */
  indiceInicial?: number;
}

/** Junta avisos sem repetir e sem deixar a lista crescer sem limite. */
export class Avisos {
  private readonly itens = new Set<string>();
  private extras = 0;

  add(msg: string) {
    if (this.itens.has(msg)) return;
    if (this.itens.size >= 20) {
      this.extras++;
      return;
    }
    this.itens.add(msg);
  }

  lista(): string[] {
    const l = [...this.itens];
    if (this.extras) l.push(`… e mais ${this.extras} aviso(s).`);
    return l;
  }
}

/** Elemento já posicionado na página, em pontos da impressora, com o texto resolvido. */
export interface ElementoPosicionado {
  el: ElementoEtiqueta;
  /** Caixa do elemento na página (pontos). */
  x: number;
  y: number;
  largura: number;
  altura: number;
  texto: string;
  /** Número da etiqueta no lote (1…n), para os avisos. */
  numero: number;
}

export interface PaginaPosicionada {
  larguraPontos: number;
  alturaPontos: number;
  elementos: ElementoPosicionado[];
}

/**
 * Distribui as etiquetas em páginas (fileiras no rolo) e resolve posição e texto de cada
 * elemento. Os geradores só traduzem isso para a linguagem da impressora.
 */
export function posicionar(layout: LayoutEtiqueta, registros: Registro[], opcoes: OpcoesGeracao): PaginaPosicionada[] {
  const p = paginar(layout);
  const pt = (mm: number) => mmParaPontos(mm, opcoes.dpi);
  let indice = opcoes.indiceInicial ?? 0;
  return emPaginas(registros, p.porPagina).map((registrosPagina) => ({
    larguraPontos: pt(p.larguraPaginaMm),
    alturaPontos: pt(p.alturaPaginaMm),
    elementos: registrosPagina.flatMap((registro, posicao) => {
      const ctx: ContextoValor = { registro, indice: indice++, hoje: opcoes.hoje };
      const origem = p.origem(posicao);
      return layout.elementos.map((el) => ({
        el,
        x: pt(origem.x + el.x),
        y: pt(origem.y + el.y),
        largura: Math.max(1, pt(el.largura)),
        altura: Math.max(1, pt(el.altura)),
        texto: textoDoElemento(el, ctx),
        numero: ctx.indice + 1,
      }));
    }),
  }));
}

/** Comprimento ao longo do texto/código e espessura, conforme a rotação. */
export function eixos(e: { largura: number; altura: number; el: { rotacao: Rotacao } }) {
  const deitado = e.el.rotacao === 90 || e.el.rotacao === 270;
  return { comprimento: deitado ? e.altura : e.largura, espessura: deitado ? e.largura : e.altura };
}

/**
 * Ponto de ancoragem para linguagens que giram em torno do ponto de origem do campo
 * (EPL/PPLB e ESC/POS): o canto "superior esquerdo" do conteúdo antes da rotação.
 * `deslocamento` anda ao longo da direção do texto (alinhamento).
 */
export function ancora(e: ElementoPosicionado, deslocamento = 0): { x: number; y: number } {
  switch (e.el.rotacao) {
    case 90:
      return { x: e.x + e.largura, y: e.y + deslocamento };
    case 180:
      return { x: e.x + e.largura - deslocamento, y: e.y + e.altura };
    case 270:
      return { x: e.x, y: e.y + e.altura - deslocamento };
    default:
      return { x: e.x + deslocamento, y: e.y };
  }
}

export function deslocamentoAlinhamento(alinhamento: 'esquerda' | 'centro' | 'direita', comprimento: number, ocupado: number) {
  const sobra = Math.max(0, comprimento - ocupado);
  return alinhamento === 'centro' ? Math.round(sobra / 2) : alinhamento === 'direita' ? sobra : 0;
}

/** Módulos (barras estreitas) de cada simbologia, sem zona de silêncio. */
export function modulosCodigo(simbologia: Simbologia, dados: string): number {
  switch (simbologia) {
    case 'EAN13':
      return 95;
    case 'EAN8':
      return 67;
    case 'CODE39':
      return (dados.length + 2) * 16; // razão 3:1
    case 'CODE128': {
      // Trechos numéricos longos usam o subconjunto C (2 dígitos por símbolo).
      const simbolos = dados.replace(/\d{4,}/g, (m) => 'x'.repeat(Math.ceil(m.length / 2) + 1)).length;
      return (simbolos + 3) * 11 + 2;
    }
  }
}

/** Largura do módulo (pontos) para o código caber no comprimento disponível. */
export function larguraModulo(simbologia: Simbologia, dados: string, comprimento: number, maximo = 10): number {
  return Math.max(1, Math.min(maximo, Math.floor(comprimento / modulosCodigo(simbologia, dados))));
}

const CAPACIDADE_QR_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666];

/** Módulos por lado do QR code (correção M, modo byte), estimados pelo tamanho dos dados. */
export function modulosQr(dados: string): number {
  const bytes = new TextEncoder().encode(dados).length;
  const versao = CAPACIDADE_QR_M.findIndex((c) => bytes <= c) + 1 || 20;
  return 17 + 4 * versao;
}

export function ampliacaoQr(dados: string, lado: number, maximo: number): number {
  return Math.max(1, Math.min(maximo, Math.floor(lado / (modulosQr(dados) + 2))));
}

/** Valida o código de barras do elemento; devolve null (e registra aviso) se não der para imprimir. */
export function codigoValido(e: ElementoPosicionado, avisos: Avisos) {
  if (e.el.tipo !== 'codigo_barras') return null;
  const r = dadosCodigoBarras(e.el.simbologia, e.texto);
  if ('erro' in r) {
    avisos.add(`Etiqueta ${e.numero}: código de barras não impresso (${r.erro}).`);
    return null;
  }
  return r;
}

/**
 * Forma vista por uma térmica (só preto): preenchimento/borda claros não são impressos,
 * senão um fundo amarelo de cartaz viraria um bloco preto cobrindo o texto.
 */
export function formaTermica(el: ElementoEtiqueta): { preenchido: boolean; bordaMm: number } | null {
  if (el.tipo !== 'retangulo' && el.tipo !== 'elipse' && el.tipo !== 'estrela') return null;
  const preenchido = el.preenchido && corEscura(el.corPreenchimento);
  const bordaMm = el.espessuraMm > 0 && corEscura(el.corBorda) ? el.espessuraMm : 0;
  return preenchido || bordaMm > 0 ? { preenchido, bordaMm } : null;
}

/** Avisa uma vez quando o layout usa recursos de design que a térmica não reproduz. */
export function avisarRecursosDesign(layout: LayoutEtiqueta, linguagem: string, avisos: Avisos) {
  const usa = (el: ElementoEtiqueta) => {
    if (el.opacidade !== undefined && el.opacidade < 1) return true;
    if (el.tipo === 'texto' || el.tipo === 'preco') {
      return Boolean(
        (el.fonte && el.fonte !== FONTE_PADRAO) || el.italico || el.contorno || el.corFundo || (el.cor && el.cor.toLowerCase() !== '#000000') ||
          (el.tipo === 'texto' && (el.sublinhado || el.tachado || el.espacamentoLetras)) ||
          (el.tipo === 'preco' && el.centavosSobrescritos),
      );
    }
    if (el.tipo === 'retangulo' || el.tipo === 'elipse' || el.tipo === 'estrela') {
      return Boolean(el.tracejado || (el.tipo === 'retangulo' && el.raioMm) || (el.preenchido && el.corPreenchimento && el.corPreenchimento !== '#000000'));
    }
    if (el.tipo === 'imagem') return Boolean(el.original);
    return el.tipo === 'linha' && Boolean(el.tracejado || (el.cor && el.cor !== '#000000'));
  };
  if (layout.corFundo || layout.elementos.some(usa)) {
    avisos.add(`${linguagem}: fontes, cores, fundos, transparência e efeitos só aparecem no PDF; aqui sai tudo em preto, na fonte da impressora.`);
  }
}

/** Remove acentos para impressoras sem página de código configurada (PPLA/PPLB). */
export function semAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}
