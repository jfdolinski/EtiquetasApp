/**
 * Grade da etiqueta avulsa: lista de produtos que o operador monta (buscas e linhas
 * digitadas), filtra, ordena, edita e altera em massa antes de imprimir. Regras puras,
 * usadas pela tela; o servidor só recebe os registros finais.
 */
import type { Registro } from './etiquetas/tipos';
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
    if (op === '=') return (v) => simplificar(textoCelula(v)) === simplificar(alvoTexto);
  }
  if (f.startsWith('!')) {
    const alvo = simplificar(f.slice(1));
    return (v) => !simplificar(textoCelula(v)).includes(alvo);
  }
  const alvo = simplificar(f);
  return (v) => simplificar(textoCelula(v)).includes(alvo);
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
      const tudo = simplificar(colunas.map((c) => textoCelula(l.registro[c])).join(' '));
      if (!palavras.every((p) => tudo.includes(p))) return false;
    }
    return porColuna.every(({ c, ok }) => ok(c === COLUNA_QUANTIDADE ? l.quantidade : l.registro[c]));
  });
}

const colador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Ordena por uma coluna: números como números, texto em ordem alfabética, vazios no fim. */
export function ordenarLinhas(linhas: LinhaAvulsa[], coluna: string, direcao: Direcao): LinhaAvulsa[] {
  const valor = (l: LinhaAvulsa) => (coluna === COLUNA_QUANTIDADE ? l.quantidade : l.registro[coluna]);
  const sinal = direcao === 'asc' ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    const ta = textoCelula(va).trim();
    const tb = textoCelula(vb).trim();
    if (!ta || !tb) return ta ? -1 : tb ? 1 : 0; // vazios sempre no fim
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
      const texto = textoCelula(atual);
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
    if (novo === atual) return l;
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
