// Desenha os ícones do aplicativo em código, como o do agente: uma etiqueta branca com código de barras.
//   node scripts/gerar-icones.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const AZUL = [0x1d, 0x4e, 0xd8, 255];
const BRANCO = [255, 255, 255, 255];
const PRETO = [0x0f, 0x17, 0x2a, 255];
const NADA = [0, 0, 0, 0];

function crc32(b) {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function bloco(tipo, dados) {
  const t = Buffer.concat([Buffer.from(tipo), dados]);
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(t));
  return Buffer.concat([tam, t, crc]);
}

function png(lado, cor) {
  const linhas = Buffer.alloc((lado * 4 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    const inicio = y * (lado * 4 + 1);
    for (let x = 0; x < lado; x++) Buffer.from(cor(x / lado, y / lado)).copy(linhas, inicio + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}

const BARRAS = [[0.34, 0.015], [0.365, 0.03], [0.41, 0.015], [0.44, 0.04], [0.495, 0.015], [0.525, 0.03], [0.57, 0.015], [0.6, 0.04], [0.655, 0.015]];

function etiqueta(x, y) {
  const dentro = x > 0.24 && x < 0.76 && y > 0.3 && y < 0.7;
  if (!dentro) return null;
  const barra = y > 0.38 && y < 0.62 && BARRAS.some(([i, l]) => x >= i && x < i + l);
  return barra ? PRETO : BRANCO;
}

mkdirSync('assets', { recursive: true });
writeFileSync('assets/icone.png', png(1024, (x, y) => etiqueta(x, y) ?? AZUL));
writeFileSync('assets/icone-frente.png', png(1024, (x, y) => etiqueta(x, y) ?? NADA));
