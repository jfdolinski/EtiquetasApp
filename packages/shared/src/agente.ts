/**
 * Agente local e conexões de banco do ERP.
 *
 * O protocolo WebSocket entre a API e o agente está descrito em `apps/agent/PROTOCOLO.md`;
 * os tipos das mensagens ficam em `apps/api/src/agentes/protocolo.ts` (lado servidor) e
 * `apps/agent/internal/protocolo` (lado agente).
 */

export type TipoBanco = 'POSTGRES' | 'MYSQL' | 'SQLSERVER';

export const TIPOS_BANCO: readonly TipoBanco[] = ['POSTGRES', 'MYSQL', 'SQLSERVER'];

export const ROTULO_TIPO_BANCO: Record<TipoBanco, string> = {
  POSTGRES: 'PostgreSQL',
  MYSQL: 'MySQL / MariaDB',
  SQLSERVER: 'SQL Server',
};

export const PORTA_PADRAO_BANCO: Record<TipoBanco, number> = {
  POSTGRES: 5432,
  MYSQL: 3306,
  SQLSERVER: 1433,
};

export interface AgenteResumo {
  id: string;
  nome: string;
  ativo: boolean;
  online: boolean;
  /** Já trocou o código de ativação por um token. */
  ativado: boolean;
  versao: string | null;
  hostname: string | null;
  sistemaOperacional: string | null;
  ultimoContatoEm: string | null;
  ativadoEm: string | null;
  /** Há um código de ativação pendente e ainda válido. */
  codigoAtivacaoExpiraEm: string | null;
  totalConexoes: number;
  criadoEm: string;
}

/** Devolvido uma única vez, ao criar o agente ou gerar novo código. */
export interface CodigoAtivacaoResposta {
  agente: AgenteResumo;
  codigo: string;
  expiraEm: string;
  /** CNPJ que o técnico digita junto com o código. */
  cnpj: string;
}

export interface AtivacaoAgenteResposta {
  token: string;
  agenteId: string;
  agenteNome: string;
  empresaNome: string;
}

export interface ConexaoBancoResumo {
  id: string;
  agenteId: string;
  nome: string;
  tipo: TipoBanco;
  host: string;
  porta: number;
  banco: string;
  usuario: string;
  /** A senha nunca volta para o navegador; só se sabe se há uma gravada. */
  temSenha: boolean;
  opcoes: OpcoesConexao;
  ativo: boolean;
  criadoEm: string;
}

export interface OpcoesConexao {
  /** PostgreSQL: disable | require | verify-full. MySQL: false | true | skip-verify. SQL Server: disable | true | false. */
  ssl?: string;
  /** SQL Server: instância nomeada (ex.: SQLEXPRESS). */
  instancia?: string;
  /** Tempo máximo de cada consulta, em segundos. */
  tempoLimiteSegundos?: number;
}

export interface ResultadoConsulta {
  colunas: { nome: string; tipo: string }[];
  linhas: unknown[][];
  /** Havia mais linhas que o limite pedido. */
  truncado: boolean;
  duracaoMs: number;
}

export interface ResultadoTesteConexao {
  ok: boolean;
  versaoServidor: string | null;
  duracaoMs: number;
}
