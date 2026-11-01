/**
 * Produtos banidos: código de barras que nunca sai em etiqueta, por empresa. Vale para toda
 * impressão (lista do dia, avulsa, agendamento e geração de arquivo).
 */
import type { Registro } from './etiquetas/tipos';

export interface ProdutoBanidoResumo {
  codigoBarras: string;
  motivo: string | null;
  criadoPor: string | null;
  criadoEm: string;
}

export interface BanirResposta {
  incluidos: number;
  jaBanidos: number;
}

/** Chave do banimento: sem espaços e traços; só dígitos, sem zeros à esquerda (0789 = 789). */
export function normalizarCodigoBarras(v: unknown): string {
  if (v === null || v === undefined) return '';
  const t = String(v).replace(/[\s-]/g, '').toUpperCase();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
}

/** Código de barras aceito no cadastro: letras e números (Code 128), até 64 caracteres. */
export function codigoBarrasValido(codigo: string): boolean {
  return /^[0-9A-Z]{1,64}$/.test(codigo);
}

/**
 * Códigos do produto no registro: as colunas de código de barras; sem nenhuma, as de código.
 * Assim um código interno "123" não bane o produto que tem EAN.
 */
export function codigosDoRegistro(registro: Registro): string[] {
  const chaves = Object.keys(registro);
  const deBarras = chaves.filter((c) => /ean|gtin|barra|codbar/i.test(c));
  const colunas = deBarras.length ? deBarras : chaves.filter((c) => /^cod|^sku$/i.test(c));
  return colunas.map((c) => normalizarCodigoBarras(registro[c])).filter(Boolean);
}

export function registroBanido(registro: Registro, banidos: ReadonlySet<string>): boolean {
  return banidos.size > 0 && codigosDoRegistro(registro).some((c) => banidos.has(c));
}
