import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIODO_S = 30;
/** Passos aceitos antes e depois do atual: tolera 30 s de diferença no relógio do celular. */
const JANELA = 1;

export function paraBase32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
    valor &= (1 << bits) - 1;
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Buffer {
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const c of texto.toUpperCase()) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) continue;
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
      valor &= (1 << bits) - 1;
    }
  }
  return Buffer.from(saida);
}

export function gerarSegredoTotp(): string {
  return paraBase32(randomBytes(20));
}

/** Código de 6 dígitos de um passo (RFC 6238 com SHA-1, o que os aplicativos autenticadores usam). */
export function codigoDoPasso(segredo: Buffer, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac('sha1', segredo).update(contador).digest();
  const inicio = hmac[hmac.length - 1] & 0xf;
  const numero = hmac.readUInt32BE(inicio) & 0x7fffffff;
  return String(numero % 1_000_000).padStart(6, '0');
}

/** Devolve o passo do código, para recusar o mesmo código duas vezes; null se não confere. */
export function conferirTotp(segredoBase32: string, codigo: string, agora = Date.now()): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const segredo = deBase32(segredoBase32);
  const atual = Math.floor(agora / 1000 / PERIODO_S);
  for (let passo = atual - JANELA; passo <= atual + JANELA; passo++) {
    const esperado = Buffer.from(codigoDoPasso(segredo, passo));
    if (timingSafeEqual(esperado, Buffer.from(codigo))) return passo;
  }
  return null;
}

export function uriTotp(segredoBase32: string, email: string): string {
  const emissor = 'Etiquetas';
  return `otpauth://totp/${encodeURIComponent(`${emissor}:${email}`)}?secret=${segredoBase32}&issuer=${emissor}&algorithm=SHA1&digits=6&period=${PERIODO_S}`;
}

/** Códigos de uso único para quem perdeu o celular. Só o hash fica no banco. */
export function gerarCodigosRecuperacao(quantidade = 8): string[] {
  return Array.from({ length: quantidade }, () => {
    const t = paraBase32(randomBytes(5));
    return `${t.slice(0, 4)}-${t.slice(4, 8)}`;
  });
}

export function hashDoCodigo(codigo: string): string {
  return createHash('sha256').update(codigo.trim().toUpperCase()).digest('hex');
}
