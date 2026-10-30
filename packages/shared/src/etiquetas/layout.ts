import { LADO_MAXIMO_IMAGEM_PX } from './imagem';
import { COR_HEX, FONTES } from './design';
import { FORMATOS_DATA, SIMBOLOGIAS, type ElementoEtiqueta, type ElementoPreco, type ElementoTexto, type LayoutEtiqueta, type OrigemValor } from './tipos';

export const LIMITES = {
  /** Até A0 (cartazes). */
  tamanhoMm: { min: 5, max: 1200 },
  papelMm: { min: 20, max: 1200 },
  colunas: { min: 1, max: 20 },
  elementos: 300,
  textoFixo: 500,
  /** Até ~70 cm de altura de letra (preço em cartaz grande). */
  tamanhoPt: { min: 4, max: 2000 },
  /** Soma das imagens (base64 e data URLs) de um layout; o corpo da API aceita até 20 MB. */
  imagensBase64: 12_000_000,
  /** Cada imagem colorida (data URL). */
  imagemOriginal: 4_000_000,
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

const corOpcional = (c: unknown) => c === undefined || c === null || (typeof c === 'string' && COR_HEX.test(c));

function validarEstiloFonte(el: ElementoTexto | ElementoPreco, onde: string, erros: string[]) {
  if (!entre(el.tamanhoPt, LIMITES.tamanhoPt.min, LIMITES.tamanhoPt.max)) erros.push(`${onde}: tamanho da fonte inválido.`);
  if (!['esquerda', 'centro', 'direita'].includes(el.alinhamento)) erros.push(`${onde}: alinhamento inválido.`);
  if (typeof el.negrito !== 'boolean') erros.push(`${onde}: negrito inválido.`);
  if (el.fonte !== undefined && !FONTES.some((f) => f.id === el.fonte)) erros.push(`${onde}: fonte desconhecida.`);
  if (el.italico !== undefined && typeof el.italico !== 'boolean') erros.push(`${onde}: itálico inválido.`);
  if (!corOpcional(el.cor) || !corOpcional(el.corFundo)) erros.push(`${onde}: cor inválida.`);
  if (el.alinhamentoVertical !== undefined && !['topo', 'meio', 'base'].includes(el.alinhamentoVertical)) erros.push(`${onde}: alinhamento vertical inválido.`);
  if (el.contorno != null && (!corOpcional(el.contorno.cor) || !entre(el.contorno.espessuraPt, 0.1, 20))) erros.push(`${onde}: contorno inválido.`);
  if (el.ajustar !== undefined && typeof el.ajustar !== 'boolean') erros.push(`${onde}: opção de ajustar inválida.`);
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
  if (el.opacidade !== undefined && !entre(el.opacidade, 0, 1)) erros.push(`${onde}: opacidade entre 0 e 1.`);
  if (el.travado !== undefined && typeof el.travado !== 'boolean') erros.push(`${onde}: opção de travar inválida.`);
  switch (el.tipo) {
    case 'texto':
    case 'preco':
      validarOrigem(el.valor, onde, erros);
      validarEstiloFonte(el, onde, erros);
      if (el.tipo === 'texto') {
        if (typeof el.prefixo !== 'string' || typeof el.sufixo !== 'string' || el.prefixo.length > 50 || el.sufixo.length > 50)
          erros.push(`${onde}: prefixo/sufixo inválido.`);
        if (el.espacamentoLetras !== undefined && !entre(el.espacamentoLetras, -10, 100)) erros.push(`${onde}: espaçamento entre letras inválido.`);
        if (el.alturaLinha !== undefined && !entre(el.alturaLinha, 0.5, 4)) erros.push(`${onde}: altura da linha entre 0,5 e 4.`);
        if (el.caixa !== undefined && !['normal', 'maiusculas', 'minusculas'].includes(el.caixa)) erros.push(`${onde}: maiúsculas/minúsculas inválido.`);
        for (const k of ['sublinhado', 'tachado'] as const) if (el[k] !== undefined && typeof el[k] !== 'boolean') erros.push(`${onde}: ${k} inválido.`);
      } else {
        if (typeof el.simbolo !== 'string' || el.simbolo.length > 10) erros.push(`${onde}: símbolo da moeda inválido.`);
        if (typeof el.centavosSobrescritos !== 'boolean') erros.push(`${onde}: opção dos centavos inválida.`);
      }
      break;
    case 'codigo_barras':
      validarOrigem(el.valor, onde, erros);
      if (!SIMBOLOGIAS.includes(el.simbologia)) erros.push(`${onde}: simbologia inválida.`);
      if (typeof el.mostrarTexto !== 'boolean') erros.push(`${onde}: opção de texto inválida.`);
      break;
    case 'qrcode':
      validarOrigem(el.valor, onde, erros);
      break;
    case 'linha':
      if (!entre(el.espessuraMm, 0.1, 50)) erros.push(`${onde}: espessura inválida.`);
      if (!corOpcional(el.cor)) erros.push(`${onde}: cor inválida.`);
      if (el.tracejado !== undefined && typeof el.tracejado !== 'boolean') erros.push(`${onde}: tracejado inválido.`);
      break;
    case 'retangulo':
    case 'elipse':
    case 'estrela':
      if (!entre(el.espessuraMm, 0, 50)) erros.push(`${onde}: espessura da borda inválida.`);
      if (typeof el.preenchido !== 'boolean') erros.push(`${onde}: preenchimento inválido.`);
      if (!el.preenchido && el.espessuraMm < 0.1) erros.push(`${onde}: forma sem preenchimento precisa de borda.`);
      if (!corOpcional(el.corPreenchimento) || !corOpcional(el.corBorda)) erros.push(`${onde}: cor inválida.`);
      if (el.tracejado !== undefined && typeof el.tracejado !== 'boolean') erros.push(`${onde}: tracejado inválido.`);
      if (el.tipo === 'retangulo' && el.raioMm !== undefined && !entre(el.raioMm, 0, 600)) erros.push(`${onde}: raio dos cantos inválido.`);
      if (el.tipo === 'estrela' && (!Number.isInteger(el.pontas) || !entre(el.pontas, 3, 40) || !entre(el.raioInterno, 0.1, 0.95)))
        erros.push(`${onde}: estrela com pontas (3–40) ou raio interno (0,1–0,95) inválido.`);
      break;
    case 'imagem': {
      const lado = (v: unknown) => Number.isInteger(v) && entre(v, 1, LADO_MAXIMO_IMAGEM_PX);
      if (!lado(el.larguraPx) || !lado(el.alturaPx)) {
        erros.push(`${onde}: imagem com tamanho inválido (até ${LADO_MAXIMO_IMAGEM_PX} px).`);
        break;
      }
      const bytes = el.larguraPx * el.alturaPx;
      if (typeof el.cinza !== 'string' || el.cinza.length !== 4 * Math.ceil(bytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(el.cinza)) {
        erros.push(`${onde}: dados da imagem corrompidos.`);
      }
      if (!Number.isInteger(el.limiar) || !entre(el.limiar, 0, 255)) erros.push(`${onde}: limiar entre 0 e 255.`);
      if (typeof el.pontilhado !== 'boolean') erros.push(`${onde}: opção de pontilhado inválida.`);
      if (typeof el.nome !== 'string' || el.nome.length > 200) erros.push(`${onde}: nome da imagem inválido.`);
      if (
        el.original !== undefined &&
        (typeof el.original !== 'string' || el.original.length > LIMITES.imagemOriginal || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(el.original))
      ) {
        erros.push(`${onde}: imagem colorida inválida ou grande demais.`);
      }
      break;
    }
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
  if (!corOpcional(l.corFundo)) erros.push('Cor de fundo inválida.');
  const tamanhoImagens = l.elementos.reduce(
    (t, el) => t + (el?.tipo === 'imagem' ? (typeof el.cinza === 'string' ? el.cinza.length : 0) + (typeof el.original === 'string' ? el.original.length : 0) : 0),
    0,
  );
  if (tamanhoImagens > LIMITES.imagensBase64) erros.push('As imagens do modelo passam do limite; use imagens menores ou em menor quantidade.');
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
