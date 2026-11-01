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

/** Dados públicos do CNPJ na Receita Federal, consultados em uma API gratuita para preencher o cadastro. */
export interface DadosCnpj {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  /** Situação cadastral, por exemplo "ATIVA" ou "BAIXADA". */
  situacao: string | null;
  municipio: string | null;
  uf: string | null;
  /** Provedor que respondeu (BrasilAPI, CNPJ.ws ou ReceitaWS). */
  fonte: string;
  /** Id da empresa da plataforma que já usa este CNPJ, se houver. */
  empresaExistenteId: string | null;
}

export interface UsuarioLogado {
  id: string;
  nome: string;
  email: string;
  superAdmin: boolean;
  empresa: Pick<EmpresaResumo, 'id' | 'razaoSocial' | 'nomeFantasia' | 'cnpj' | 'statusAssinatura'> | null;
  perfil: { id: string; nome: string } | null;
  permissoes: CodigoPermissao[];
  /** Verificação em duas etapas ativa. */
  doisFatores: boolean;
}

/** Senha certa, falta o código da verificação em duas etapas: reenviar o login com `codigo`. */
export interface LoginDesafio {
  precisaCodigo: true;
}

export interface SessaoResumo {
  id: string;
  descricao: string | null;
  ip: string | null;
  criadoEm: string;
  ultimoUsoEm: string;
  /** É a sessão desta requisição. */
  atual: boolean;
}

export interface IniciarDoisFatoresResposta {
  segredo: string;
  uri: string;
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

export interface CodigoVinculoResposta {
  /** Só existe nesta resposta: no banco fica o hash. */
  codigo: string;
  expiraEm: string;
}

export interface VincularAppResposta {
  token: string;
  /** Empresa em que o app opera (enviada em X-Empresa-Id quando o usuário é super-admin). */
  empresaId: string;
  usuario: UsuarioLogado;
}

export interface DispositivoResumo {
  id: string;
  nome: string;
  plataforma: 'ANDROID' | 'IOS';
  versaoApp: string | null;
  recebeAvisos: boolean;
  criadoEm: string;
  ultimoUsoEm: string;
  atual: boolean;
}

export interface SaudeSistema {
  agora: string;
  noArHaSegundos: number;
  memoriaMb: number;
  bancoBytes: number;
  tabelas: { nome: string; bytes: number }[];
  erros24h: number;
  erros: { id: string; metodo: string; rota: string; mensagem: string; criadoEm: string }[];
  filaImpressao: number;
  agentes: { ativados: number; online: number };
  emailConfigurado: boolean;
  pushConfigurado: boolean;
  retencao: { conteudoDias: number; auditoriaDias: number };
  ultimaFaxina: { em: string; conteudos: number; auditoria: number; listas: number; erro?: string } | null;
}
