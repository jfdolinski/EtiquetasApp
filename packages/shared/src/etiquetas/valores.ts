import { aplicarCaixa, formatarPreco } from './design';
import type { ElementoEtiqueta, FormatoCampo, FormatoData, OrigemValor, Registro, Simbologia } from './tipos';

/** Contexto de uma etiqueta no lote. `hoje` é AAAA-MM-DD no fuso da empresa. */
export interface ContextoValor {
  registro: Registro;
  /** Posição da etiqueta no lote, a partir de 0 (para o contador). */
  indice: number;
  hoje: string;
}

const PT = 25.4 / 72;

export function ptParaMm(pt: number): number {
  return pt * PT;
}

export function mmParaPontos(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

function pad(n: number, d = 2) {
  return String(n).padStart(d, '0');
}

/** Lê AAAA-MM-DD, ISO 8601 ou Date; devolve [ano, mês, dia] sem passar por fuso. */
function partesData(v: unknown): [number, number, number] | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return [v.getFullYear(), v.getMonth() + 1, v.getDate()];
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function formatarData(v: unknown, formato: FormatoData): string {
  const p = partesData(v);
  if (!p) return v == null ? '' : String(v);
  const [a, m, d] = p;
  switch (formato) {
    case 'dd/MM/yyyy':
      return `${pad(d)}/${pad(m)}/${a}`;
    case 'dd/MM/yy':
      return `${pad(d)}/${pad(m)}/${pad(a % 100)}`;
    case 'dd/MM':
      return `${pad(d)}/${pad(m)}`;
    case 'MM/yyyy':
      return `${pad(m)}/${a}`;
    case 'yyyy-MM-dd':
      return `${a}-${pad(m)}-${pad(d)}`;
  }
}

/** Soma dias a uma data AAAA-MM-DD (em UTC, sem horário de verão no caminho). */
export function somarDias(hoje: string, dias: number): string {
  const [a, m, d] = hoje.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d + dias));
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}`;
}

function formatarNumero(v: unknown, casas: number): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function formatarCampo(v: unknown, formato: FormatoCampo | undefined): string {
  if (v === null || v === undefined) return '';
  switch (formato?.tipo) {
    case 'numero':
      return formatarNumero(v, formato.casas) ?? String(v);
    case 'moeda': {
      const n = formatarNumero(v, formato.casas);
      return n === null ? String(v) : `R$ ${n}`;
    }
    case 'data':
      return formatarData(v, formato.formato);
    default:
      if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

/** Busca a coluna ignorando maiúsculas (SQL Server e MySQL podem mudar o caso). */
export function valorDoCampo(registro: Registro, campo: string): unknown {
  if (campo in registro) return registro[campo];
  const chave = Object.keys(registro).find((k) => k.toLowerCase() === campo.toLowerCase());
  return chave === undefined ? undefined : registro[chave];
}

export function resolverOrigem(origem: OrigemValor, ctx: ContextoValor): string {
  switch (origem.tipo) {
    case 'fixo':
      return origem.texto;
    case 'campo':
      return formatarCampo(valorDoCampo(ctx.registro, origem.campo), origem.formato);
    case 'data':
      return formatarData(somarDias(ctx.hoje, origem.dias), origem.formato);
    case 'contador':
      return String(origem.inicio + ctx.indice * origem.passo).padStart(origem.digitos, '0');
  }
}

/** Texto final de um elemento (com prefixo/sufixo no caso de texto). */
export function textoDoElemento(el: ElementoEtiqueta, ctx: ContextoValor): string {
  switch (el.tipo) {
    case 'texto': {
      const v = resolverOrigem(el.valor, ctx);
      return v === '' ? '' : aplicarCaixa(`${el.prefixo}${v}${el.sufixo}`, el.caixa);
    }
    case 'preco': {
      const bruto = resolverOrigem(el.valor, ctx);
      if (!bruto) return '';
      const v = formatarPreco(bruto) ?? bruto;
      return el.simbolo ? `${el.simbolo} ${v}` : v;
    }
    case 'codigo_barras':
    case 'qrcode':
      return resolverOrigem(el.valor, ctx);
    default:
      return '';
  }
}

/** Dígito verificador EAN/UPC (módulo 10, pesos 3/1 da direita para a esquerda). */
export function digitoEan(digitos: string): number {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) {
    const d = Number(digitos[digitos.length - 1 - i]);
    soma += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Normaliza o conteúdo de um código de barras. EAN-13/EAN-8 aceitam o código com ou sem
 * dígito verificador (confere quando vem) e devolvem sem o verificador, que as impressoras
 * calculam. Retorna `erro` quando o valor não serve para a simbologia.
 */
export function dadosCodigoBarras(simbologia: Simbologia, valor: string): { dados: string; completo: string } | { erro: string } {
  const v = valor.trim();
  if (!v) return { erro: 'valor vazio' };
  if (simbologia === 'EAN13' || simbologia === 'EAN8') {
    const tamanho = simbologia === 'EAN13' ? 13 : 8;
    if (!/^\d+$/.test(v)) return { erro: `${simbologia} aceita só dígitos: "${v}"` };
    if (v.length === tamanho) {
      const base = v.slice(0, -1);
      if (digitoEan(base) !== Number(v[v.length - 1])) return { erro: `dígito verificador inválido em ${v}` };
      return { dados: base, completo: v };
    }
    if (v.length === tamanho - 1) return { dados: v, completo: v + digitoEan(v) };
    return { erro: `${simbologia} precisa de ${tamanho - 1} ou ${tamanho} dígitos: "${v}"` };
  }
  if (simbologia === 'CODE39') {
    const u = v.toUpperCase();
    if (!/^[0-9A-Z \-.$/+%]+$/.test(u)) return { erro: `caractere não aceito em Code 39: "${v}"` };
    return { dados: u, completo: u };
  }
  if (!/^[\x20-\x7e]+$/.test(v)) return { erro: `Code 128 aceita só ASCII: "${v}"` };
  return { dados: v, completo: v };
}

/** Converte linhas da consulta (array de arrays) em registros por nome de coluna. */
export function linhasParaRegistros(colunas: { nome: string }[], linhas: unknown[][]): Registro[] {
  return linhas.map((l) => Object.fromEntries(colunas.map((c, i) => [c.nome, l[i]])));
}
