import { describe, expect, it } from 'vitest';
import { avisosDosCampos, camposDasColunas, categoriaDoTipo } from './consultas';
import { compilarSql, ErroPlaceholder, extrairPlaceholders } from './placeholders';

const VALORES = { 'empresa.cnpj': '11222333000181', data_hoje: '2026-10-29', 'param.busca': "7891'; DROP" };

describe('compilarSql', () => {
  it('PostgreSQL: $n por placeholder distinto, reaproveitando repetidos', () => {
    const r = compilarSql(
      'SELECT * FROM p WHERE loja = {empresa.cnpj} AND alterado >= {data_hoje} AND (cod = {param.busca} OR ean = {param.busca})',
      'POSTGRES',
      VALORES,
    );
    expect(r.sql).toBe('SELECT * FROM p WHERE loja = $1 AND alterado >= $2 AND (cod = $3 OR ean = $3)');
    expect(r.parametros).toEqual(['11222333000181', '2026-10-29', "7891'; DROP"]);
    expect(r.placeholders).toEqual(['empresa.cnpj', 'data_hoje', 'param.busca']);
  });

  it('MySQL: um ? por ocorrência', () => {
    const r = compilarSql('SELECT * FROM p WHERE cod = {param.busca} OR ean = {param.busca}', 'MYSQL', VALORES);
    expect(r.sql).toBe('SELECT * FROM p WHERE cod = ? OR ean = ?');
    expect(r.parametros).toEqual(["7891'; DROP", "7891'; DROP"]);
  });

  it('SQL Server: @pn', () => {
    const r = compilarSql('SELECT TOP 10 * FROM p WHERE data = {data_hoje} OR d2 = {data_hoje}', 'SQLSERVER', VALORES);
    expect(r.sql).toBe('SELECT TOP 10 * FROM p WHERE data = @p1 OR d2 = @p1');
    expect(r.parametros).toEqual(['2026-10-29']);
  });

  it('o valor nunca entra no texto do SQL', () => {
    const r = compilarSql('SELECT {param.busca}', 'POSTGRES', VALORES);
    expect(r.sql).not.toContain('DROP');
  });

  it('não substitui dentro de comentários, identificadores e dollar quote', () => {
    const sql = 'SELECT "{data_hoje}", $$ {data_hoje} $$ -- {data_hoje}\n/* {data_hoje} */ FROM t WHERE d = {data_hoje}';
    const r = compilarSql(sql, 'POSTGRES', VALORES);
    expect(r.sql).toBe('SELECT "{data_hoje}", $$ {data_hoje} $$ -- {data_hoje}\n/* {data_hoje} */ FROM t WHERE d = $1');
    expect(compilarSql('SELECT [{data_hoje}] FROM t', 'SQLSERVER', VALORES).parametros).toEqual([]);
  });

  it('não confunde chaves de JSON/arrays e escapes ODBC', () => {
    expect(compilarSql("SELECT '{1,2}'::int[], '{\"a\":1}'::jsonb", 'POSTGRES', {}).parametros).toEqual([]);
    expect(compilarSql('SELECT {fn NOW()}', 'SQLSERVER', {}).sql).toBe('SELECT {fn NOW()}');
  });

  it('recusa placeholder entre aspas', () => {
    expect(() => compilarSql("SELECT * FROM t WHERE d = '{data_hoje}'", 'POSTGRES', VALORES)).toThrow(/entre aspas/);
    expect(() => compilarSql('SELECT * FROM t WHERE d = "{data_hoje}"', 'MYSQL', VALORES)).toThrow(/entre aspas/);
  });

  it('recusa placeholder desconhecido e valor faltando', () => {
    expect(() => extrairPlaceholders('SELECT {empresa.senha}', 'POSTGRES')).toThrow(/desconhecido/);
    expect(() => compilarSql('SELECT {param.codigo}', 'POSTGRES', {})).toThrow(/\{param\.codigo\}/);
  });

  it('recusa parâmetros crus do driver', () => {
    expect(() => compilarSql('SELECT * FROM t WHERE a = $1', 'POSTGRES', {})).toThrow(ErroPlaceholder);
    expect(() => compilarSql('SELECT * FROM t WHERE a = ?', 'MYSQL', {})).toThrow(ErroPlaceholder);
    expect(() => compilarSql('SELECT * FROM t WHERE a = @p1', 'SQLSERVER', {})).toThrow(ErroPlaceholder);
    // ? é operador de JSONB no PostgreSQL; $ dentro de identificador é permitido.
    expect(compilarSql("SELECT dados ? 'chave', col$1 FROM t", 'POSTGRES', {}).sql).toBe("SELECT dados ? 'chave', col$1 FROM t");
  });

  it('segue o escape de cada banco ao decidir o que é string', () => {
    // MySQL: \' não fecha a string, então o placeholder está dentro dela.
    expect(() => compilarSql("SELECT 'a\\' , {data_hoje} '", 'MYSQL', VALORES)).toThrow(/entre aspas/);
    // PostgreSQL: a string 'a\' fecha antes do placeholder.
    expect(compilarSql("SELECT 'a\\', {data_hoje}", 'POSTGRES', VALORES).sql).toBe("SELECT 'a\\', $1");
    // PostgreSQL E'': \' escapa.
    expect(() => compilarSql("SELECT E'a\\' , {data_hoje} '", 'POSTGRES', VALORES)).toThrow(/entre aspas/);
  });

  it('normaliza o nome para minúsculas', () => {
    expect(extrairPlaceholders('SELECT {DATA_HOJE}, {Param.Busca}', 'POSTGRES')).toEqual(['data_hoje', 'param.busca']);
  });
});

describe('campos dinâmicos', () => {
  it('classifica os tipos dos três bancos', () => {
    expect(categoriaDoTipo('INT4')).toBe('numero');
    expect(categoriaDoTipo('NUMERIC')).toBe('numero');
    expect(categoriaDoTipo('UNSIGNED BIGINT')).toBe('numero');
    expect(categoriaDoTipo('MONEY')).toBe('numero');
    expect(categoriaDoTipo('DATE')).toBe('data');
    expect(categoriaDoTipo('TIMESTAMPTZ')).toBe('data_hora');
    expect(categoriaDoTipo('DATETIME2')).toBe('data_hora');
    expect(categoriaDoTipo('BIT')).toBe('booleano');
    expect(categoriaDoTipo('VARCHAR')).toBe('texto');
    expect(categoriaDoTipo('NVARCHAR')).toBe('texto');
    expect(categoriaDoTipo('BYTEA')).toBe('binario');
  });

  it('aponta colunas sem nome ou repetidas', () => {
    const campos = camposDasColunas([
      { nome: 'codigo', tipo: 'INT4' },
      { nome: '', tipo: 'INT4' },
      { nome: 'Codigo', tipo: 'TEXT' },
    ]);
    const avisos = avisosDosCampos(campos);
    expect(avisos).toHaveLength(2);
    expect(avisos.join()).toMatch(/sem nome/);
    expect(avisos.join()).toMatch(/"codigo" aparece 2 vezes/);
  });
});
