import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adicionarProduto, colunasVisiveis, corpoDaBusca, impressoraDoModelo, parametrosDaBusca, registrosDoCodigo, avisosNovos, chavesDosAvisos, codigoValido, lerQrDeVinculo, pendentesPorModelo, quantidadeValida, registroParaDigitar, servidorValido, tempoDesde, versaoMaisNova } from './regras.ts';

test('QR de vínculo: lê o formato certo', () => {
  assert.deepEqual(lerQrDeVinculo('etiquetas://vincular?servidor=https%3A%2F%2Fapp.exemplo.com&codigo=ABCDEFGH23'), { servidor: 'https://app.exemplo.com', codigo: 'ABCDEFGH23' });
});

test('QR de vínculo: recusa o resto', () => {
  for (const t of [
    'https://exemplo.com',
    'etiquetas://outra?servidor=https%3A%2F%2Fa.com&codigo=ABCDEFGH23',
    'etiquetas://vincular?servidor=http%3A%2F%2Fa.com&codigo=ABCDEFGH23',
    'etiquetas://vincular?servidor=https%3A%2F%2Fa.com&codigo=curto',
    'etiquetas://vincular?codigo=ABCDEFGH23',
    'etiquetas://vincular?servidor=javascript%3Aalert(1)&codigo=ABCDEFGH23',
  ]) {
    assert.equal(lerQrDeVinculo(t), null, t);
  }
});

test('servidor: só HTTPS, sem usuário embutido, reduz à origem', () => {
  assert.equal(servidorValido(' https://a.com/qualquer/coisa '), 'https://a.com');
  assert.equal(servidorValido('http://a.com'), null);
  assert.equal(servidorValido('http://localhost:8081', true), 'http://localhost:8081');
  assert.equal(servidorValido('https://user:senha@a.com'), null);
  assert.equal(servidorValido('nada'), null);
});

test('código digitado aceita espaço, traço e minúscula', () => {
  assert.equal(codigoValido('abcd-efgh 23'), 'ABCDEFGH23');
  assert.equal(codigoValido('ABC'), null);
});

test('comparação de versões', () => {
  assert.equal(versaoMaisNova('1.2.10', '1.2.9'), true);
  assert.equal(versaoMaisNova('1.2.9', '1.2.10'), false);
  assert.equal(versaoMaisNova('1.2', '1.2.0'), false);
  assert.equal(versaoMaisNova('2.0.0', '1.9.9'), true);
  assert.equal(versaoMaisNova('<html>', '1.0.0'), false);
});

test('tempo desde', () => {
  const agora = new Date('2026-11-02T12:00:00Z').getTime();
  assert.equal(tempoDesde(null, agora), 'nunca');
  assert.equal(tempoDesde('2026-11-02T11:59:40Z', agora), 'agora há pouco');
  assert.equal(tempoDesde('2026-11-02T11:30:00Z', agora), 'há 30 min');
  assert.equal(tempoDesde('2026-11-02T07:00:00Z', agora), 'há 5 h');
  assert.equal(tempoDesde('2026-11-01T12:00:00Z', agora), 'há 1 dia');
  assert.equal(tempoDesde('2026-10-29T12:00:00Z', agora), 'há 4 dias');
});

test('quantidade', () => {
  assert.equal(quantidadeValida('3'), 3);
  assert.equal(quantidadeValida('0'), null);
  assert.equal(quantidadeValida('-1'), null);
  assert.equal(quantidadeValida('1,5'), null);
  assert.equal(quantidadeValida(''), null);
});

test('agrupa só os pendentes por modelo', () => {
  const itens = [
    { id: '1', modeloId: 'a', impressoraId: 'i', status: 'PENDENTE' },
    { id: '2', modeloId: 'b', impressoraId: 'i', status: 'NA_FILA' },
    { id: '3', modeloId: 'a', impressoraId: 'i', status: 'PENDENTE' },
    { id: '4', modeloId: 'c', impressoraId: 'i', status: 'PENDENTE' },
  ];
  const g = pendentesPorModelo(itens, [{ id: 'a', nome: 'Gôndola' }]);
  assert.deepEqual(g.map((x) => [x.nome, x.itens.length]), [['Gôndola', 2], ['Modelo', 1]]);
});

test('avisos novos: a primeira carga não avisa; repetição e novo avisam; resolvido não', () => {
  const n1 = { id: 'a', vezes: 1, resolvidaEm: null };
  const vistos = chavesDosAvisos([n1]);
  assert.deepEqual(avisosNovos([n1], null), []);
  assert.deepEqual(avisosNovos([n1], vistos), []);
  const repetido = { id: 'a', vezes: 2, resolvidaEm: null };
  const novo = { id: 'b', vezes: 1, resolvidaEm: null };
  assert.deepEqual(avisosNovos([repetido, novo], vistos), [repetido, novo]);
  assert.deepEqual(avisosNovos([{ id: 'c', vezes: 1, resolvidaEm: 'x' }], vistos), []);
});

test('sempre as 5 primeiras colunas, na ordem do modelo', () => {
  assert.deepEqual(colunasVisiveis(['codigo', 'descricao', 'preco', 'unidade', 'marca', 'estoque'], [{ preco: 1, codigo: 2 }]), ['codigo', 'descricao', 'preco', 'unidade', 'marca']);
  // Modelo sem colunas cadastradas: usa as dos registros. Com menos de 5: completa.
  assert.deepEqual(colunasVisiveis([], [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }]), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(colunasVisiveis(['a'], [{ a: 1, b: 2 }]), ['a', 'b']);
  assert.deepEqual(colunasVisiveis([], []), []);
});

test('o valor buscado vai no parâmetro certo', () => {
  assert.deepEqual(parametrosDaBusca(['loja', 'busca'], '789'), { loja: null, busca: '789' });
  assert.deepEqual(parametrosDaBusca(['loja', 'ean'], '789'), { loja: null, ean: '789' });
  assert.deepEqual(parametrosDaBusca(['x', 'y'], '789'), { x: '789', y: null });
  assert.deepEqual(parametrosDaBusca([], '789'), {});
});

test('código lido: o igual ganha dos parecidos, ignorando zeros à esquerda', () => {
  const a = { ean: '07891000100103', nome: 'A' };
  const b = { ean: '78910001001039', nome: 'B' };
  assert.deepEqual(registrosDoCodigo([a, b], '7891000100103'), [a]);
  assert.deepEqual(registrosDoCodigo([], '1'), []);
});

test('nada a ver com o termo não é resultado: vira produto não encontrado', () => {
  const a = { ean: '789', nome: 'Café moído' };
  const b = { ean: '790', nome: 'Arroz' };
  assert.deepEqual(registrosDoCodigo([a, b], 'feijao'), []);
  assert.deepEqual(registrosDoCodigo([a, b], '000'), []);
  assert.deepEqual(registrosDoCodigo([a, b], 'cafe moido'), [a]);
  // Um só: a consulta pode ter achado por uma coluna que não devolve.
  assert.deepEqual(registrosDoCodigo([a], '555'), [a]);
});

test('produto não encontrado: o que foi buscado entra na coluna do código', () => {
  assert.deepEqual(registroParaDigitar(['descricao', 'ean', 'preco'], '123'), { descricao: '', ean: '123', preco: '' });
  assert.deepEqual(registroParaDigitar(['nome', 'codigo'], '123'), { nome: '', codigo: '123' });
  assert.deepEqual(registroParaDigitar([], '123'), { codigo: '123', descricao: '' });
});

test('ler o mesmo produto soma uma etiqueta', () => {
  const p = { ean: '1' };
  const um = adicionarProduto([], p, () => 'x');
  assert.equal(um.linhas[0].quantidade, 1);
  assert.equal(um.repetida, null);
  const dois = adicionarProduto(um.linhas, { ean: '1' }, () => 'y');
  assert.equal(dois.linhas.length, 1);
  assert.equal(dois.linhas[0].quantidade, 2);
  assert.equal(adicionarProduto(dois.linhas, { ean: '2' }, () => 'z').linhas.length, 2);
});

test('impressora: a escolhida, depois a padrão, depois a única', () => {
  const duas = [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }];
  assert.equal(impressoraDoModelo('b', 'a', duas), 'b');
  assert.equal(impressoraDoModelo(null, 'a', duas), 'a');
  // Padrão que não existe mais: não há o que escolher sozinho entre duas.
  assert.equal(impressoraDoModelo(null, 'pdf', duas), null);
  assert.equal(impressoraDoModelo('sumiu', 'pdf', [duas[0]]), 'a');
  assert.equal(impressoraDoModelo(null, null, []), null);
});

test('busca: com parâmetro vai nele; sem parâmetro, o termo vai para o servidor procurar', () => {
  assert.deepEqual(corpoDaBusca('m', ['busca'], '789'), { modeloId: 'm', parametros: { busca: '789' } });
  assert.deepEqual(corpoDaBusca('m', [], '789'), { modeloId: 'm', parametros: {}, termo: '789' });
});
