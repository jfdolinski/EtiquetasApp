import { FORMATOS_DATA, SIMBOLOGIAS, type ElementoEtiqueta, type LayoutEtiqueta, type OrigemValor } from './tipos';

export const LIMITES = {
  tamanhoMm: { min: 5, max: 400 },
  papelMm: { min: 20, max: 1200 },
  colunas: { min: 1, max: 20 },
  elementos: 300,
  textoFixo: 500,
  tamanhoPt: { min: 4, max: 200 },
} as const;

/** Área impressa de uma "página": no rolo, uma fileira de etiquetas; na folha, a folha inteira. */
export interface Paginacao {
  larguraPaginaMm: number;
  alturaPaginaMm: number;
  linhasPorPagina: number;
  porPagina: number;
  /** Canto superior esquerdo da etiqueta na posição `i` da página. */
  origem(i: number): { x: number; y: number };
}

export function paginar(l: LayoutEtiqueta): Paginacao {
  const passoX = l.larguraMm + l.espacamentoHorizontalMm;
  const passoY = l.alturaMm + l.espacamentoVerticalMm;
  const linhasPorPagina =
    l.papel.tipo === 'rolo'
      ? 1
      : Math.max(1, Math.floor((l.papel.alturaMm - l.margens.superior - l.margens.inferior + l.espacamentoVerticalMm) / passoY));
  return {
    larguraPaginaMm:
      l.papel.tipo === 'folha'
        ? l.papel.larguraMm
        : l.margens.esquerda + l.colunas * l.larguraMm + (l.colunas - 1) * l.espacamentoHorizontalMm + l.margens.direita,
    alturaPaginaMm: l.papel.tipo === 'folha' ? l.papel.alturaMm : l.margens.superior + l.alturaMm + l.margens.inferior,
    linhasPorPagina,
    porPagina: linhasPorPagina * l.colunas,
    origem: (i) => ({
      x: l.margens.esquerda + (i % l.colunas) * passoX,
      y: l.margens.superior + Math.floor(i / l.colunas) * passoY,
    }),
  };
}

/** Divide a lista em páginas (fileiras no rolo). */
export function emPaginas<T>(itens: T[], porPagina: number): T[][] {
  const paginas: T[][] = [];
  for (let i = 0; i < itens.length; i += porPagina) paginas.push(itens.slice(i, i + porPagina));
  return paginas;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const entre = (v: unknown, min: number, max: number) => num(v) && v >= min && v <= max;

function validarOrigem(o: OrigemValor | undefined, onde: string, erros: string[]) {
  if (!o || typeof o !== 'object') return void erros.push(`${onde}: conteúdo ausente.`);
  switch (o.tipo) {
    case 'fixo':
      if (typeof o.texto !== 'string' || o.texto.length > LIMITES.textoFixo) erros.push(`${onde}: texto fixo inválido.`);
      break;
    case 'campo':
      if (typeof o.campo !== 'string' || !o.campo) erros.push(`${onde}: escolha o campo.`);
      if (o.formato && !['texto', 'numero', 'moeda', 'data'].includes(o.formato.tipo)) erros.push(`${onde}: formato inválido.`);
      if (o.formato && (o.formato.tipo === 'numero' || o.formato.tipo === 'moeda') && !entre(o.formato.casas, 0, 6))
        erros.push(`${onde}: casas decimais entre 0 e 6.`);
      if (o.formato?.tipo === 'data' && !FORMATOS_DATA.includes(o.formato.formato)) erros.push(`${onde}: formato de data inválido.`);
      break;
    case 'data':
      if (!entre(o.dias, -3650, 3650) || !FORMATOS_DATA.includes(o.formato)) erros.push(`${onde}: data inválida.`);
      break;
    case 'contador':
      if (!Number.isInteger(o.inicio) || !Number.isInteger(o.passo) || !entre(o.digitos, 0, 12))
        erros.push(`${onde}: contador inválido.`);
      break;
    default:
      erros.push(`${onde}: origem de conteúdo desconhecida.`);
  }
}

function validarElemento(el: ElementoEtiqueta, i: number, l: LayoutEtiqueta, erros: string[]) {
  const onde = `Elemento ${i + 1}`;
  if (typeof el.id !== 'string' || !el.id) erros.push(`${onde}: id ausente.`);
  if (![0, 90, 180, 270].includes(el.rotacao)) erros.push(`${onde}: rotação deve ser 0, 90, 180 ou 270.`);
  if (!entre(el.largura, 0.1, l.larguraMm + 0.01) || !entre(el.altura, 0.1, l.alturaMm + 0.01)) {
    erros.push(`${onde}: tamanho fora da etiqueta.`);
  }
  if (!entre(el.x, -0.01, l.larguraMm) || !entre(el.y, -0.01, l.alturaMm) || el.x + el.largura > l.larguraMm + 0.05 || el.y + el.altura > l.alturaMm + 0.05) {
    erros.push(`${onde}: posição fora da etiqueta.`);
  }
  switch (el.tipo) {
    case 'texto':
      validarOrigem(el.valor, onde, erros);
      if (!entre(el.tamanhoPt, LIMITES.tamanhoPt.min, LIMITES.tamanhoPt.max)) erros.push(`${onde}: tamanho da fonte inválido.`);
      if (!['esquerda', 'centro', 'direita'].includes(el.alinhamento)) erros.push(`${onde}: alinhamento inválido.`);
      if (typeof el.prefixo !== 'string' || typeof el.sufixo !== 'string' || el.prefixo.length > 50 || el.sufixo.length > 50)
        erros.push(`${onde}: prefixo/sufixo inválido.`);
      if (typeof el.negrito !== 'boolean') erros.push(`${onde}: negrito inválido.`);
      break;
    case 'codigo_barras':
      validarOrigem(el.valor, onde, erros);
      if (!SIMBOLOGIAS.includes(el.simbologia)) erros.push(`${onde}: simbologia inválida.`);
      if (typeof el.mostrarTexto !== 'boolean') erros.push(`${onde}: opção de texto inválida.`);
      break;
    case 'qrcode':
      validarOrigem(el.valor, onde, erros);
      break;
    case 'retangulo':
    case 'linha':
      if (!entre(el.espessuraMm, 0.1, 20)) erros.push(`${onde}: espessura inválida.`);
      if (el.tipo === 'retangulo' && typeof el.preenchido !== 'boolean') erros.push(`${onde}: preenchimento inválido.`);
      break;
    default:
      erros.push(`${onde}: tipo desconhecido.`);
  }
}

/** Valida o layout recebido da API (o JSON vem do navegador). Lista vazia = válido. */
export function validarLayout(l: LayoutEtiqueta): string[] {
  const erros: string[] = [];
  if (!l || typeof l !== 'object') return ['Layout ausente.'];
  if (!entre(l.larguraMm, LIMITES.tamanhoMm.min, LIMITES.tamanhoMm.max) || !entre(l.alturaMm, LIMITES.tamanhoMm.min, LIMITES.tamanhoMm.max)) {
    erros.push(`Tamanho da etiqueta entre ${LIMITES.tamanhoMm.min} e ${LIMITES.tamanhoMm.max} mm.`);
  }
  if (!Number.isInteger(l.colunas) || !entre(l.colunas, LIMITES.colunas.min, LIMITES.colunas.max)) erros.push('Colunas entre 1 e 20.');
  if (!entre(l.espacamentoHorizontalMm, 0, 100) || !entre(l.espacamentoVerticalMm, 0, 100)) erros.push('Espaçamento entre 0 e 100 mm.');
  const m = l.margens;
  if (!m || ![m.superior, m.inferior, m.esquerda, m.direita].every((v) => entre(v, 0, 100))) erros.push('Margens entre 0 e 100 mm.');
  if (!l.papel || (l.papel.tipo !== 'rolo' && l.papel.tipo !== 'folha')) erros.push('Tipo de papel inválido.');
  if (l.papel?.tipo === 'folha') {
    if (!entre(l.papel.larguraMm, LIMITES.papelMm.min, LIMITES.papelMm.max) || !entre(l.papel.alturaMm, LIMITES.papelMm.min, LIMITES.papelMm.max)) {
      erros.push('Tamanho da folha inválido.');
    } else if (erros.length === 0) {
      const larguraOcupada = m.esquerda + l.colunas * l.larguraMm + (l.colunas - 1) * l.espacamentoHorizontalMm + m.direita;
      if (larguraOcupada > l.papel.larguraMm + 0.01) erros.push(`As ${l.colunas} colunas não cabem na largura da folha.`);
      if (m.superior + l.alturaMm + m.inferior > l.papel.alturaMm + 0.01) erros.push('A etiqueta não cabe na altura da folha.');
    }
  }
  if (!Array.isArray(l.elementos)) return [...erros, 'Lista de elementos ausente.'];
  if (l.elementos.length > LIMITES.elementos) erros.push(`No máximo ${LIMITES.elementos} elementos.`);
  if (erros.length === 0) l.elementos.forEach((el, i) => validarElemento(el, i, l, erros));
  const ids = new Set(l.elementos.map((e) => e.id));
  if (ids.size !== l.elementos.length) erros.push('Há elementos com id repetido.');
  return erros;
}

/** Campos de consulta usados pelo layout (para avisar quando a consulta não os tem mais). */
export function camposUsados(l: LayoutEtiqueta): string[] {
  const nomes = new Set<string>();
  for (const el of l.elementos) {
    if ('valor' in el && el.valor.tipo === 'campo') nomes.add(el.valor.campo);
  }
  return [...nomes];
}
