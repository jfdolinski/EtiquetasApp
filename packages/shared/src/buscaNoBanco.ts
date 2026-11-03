import type { TipoBanco } from './agente';
import type { CampoDinamico } from './consultas';

/**
 * Busca em consulta sem `{param.*}`: em vez de trazer milhares de linhas para procurar o termo
 * aqui, põe o SQL do cliente dentro de um filtro e o banco devolve só o que interessa. Primeiro
 * o código exato, que aproveita os índices; se nada vier, o texto contido. O termo vai sempre em
 * parâmetro ligado; os nomes de coluna vêm da leitura dos campos e são escapados.
 */
export interface EtapaBuscaNoBanco {
  sql: string;
  /** Valores dos `{param.*}` do SQL acima. */
  parametros: Record<string, string>;
}

/** O banco não aceitou o filtro e nem todas as linhas foram lidas: "não encontrado" não é certeza. */
export const AVISO_BUSCA_INCOMPLETA = 'A consulta tem muitas linhas e só as primeiras 5.000 foram procuradas, então pode faltar produto. Use {param.busca} no SQL dela.';

const CAST_TEXTO: Record<TipoBanco, string> = { POSTGRES: 'TEXT', MYSQL: 'CHAR', SQLSERVER: 'NVARCHAR(4000)' };
const TAMANHO_MAXIMO_TERMO = 200;
const COLUNA_DE_CODIGO = /ean|gtin|barra|codbar|^cod|codigo|código|sku|^id$/i;

function coluna(nome: string, tipo: TipoBanco): string {
  if (tipo === 'MYSQL') return `\`${nome.replace(/`/g, '``')}\``;
  if (tipo === 'SQLSERVER') return `[${nome.replace(/]/g, ']]')}]`;
  return `"${nome.replace(/"/g, '""')}"`;
}

const comoTexto = (nome: string, tipo: TipoBanco) => `CAST(${coluna(nome, tipo)} AS ${CAST_TEXTO[tipo]})`;

/**
 * Padrão do LIKE: minúsculo, sem acento, com `_` no lugar das letras que podem ter acento no banco
 * ("cafe" acha "Café"). Fica um pouco mais largo que o termo: quem chama confere as linhas depois.
 */
export function padraoDeBusca(termo: string): string {
  const limpo = termo.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const semZeros = /^\d+$/.test(limpo) ? limpo.replace(/^0+(?=\d)/, '') : limpo;
  const miolo = [...semZeros].map((c) => (/[aeiouc]/.test(c) ? '_' : /[!%_[]/.test(c) ? `!${c}` : c)).join('');
  return `%${miolo}%`;
}

/** Etapas na ordem de tentar. Vazio: não dá para filtrar no banco (ex.: colunas ainda não lidas). */
export function planoDeBuscaNoBanco(sql: string, tipo: TipoBanco, campos: readonly CampoDinamico[], termo: string): EtapaBuscaNoBanco[] {
  const t = termo.trim();
  if (!t || t.length > TAMANHO_MAXIMO_TERMO || !campos.length) return [];
  // Nome repetido ou vazio: a subconsulta seria recusada pelo banco.
  const nomes = campos.map((c) => c.nome.toLowerCase());
  if (nomes.some((n) => !n.trim()) || new Set(nomes).size !== nomes.length) return [];

  const base = sql.trim().replace(/;\s*$/, '');
  // Quebra de linha antes de fechar: o SQL pode terminar em comentário de linha.
  const montar = (condicoes: string[]) => `SELECT * FROM (\n${base}\n) etiquetas_busca WHERE ${condicoes.join(' OR ')}`;
  const etapas: EtapaBuscaNoBanco[] = [];

  const digitos = /^\d+$/.test(t);
  const codigos = campos.filter((c) => COLUNA_DE_CODIGO.test(c.nome) && (c.categoria === 'texto' || c.categoria === 'numero'));
  if (codigos.length && !/\s/.test(t)) {
    const semZeros = digitos ? t.replace(/^0+(?=\d)/, '') : t;
    const valores = semZeros === t ? ['{param.busca_exata}'] : ['{param.busca_exata}', '{param.busca_sem_zeros}'];
    // Coluna de texto sem conversão: é o que permite ao banco usar o índice dela.
    const condicoes = codigos.flatMap((c) => valores.map((v) => `${c.categoria === 'texto' ? coluna(c.nome, tipo) : comoTexto(c.nome, tipo)} = ${v}`));
    etapas.push({ sql: montar(condicoes), parametros: semZeros === t ? { busca_exata: t } : { busca_exata: t, busca_sem_zeros: semZeros } });
  }

  // Número só entra quando se procura número: senão "4" acharia todo preço com 4.
  const contem = campos.filter((c) => c.categoria === 'texto' || (digitos && c.categoria === 'numero'));
  if (contem.length) {
    const condicoes = contem.map((c) => `LOWER(${comoTexto(c.nome, tipo)}) LIKE {param.busca_contem} ESCAPE '!'`);
    etapas.push({ sql: montar(condicoes), parametros: { busca_contem: padraoDeBusca(t) } });
  }
  return etapas;
}
