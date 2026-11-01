import type { Request } from 'express';

/** Usuário carregado do banco a cada requisição pelo AuthGuard. */
export interface UsuarioRequisicao {
  id: string;
  empresaId: string | null;
  superAdmin: boolean;
  permissoes: string[];
  /** Sessão do navegador; token antigo, sem sessão, fica sem. */
  sessaoId?: string;
}

export interface RequisicaoAutenticada extends Request {
  usuario?: UsuarioRequisicao;
}
