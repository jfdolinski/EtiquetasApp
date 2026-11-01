import { describe, expect, it } from 'vitest';
import { codigoBarrasValido, codigosDoRegistro, normalizarCodigoBarras, registroBanido } from './banidos';

describe('produtos banidos', () => {
  it('normaliza o código: espaços, traços e zeros à esquerda', () => {
    expect(normalizarCodigoBarras(' 0789-100 ')).toBe('789100');
    expect(normalizarCodigoBarras(7891000100103)).toBe('7891000100103');
    expect(normalizarCodigoBarras('000')).toBe('0');
    expect(normalizarCodigoBarras('ab12')).toBe('AB12');
    expect(normalizarCodigoBarras(null)).toBe('');
    expect(codigoBarrasValido('AB12')).toBe(true);
    expect(codigoBarrasValido('a; drop')).toBe(false);
    expect(codigoBarrasValido('')).toBe(false);
  });

  it('olha o código de barras e só sem ele o código interno', () => {
    expect(codigosDoRegistro({ codigo: '1', ean: '0789', descricao: 'x' })).toEqual(['789']);
    expect(codigosDoRegistro({ codigo_de_barras: 789 })).toEqual(['789']);
    expect(codigosDoRegistro({ cod_produto: 'A1', descricao: 'x' })).toEqual(['A1']);
    expect(codigosDoRegistro({ descricao: '789' })).toEqual([]);
  });

  it('banido com zeros a mais ou como número', () => {
    const banidos = new Set(['789']);
    expect(registroBanido({ ean: '000789' }, banidos)).toBe(true);
    expect(registroBanido({ ean: 789 }, banidos)).toBe(true);
    expect(registroBanido({ ean: '790', codigo: '789' }, banidos)).toBe(false);
    expect(registroBanido({ ean: '789' }, new Set())).toBe(false);
  });
});
