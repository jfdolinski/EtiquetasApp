import { FINALIDADES_CONSULTA, type FinalidadeConsulta, ROTULO_FINALIDADE } from './consultas';
import { COLUNAS_CHAVE, COLUNAS_DESCRICAO, COLUNAS_QUANTIDADE } from './impressao';

/**
 * Índice de campos: o que cada alias de uma consulta significa dentro do sistema e quais são
 * obrigatórios em cada finalidade. É dado da plataforma, igual para todas as empresas.
 */
export interface ReferenciaCampoDados {
  /** Nome a usar na consulta: `p.preco_venda AS preco`. */
  alias: string;
  nome: string;
  /** O que o sistema faz com o campo. */
  descricao: string;
  exemplo: string;
  /** Outros nomes de coluna entendidos como este campo. */
  alternativos: string[];
  obrigatoriaEm: FinalidadeConsulta[];
}

export interface ReferenciaCampo extends ReferenciaCampoDados {
  id: string;
  /** O sistema lê este campo pelo nome: o alias não muda e o registro não sai do índice. */
  sistema: boolean;
  ativa: boolean;
  ordem: number;
}

export function aliasValido(alias: string): boolean {
  return /^[a-z][a-z0-9_]{0,59}$/.test(alias);
}

const LISTA_E_BUSCA: FinalidadeConsulta[] = ['LISTA_DIARIA', 'BUSCA_PRODUTO'];

/** Campos que o código do sistema lê pelo nome. Os outros nomes vêm das convenções em uso. */
export const REFERENCIAS_SISTEMA: readonly ReferenciaCampoDados[] = [
  {
    alias: 'codigo_barras',
    nome: 'Código de barras (EAN)',
    descricao: 'Usado em Produtos banidos e na leitura pela câmera do celular. Sem ele, o banimento olha o código do produto.',
    exemplo: '7891000100103',
    alternativos: ['ean', 'gtin', 'codbar', 'cod_barras', 'barras'],
    obrigatoriaEm: [],
  },
  {
    alias: 'codigo',
    nome: 'Código do produto',
    descricao: 'Identifica o produto na lista do dia: o que já foi impresso ou descartado hoje não volta. Produto só com EAN pode usar o EAN aqui.',
    exemplo: '12345',
    alternativos: COLUNAS_CHAVE.filter((c) => c !== 'codigo'),
    obrigatoriaEm: LISTA_E_BUSCA,
  },
  {
    alias: 'descricao',
    nome: 'Descrição do produto',
    descricao: 'Nome mostrado na lista do dia, no aplicativo e no histórico.',
    exemplo: 'Café torrado 500 g',
    alternativos: COLUNAS_DESCRICAO.filter((c) => c !== 'descricao'),
    obrigatoriaEm: LISTA_E_BUSCA,
  },
  {
    alias: 'quantidade',
    nome: 'Quantidade de etiquetas',
    descricao: 'Quantas etiquetas imprimir de cada produto na lista do dia. Sem ela, vale 1 e o operador ajusta.',
    exemplo: '3',
    alternativos: COLUNAS_QUANTIDADE.filter((c) => c !== 'quantidade'),
    obrigatoriaEm: [],
  },
];

/** Sugestões iniciais para a etiqueta. O sistema não depende delas: podem ser editadas ou excluídas. */
export const REFERENCIAS_SUGERIDAS: readonly ReferenciaCampoDados[] = [
  { alias: 'preco', nome: 'Preço de venda', descricao: 'Preço impresso na etiqueta. Use número, sem símbolo de moeda.', exemplo: '19.90', alternativos: ['preco_venda', 'valor', 'vl_venda'], obrigatoriaEm: [] },
  { alias: 'preco_promocional', nome: 'Preço promocional', descricao: 'Preço de oferta, para etiquetas e cartazes de promoção.', exemplo: '15.90', alternativos: ['preco_oferta', 'promocao'], obrigatoriaEm: [] },
  { alias: 'preco_de', nome: 'Preço anterior ("de")', descricao: 'Preço riscado em cartazes de "de/por".', exemplo: '24.90', alternativos: ['preco_antigo', 'preco_anterior'], obrigatoriaEm: [] },
  { alias: 'unidade', nome: 'Unidade de medida', descricao: 'Unidade de venda.', exemplo: 'UN', alternativos: ['un', 'und', 'unid'], obrigatoriaEm: [] },
  { alias: 'preco_por_unidade', nome: 'Preço por unidade de medida', descricao: 'Preço por kg, litro ou metro, quando a etiqueta precisa mostrar.', exemplo: '39.80', alternativos: ['preco_kg', 'preco_litro'], obrigatoriaEm: [] },
  { alias: 'marca', nome: 'Marca', descricao: 'Marca do produto.', exemplo: 'Acme', alternativos: ['fabricante'], obrigatoriaEm: [] },
  { alias: 'fornecedor', nome: 'Fornecedor', descricao: 'Fornecedor do produto.', exemplo: 'Distribuidora Sul', alternativos: [], obrigatoriaEm: [] },
  { alias: 'departamento', nome: 'Departamento ou seção', descricao: 'Agrupamento do produto na loja.', exemplo: 'Mercearia', alternativos: ['secao', 'categoria', 'grupo'], obrigatoriaEm: [] },
  { alias: 'lote', nome: 'Lote', descricao: 'Lote de fabricação.', exemplo: 'L2026-11', alternativos: [], obrigatoriaEm: [] },
  { alias: 'validade', nome: 'Data de validade', descricao: 'Validade do produto. Use uma coluna de data, para o modelo formatar.', exemplo: '2027-03-15', alternativos: ['data_validade', 'dt_validade'], obrigatoriaEm: [] },
  { alias: 'fabricacao', nome: 'Data de fabricação', descricao: 'Fabricação do produto. Use uma coluna de data, para o modelo formatar.', exemplo: '2026-11-01', alternativos: ['data_fabricacao', 'dt_fabricacao'], obrigatoriaEm: [] },
  { alias: 'peso', nome: 'Peso', descricao: 'Peso ou conteúdo líquido.', exemplo: '0.500', alternativos: ['peso_liquido'], obrigatoriaEm: [] },
  { alias: 'localizacao', nome: 'Localização na loja', descricao: 'Corredor, prateleira ou endereço de estoque.', exemplo: 'A3-12', alternativos: ['endereco', 'corredor'], obrigatoriaEm: [] },
];

const nomesDe = (r: Pick<ReferenciaCampoDados, 'alias' | 'alternativos'>) => [r.alias, ...r.alternativos].map((n) => n.toLowerCase());

export function colunaDaReferencia(referencia: Pick<ReferenciaCampoDados, 'alias' | 'alternativos'>, colunas: readonly string[]): string | null {
  for (const nome of nomesDe(referencia)) {
    const achada = colunas.find((c) => c.toLowerCase() === nome);
    if (achada !== undefined) return achada;
  }
  return null;
}

/** A referência que explica uma coluna: o alias exato ganha de um nome alternativo. */
export function referenciaDaColuna<T extends Pick<ReferenciaCampoDados, 'alias' | 'alternativos'>>(referencias: readonly T[], coluna: string): T | null {
  const c = coluna.toLowerCase();
  return referencias.find((r) => r.alias.toLowerCase() === c) ?? referencias.find((r) => nomesDe(r).includes(c)) ?? null;
}

export function obrigatoriasFaltando<T extends Pick<ReferenciaCampoDados, 'alias' | 'alternativos' | 'obrigatoriaEm'>>(referencias: readonly T[], colunas: readonly string[], finalidade: FinalidadeConsulta): T[] {
  return referencias.filter((r) => r.obrigatoriaEm.includes(finalidade) && colunaDaReferencia(r, colunas) === null);
}

export function mensagemFaltando(faltando: readonly Pick<ReferenciaCampoDados, 'alias' | 'nome'>[], finalidade: FinalidadeConsulta): string {
  const nomes = faltando.map((r) => `${r.alias} (${r.nome})`).join(', ');
  return `Para ${ROTULO_FINALIDADE[finalidade]}, a consulta precisa ${faltando.length > 1 ? 'destes campos' : 'deste campo'}: ${nomes}. Use o alias: coluna AS ${faltando[0].alias}.`;
}

/** Só finalidades conhecidas e sem repetir. */
export function finalidadesValidas(valores: readonly string[]): FinalidadeConsulta[] {
  return FINALIDADES_CONSULTA.filter((f) => valores.includes(f));
}
