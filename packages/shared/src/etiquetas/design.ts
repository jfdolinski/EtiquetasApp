import type { AlinhamentoVertical, CaixaTexto, Cor, ElementoPreco, ElementoTexto } from './tipos';

/**
 * Fontes disponíveis no editor e no PDF. As "padrão" são as 14 fontes-base do PDF; as demais
 * são do Google Fonts (licença OFL), empacotadas pelo Fontsource em `apps/api` e `apps/web`.
 */
export interface FonteCatalogo {
  id: string;
  nome: string;
  /** Família CSS no navegador. */
  familia: string;
  categoria: 'Padrão' | 'Sem serifa' | 'Arredondada' | 'Condensada' | 'Serifada' | 'Destaque' | 'Manuscrita' | 'Monoespaçada';
  /** Tem arquivo próprio de negrito/itálico (senão o PDF simula). */
  negrito: boolean;
  italico: boolean;
  /** Fonte padrão do PDF (Helvetica, Times, Courier), sem arquivo. */
  padraoPdf?: boolean;
}

export const FONTES: readonly FonteCatalogo[] = [
  { id: 'helvetica', nome: 'Helvetica', familia: 'Helvetica, Arial, sans-serif', categoria: 'Padrão', negrito: true, italico: true, padraoPdf: true },
  { id: 'times', nome: 'Times', familia: '"Times New Roman", Times, serif', categoria: 'Padrão', negrito: true, italico: true, padraoPdf: true },
  { id: 'courier', nome: 'Courier', familia: '"Courier New", Courier, monospace', categoria: 'Padrão', negrito: true, italico: true, padraoPdf: true },
  { id: 'roboto', nome: 'Roboto', familia: 'Roboto', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'open-sans', nome: 'Open Sans', familia: 'Open Sans', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'montserrat', nome: 'Montserrat', familia: 'Montserrat', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'lato', nome: 'Lato', familia: 'Lato', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'poppins', nome: 'Poppins', familia: 'Poppins', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'roboto-condensed', nome: 'Roboto Condensed', familia: 'Roboto Condensed', categoria: 'Condensada', negrito: true, italico: true },
  { id: 'oswald', nome: 'Oswald', familia: 'Oswald', categoria: 'Condensada', negrito: true, italico: false },
  { id: 'bebas-neue', nome: 'Bebas Neue', familia: 'Bebas Neue', categoria: 'Condensada', negrito: false, italico: false },
  { id: 'anton', nome: 'Anton', familia: 'Anton', categoria: 'Condensada', negrito: false, italico: false },
  { id: 'playfair-display', nome: 'Playfair Display', familia: 'Playfair Display', categoria: 'Serifada', negrito: true, italico: true },
  { id: 'merriweather', nome: 'Merriweather', familia: 'Merriweather', categoria: 'Serifada', negrito: true, italico: true },
  { id: 'archivo-black', nome: 'Archivo Black', familia: 'Archivo Black', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'bangers', nome: 'Bangers', familia: 'Bangers', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'lobster', nome: 'Lobster', familia: 'Lobster', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'pacifico', nome: 'Pacifico', familia: 'Pacifico', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'dancing-script', nome: 'Dancing Script', familia: 'Dancing Script', categoria: 'Manuscrita', negrito: true, italico: false },
  { id: 'permanent-marker', nome: 'Permanent Marker', familia: 'Permanent Marker', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'inter', nome: 'Inter', familia: 'Inter', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'nunito', nome: 'Nunito', familia: 'Nunito', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'raleway', nome: 'Raleway', familia: 'Raleway', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'ubuntu', nome: 'Ubuntu', familia: 'Ubuntu', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'rubik', nome: 'Rubik', familia: 'Rubik', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'work-sans', nome: 'Work Sans', familia: 'Work Sans', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'barlow', nome: 'Barlow', familia: 'Barlow', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'fira-sans', nome: 'Fira Sans', familia: 'Fira Sans', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'josefin-sans', nome: 'Josefin Sans', familia: 'Josefin Sans', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'exo-2', nome: 'Exo 2', familia: 'Exo 2', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'titillium-web', nome: 'Titillium Web', familia: 'Titillium Web', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'league-spartan', nome: 'League Spartan', familia: 'League Spartan', categoria: 'Sem serifa', negrito: true, italico: false },
  { id: 'dm-sans', nome: 'DM Sans', familia: 'DM Sans', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'mulish', nome: 'Mulish', familia: 'Mulish', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'karla', nome: 'Karla', familia: 'Karla', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'source-sans-3', nome: 'Source Sans 3', familia: 'Source Sans 3', categoria: 'Sem serifa', negrito: true, italico: true },
  { id: 'quicksand', nome: 'Quicksand', familia: 'Quicksand', categoria: 'Arredondada', negrito: true, italico: false },
  { id: 'comfortaa', nome: 'Comfortaa', familia: 'Comfortaa', categoria: 'Arredondada', negrito: true, italico: false },
  { id: 'fredoka', nome: 'Fredoka', familia: 'Fredoka', categoria: 'Arredondada', negrito: true, italico: false },
  { id: 'baloo-2', nome: 'Baloo 2', familia: 'Baloo 2', categoria: 'Arredondada', negrito: true, italico: false },
  { id: 'barlow-condensed', nome: 'Barlow Condensed', familia: 'Barlow Condensed', categoria: 'Condensada', negrito: true, italico: true },
  { id: 'archivo-narrow', nome: 'Archivo Narrow', familia: 'Archivo Narrow', categoria: 'Condensada', negrito: true, italico: true },
  { id: 'teko', nome: 'Teko', familia: 'Teko', categoria: 'Condensada', negrito: true, italico: false },
  { id: 'fjalla-one', nome: 'Fjalla One', familia: 'Fjalla One', categoria: 'Condensada', negrito: false, italico: false },
  { id: 'roboto-slab', nome: 'Roboto Slab', familia: 'Roboto Slab', categoria: 'Serifada', negrito: true, italico: false },
  { id: 'lora', nome: 'Lora', familia: 'Lora', categoria: 'Serifada', negrito: true, italico: true },
  { id: 'pt-serif', nome: 'PT Serif', familia: 'PT Serif', categoria: 'Serifada', negrito: true, italico: true },
  { id: 'libre-baskerville', nome: 'Libre Baskerville', familia: 'Libre Baskerville', categoria: 'Serifada', negrito: true, italico: true },
  { id: 'eb-garamond', nome: 'EB Garamond', familia: 'EB Garamond', categoria: 'Serifada', negrito: true, italico: true },
  { id: 'bree-serif', nome: 'Bree Serif', familia: 'Bree Serif', categoria: 'Serifada', negrito: false, italico: false },
  { id: 'abril-fatface', nome: 'Abril Fatface', familia: 'Abril Fatface', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'alfa-slab-one', nome: 'Alfa Slab One', familia: 'Alfa Slab One', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'lilita-one', nome: 'Lilita One', familia: 'Lilita One', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'righteous', nome: 'Righteous', familia: 'Righteous', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'russo-one', nome: 'Russo One', familia: 'Russo One', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'passion-one', nome: 'Passion One', familia: 'Passion One', categoria: 'Destaque', negrito: true, italico: false },
  { id: 'luckiest-guy', nome: 'Luckiest Guy', familia: 'Luckiest Guy', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'bungee', nome: 'Bungee', familia: 'Bungee', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'titan-one', nome: 'Titan One', familia: 'Titan One', categoria: 'Destaque', negrito: false, italico: false },
  { id: 'great-vibes', nome: 'Great Vibes', familia: 'Great Vibes', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'satisfy', nome: 'Satisfy', familia: 'Satisfy', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'kaushan-script', nome: 'Kaushan Script', familia: 'Kaushan Script', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'caveat', nome: 'Caveat', familia: 'Caveat', categoria: 'Manuscrita', negrito: true, italico: false },
  { id: 'sacramento', nome: 'Sacramento', familia: 'Sacramento', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'shadows-into-light', nome: 'Shadows Into Light', familia: 'Shadows Into Light', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'amatic-sc', nome: 'Amatic SC', familia: 'Amatic SC', categoria: 'Manuscrita', negrito: true, italico: false },
  { id: 'indie-flower', nome: 'Indie Flower', familia: 'Indie Flower', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'courgette', nome: 'Courgette', familia: 'Courgette', categoria: 'Manuscrita', negrito: false, italico: false },
  { id: 'roboto-mono', nome: 'Roboto Mono', familia: 'Roboto Mono', categoria: 'Monoespaçada', negrito: true, italico: true },
];

export const FONTE_PADRAO = 'helvetica';

export function fonteDoCatalogo(id: string | undefined): FonteCatalogo {
  return FONTES.find((f) => f.id === id) ?? FONTES[0];
}

/** Cores rápidas do seletor (cartazes de oferta). */
export const PALETA: readonly Cor[] = ['#000000', '#ffffff', '#d32f2f', '#ffd600', '#ff6d00', '#2e7d32', '#1565c0', '#6a1b9a', '#ec407a', '#795548', '#9e9e9e', '#fff3e0'];

export const COR_HEX = /^#[0-9a-fA-F]{6}$/;

export function corRgb(cor: Cor | undefined | null, padrao = '#000000'): [number, number, number] {
  const c = cor && COR_HEX.test(cor) ? cor : padrao;
  return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
}

/** Cor que uma térmica imprime como preto (clara demais = não imprime). */
export function corEscura(cor: Cor | undefined | null): boolean {
  const [r, g, b] = corRgb(cor);
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.6;
}

export function aplicarCaixa(texto: string, caixa: CaixaTexto | undefined): string {
  return caixa === 'maiusculas' ? texto.toLocaleUpperCase('pt-BR') : caixa === 'minusculas' ? texto.toLocaleLowerCase('pt-BR') : texto;
}

/** Mede a largura (pt) de um texto sem espaçamento extra, no tamanho e estilo pedidos. */
export type Medidor = (texto: string, tamanhoPt: number) => number;

export const ALTURA_LINHA_PADRAO = 1.15;
const TAMANHO_MINIMO_AJUSTE = 4;

/** Proporção da altura das maiúsculas sobre o tamanho da fonte (aproximação comum às fontes). */
export const ALTURA_MAIUSCULAS = 0.72;

function larguraCom(medir: Medidor, texto: string, tamanho: number, espacamento: number) {
  return medir(texto, tamanho) + espacamento * Math.max(0, [...texto].length - 1);
}

/** Quebra por palavra (palavra longa demais é cortada por caractere) e respeita "\n". */
export function quebrarLinhas(texto: string, largura: number, tamanho: number, medir: Medidor, espacamento = 0): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split('\n')) {
    let atual = '';
    for (const palavra of paragrafo.split(/ +/)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (larguraCom(medir, tentativa, tamanho, espacamento) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      atual = '';
      // Palavra sozinha maior que a linha: corta por caractere.
      let pedaco = '';
      for (const ch of palavra) {
        if (pedaco && larguraCom(medir, pedaco + ch, tamanho, espacamento) > largura) {
          linhas.push(pedaco);
          pedaco = '';
        }
        pedaco += ch;
      }
      atual = pedaco;
    }
    linhas.push(atual);
  }
  return linhas;
}

export interface TextoDiagramado {
  tamanhoPt: number;
  linhas: string[];
  /** Distância entre linhas de base (pt). */
  entrelinha: number;
  /** Deslocamento do topo do bloco dentro da caixa (pt), pelo alinhamento vertical. */
  topo: number;
}

function deslocamentoVertical(alinhamento: AlinhamentoVertical | undefined, espaco: number, ocupado: number) {
  const sobra = espaco - ocupado;
  return alinhamento === 'meio' ? sobra / 2 : alinhamento === 'base' ? sobra : 0;
}

/**
 * Diagrama o texto numa caixa de `comprimento` × `espessura` pt (já considerando a rotação):
 * quebra as linhas e, com `ajustar`, reduz a fonte até caber. Sem `ajustar`, corta as linhas
 * que não cabem (como antes).
 */
export function diagramarTexto(
  el: Pick<ElementoTexto, 'tamanhoPt' | 'ajustar' | 'alturaLinha' | 'espacamentoLetras' | 'alinhamentoVertical'>,
  texto: string,
  comprimento: number,
  espessura: number,
  medir: Medidor,
): TextoDiagramado {
  const fator = el.alturaLinha ?? ALTURA_LINHA_PADRAO;
  const espacamento = el.espacamentoLetras ?? 0;
  const montar = (tamanho: number) => {
    const linhas = quebrarLinhas(texto, comprimento, tamanho, medir, espacamento);
    return { tamanho, linhas, altura: tamanho + (linhas.length - 1) * tamanho * fator };
  };
  let r = montar(el.tamanhoPt);
  if (el.ajustar) {
    const cabe = (x: ReturnType<typeof montar>) =>
      x.altura <= espessura + 0.01 && x.linhas.every((l) => larguraCom(medir, l, x.tamanho, espacamento) <= comprimento + 0.01);
    // Busca binária do maior tamanho que cabe.
    if (!cabe(r)) {
      let lo = TAMANHO_MINIMO_AJUSTE;
      let hi = el.tamanhoPt;
      let melhor = montar(lo);
      for (let i = 0; i < 14; i++) {
        const meio = (lo + hi) / 2;
        const t = montar(meio);
        if (cabe(t)) {
          melhor = t;
          lo = meio;
        } else hi = meio;
      }
      r = melhor;
    }
  } else {
    const maxLinhas = Math.max(1, Math.floor((espessura - r.tamanho) / (r.tamanho * fator) + 1.15));
    if (r.linhas.length > maxLinhas) r = { ...r, linhas: r.linhas.slice(0, maxLinhas), altura: r.tamanho + (maxLinhas - 1) * r.tamanho * fator };
  }
  return { tamanhoPt: r.tamanho, linhas: r.linhas, entrelinha: r.tamanho * fator, topo: Math.max(0, deslocamentoVertical(el.alinhamentoVertical, espessura, r.altura)) };
}

/** Linha pronta para desenhar: `u` ao longo do texto e `v` = linha de base, a partir do canto da caixa (pt). */
export interface LinhaPlanejada {
  texto: string;
  u: number;
  v: number;
  largura: number;
}

/** Linha de base da primeira linha abaixo do topo do bloco, em frações do tamanho. */
export const ASCENDENTE = 0.8;

/** Texto diagramado e alinhado: o PDF e o editor desenham exatamente estas linhas. */
export function planejarTexto(
  el: Pick<ElementoTexto, 'tamanhoPt' | 'ajustar' | 'alturaLinha' | 'espacamentoLetras' | 'alinhamentoVertical' | 'alinhamento'>,
  texto: string,
  comprimento: number,
  espessura: number,
  medir: Medidor,
): { tamanhoPt: number; linhas: LinhaPlanejada[] } {
  const d = diagramarTexto(el, texto, comprimento, espessura, medir);
  const espacamento = el.espacamentoLetras ?? 0;
  return {
    tamanhoPt: d.tamanhoPt,
    linhas: d.linhas.map((t, i) => {
      const largura = larguraCom(medir, t, d.tamanhoPt, espacamento);
      const sobra = comprimento - largura;
      const u = el.alinhamento === 'centro' ? sobra / 2 : el.alinhamento === 'direita' ? sobra : 0;
      return { texto: t, u, v: d.topo + d.tamanhoPt * ASCENDENTE + i * d.entrelinha, largura };
    }),
  };
}

/** Preço já formatado ("1.234,56") a partir do valor resolvido; null se não for número. */
export function formatarPreco(valor: string): string | null {
  let v = valor.trim().replace(/^R\$\s*/i, '');
  if (!v) return null;
  // "1.234,56" (pt-BR) ou "1234.56"/"1234,5" (banco/digitado).
  if (/,\d{1,}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface PedacoPreco {
  texto: string;
  tamanhoPt: number;
  /** Início ao longo do texto (pt), a partir da borda da caixa. */
  u: number;
  /** Linha de base (pt) a partir do topo da caixa. */
  v: number;
}

/**
 * Posiciona símbolo, reais e centavos. `texto` é a saída de `textoDoElemento` ("R$ 9,99").
 * Com `ajustar`, o tamanho é o maior que cabe na caixa (útil em cartaz).
 */
export function diagramarPreco(el: ElementoPreco, texto: string, comprimento: number, espessura: number, medir: Medidor): PedacoPreco[] {
  const semSimbolo = el.simbolo && texto.startsWith(el.simbolo) ? texto.slice(el.simbolo.length).trim() : texto;
  const m = semSimbolo.match(/^(.*?)(,\d+)$/);
  const pequeno = 0.45;
  const pecas = (t: number) => {
    if (!el.centavosSobrescritos || !m) return [{ texto, tamanhoPt: t, topo: false }];
    const p: { texto: string; tamanhoPt: number; topo: boolean }[] = [];
    if (el.simbolo) p.push({ texto: `${el.simbolo} `, tamanhoPt: t * pequeno, topo: true });
    p.push({ texto: m[1], tamanhoPt: t, topo: false }, { texto: m[2], tamanhoPt: t * pequeno, topo: true });
    return p;
  };
  const largura = (t: number) => pecas(t).reduce((s, p) => s + medir(p.texto, p.tamanhoPt), 0);
  let tamanho = el.tamanhoPt;
  if (el.ajustar) tamanho = Math.max(TAMANHO_MINIMO_AJUSTE, Math.min((comprimento * tamanho) / Math.max(1, largura(tamanho)), espessura / ALTURA_MAIUSCULAS) * 0.98);
  const total = largura(tamanho);
  const altura = tamanho * ALTURA_MAIUSCULAS;
  let u = el.alinhamento === 'centro' ? (comprimento - total) / 2 : el.alinhamento === 'direita' ? comprimento - total : 0;
  const topo = Math.max(0, deslocamentoVertical(el.alinhamentoVertical ?? 'meio', espessura, altura));
  return pecas(tamanho).map((p) => {
    const r = { texto: p.texto, tamanhoPt: p.tamanhoPt, u, v: topo + (p.topo ? p.tamanhoPt * ALTURA_MAIUSCULAS : altura) };
    u += medir(p.texto, p.tamanhoPt);
    return r;
  });
}

/** Contorno da estrela (pontos em mm relativos ao canto da caixa), começando pela ponta de cima. */
export function pontosEstrela(largura: number, altura: number, pontas: number, raioInterno: number): [number, number][] {
  const cx = largura / 2;
  const cy = altura / 2;
  const r: [number, number][] = [];
  for (let i = 0; i < pontas * 2; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / pontas;
    const f = i % 2 === 0 ? 1 : raioInterno;
    r.push([cx + Math.cos(ang) * cx * f, cy + Math.sin(ang) * cy * f]);
  }
  return r;
}

/** Tamanhos de papel para cartazes (mm, retrato). */
export const PAPEIS_CARTAZ = {
  A6: [105, 148],
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  Carta: [215.9, 279.4],
  Ofício: [215.9, 355.6],
} as const;
