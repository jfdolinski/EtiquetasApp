import type { Request } from 'express';

/** Usuário carregado do banco a cada requisição pelo AuthGuard. */
export interface UsuarioRequisicao {
  id: string;
  empresaId: string | null;
  superAdmin: boolean;
  permissoes: string[];
  /** Sessão do navegador; token antigo, sem sessão, fica sem. */
  sessaoId?: string;
  /** Preenchido quando a requisição veio do aplicativo de celular. */
  dispositivoId?: string;
}

export interface RequisicaoAutenticada extends Request {
  usuario?: UsuarioRequisicao;
}
