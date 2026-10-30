import { bitmapNaCaixa, LADO_MAXIMO_IMAGEM_PX, type ElementoImagem, type LayoutEtiqueta } from '@etiquetas/shared';
import { arredondar } from './elementos';

/** Tamanho máximo do arquivo aceito antes da redução (a imagem guardada é bem menor). */
const TAMANHO_MAXIMO_ARQUIVO = 15 * 1024 * 1024;

function carregar(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem. Use PNG, JPG, GIF, WebP, BMP ou SVG.'));
    };
    img.src = url;
  });
}

/** Lê o arquivo, reduz para no máximo 480 px, põe fundo branco e converte em tons de cinza. */
export async function lerImagem(arquivo: File): Promise<Pick<ElementoImagem, 'nome' | 'larguraPx' | 'alturaPx' | 'cinza'>> {
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO) throw new Error('Imagem muito grande (máximo 15 MB).');
  const img = await carregar(arquivo);
  const w0 = img.naturalWidth || 300;
  const h0 = img.naturalHeight || 300;
  const fator = Math.min(1, LADO_MAXIMO_IMAGEM_PX / Math.max(w0, h0));
  const larguraPx = Math.max(1, Math.round(w0 * fator));
  const alturaPx = Math.max(1, Math.round(h0 * fator));
  const canvas = document.createElement('canvas');
  canvas.width = larguraPx;
  canvas.height = alturaPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, larguraPx, alturaPx);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, larguraPx, alturaPx);
  const rgba = ctx.getImageData(0, 0, larguraPx, alturaPx).data;
  let binario = '';
  for (let i = 0; i < rgba.length; i += 4) {
    // Luminância (Rec. 601).
    binario += String.fromCharCode(Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]));
  }
  return { nome: arquivo.name.slice(0, 200), larguraPx, alturaPx, cinza: btoa(binario) };
}

/** Caixa (mm) com a proporção da imagem, ocupando até 60% da etiqueta. */
export function caixaProporcional(layout: LayoutEtiqueta, larguraPx: number, alturaPx: number, maxFracao = 0.6) {
  const escala = Math.min((layout.larguraMm * maxFracao) / larguraPx, (layout.alturaMm * maxFracao) / alturaPx);
  return { largura: Math.max(1, arredondar(larguraPx * escala)), altura: Math.max(1, arredondar(alturaPx * escala)) };
}

export async function novaImagem(arquivo: File, layout: LayoutEtiqueta): Promise<ElementoImagem> {
  const dados = await lerImagem(arquivo);
  const { largura, altura } = caixaProporcional(layout, dados.larguraPx, dados.alturaPx);
  return {
    id: Math.random().toString(36).slice(2, 10),
    tipo: 'imagem',
    ...dados,
    x: arredondar((layout.larguraMm - largura) / 2),
    y: arredondar((layout.alturaMm - altura) / 2),
    largura,
    altura,
    rotacao: 0,
    limiar: 128,
    pontilhado: false,
  };
}

/** Pontos por mm da prévia: 203 dpi, a resolução mais comum das térmicas. */
const PONTOS_MM = 8;
const cache = new WeakMap<ElementoImagem, HTMLCanvasElement>();

/** Prévia em preto e branco, como sai na térmica (mesmo código dos geradores). */
export function canvasImagem(el: ElementoImagem): HTMLCanvasElement {
  let c = cache.get(el);
  if (c) return c;
  const b = bitmapNaCaixa(el, Math.max(1, Math.round(el.largura * PONTOS_MM)), Math.max(1, Math.round(el.altura * PONTOS_MM)));
  c = document.createElement('canvas');
  c.width = b.largura;
  c.height = b.altura;
  const ctx = c.getContext('2d')!;
  const dados = ctx.createImageData(b.largura, b.altura);
  for (let y = 0; y < b.altura; y++) {
    for (let x = 0; x < b.largura; x++) {
      const preto = b.dados[y * b.bytesPorLinha + (x >> 3)] & (0x80 >> (x & 7));
      const i = (y * b.largura + x) * 4;
      dados.data[i] = dados.data[i + 1] = dados.data[i + 2] = preto ? 17 : 255;
      dados.data[i + 3] = preto ? 255 : 0;
    }
  }
  ctx.putImageData(dados, 0, 0);
  cache.set(el, c);
  return c;
}
