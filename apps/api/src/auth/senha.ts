import { compare, hash } from 'bcryptjs';

const CUSTO = 10;

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, CUSTO);
}

export function conferirSenha(senha: string, senhaHash: string): Promise<boolean> {
  return compare(senha, senhaHash);
}

let hashFicticio: Promise<string> | null = null;

/** Gasta o mesmo tempo de uma comparação real, para não revelar se o e-mail existe. */
export async function compararComHashFicticio(senha: string): Promise<false> {
  hashFicticio ??= gerarHashSenha('senha-ficticia-para-tempo-constante');
  await compare(senha, await hashFicticio);
  return false;
}
