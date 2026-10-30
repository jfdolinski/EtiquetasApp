import { inflateSync } from 'node:zlib';

/**
 * Converte WOFF 1.0 em TTF/OTF: descomprime cada tabela (zlib) e remonta o arquivo sfnt.
 * O fontkit lê WOFF com falhas em algumas fontes do Fontsource; TTF ele lê bem.
 */
export function woffParaSfnt(woff: Buffer): Buffer {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Arquivo não é WOFF 1.0.');
  const flavor = woff.readUInt32BE(4);
  const numTabelas = woff.readUInt16BE(12);
  const tabelas: { tag: Buffer; checksum: number; dados: Buffer }[] = [];
  for (let i = 0; i < numTabelas; i++) {
    const p = 44 + i * 20;
    const offset = woff.readUInt32BE(p + 4);
    const tamanhoComprimido = woff.readUInt32BE(p + 8);
    const tamanhoOriginal = woff.readUInt32BE(p + 12);
    const bruto = woff.subarray(offset, offset + tamanhoComprimido);
    tabelas.push({
      tag: woff.subarray(p, p + 4),
      checksum: woff.readUInt32BE(p + 16),
      dados: tamanhoComprimido < tamanhoOriginal ? inflateSync(bruto) : Buffer.from(bruto),
    });
  }
  let potencia = 1;
  let expoente = 0;
  while (potencia * 2 <= numTabelas) {
    potencia *= 2;
    expoente++;
  }
  const cabecalho = Buffer.alloc(12 + 16 * numTabelas);
  cabecalho.writeUInt32BE(flavor, 0);
  cabecalho.writeUInt16BE(numTabelas, 4);
  cabecalho.writeUInt16BE(potencia * 16, 6);
  cabecalho.writeUInt16BE(expoente, 8);
  cabecalho.writeUInt16BE(numTabelas * 16 - potencia * 16, 10);
  const partes: Buffer[] = [cabecalho];
  let offset = cabecalho.length;
  tabelas.forEach((t, i) => {
    const r = 12 + i * 16;
    t.tag.copy(cabecalho, r);
    cabecalho.writeUInt32BE(t.checksum, r + 4);
    cabecalho.writeUInt32BE(offset, r + 8);
    cabecalho.writeUInt32BE(t.dados.length, r + 12);
    const preenchimento = (4 - (t.dados.length % 4)) % 4;
    partes.push(t.dados, Buffer.alloc(preenchimento));
    offset += t.dados.length + preenchimento;
  });
  return Buffer.concat(partes);
}
