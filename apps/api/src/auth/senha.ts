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

// Bloqueio por conta --------------------------------------------------------------------------
// O limite por IP (Throttle) não segura quem tenta a mesma conta de vários endereços: depois de
// FALHAS_SENHA_ATE_BLOQUEAR senhas erradas seguidas, a conta não aceita senha por um tempo, nem a
// certa. Vale para usuários das empresas e entregadores; redefinir a senha libera na hora.

export const FALHAS_SENHA_ATE_BLOQUEAR = 10;
export const BLOQUEIO_SENHA_MS = 15 * 60_000;
export const MENSAGEM_SENHA_BLOQUEADA = 'Muitas tentativas com a senha errada nesta conta. Aguarde 15 minutos ou use "Esqueci minha senha".';

export const senhaBloqueada = (ate: Date | null | undefined, agora = new Date()) => !!ate && ate.getTime() > agora.getTime();

/** Depois de mais uma senha errada: chegou ao limite, bloqueia e zera a contagem. */
export function aposSenhaErrada(falhasAgora: number, agora = new Date()): { senhaFalhas: number; senhaBloqueadaAte: Date | null } | null {
  return falhasAgora >= FALHAS_SENHA_ATE_BLOQUEAR ? { senhaFalhas: 0, senhaBloqueadaAte: new Date(agora.getTime() + BLOQUEIO_SENHA_MS) } : null;
}
