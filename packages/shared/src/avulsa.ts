/**
 * Grade da etiqueta avulsa: lista de produtos que o operador monta (buscas e linhas
 * digitadas), filtra, ordena, edita e altera em massa antes de imprimir. Regras puras,
 * usadas pela tela; o servidor só recebe os registros finais.
 */
import type { Registro } from './etiquetas/tipos';
import { dataIsoDe, textoNaTela } from './etiquetas/valores';
import { QUANTIDADE_MAXIMA_ITEM } from './impressao';

export interface LinhaAvulsa {
  id: string;
  registro: Registro;
  quantidade: number;
}

/** Coluna especial: quantidade de etiquetas da linha. */
export const COLUNA_QUANTIDADE = '__quantidade';

export type Direcao = 'asc' | 'desc';

export function textoCelula(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function simplificar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Número de um valor: number, "4.99", "4,99", "1.234,56" ou "1,234.56". null se não for número. */
export function numeroDe(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^R\$\s*/i, '');
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const ultimaVirgula = s.lastIndexOf(',');
  const ultimoPonto = s.lastIndexOf('.');
  if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, '').replace(',', '.'); // pt-BR
  else s = s.replace(/,/g, ''); // en
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Coluna numérica: tem algum valor e todos os preenchidos são números. */
export function colunaNumerica(linhas: LinhaAvulsa[], coluna: string): boolean {
  if (coluna === COLUNA_QUANTIDADE) return true;
  let algum = false;
  for (const l of linhas) {
    const v = l.registro[coluna];
    if (textoCelula(v).trim() === '') continue;
    if (numeroDe(v) === null) return false;
    algum = true;
  }
  return algum;
}

/**
 * Valor digitado numa célula. Decimal brasileiro ("5,49", "1.234,50") vira "5.49", que os
 * formatos de número/moeda do modelo entendem. Inteiros ficam como texto: códigos e EAN
 * não podem perder zeros à esquerda.
 */
export function normalizarEntrada(texto: string): string {
  const t = texto.trim();
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t) || /^-?\d+,\d+$/.test(t)) return t.replace(/\./g, '').replace(',', '.');
  return texto;
}

/** Condição de um filtro de coluna: ">10", "<=5", "=7891", "!promo" ou texto contido. */
function condicao(filtro: string): (v: unknown) => boolean {
  const f = filtro.trim();
  const comparacao = f.match(/^(>=|<=|>|<|=)\s*(.+)$/);
  if (comparacao) {
    const [, op, alvoTexto] = comparacao;
    const alvo = numeroDe(alvoTexto);
    if (alvo !== null) {
      return (v) => {
        const n = numeroDe(v);
        if (n === null) return false;
        return op === '>' ? n > alvo : op === '<' ? n < alvo : op === '>=' ? n >= alvo : op === '<=' ? n <= alvo : n === alvo;
      };
    }
    if (op === '=') return (v) => simplificar(textoNaTela(v)) === simplificar(alvoTexto);
  }
  if (f.startsWith('!')) {
    const alvo = simplificar(f.slice(1));
    return (v) => !simplificar(textoNaTela(v)).includes(alvo);
  }
  const alvo = simplificar(f);
  return (v) => simplificar(textoNaTela(v)).includes(alvo);
}

/**
 * Busca geral (todas as palavras em qualquer coluna, sem acento nem maiúsculas) e filtros
 * por coluna (todos precisam bater).
 */
export function filtrarLinhas(linhas: LinhaAvulsa[], colunas: string[], busca: string, filtros: Record<string, string>): LinhaAvulsa[] {
  const palavras = simplificar(busca).split(/\s+/).filter(Boolean);
  const porColuna = Object.entries(filtros)
    .filter(([, f]) => f.trim() !== '')
    .map(([c, f]) => ({ c, ok: condicao(f) }));
  if (!palavras.length && !porColuna.length) return linhas;
  return linhas.filter((l) => {
    if (palavras.length) {
      const tudo = simplificar(colunas.map((c) => textoNaTela(l.registro[c])).join(' '));
      if (!palavras.every((p) => tudo.includes(p))) return false;
    }
    return porColuna.every(({ c, ok }) => ok(c === COLUNA_QUANTIDADE ? l.quantidade : l.registro[c]));
  });
}

const colador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Ordena por uma coluna: números como números, datas pelo dia, texto em ordem alfabética, vazios no fim. */
export function ordenarLinhas(linhas: LinhaAvulsa[], coluna: string, direcao: Direcao): LinhaAvulsa[] {
  const valor = (l: LinhaAvulsa) => (coluna === COLUNA_QUANTIDADE ? l.quantidade : l.registro[coluna]);
  const sinal = direcao === 'asc' ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    const ta = textoCelula(va).trim();
    const tb = textoCelula(vb).trim();
    if (!ta || !tb) return ta ? -1 : tb ? 1 : 0; // vazios sempre no fim
    const da = dataIsoDe(va);
    const db = dataIsoDe(vb);
    if (da && db) return da.localeCompare(db) * sinal;
    const na = numeroDe(va);
    const nb = numeroDe(vb);
    if (na !== null && nb !== null) return (na - nb) * sinal;
    return colador.compare(ta, tb) * sinal;
  });
}

export type OperacaoMassa =
  | 'definir'
  | 'limpar'
  | 'substituir'
  | 'prefixo'
  | 'sufixo'
  | 'maiusculas'
  | 'minusculas'
  | 'somar'
  | 'multiplicar'
  | 'aumentar_pct'
  | 'diminuir_pct';

export const ROTULO_OPERACAO: Record<OperacaoMassa, string> = {
  definir: 'Definir o valor',
  limpar: 'Apagar o valor',
  substituir: 'Substituir texto',
  prefixo: 'Acrescentar no início',
  sufixo: 'Acrescentar no fim',
  maiusculas: 'MAIÚSCULAS',
  minusculas: 'minúsculas',
  somar: 'Somar (ou subtrair)',
  multiplicar: 'Multiplicar por',
  aumentar_pct: 'Aumentar %',
  diminuir_pct: 'Diminuir %',
};

export const OPERACOES_NUMERICAS: readonly OperacaoMassa[] = ['somar', 'multiplicar', 'aumentar_pct', 'diminuir_pct'];

function casasDecimais(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const m = v.trim().match(/[.,](\d+)$/);
  return m ? m[1].length : 0;
}

function calcular(op: OperacaoMassa, atual: number, valor: number): number {
  switch (op) {
    case 'somar':
      return atual + valor;
    case 'multiplicar':
      return atual * valor;
    case 'aumentar_pct':
      return atual * (1 + valor / 100);
    case 'diminuir_pct':
      return atual * (1 - valor / 100);
    default:
      return atual;
  }
}

export interface ResultadoMassa {
  linhas: LinhaAvulsa[];
  alteradas: number;
  /** Linhas puladas porque o valor atual não é número (operações de conta). */
  ignoradas: number;
  erro?: string;
}

/**
 * Altera uma coluna (ou a quantidade de etiquetas) nas linhas `ids`. Contas mantêm o tipo
 * do valor: número continua número; texto "4.99" vira texto com as mesmas casas (mínimo 2
 * quando a conta gera centavos).
 */
export function alterarEmMassa(
  linhas: LinhaAvulsa[],
  ids: ReadonlySet<string>,
  coluna: string,
  op: OperacaoMassa,
  valor = '',
  substituirPor = '',
): ResultadoMassa {
  const numerica = OPERACOES_NUMERICAS.includes(op);
  const numeroInformado = numeroDe(valor);
  if (numerica && numeroInformado === null) return { linhas, alteradas: 0, ignoradas: 0, erro: 'Informe um número (ex.: 10 ou 2,5).' };
  if (op === 'substituir' && valor === '') return { linhas, alteradas: 0, ignoradas: 0, erro: 'Informe o texto a substituir.' };

  let alteradas = 0;
  let ignoradas = 0;
  const novas = linhas.map((l) => {
    if (!ids.has(l.id)) return l;
    if (coluna === COLUNA_QUANTIDADE) {
      let q = l.quantidade;
      if (op === 'definir') q = numeroInformado ?? NaN;
      else if (op === 'limpar') q = 0;
      else if (numerica) q = calcular(op, l.quantidade, numeroInformado!);
      else {
        ignoradas++;
        return l;
      }
      if (!Number.isFinite(q)) {
        ignoradas++;
        return l;
      }
      alteradas++;
      return { ...l, quantidade: Math.max(0, Math.min(QUANTIDADE_MAXIMA_ITEM, Math.round(q))) };
    }

    const atual = l.registro[coluna];
    let novo: unknown;
    if (numerica) {
      const n = numeroDe(atual);
      if (n === null) {
        ignoradas++;
        return l;
      }
      const r = Math.round(calcular(op, n, numeroInformado!) * 100) / 100;
      if (typeof atual === 'number') novo = r;
      else {
        const casas = Math.max(casasDecimais(atual), Number.isInteger(r) ? 0 : 2);
        novo = r.toFixed(Math.min(casas, 6));
      }
    } else {
      const texto = textoNaTela(atual);
      switch (op) {
        case 'definir':
          novo = normalizarEntrada(valor);
          break;
        case 'limpar':
          novo = '';
          break;
        case 'substituir':
          novo = texto.split(valor).join(substituirPor);
          break;
        case 'prefixo':
          novo = valor + texto;
          break;
        case 'sufixo':
          novo = texto + valor;
          break;
        case 'maiusculas':
          novo = texto.toLocaleUpperCase('pt-BR');
          break;
        case 'minusculas':
          novo = texto.toLocaleLowerCase('pt-BR');
          break;
      }
    }
    if (novo === atual || novo === textoNaTela(atual)) return l;
    alteradas++;
    return { ...l, registro: { ...l.registro, [coluna]: novo } };
  });
  return { linhas: novas, alteradas, ignoradas };
}

/** Junta resultados de uma busca à lista, sem repetir produto igual (mesmos dados). */
export function somarResultados(lista: LinhaAvulsa[], registros: Registro[], novoId: () => string, quantidade: number): { linhas: LinhaAvulsa[]; novas: number } {
  const existentes = new Set(lista.map((l) => JSON.stringify(l.registro)));
  const novas: LinhaAvulsa[] = [];
  for (const r of registros) {
    const k = JSON.stringify(r);
    if (existentes.has(k)) continue;
    existentes.add(k);
    novas.push({ id: novoId(), registro: r, quantidade });
  }
  return { linhas: [...novas, ...lista], novas: novas.length };
}

/** Coluna da grade que dispara a busca do produto: código de barras; sem ela, o código. */
export function colunaDeBusca(colunas: string[]): string | null {
  return colunas.find((c) => /ean|gtin|barra|codbar/i.test(c)) ?? colunas.find((c) => /^cod|codigo|código|sku|^id$/i.test(c)) ?? colunas[0] ?? null;
}

/** Em qual `{param.*}` da consulta vai o valor digitado na linha; os outros seguem nulos. */
export function parametrosDaBusca(parametros: string[], valor: string): Record<string, string | null> {
  const alvo =
    parametros.find((p) => p === 'busca') ??
    parametros.find((p) => /ean|gtin|barra|codbar/i.test(p)) ??
    parametros.find((p) => /cod/i.test(p)) ??
    parametros[0];
  return Object.fromEntries(parametros.map((p) => [p, p === alvo ? valor : null]));
}

/** O mesmo código, ignorando espaços e zeros à esquerda (o Excel costuma comer os zeros). */
export function mesmoCodigo(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    const t = textoCelula(v).trim().toLowerCase();
    return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
  };
  return norm(a) !== '' && norm(a) === norm(b);
}

/**
 * Resultado da busca pelo que foi digitado: código igual ganha de parecido, e nome vale pelas
 * palavras. A consulta pode trazer parecidos (LIKE) ou nem filtrar, então o que não tem relação
 * com o termo não é resultado: vazio significa "produto não encontrado". Um registro só é aceito
 * mesmo sem o termo: a consulta pode ter achado por uma coluna que não devolve.
 */
export function registrosDoCodigo<T extends Record<string, unknown>>(registros: T[], coluna: string | null, valor: string): T[] {
  const naColuna = coluna ? registros.filter((r) => mesmoCodigo(r[coluna], valor)) : [];
  if (naColuna.length) return naColuna;
  const emQualquer = registros.filter((r) => Object.values(r).some((v) => mesmoCodigo(v, valor)));
  if (emQualquer.length) return emQualquer;
  const palavras = simplificar(valor.trim()).split(/\s+/).filter(Boolean);
  const comPalavras = registros.filter((r) => {
    const texto = Object.values(r).map((v) => simplificar(textoCelula(v))).join(' ');
    return palavras.length > 0 && palavras.every((p) => texto.includes(p));
  });
  if (comPalavras.length) return comPalavras;
  return registros.length === 1 ? registros : [];
}

/** Procura no resultado de uma consulta sem parâmetro: código igual ganha de texto parecido. */
export function filtrarPorTermo<T extends Record<string, unknown>>(registros: T[], termo: string): T[] {
  const iguais = registros.filter((r) => Object.values(r).some((v) => mesmoCodigo(v, termo)));
  if (iguais.length) return iguais;
  const t = simplificar(termo.trim());
  return t ? registros.filter((r) => Object.values(r).some((v) => simplificar(textoCelula(v)).includes(t))) : [];
}
