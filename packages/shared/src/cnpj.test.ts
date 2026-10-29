import { describe, expect, it } from 'vitest';
import { formatarCnpj, normalizarCnpj, validarCnpj } from './cnpj';

describe('validarCnpj', () => {
  it('aceita CNPJ numérico válido, com ou sem máscara', () => {
    expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    expect(validarCnpj('11222333000181')).toBe(true);
  });

  it('aceita CNPJ alfanumérico válido (exemplo da Receita Federal)', () => {
    expect(validarCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(validarCnpj('12abc34501de35')).toBe(true);
  });

  it('rejeita dígitos verificadores errados', () => {
    expect(validarCnpj('11.222.333/0001-82')).toBe(false);
    expect(validarCnpj('12.ABC.345/01DE-36')).toBe(false);
  });

  it('rejeita formato inválido e sequências repetidas', () => {
    expect(validarCnpj('')).toBe(false);
    expect(validarCnpj('1122233300018')).toBe(false);
    expect(validarCnpj('12.ABC.345/01DE-3A')).toBe(false);
    expect(validarCnpj('00000000000000')).toBe(false);
  });
});

describe('normalizarCnpj / formatarCnpj', () => {
  it('remove máscara e formata de volta', () => {
    expect(normalizarCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(formatarCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });
});
