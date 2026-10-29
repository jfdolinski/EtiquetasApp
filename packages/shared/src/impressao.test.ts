import { describe, expect, it } from 'vitest';
import { chaveDoRegistro, descricaoDoRegistro, quantidadeDoRegistro } from './impressao';

describe('colunas da lista do dia', () => {
  it('chave: primeira coluna de identificação, sem diferenciar maiúsculas', () => {
    expect(chaveDoRegistro({ EAN: '789', CODIGO: 12 })).toBe('12');
    expect(chaveDoRegistro({ ean: '789', descricao: 'X' })).toBe('789');
    expect(chaveDoRegistro({ descricao: 'X' })).toBe('{"descricao":"X"}');
  });

  it('descrição: coluna conhecida ou primeiro texto', () => {
    expect(descricaoDoRegistro({ codigo: 1, Nome: 'Arroz' })).toBe('Arroz');
    expect(descricaoDoRegistro({ codigo: 1, marca: 'Tio' })).toBe('Tio');
    expect(descricaoDoRegistro({ codigo: 7 })).toBe('7');
  });

  it('quantidade: coluna conhecida, inteira, entre 1 e 999', () => {
    expect(quantidadeDoRegistro({ qtd: '3' })).toBe(3);
    expect(quantidadeDoRegistro({ QUANTIDADE: 2.9 })).toBe(2);
    expect(quantidadeDoRegistro({ quantidade: 0 })).toBe(1);
    expect(quantidadeDoRegistro({ quantidade: 5000 })).toBe(999);
    expect(quantidadeDoRegistro({})).toBe(1);
  });
});
