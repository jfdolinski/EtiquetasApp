import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

const VERSAO = 'v1';

/** AES-256-GCM. Formato: `v1:<iv>:<tag>:<cifrado>`, partes em base64. */
export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return [VERSAO, iv.toString('base64'), cifra.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

export function decifrar(valor: string, chave: Buffer): string {
  const [versao, iv, tag, cifrado] = valor.split(':');
  if (versao !== VERSAO || !iv || !tag || cifrado === undefined) throw new Error('Valor cifrado em formato inválido.');
  const decifra = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
  decifra.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decifra.update(Buffer.from(cifrado, 'base64')), decifra.final()]).toString('utf8');
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** Token do agente: 256 bits aleatórios. Só o hash fica no banco. */
export function gerarTokenAgente(): string {
  return `agt_${randomBytes(32).toString('base64url')}`;
}

// Sem 0/O, 1/I/L: o código é digitado pelo técnico na instalação.
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Código de ativação de uso único, ex.: `K7PX-3MQA`. */
export function gerarCodigoAtivacao(): string {
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

export function normalizarCodigoAtivacao(codigo: string): string {
  const limpo = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpo.length === 8 ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : limpo;
}
