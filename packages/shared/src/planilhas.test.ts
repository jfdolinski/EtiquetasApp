import { describe, expect, it } from 'vitest';
import { ErroPlanilha, colunasDaTabela, filtrarTabela, lerChaveDrive, lerCsv, montarTabela, nomeDeCampo, pastaDriveDoLink, tabelaDeLinhas } from './planilhas';

describe('planilhas', () => {
  it('cabeçalho vira nome de campo, sem repetir', () => {
    expect(nomeDeCampo('Código de Barras')).toBe('codigo_de_barras');
    expect(nomeDeCampo(' Preço (R$) ')).toBe('preco_r');
    expect(montarTabela(['Preço', 'preco'], [[1, 2]]).colunas).toEqual(['preco', 'preco_2']);
  });

  it('limpa linhas vazias e colunas sem título, converte datas e decimal com vírgula', () => {
    const t = tabelaDeLinhas([
      [null, null],
      ['Código', 'Validade', 'Preço', null],
      ['0789', new Date('2026-12-31T00:00:00Z'), '4,99', 'sobra'],
      [null, '  ', null, null],
    ]);
    expect(t).toEqual({ colunas: ['codigo', 'validade', 'preco'], linhas: [['0789', '2026-12-31', '4.99']] });
  });

  it('aceita planilha sem linhas (busca sem resultado), mas não sem título', () => {
    expect(tabelaDeLinhas([['a']])).toEqual({ colunas: ['a'], linhas: [] });
    expect(() => tabelaDeLinhas([])).toThrow(ErroPlanilha);
    expect(() => montarTabela(['a'], [[{ x: 1 }]])).toThrow(ErroPlanilha);
    expect(() => montarTabela(['a'], [['x'.repeat(2001)]])).toThrow(/caracteres/);
    expect(() => montarTabela(['a'], Array.from({ length: 100_001 }, () => ['x']))).toThrow(/linhas/);
  });

  it('lê CSV com aspas e ponto e vírgula', () => {
    expect(lerCsv('﻿ean;nome;preco\r\n0789;"Arroz; 5kg ""tipo 1""";4,99\n')).toEqual([
      ['ean', 'nome', 'preco'],
      ['0789', 'Arroz; 5kg "tipo 1"', '4,99'],
    ]);
    expect(lerCsv('a,b\n1,"linha\nquebrada"')).toEqual([
      ['a', 'b'],
      ['1', 'linha\nquebrada'],
    ]);
  });

  it('coluna só é número se todos os valores forem', () => {
    expect(colunasDaTabela({ colunas: ['a', 'b'], linhas: [[1, '1'], [null, 2]] })).toEqual([
      { nome: 'a', tipo: 'NUMERIC' },
      { nome: 'b', tipo: 'TEXT' },
    ]);
  });

  it('busca o código exato (com ou sem zeros) e, sem exato, parte do texto', () => {
    const t = { colunas: ['ean', 'nome'], linhas: [['0789', 'Arroz'], [7891, 'Arroz integral'], ['555', 'Feijão 789']] };
    expect(filtrarTabela(t, '789').map((l) => l[1])).toEqual(['Arroz']);
    expect(filtrarTabela(t, 'arroz').map((l) => l[1])).toEqual(['Arroz', 'Arroz integral']);
    expect(filtrarTabela(t, null)).toHaveLength(3);
    expect(filtrarTabela(t, 'nada')).toHaveLength(0);
  });

  it('pasta do Drive: aceita link e id, recusa o resto', () => {
    expect(pastaDriveDoLink('https://drive.google.com/drive/folders/1AbC_d-EfGhIj?usp=sharing')).toBe('1AbC_d-EfGhIj');
    expect(pastaDriveDoLink('https://drive.google.com/drive/u/0/folders/1AbC_d-EfGhIj')).toBe('1AbC_d-EfGhIj');
    expect(pastaDriveDoLink(' 1AbC_d-EfGhIj ')).toBe('1AbC_d-EfGhIj');
    for (const ruim of ["x' or '1'='1", 'https://mal.com/drive/folders/abc', 'http://drive.google.com/drive/folders/abc', 'https://drive.google.com/file/d/abc/view']) {
      expect(() => pastaDriveDoLink(ruim)).toThrow(ErroPlanilha);
    }
  });

  it('chave do Drive: só conta de serviço', () => {
    expect(lerChaveDrive(JSON.stringify({ type: 'service_account', client_email: 'a@b.iam', private_key: 'k' }))).toEqual({ email: 'a@b.iam', chavePrivada: 'k' });
    for (const ruim of ['x', '{}', JSON.stringify({ type: 'authorized_user', client_email: 'a', private_key: 'k' })]) expect(() => lerChaveDrive(ruim)).toThrow(ErroPlanilha);
  });
});
