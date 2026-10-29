import type { TipoBanco } from './agente';

/**
 * Placeholders `{...}` das consultas SQL. O servidor troca cada placeholder por um parâmetro
 * ligado na sintaxe do driver ($1, ?, @p1) e envia os valores separados — nunca concatena.
 *
 * O lexer segue as mesmas regras por dialeto do validador do agente
 * (apps/agent/internal/banco/somente_leitura.go): placeholders dentro de strings e
 * comentários não são substituídos.
 */

export interface DefinicaoPlaceholder {
  nome: string;
  descricao: string;
  exemplo: string;
}

export const PLACEHOLDERS: readonly DefinicaoPlaceholder[] = [
  { nome: 'empresa.cnpj', descricao: 'CNPJ da empresa, sem máscara', exemplo: '11222333000181' },
  { nome: 'empresa.codigo_erp', descricao: 'Código da empresa no ERP (cadastro da empresa)', exemplo: '001' },
  { nome: 'empresa.razao_social', descricao: 'Razão social da empresa', exemplo: 'Mercado Exemplo Ltda' },
  { nome: 'usuario.id', descricao: 'Id do usuário que está executando', exemplo: '3f2a…' },
  { nome: 'usuario.email', descricao: 'E-mail do usuário que está executando', exemplo: 'operador@loja.com' },
  { nome: 'data_hoje', descricao: 'Data de hoje (AAAA-MM-DD), no fuso da plataforma', exemplo: '2026-10-29' },
  { nome: 'data_hora_agora', descricao: 'Data e hora atuais (AAAA-MM-DD HH:MM:SS)', exemplo: '2026-10-29 14:30:00' },
];

/** Parâmetros informados na hora da execução, ex.: `{param.busca}` na etiqueta avulsa. */
export const PREFIXO_PARAMETRO = 'param.';

const NOMES_FIXOS = new Set(PLACEHOLDERS.map((p) => p.nome));
const RE_PLACEHOLDER = /^\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\}/;
const RE_PLACEHOLDER_GLOBAL = /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\}/g;

export class ErroPlaceholder extends Error {}

export function ehParametro(nome: string): boolean {
  return nome.startsWith(PREFIXO_PARAMETRO) && nome.length > PREFIXO_PARAMETRO.length;
}

interface Dialeto {
  barraEscapa: boolean;
  comentarioHash: boolean;
  comentarioAninhado: boolean;
  colchetes: boolean;
  dollarQuote: boolean;
  stringE: boolean;
  aspasDuplasSaoString: boolean;
}

const DIALETOS: Record<TipoBanco, Dialeto> = {
  POSTGRES: { barraEscapa: false, comentarioHash: false, comentarioAninhado: true, colchetes: false, dollarQuote: true, stringE: true, aspasDuplasSaoString: false },
  MYSQL: { barraEscapa: true, comentarioHash: true, comentarioAninhado: false, colchetes: false, dollarQuote: false, stringE: false, aspasDuplasSaoString: true },
  SQLSERVER: { barraEscapa: false, comentarioHash: false, comentarioAninhado: true, colchetes: true, dollarQuote: false, stringE: false, aspasDuplasSaoString: false },
};

type Trecho =
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'placeholder'; nome: string; texto: string }
  | { tipo: 'string' | 'outro'; texto: string };

const ehLetraIdent = (c: string) => /[\p{L}\p{N}_$]/u.test(c);

/** Quebra o SQL em trechos, separando placeholders do resto. */
function tokenizar(sql: string, tipo: TipoBanco): Trecho[] {
  const d = DIALETOS[tipo];
  const trechos: Trecho[] = [];
  let codigo = '';
  const fecharCodigo = () => {
    if (codigo) trechos.push({ tipo: 'codigo', texto: codigo });
    codigo = '';
  };
  const empurrar = (t: Trecho) => {
    fecharCodigo();
    trechos.push(t);
  };

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const prox = sql[i + 1];

    if ((c === '-' && prox === '-') || (c === '#' && d.comentarioHash)) {
      const fim = sql.indexOf('\n', i);
      const j = fim < 0 ? n : fim;
      empurrar({ tipo: 'outro', texto: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '/' && prox === '*') {
      let nivel = 0;
      let j = i;
      for (; j + 1 < n; j++) {
        if (sql[j] === '/' && sql[j + 1] === '*' && (d.comentarioAninhado || nivel === 0)) {
          nivel++;
          j++;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          nivel--;
          j++;
          if (nivel === 0) break;
        }
      }
      if (nivel !== 0) throw new ErroPlaceholder('Comentário /* sem fechamento.');
      empurrar({ tipo: 'outro', texto: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || (c === '[' && d.colchetes)) {
      const fecha = c === '[' ? ']' : c;
      const anterior = codigo.match(/(^|[^\p{L}\p{N}_$])([eE])$/u);
      const escapa = (d.barraEscapa && c !== '`' && c !== '[') || (c === "'" && d.stringE && anterior !== null);
      let j = i + 1;
      for (; j < n; j++) {
        if (escapa && sql[j] === '\\') {
          j++;
          continue;
        }
        if (sql[j] === fecha) {
          if (sql[j + 1] === fecha) {
            j++;
            continue;
          }
          break;
        }
      }
      if (j >= n) throw new ErroPlaceholder('Texto entre aspas ou colchetes sem fechamento.');
      const texto = sql.slice(i, j + 1);
      const ehString = c === "'" || (c === '"' && d.aspasDuplasSaoString);
      empurrar({ tipo: ehString ? 'string' : 'outro', texto });
      i = j + 1;
      continue;
    }
    const dentroDeIdentificador = codigo.length > 0 && ehLetraIdent(codigo[codigo.length - 1]);
    if (c === '$' && d.dollarQuote && !dentroDeIdentificador) {
      if (/[0-9]/.test(prox ?? '')) {
        throw new ErroPlaceholder('Não use $1, $2… no SQL: use placeholders entre chaves, como {param.codigo}.');
      }
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        const fim = sql.indexOf(tag, i + tag.length);
        if (fim < 0) throw new ErroPlaceholder(`String ${tag} sem fechamento.`);
        empurrar({ tipo: 'outro', texto: sql.slice(i, fim + tag.length) });
        i = fim + tag.length;
        continue;
      }
    }
    if (c === '?' && tipo === 'MYSQL') {
      throw new ErroPlaceholder('Não use ? no SQL: use placeholders entre chaves, como {param.codigo}.');
    }
    if (c === '@' && tipo === 'SQLSERVER' && /^@[pP][0-9]/.test(sql.slice(i, i + 3))) {
      throw new ErroPlaceholder('Não use @p1, @p2… no SQL: use placeholders entre chaves, como {param.codigo}.');
    }
    if (c === '{') {
      const m = sql.slice(i).match(RE_PLACEHOLDER);
      if (m) {
        empurrar({ tipo: 'placeholder', nome: m[1].toLowerCase(), texto: m[0] });
        i += m[0].length;
        continue;
      }
    }
    codigo += c;
    i++;
  }
  fecharCodigo();
  return trechos;
}

function validarNome(nome: string) {
  if (!NOMES_FIXOS.has(nome) && !ehParametro(nome)) {
    throw new ErroPlaceholder(
      `Placeholder desconhecido: {${nome}}. Use um dos disponíveis (${[...NOMES_FIXOS].map((n) => `{${n}}`).join(', ')}) ou {param.nome} para valores informados na execução.`,
    );
  }
}

/** Placeholders usados no SQL (sem repetição, na ordem em que aparecem). */
export function extrairPlaceholders(sql: string, tipo: TipoBanco): string[] {
  const nomes: string[] = [];
  for (const t of tokenizar(sql, tipo)) {
    if (t.tipo === 'string') {
      const dentro = [...t.texto.matchAll(RE_PLACEHOLDER_GLOBAL)][0];
      if (dentro) {
        throw new ErroPlaceholder(
          `O placeholder ${dentro[0]} está entre aspas. Remova as aspas: o valor é enviado ao banco como parâmetro.`,
        );
      }
    }
    if (t.tipo === 'placeholder') {
      validarNome(t.nome);
      if (!nomes.includes(t.nome)) nomes.push(t.nome);
    }
  }
  return nomes;
}

export interface SqlCompilado {
  sql: string;
  parametros: unknown[];
  placeholders: string[];
}

/**
 * Troca os placeholders por parâmetros do driver. `valores` precisa ter todos os
 * placeholders usados (null vira NULL no banco).
 */
export function compilarSql(sql: string, tipo: TipoBanco, valores: Record<string, unknown>): SqlCompilado {
  const placeholders = extrairPlaceholders(sql, tipo);
  const faltando = placeholders.filter((p) => !(p in valores));
  if (faltando.length) {
    throw new ErroPlaceholder(`Informe o valor de ${faltando.map((p) => `{${p}}`).join(', ')}.`);
  }

  const parametros: unknown[] = [];
  const indice = new Map<string, number>();
  let saida = '';
  for (const t of tokenizar(sql, tipo)) {
    if (t.tipo !== 'placeholder') {
      saida += t.texto;
      continue;
    }
    if (tipo === 'MYSQL') {
      parametros.push(valores[t.nome]);
      saida += '?';
      continue;
    }
    let n = indice.get(t.nome);
    if (n === undefined) {
      parametros.push(valores[t.nome]);
      n = parametros.length;
      indice.set(t.nome, n);
    }
    saida += tipo === 'POSTGRES' ? `$${n}` : `@p${n}`;
  }
  return { sql: saida, parametros, placeholders };
}
