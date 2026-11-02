import { describe, expect, it } from 'vitest';
import { codigosDoRegistro } from './banidos';
import { chaveDoRegistro, descricaoDoRegistro, quantidadeDoRegistro } from './impressao';
import { aliasValido, colunaDaReferencia, mensagemFaltando, obrigatoriasFaltando, REFERENCIAS_SISTEMA, REFERENCIAS_SUGERIDAS, referenciaDaColuna } from './referencias';

const ref = (alias: string) => REFERENCIAS_SISTEMA.find((r) => r.alias === alias)!;

describe('índice de campos', () => {
  // O índice não pode prometer um nome que o sistema não entende.
  it('todo nome dos campos do sistema é lido de verdade', () => {
    for (const n of [ref('codigo').alias, ...ref('codigo').alternativos]) expect(chaveDoRegistro({ [n]: 'K1', outra: 'x' }), n).toBe('K1');
    for (const n of [ref('descricao').alias, ...ref('descricao').alternativos]) expect(descricaoDoRegistro({ cod: 1, [n]: 'Café' }), n).toBe('Café');
    for (const n of [ref('quantidade').alias, ...ref('quantidade').alternativos]) expect(quantidadeDoRegistro({ [n]: 7 }), n).toBe(7);
    for (const n of [ref('codigo_barras').alias, ...ref('codigo_barras').alternativos]) expect(codigosDoRegistro({ [n]: '789', codigo: '1' }), n).toEqual(['789']);
  });

  it('todos os aliases são válidos e não se repetem', () => {
    const todos = [...REFERENCIAS_SISTEMA, ...REFERENCIAS_SUGERIDAS];
    for (const r of todos) expect(aliasValido(r.alias), r.alias).toBe(true);
    expect(new Set(todos.map((r) => r.alias)).size).toBe(todos.length);
  });

  it('alias válido: minúsculas, números e sublinhado, começando por letra', () => {
    expect(aliasValido('preco_2')).toBe(true);
    for (const a of ['Preco', '2preco', 'preço', 'a b', '']) expect(aliasValido(a), a).toBe(false);
  });

  it('encontra a coluna sem diferenciar maiúsculas, com o alias antes do alternativo', () => {
    expect(colunaDaReferencia(ref('descricao'), ['NOME', 'DESCRICAO'])).toBe('DESCRICAO');
    expect(colunaDaReferencia(ref('descricao'), ['Nome'])).toBe('Nome');
    expect(colunaDaReferencia(ref('descricao'), ['outra'])).toBeNull();
  });

  it('a coluna é explicada pela referência certa, mesmo quando serve para duas', () => {
    expect(referenciaDaColuna(REFERENCIAS_SISTEMA, 'EAN')?.alias).toBe('codigo_barras');
    expect(referenciaDaColuna(REFERENCIAS_SISTEMA, 'codigo')?.alias).toBe('codigo');
    expect(referenciaDaColuna(REFERENCIAS_SISTEMA, 'cod')?.alias).toBe('codigo');
    expect(referenciaDaColuna(REFERENCIAS_SISTEMA, 'cor')).toBeNull();
  });

  it('obrigatórias dependem da finalidade', () => {
    const faltam = (colunas: string[], f: 'LISTA_DIARIA' | 'BUSCA_PRODUTO' | 'OUTRA') => obrigatoriasFaltando(REFERENCIAS_SISTEMA, colunas, f).map((r) => r.alias);
    expect(faltam(['preco'], 'LISTA_DIARIA')).toEqual(['codigo', 'descricao']);
    expect(faltam(['preco'], 'BUSCA_PRODUTO')).toEqual(['codigo', 'descricao']);
    expect(faltam(['preco'], 'OUTRA')).toEqual([]);
    // Produto só com EAN atende ao código.
    expect(faltam(['ean', 'nome'], 'LISTA_DIARIA')).toEqual([]);
  });

  it('a mensagem diz o que falta e como resolver', () => {
    const m = mensagemFaltando(obrigatoriasFaltando(REFERENCIAS_SISTEMA, [], 'LISTA_DIARIA'), 'LISTA_DIARIA');
    expect(m).toContain('codigo (Código do produto)');
    expect(m).toContain('descricao (Descrição do produto)');
    expect(m).toContain('Lista do dia');
    expect(m).toContain('AS codigo');
  });
});
