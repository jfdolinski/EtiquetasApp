import { describe, expect, it } from 'vitest';
import { padraoDeBusca, planoDeBuscaNoBanco } from './buscaNoBanco';
import type { CampoDinamico } from './consultas';
import { compilarSql } from './placeholders';

const campo = (nome: string, categoria: CampoDinamico['categoria'] = 'texto'): CampoDinamico => ({ nome, tipoBanco: '', categoria });
const CAMPOS = [campo('ean'), campo('descricao'), campo('preco', 'numero'), campo('validade', 'data'), campo('foto', 'binario')];
const SQL = 'SELECT ean, descricao, preco, validade, foto FROM produtos';

describe('padraoDeBusca', () => {
  it('fica sem acento e aceita acento no banco', () => {
    expect(padraoDeBusca('Café')).toBe('%__f_%');
    expect(padraoDeBusca('  LIMÃO ')).toBe('%l_m__%');
  });

  it('coringa digitado é texto, não coringa', () => {
    expect(padraoDeBusca('10%')).toBe('%10!%%');
    expect(padraoDeBusca('a_b')).toBe('%_!_b%');
    expect(padraoDeBusca('x!y')).toBe('%x!!y%');
    expect(padraoDeBusca('[z]')).toBe('%![z]%');
  });

  it('código não depende dos zeros à esquerda', () => {
    expect(padraoDeBusca('000789')).toBe('%789%');
  });
});

describe('planoDeBuscaNoBanco', () => {
  it('primeiro o código exato, sem conversão na coluna de texto; depois o contido', () => {
    const [exata, contem] = planoDeBuscaNoBanco(SQL, 'POSTGRES', CAMPOS, '789');
    expect(exata).toEqual({ sql: `SELECT * FROM (\n${SQL}\n) etiquetas_busca WHERE "ean" = {param.busca_exata}`, parametros: { busca_exata: '789' } });
    expect(contem.sql).toBe(
      `SELECT * FROM (\n${SQL}\n) etiquetas_busca WHERE LOWER(CAST("ean" AS TEXT)) LIKE {param.busca_contem} ESCAPE '!' OR LOWER(CAST("descricao" AS TEXT)) LIKE {param.busca_contem} ESCAPE '!' OR LOWER(CAST("preco" AS TEXT)) LIKE {param.busca_contem} ESCAPE '!'`,
    );
    expect(contem.parametros).toEqual({ busca_contem: '%789%' });
  });

  it('com zeros à esquerda, procura os dois jeitos', () => {
    const [exata] = planoDeBuscaNoBanco(SQL, 'POSTGRES', CAMPOS, '00789');
    expect(exata.sql).toContain('"ean" = {param.busca_exata} OR "ean" = {param.busca_sem_zeros}');
    expect(exata.parametros).toEqual({ busca_exata: '00789', busca_sem_zeros: '789' });
  });

  it('nome com espaço não tenta código, e número fica de fora quando não se procura número', () => {
    const etapas = planoDeBuscaNoBanco(SQL, 'POSTGRES', CAMPOS, 'cafe moido');
    expect(etapas).toHaveLength(1);
    expect(etapas[0].sql.split('WHERE')[1]).not.toContain('preco');
    expect(etapas[0].sql).toContain('"descricao"');
    expect(planoDeBuscaNoBanco(SQL, 'POSTGRES', CAMPOS, 'cafe')[1].sql.split('WHERE')[1]).not.toContain('preco');
  });

  it('coluna de data e binária nunca entram', () => {
    for (const e of planoDeBuscaNoBanco(SQL, 'POSTGRES', CAMPOS, '123')) {
      expect(e.sql.split('WHERE')[1]).not.toMatch(/validade|foto/);
    }
  });

  it('código numérico é convertido: comparar número com texto daria erro no banco', () => {
    const [exata] = planoDeBuscaNoBanco(SQL, 'POSTGRES', [campo('codigo', 'numero')], '12');
    expect(exata.sql).toContain('CAST("codigo" AS TEXT) = {param.busca_exata}');
  });

  it('usa a sintaxe de cada banco', () => {
    const [m] = planoDeBuscaNoBanco(SQL, 'MYSQL', [campo('ean'), campo('cod', 'numero')], 'x');
    expect(m.sql).toContain('`ean` = {param.busca_exata} OR CAST(`cod` AS CHAR) = {param.busca_exata}');
    const [s] = planoDeBuscaNoBanco(SQL, 'SQLSERVER', [campo('ean'), campo('cod', 'numero')], 'x');
    expect(s.sql).toContain('[ean] = {param.busca_exata} OR CAST([cod] AS NVARCHAR(4000)) = {param.busca_exata}');
  });

  it('nome de coluna não consegue sair do identificador', () => {
    expect(planoDeBuscaNoBanco(SQL, 'POSTGRES', [campo('a" OR 1=1 --')], 'x')[0].sql).toContain('"a"" OR 1=1 --"');
    expect(planoDeBuscaNoBanco(SQL, 'MYSQL', [campo('a` x')], 'x')[0].sql).toContain('`a`` x`');
    expect(planoDeBuscaNoBanco(SQL, 'SQLSERVER', [campo('a] x')], 'x')[0].sql).toContain('[a]] x]');
  });

  it('o termo vira parâmetro ligado, nunca texto do SQL', () => {
    const maldoso = "'; DROP TABLE produtos; --";
    for (const e of planoDeBuscaNoBanco(SQL, 'POSTGRES', CAMPOS, maldoso)) {
      expect(e.sql).not.toContain('DROP');
      const valores = Object.fromEntries(Object.entries(e.parametros).map(([k, v]) => [`param.${k}`, v]));
      const c = compilarSql(e.sql, 'POSTGRES', valores);
      expect(c.sql).toContain('$1');
      expect(c.sql).not.toContain('{param');
    }
  });

  it('o mesmo parâmetro repetido compila em todos os bancos', () => {
    const [, contem] = planoDeBuscaNoBanco(SQL, 'MYSQL', CAMPOS, '12');
    const c = compilarSql(contem.sql, 'MYSQL', { 'param.busca_contem': '%12%' });
    expect(c.parametros).toEqual(['%12%', '%12%', '%12%']);
  });

  it('tira o ponto e vírgula final e aguenta comentário no fim do SQL', () => {
    const [e] = planoDeBuscaNoBanco('SELECT ean FROM p;  \n', 'POSTGRES', [campo('ean')], 'x');
    expect(e.sql.startsWith('SELECT * FROM (\nSELECT ean FROM p\n)')).toBe(true);
    const [c] = planoDeBuscaNoBanco('SELECT ean FROM p -- todos', 'POSTGRES', [campo('ean')], 'x');
    expect(c.sql).toContain('-- todos\n) etiquetas_busca');
  });

  it.each<[string, CampoDinamico[], string]>([
    ['colunas não lidas', [], 'x'],
    ['nome repetido', [campo('a'), campo('A')], 'x'],
    ['coluna sem nome', [campo('')], 'x'],
    ['termo vazio', [campo('a')], '   '],
    ['termo enorme', [campo('a')], 'x'.repeat(201)],
  ])('não filtra no banco com %s', (_n, campos, termo) => {
    expect(planoDeBuscaNoBanco(SQL, 'POSTGRES', campos, termo)).toEqual([]);
  });
});
