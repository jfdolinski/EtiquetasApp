import type { CodigoPermissao } from './permissoes';

/** Contratos da API compartilhados entre `apps/api` e `apps/web`. Datas trafegam como string ISO. */

export type StatusAssinatura = 'ATIVA' | 'CARENCIA' | 'BLOQUEADA' | 'CANCELADA';

export const STATUS_ASSINATURA: readonly StatusAssinatura[] = ['ATIVA', 'CARENCIA', 'BLOQUEADA', 'CANCELADA'];

export interface EmpresaResumo {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  codigoErp: string | null;
  plano: string;
  statusAssinatura: StatusAssinatura;
  ativa: boolean;
  sistemaErpId: string | null;
  criadoEm: string;
  totalUsuarios?: number;
}

export interface UsuarioLogado {
  id: string;
  nome: string;
  email: string;
  superAdmin: boolean;
  empresa: Pick<EmpresaResumo, 'id' | 'razaoSocial' | 'nomeFantasia' | 'cnpj' | 'statusAssinatura'> | null;
  perfil: { id: string; nome: string } | null;
  permissoes: CodigoPermissao[];
}

export interface LoginResposta {
  token: string;
  usuario: UsuarioLogado;
  /** Mensagem de aviso exibida após o login (ex.: empresa em carência). */
  aviso: string | null;
}

export interface UsuarioResumo {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  perfil: { id: string; nome: string } | null;
  ultimoLoginEm: string | null;
  criadoEm: string;
}

export interface PermissaoResumo {
  codigo: CodigoPermissao;
  grupo: string;
  descricao: string;
}

export interface PerfilResumo {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: CodigoPermissao[];
  totalUsuarios: number;
}
