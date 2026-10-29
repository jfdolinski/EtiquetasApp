import bwipjs from 'bwip-js/browser';
import { dadosCodigoBarras, type ElementoEtiqueta, type LayoutEtiqueta, type OrigemValor, type TipoElemento } from '@etiquetas/shared';

export const PASSO_MM = 0.5;

export function arredondar(mm: number, passo = PASSO_MM): number {
  return Math.round(mm / passo) * passo;
}

function novoId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Cria um elemento centralizado, no tamanho padrão de cada tipo e limitado à etiqueta. */
export function novoElemento(tipo: TipoElemento, layout: LayoutEtiqueta, origem?: OrigemValor): ElementoEtiqueta {
  const valor: OrigemValor = origem ?? { tipo: 'fixo', texto: tipo === 'qrcode' ? 'https://' : tipo === 'codigo_barras' ? '7891000000045' : 'Texto' };
  const caixa = (largura: number, altura: number) => {
    const l = Math.min(largura, layout.larguraMm);
    const a = Math.min(altura, layout.alturaMm);
    return { x: arredondar((layout.larguraMm - l) / 2), y: arredondar((layout.alturaMm - a) / 2), largura: l, altura: a, rotacao: 0 as const };
  };
  const id = novoId();
  switch (tipo) {
    case 'texto':
      return { id, tipo, ...caixa(Math.min(40, layout.larguraMm - 4), 6), valor, prefixo: '', sufixo: '', tamanhoPt: 10, negrito: false, alinhamento: 'esquerda' };
    case 'codigo_barras':
      return { id, tipo, ...caixa(Math.min(36, layout.larguraMm - 4), 14), valor, simbologia: 'EAN13', mostrarTexto: true };
    case 'qrcode':
      return { id, tipo, ...caixa(14, 14), valor };
    case 'retangulo':
      return { id, tipo, ...caixa(20, 10), espessuraMm: 0.3, preenchido: false };
    case 'linha':
      return { id, tipo, ...caixa(layout.larguraMm - 4, 0.5), espessuraMm: 0.3 };
  }
}

const GIRO = { 0: 'N', 90: 'R', 180: 'I', 270: 'L' } as const;
const BCID = { EAN13: 'ean13', EAN8: 'ean8', CODE128: 'code128', CODE39: 'code39' } as const;
const cache = new Map<string, HTMLCanvasElement | string>();

/**
 * Desenha código de barras/QR em um canvas (bwip-js, o mesmo usado no PDF).
 * Devolve a mensagem de erro quando o valor não serve para a simbologia.
 */
export function imagemCodigo(el: ElementoEtiqueta, texto: string): HTMLCanvasElement | string {
  if (el.tipo !== 'codigo_barras' && el.tipo !== 'qrcode') return '';
  let opcoes: Parameters<typeof bwipjs.toCanvas>[1];
  if (el.tipo === 'qrcode') {
    if (!texto) return 'QR code sem conteúdo';
    // eclevel é aceito pelo bwip-js, mas não está nos tipos dele.
    const qr = { bcid: 'qrcode', text: texto, scale: 3, eclevel: 'M', rotate: GIRO[el.rotacao] };
    opcoes = qr;
  } else {
    const d = dadosCodigoBarras(el.simbologia, texto);
    if ('erro' in d) return d.erro;
    opcoes = { bcid: BCID[el.simbologia], text: d.completo, scale: 2, height: 10, includetext: el.mostrarTexto, textxalign: 'center', rotate: GIRO[el.rotacao] };
  }
  const chave = JSON.stringify(opcoes);
  let r = cache.get(chave);
  if (!r) {
    try {
      r = bwipjs.toCanvas(document.createElement('canvas'), opcoes);
    } catch (e) {
      r = String((e as Error).message ?? e);
    }
    if (cache.size > 300) cache.clear();
    cache.set(chave, r);
  }
  return r;
}
