/**
 * Validação de CNPJ numérico e alfanumérico (IN RFB nº 2.229/2024, emitido a partir de julho/2026).
 * Os 12 primeiros caracteres podem ser letras ou dígitos; os 2 dígitos verificadores são sempre numéricos.
 * Cada caractere vale (código ASCII − 48), o que mantém o cálculo idêntico para CNPJs só com dígitos.
 */

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Remove máscara e converte para maiúsculas. Não valida. */
export function normalizarCnpj(valor: string): string {
  return valor.replace(/[.\-/\s]/g, '').toUpperCase();
}

function calcularDigito(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) {
    soma += (base.charCodeAt(i) - 48) * pesos[i];
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function validarCnpj(valor: string): boolean {
  const cnpj = normalizarCnpj(valor);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  const dv1 = calcularDigito(cnpj.slice(0, 12), PESOS_DV1);
  const dv2 = calcularDigito(cnpj.slice(0, 12) + dv1, PESOS_DV2);
  return cnpj.endsWith(`${dv1}${dv2}`);
}

/** Formata como XX.XXX.XXX/XXXX-XX. Espera um CNPJ já normalizado com 14 caracteres. */
export function formatarCnpj(valor: string): string {
  const c = normalizarCnpj(valor);
  if (c.length !== 14) return valor;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
