import { gerarEscpos } from './escpos';
import { gerarPpla } from './ppla';
import { gerarPplb } from './pplb';
import { gerarZpl } from './zpl';
import type { OpcoesGeracao } from './comum';
import type { LayoutEtiqueta, LinguagemImpressora, Registro, SaidaEtiquetas } from './tipos';

export * from './comum';
export * from './design';
export * from './escpos';
export * from './imagem';
export * from './layout';
export * from './ppla';
export * from './pplb';
export * from './tipos';
export * from './valores';
export * from './zpl';

/** Geradores de texto/bytes. PDF fica na API (depende de pdf-lib e bwip-js). */
export const GERADORES: Record<Exclude<LinguagemImpressora, 'PDF'>, (l: LayoutEtiqueta, r: Registro[], o: OpcoesGeracao) => SaidaEtiquetas> = {
  ZPL: gerarZpl,
  PPLA: gerarPpla,
  PPLB: gerarPplb,
  ESCPOS: gerarEscpos,
};
