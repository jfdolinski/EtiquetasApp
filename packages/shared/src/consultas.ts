import type { ResultadoConsulta } from './agente';

/** Para que a consulta é usada. A lista do dia e a busca avulsa entram na Fase 5. */
export type FinalidadeConsulta = 'LISTA_DIARIA' | 'BUSCA_PRODUTO' | 'OUTRA';

export const FINALIDADES_CONSULTA: readonly FinalidadeConsulta[] = ['LISTA_DIARIA', 'BUSCA_PRODUTO', 'OUTRA'];

export const ROTULO_FINALIDADE: Record<FinalidadeConsulta, string> = {
  LISTA_DIARIA: 'Lista do dia',
  BUSCA_PRODUTO: 'Busca de produto (etiqueta avulsa)',
  OUTRA: 'Outra',
};

/** Categoria do campo para o editor de etiquetas (formatação e validação). */
export type CategoriaCampo = 'texto' | 'numero' | 'data' | 'data_hora' | 'booleano' | 'binario';

export const ROTULO_CATEGORIA: Record<CategoriaCampo, string> = {
  texto: 'Texto',
  numero: 'Número',
  data: 'Data',
  data_hora: 'Data e hora',
  booleano: 'Sim/não',
  binario: 'Binário',
};

/** Campo dinâmico: uma coluna devolvida pela consulta. */
export interface CampoDinamico {
  nome: string;
  /** Tipo informado pelo banco (ex.: VARCHAR, NUMERIC, INT4). */
  tipoBanco: string;
  categoria: CategoriaCampo;
}

/** Classifica o tipo de coluna dos três bancos (nomes vindos de DatabaseTypeName no agente). */
export function categoriaDoTipo(tipoBanco: string): CategoriaCampo {
  const t = tipoBanco.toUpperCase().replace(/\(.*$/, '').trim();
  if (/^(BOOL|BOOLEAN|BIT)$/.test(t)) return 'booleano';
  if (/^(DATE)$/.test(t)) return 'data';
  if (/^(TIMESTAMP|TIMESTAMPTZ|DATETIME|DATETIME2|SMALLDATETIME|DATETIMEOFFSET)$/.test(t)) return 'data_hora';
  if (
    /^(UNSIGNED )?(INT|INT2|INT4|INT8|INTEGER|SMALLINT|TINYINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|FLOAT4|FLOAT8|DOUBLE|REAL|MONEY|SMALLMONEY|YEAR)$/.test(
      t,
    )
  ) {
    return 'numero';
  }
  if (/^(BYTEA|BLOB|TINYBLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|IMAGE)$/.test(t)) return 'binario';
  return 'texto';
}

export function camposDasColunas(colunas: ResultadoConsulta['colunas']): CampoDinamico[] {
  return colunas.map((c) => ({ nome: c.nome, tipoBanco: c.tipo, categoria: categoriaDoTipo(c.tipo) }));
}

/** Problemas que impedem usar as colunas como campos da etiqueta. */
export function avisosDosCampos(campos: CampoDinamico[]): string[] {
  const avisos: string[] = [];
  const vistos = new Map<string, number>();
  campos.forEach((c, i) => {
    if (!c.nome.trim()) avisos.push(`A coluna ${i + 1} está sem nome: use um apelido (AS nome).`);
    const chave = c.nome.toLowerCase();
    vistos.set(chave, (vistos.get(chave) ?? 0) + 1);
  });
  for (const [nome, vezes] of vistos) {
    if (nome && vezes > 1) avisos.push(`A coluna "${nome}" aparece ${vezes} vezes: use apelidos diferentes (AS ...).`);
  }
  return avisos;
}

export interface ConsultaSqlResumo {
  id: string;
  conexaoId: string;
  nome: string;
  descricao: string | null;
  finalidade: FinalidadeConsulta;
  sql: string;
  /** Placeholders usados no SQL. */
  placeholders: string[];
  campos: CampoDinamico[];
  /** O SQL ou a conexão mudou depois da última leitura das colunas. */
  camposDesatualizados: boolean;
  camposAtualizadosEm: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

/** Resposta de salvar: a consulta e, se não deu para ler as colunas, o motivo. */
export interface SalvarConsultaResposta {
  consulta: ConsultaSqlResumo;
  avisos: string[];
}

export interface PreviaConsulta {
  resultado: ResultadoConsulta;
  campos: CampoDinamico[];
  /** SQL exatamente como foi enviado ao banco, com os parâmetros do driver. */
  sqlExecutado: string;
  parametros: unknown[];
  placeholders: string[];
  avisos: string[];
}
