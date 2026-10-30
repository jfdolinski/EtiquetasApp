import type { LinguagemImpressora, Registro } from './etiquetas/tipos';

/**
 * Lista do dia, etiquetas avulsas e trabalhos de impressão.
 *
 * Convenções de colunas nas consultas da lista do dia (sem diferenciar maiúsculas):
 * - identificação do produto: `codigo`, `cod`, `id`, `ean`, `codigo_barras` (a primeira que existir);
 * - nome exibido na lista: `descricao`, `nome`, `produto`;
 * - quantidade de etiquetas: `quantidade`, `qtd`, `qtde`, `qtd_etiquetas` (padrão 1).
 */

const COLUNAS_CHAVE = ['codigo', 'cod', 'id', 'ean', 'codigo_barras'];
const COLUNAS_DESCRICAO = ['descricao', 'nome', 'produto'];
const COLUNAS_QUANTIDADE = ['quantidade', 'qtd', 'qtde', 'qtd_etiquetas'];
export const QUANTIDADE_MAXIMA_ITEM = 999;

function coluna(registro: Registro, nomes: string[]): unknown {
  const chaves = Object.keys(registro);
  for (const n of nomes) {
    const k = chaves.find((c) => c.toLowerCase() === n);
    if (k !== undefined && registro[k] !== null && registro[k] !== undefined && registro[k] !== '') return registro[k];
  }
  return undefined;
}

/** Identifica o produto na lista (para não repetir o que já foi impresso hoje). */
export function chaveDoRegistro(registro: Registro): string {
  const v = coluna(registro, COLUNAS_CHAVE);
  if (v !== undefined) return String(v).slice(0, 200);
  return JSON.stringify(registro).slice(0, 200);
}

export function descricaoDoRegistro(registro: Registro): string {
  const v = coluna(registro, COLUNAS_DESCRICAO) ?? Object.values(registro).find((x) => typeof x === 'string' && x.trim());
  return String(v ?? chaveDoRegistro(registro)).slice(0, 300);
}

export function quantidadeDoRegistro(registro: Registro): number {
  const n = Number(coluna(registro, COLUNAS_QUANTIDADE));
  return Number.isFinite(n) && n >= 1 ? Math.min(QUANTIDADE_MAXIMA_ITEM, Math.floor(n)) : 1;
}

export type StatusItemLista = 'PENDENTE' | 'NA_FILA' | 'IMPRESSO' | 'DESCARTADO';
export type StatusTrabalho = 'PENDENTE' | 'ENVIANDO' | 'CONCLUIDO' | 'ERRO' | 'CANCELADO';
export type OrigemTrabalho = 'LISTA' | 'AVULSA' | 'AGENDAMENTO';

export const ROTULO_STATUS_TRABALHO: Record<StatusTrabalho, string> = {
  PENDENTE: 'Aguardando',
  ENVIANDO: 'Enviando',
  CONCLUIDO: 'Impresso',
  ERRO: 'Erro',
  CANCELADO: 'Cancelado',
};

export interface ItemListaResumo {
  id: string;
  modeloId: string;
  impressoraId: string | null;
  chave: string;
  descricao: string;
  quantidade: number;
  status: StatusItemLista;
  impressoEm: string | null;
  trabalhoId: string | null;
}

/** Erro ao montar a parte de um modelo (agente offline, SQL com erro…). */
export interface ErroLista {
  modeloId: string;
  modeloNome: string;
  mensagem: string;
}

export interface ListaDiariaResumo {
  id: string;
  /** AAAA-MM-DD no fuso da plataforma. */
  data: string;
  atualizadaEm: string;
  erros: ErroLista[];
  itens: ItemListaResumo[];
  /** Nomes para agrupar a tela por impressora → modelo. */
  modelos: { id: string; nome: string }[];
  impressoras: { id: string; nome: string; linguagem: LinguagemImpressora }[];
}

export interface TrabalhoResumo {
  id: string;
  origem: OrigemTrabalho;
  status: StatusTrabalho;
  linguagem: LinguagemImpressora;
  quantidadeEtiquetas: number;
  modeloNome: string;
  impressoraId: string | null;
  impressoraNome: string;
  tentativas: number;
  erro: string | null;
  criadoPor: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}

export interface ImprimirResposta {
  trabalhos: TrabalhoResumo[];
  /** Grupos não enviados (ex.: modelo sem impressora) e avisos dos geradores. */
  avisos: string[];
}

/** Modelo disponível para etiqueta avulsa: consulta de busca e os parâmetros que ela pede. */
export interface ModeloAvulso {
  id: string;
  nome: string;
  impressoraId: string | null;
  parametros: string[];
  /** Campos do modelo: colunas da consulta e campos usados no layout (para incluir linhas à mão). */
  campos: string[];
}

export interface BuscaAvulsaResposta {
  registros: Registro[];
  /** Colunas para mostrar o resultado. */
  colunas: string[];
}
