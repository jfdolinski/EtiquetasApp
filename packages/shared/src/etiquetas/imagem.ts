import type { ElementoImagem, Rotacao } from './tipos';

/** Maior lado guardado no layout: suficiente para logotipos e mantém o modelo leve. */
export const LADO_MAXIMO_IMAGEM_PX = 480;

/** Imagem em tons de cinza: 0 = preto, 255 = branco. */
export interface RasterCinza {
  largura: number;
  altura: number;
  pixels: Uint8Array;
}

/** Imagem monocromática em linhas de `bytesPorLinha` bytes; bit 1 = ponto preto, bit mais alto à esquerda. */
export interface Bitmap {
  largura: number;
  altura: number;
  bytesPorLinha: number;
  dados: Uint8Array;
}

function decodificarBase64(b64: string): Uint8Array {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

const cacheCinza = new WeakMap<ElementoImagem, RasterCinza>();

/** Pixels do elemento (decodificados uma vez por objeto). */
export function cinzaDoElemento(el: ElementoImagem): RasterCinza {
  let r = cacheCinza.get(el);
  if (!r) {
    r = { largura: el.larguraPx, altura: el.alturaPx, pixels: decodificarBase64(el.cinza) };
    cacheCinza.set(el, r);
  }
  return r;
}

/** Redimensiona por média de área (redução) ou bilinear (ampliação). */
export function redimensionar(src: RasterCinza, largura: number, altura: number): RasterCinza {
  const out = new Uint8Array(largura * altura);
  const ex = src.largura / largura;
  const ey = src.altura / altura;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      let v: number;
      if (ex > 1 || ey > 1) {
        const x0 = Math.floor(x * ex);
        const x1 = Math.max(x0 + 1, Math.min(src.largura, Math.floor((x + 1) * ex)));
        const y0 = Math.floor(y * ey);
        const y1 = Math.max(y0 + 1, Math.min(src.altura, Math.floor((y + 1) * ey)));
        let soma = 0;
        for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) soma += src.pixels[sy * src.largura + sx];
        v = soma / ((x1 - x0) * (y1 - y0));
      } else {
        const fx = Math.max(0, (x + 0.5) * ex - 0.5);
        const fy = Math.max(0, (y + 0.5) * ey - 0.5);
        const x0 = Math.min(src.largura - 1, Math.floor(fx));
        const y0 = Math.min(src.altura - 1, Math.floor(fy));
        const x1 = Math.min(src.largura - 1, x0 + 1);
        const y1 = Math.min(src.altura - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const p = (px: number, py: number) => src.pixels[py * src.largura + px];
        v = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty;
      }
      out[y * largura + x] = Math.round(v);
    }
  }
  return { largura, altura, pixels: out };
}

/** Gira no sentido horário (mesma convenção dos demais elementos). */
export function girarCinza(src: RasterCinza, rotacao: Rotacao): RasterCinza {
  if (rotacao === 0) return src;
  const deitado = rotacao === 90 || rotacao === 270;
  const largura = deitado ? src.altura : src.largura;
  const altura = deitado ? src.largura : src.altura;
  const out = new Uint8Array(largura * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      // (x, y) no resultado ← (u, v) na imagem original.
      const [u, v] = rotacao === 90 ? [y, src.altura - 1 - x] : rotacao === 180 ? [src.largura - 1 - x, src.altura - 1 - y] : [src.largura - 1 - y, x];
      out[y * largura + x] = src.pixels[v * src.largura + u];
    }
  }
  return { largura, altura, pixels: out };
}

/** Converte para preto e branco: corte no limiar ou pontilhado Floyd–Steinberg. */
export function monocromatico(src: RasterCinza, limiar: number, pontilhado: boolean): Bitmap {
  const bytesPorLinha = Math.ceil(src.largura / 8);
  const dados = new Uint8Array(bytesPorLinha * src.altura);
  const erro = pontilhado ? Float32Array.from(src.pixels) : null;
  for (let y = 0; y < src.altura; y++) {
    for (let x = 0; x < src.largura; x++) {
      const i = y * src.largura + x;
      const v = erro ? erro[i] : src.pixels[i];
      const preto = v < limiar;
      if (preto) dados[y * bytesPorLinha + (x >> 3)] |= 0x80 >> (x & 7);
      if (erro) {
        const e = v - (preto ? 0 : 255);
        if (x + 1 < src.largura) erro[i + 1] += (e * 7) / 16;
        if (y + 1 < src.altura) {
          if (x > 0) erro[i + src.largura - 1] += (e * 3) / 16;
          erro[i + src.largura] += (e * 5) / 16;
          if (x + 1 < src.largura) erro[i + src.largura + 1] += e / 16;
        }
      }
    }
  }
  return { largura: src.largura, altura: src.altura, bytesPorLinha, dados };
}

/** Imagem em tons de cinza girada e no tamanho da caixa (em pontos da impressora). */
export function cinzaNaCaixa(el: ElementoImagem, largura: number, altura: number): RasterCinza {
  const deitado = el.rotacao === 90 || el.rotacao === 270;
  return girarCinza(redimensionar(cinzaDoElemento(el), deitado ? altura : largura, deitado ? largura : altura), el.rotacao);
}

const cacheBitmap = new WeakMap<ElementoImagem, Map<string, Bitmap>>();

/** Bitmap pronto para a impressora: o mesmo para todas as etiquetas do lote, por isso fica em cache. */
export function bitmapNaCaixa(el: ElementoImagem, largura: number, altura: number): Bitmap {
  let porTamanho = cacheBitmap.get(el);
  if (!porTamanho) cacheBitmap.set(el, (porTamanho = new Map()));
  const chave = `${largura}x${altura}`;
  let b = porTamanho.get(chave);
  if (!b) {
    b = monocromatico(cinzaNaCaixa(el, largura, altura), el.limiar, el.pontilhado);
    porTamanho.set(chave, b);
  }
  return b;
}

/** Hexadecimal maiúsculo (ZPL ^GF/~DG). */
export function bitmapEmHex(b: Bitmap): string {
  let s = '';
  for (const byte of b.dados) s += byte.toString(16).toUpperCase().padStart(2, '0');
  return s;
}
