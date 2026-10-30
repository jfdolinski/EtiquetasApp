import { deflateSync } from 'node:zlib';
import type { RasterCinza } from '@etiquetas/shared';

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** PNG em tons de cinza de 8 bits (para o pdf-lib, que só embute PNG e JPEG). */
export function pngCinza(r: RasterCinza): Buffer {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(r.largura, 0);
  cabecalho.writeUInt32BE(r.altura, 4);
  cabecalho.writeUInt8(8, 8); // bits por amostra
  cabecalho.writeUInt8(0, 9); // tons de cinza
  // Cada linha começa com o filtro 0 (nenhum).
  const linhas = Buffer.alloc((r.largura + 1) * r.altura);
  for (let y = 0; y < r.altura; y++) {
    linhas[y * (r.largura + 1)] = 0;
    linhas.set(r.pixels.subarray(y * r.largura, (y + 1) * r.largura), y * (r.largura + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', deflateSync(linhas)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}
