import { filtrarPorTermo } from './avulsa';
import { describe, expect, it } from 'vitest';
import {
  alterarEmMassa,
  colunaDeBusca,
  parametrosDaBusca,
  registrosDoCodigo,
  COLUNA_QUANTIDADE,
  colunaNumerica,
  filtrarLinhas,
  normalizarEntrada,
  numeroDe,
  ordenarLinhas,
  somarResultados,
  type LinhaAvulsa,
} from './avulsa';

const linhas: LinhaAvulsa[] = [
  { id: 'a', quantidade: 1, registro: { codigo: '0012', descricao: 'Açúcar cristal 1kg', preco: '4.99', estoque: 30 } },
  { id: 'b', quantidade: 0, registro: { codigo: '0007', descricao: 'Arroz tipo 1 5kg', preco: '25.90', estoque: 5 } },
  { id: 'c', quantidade: 3, registro: { codigo: '0100', descricao: 'Feijão preto', preco: '', estoque: null } },
];
const colunas = ['codigo', 'descricao', 'preco', 'estoque'];

describe('grade da etiqueta avulsa', () => {
  it('entende números brasileiros e internacionais', () => {
    expect(numeroDe('4,99')).toBe(4.99);
    expect(numeroDe('1.234,56')).toBe(1234.56);
    expect(numeroDe('1,234.56')).toBe(1234.56);
    expect(numeroDe('R$ 10')).toBe(10);
    expect(numeroDe('abc')).toBeNull();
    expect(numeroDe('')).toBeNull();
    expect(normalizarEntrada('5,49')).toBe('5.49');
    expect(normalizarEntrada('1.234,50')).toBe('1234.50');
    expect(normalizarEntrada('0012')).toBe('0012'); // códigos não perdem zeros
    expect(colunaNumerica(linhas, 'preco')).toBe(true);
    expect(colunaNumerica(linhas, 'descricao')).toBe(false);
  });

  it('filtra por palavras em qualquer coluna, sem acento, e por coluna com comparação', () => {
    expect(filtrarLinhas(linhas, colunas, 'acucar 1kg', {}).map((l) => l.id)).toEqual(['a']);
    expect(filtrarLinhas(linhas, colunas, '', { preco: '>10' }).map((l) => l.id)).toEqual(['b']);
    expect(filtrarLinhas(linhas, colunas, '', { descricao: '!kg' }).map((l) => l.id)).toEqual(['c']);
    expect(filtrarLinhas(linhas, colunas, '', { [COLUNA_QUANTIDADE]: '>=1' }).map((l) => l.id)).toEqual(['a', 'c']);
    expect(filtrarLinhas(linhas, colunas, '', { codigo: '=0007' }).map((l) => l.id)).toEqual(['b']);
  });

  it('ordena números como números, texto em ordem alfabética e vazios no fim', () => {
    expect(ordenarLinhas(linhas, 'preco', 'desc').map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(ordenarLinhas(linhas, 'preco', 'asc').map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(ordenarLinhas(linhas, 'descricao', 'asc').map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(ordenarLinhas(linhas, 'codigo', 'asc').map((l) => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('altera em massa mantendo o tipo e as casas decimais', () => {
    const todos = new Set(['a', 'b', 'c']);
    const pct = alterarEmMassa(linhas, todos, 'preco', 'aumentar_pct', '10');
    expect(pct.linhas.map((l) => l.registro.preco)).toEqual(['5.49', '28.49', '']);
    expect(pct).toMatchObject({ alteradas: 2, ignoradas: 1 });
    expect(alterarEmMassa(linhas, todos, 'estoque', 'somar', '-2').linhas.map((l) => l.registro.estoque)).toEqual([28, 3, null]);
    expect(alterarEmMassa(linhas, new Set(['a']), 'descricao', 'maiusculas').linhas[0].registro.descricao).toBe('AÇÚCAR CRISTAL 1KG');
    expect(alterarEmMassa(linhas, todos, 'descricao', 'substituir', 'kg', ' KG').linhas[1].registro.descricao).toBe('Arroz tipo 1 5 KG');
    expect(alterarEmMassa(linhas, todos, 'preco', 'definir', '9,90').linhas[2].registro.preco).toBe('9.90');
    const q = alterarEmMassa(linhas, todos, COLUNA_QUANTIDADE, 'multiplicar', '400');
    expect(q.linhas.map((l) => l.quantidade)).toEqual([400, 0, 999]); // limite por linha
    expect(alterarEmMassa(linhas, todos, 'preco', 'somar', 'x').erro).toMatch(/número/);
    expect(linhas[0].registro.preco).toBe('4.99'); // não altera a lista original
  });

  it('soma resultados da busca sem repetir produtos', () => {
    let n = 0;
    const r = somarResultados(linhas, [linhas[0].registro, { codigo: '0200', descricao: 'Café' }], () => `n${n++}`, 1);
    expect(r.novas).toBe(1);
    expect(r.linhas[0]).toMatchObject({ id: 'n0', quantidade: 1, registro: { codigo: '0200' } });
    expect(r.linhas).toHaveLength(4);
  });
});

describe('busca pelo código na linha', () => {
  it('escolhe a coluna do código de barras, depois a do código', () => {
    expect(colunaDeBusca(['descricao', 'codigo', 'ean'])).toBe('ean');
    expect(colunaDeBusca(['descricao', 'codigo_barras'])).toBe('codigo_barras');
    expect(colunaDeBusca(['descricao', 'CodProduto', 'preco'])).toBe('CodProduto');
    expect(colunaDeBusca(['descricao', 'preco'])).toBe('descricao');
    expect(colunaDeBusca([])).toBeNull();
  });

  it('põe o valor no parâmetro certo e os outros ficam nulos', () => {
    expect(parametrosDaBusca(['loja', 'busca'], '789')).toEqual({ loja: null, busca: '789' });
    expect(parametrosDaBusca(['loja', 'ean'], '789')).toEqual({ loja: null, ean: '789' });
    expect(parametrosDaBusca(['x'], '789')).toEqual({ x: '789' });
    expect(parametrosDaBusca([], '789')).toEqual({});
  });

  it('prefere o código exato, ignorando zeros à esquerda; sem exato, devolve tudo', () => {
    const r = [{ ean: '7891000', d: 'A' }, { ean: 78910001, d: 'B' }, { ean: '0123', d: 'C' }];
    expect(registrosDoCodigo(r, 'ean', '7891000').map((x) => x.d)).toEqual(['A']);
    expect(registrosDoCodigo(r, 'ean', '123').map((x) => x.d)).toEqual(['C']);
    expect(registrosDoCodigo(r, 'ean', '999')).toHaveLength(3);
  });
});

describe('filtrarPorTermo', () => {
  const lista = [{ ean: '07891', nome: 'Café forte' }, { ean: '78912', nome: 'Cafe fraco' }, { ean: '3', nome: 'Arroz' }];
  it('código igual ganha do texto, sem zeros à esquerda', () => {
    expect(filtrarPorTermo(lista, '7891')).toEqual([lista[0]]);
  });
  it('texto ignora acento e caixa', () => {
    expect(filtrarPorTermo(lista, 'CAFÉ')).toEqual([lista[0], lista[1]]);
  });
  it('nada encontrado e termo vazio não trazem nada', () => {
    expect(filtrarPorTermo(lista, 'feijão')).toEqual([]);
    expect(filtrarPorTermo(lista, '  ')).toEqual([]);
  });
});
