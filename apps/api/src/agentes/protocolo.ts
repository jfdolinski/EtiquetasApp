import type { OpcoesConexao, TipoConexao } from '@etiquetas/shared';

/**
 * Mensagens do WebSocket API ↔ agente (JSON, uma por frame). Espelho em
 * apps/agent/internal/protocolo; documentação em apps/agent/PROTOCOLO.md.
 */

export const VERSAO_PROTOCOLO = 1;
export const CAMINHO_WS_AGENTE = '/api/agente/conectar';

export interface Mensagem<T = unknown> {
  tipo: string;
  /** Presente em requisições que esperam `resposta` e na própria resposta. */
  id?: string;
  dados?: T;
}

// Servidor → agente

export interface ConexaoParaAgente {
  id: string;
  nome: string;
  tipo: TipoConexao;
  host: string;
  porta: number;
  banco: string;
  usuario: string;
  senha: string;
  opcoes: OpcoesConexao;
}

/** `configuracao`: enviada ao conectar e sempre que as conexões do agente mudam. */
export interface DadosConfiguracao {
  agenteNome: string;
  empresaNome: string;
  /** CNPJ sem máscara, para o painel do agente exibir. */
  empresaCnpj: string;
  conexoes: ConexaoParaAgente[];
}

/**
 * `consultar`: SQL somente leitura. Os parâmetros já vêm na sintaxe do driver
 * ($1 no PostgreSQL, ? no MySQL, @p1 no SQL Server).
 */
export interface DadosConsultar {
  conexaoId: string;
  sql: string;
  parametros: unknown[];
  limiteLinhas: number;
  tempoLimiteSegundos: number;
}

/** `listar_arquivos`: planilhas da pasta de uma conexão PASTA. */
export interface DadosListarArquivos {
  conexaoId: string;
}

export interface ResultadoListarArquivos {
  arquivos: { caminho: string; tamanho: number; modificadoEm: string }[];
}

/** `ler_arquivo`: linhas brutas de uma aba, já filtradas por `termo`; a primeira é o título. */
export interface DadosLerArquivo {
  conexaoId: string;
  caminho: string;
  aba: string;
  termo: string;
  limiteLinhas: number;
}

export interface ResultadoLerArquivo {
  abas: string[];
  aba: string;
  linhas: unknown[][];
  truncado: boolean;
  duracaoMs: number;
}

/** `testar_conexao` */
export interface DadosTestarConexao {
  conexaoId: string;
}

/** `rotacionar_token`: o agente grava o novo token e só então responde ok. */
export interface DadosRotacionarToken {
  token: string;
}

/**
 * `imprimir`: bytes prontos na linguagem da impressora (base64). O agente responde ok
 * depois de entregar tudo à impressora (rede) ou ao spooler (impressora do sistema).
 */
export interface DadosImprimir {
  trabalhoId: string;
  metodo: 'REDE' | 'SISTEMA';
  /** IP:porta (REDE) ou nome da impressora no sistema (SISTEMA). */
  endereco: string;
  /** Nome do documento no spooler. */
  nome: string;
  dados: string;
}

/**
 * `notificar`: o agente guarda e o painel da bandeja mostra o balão do Windows. O `id` muda a cada
 * repetição do aviso. Versão antiga do agente responde erro de tipo não suportado.
 */
export interface DadosNotificar {
  id: string;
  titulo: string;
  mensagem: string;
  nivel: 'info' | 'aviso' | 'erro';
  em: string;
}

// Agente → servidor

/** `ola`: primeira mensagem depois de conectar. */
export interface DadosOla {
  versao: string;
  protocolo: number;
  hostname: string;
  sistemaOperacional: string;
}

/** `resposta` a uma requisição com `id`. */
export type DadosResposta<T = unknown> = { ok: true; resultado: T } | { ok: false; erro: { codigo: string; mensagem: string } };
