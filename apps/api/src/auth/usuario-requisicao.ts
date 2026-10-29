import type { Request } from 'express';

/** Usuário carregado do banco a cada requisição pelo AuthGuard. */
export interface UsuarioRequisicao {
  id: string;
  empresaId: string | null;
  superAdmin: boolean;
  permissoes: string[];
}

export interface RequisicaoAutenticada extends Request {
  usuario?: UsuarioRequisicao;
}
