import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codigoDaTela, codigoDaTelaParaLer, adicionarProduto, colunasVisiveis, lerLinhasPorProduto, proximasLinhasPorProduto, textoNaTela, contaExibicao, corpoDaBusca, linkDeBannerValido, impressoraDoModelo, parametrosDaBusca, registrosDoCodigo, avisosNovos, chavesDosAvisos, codigoValido, lerQrDeVinculo, pendentesPorModelo, quantidadeValida, registroParaDigitar, servidorValido, tempoDesde, versaoMaisNova } from './regras.ts';

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
  assert.deepEqual(colunasVisiveis(['codigo', 'descricao', 'preco', 'unidade', 'marca', 'estoque'], [{ preco: 1, codigo: 2 }]), ['codigo', 'descricao', 'preco', 'unidade', 'marca', 'estoque']);
  // Modelo sem colunas cadastradas: usa as dos registros, sem limite de quantidade.
  assert.deepEqual(colunasVisiveis([], [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }]), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  // O que só os registros trazem vem depois das colunas do modelo.
  assert.deepEqual(colunasVisiveis(['a'], [{ b: 2, a: 1 }]), ['a', 'b']);
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

test('banner: conta exibição uma vez a cada 10 minutos e só abre link http(s)', () => {
  assert.equal(contaExibicao(undefined, 1000), true);
  assert.equal(contaExibicao(1000, 1000 + 10 * 60_000 - 1), false);
  assert.equal(contaExibicao(1000, 1000 + 10 * 60_000), true);
  assert.equal(linkDeBannerValido('https://exemplo.com.br/oferta'), true);
  assert.equal(linkDeBannerValido('http://exemplo.com.br'), true);
  assert.equal(linkDeBannerValido('javascript:alert(1)'), false);
  assert.equal(linkDeBannerValido('intent://x'), false);
  assert.equal(linkDeBannerValido(null), false);
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

test('o que parece data aparece como DD/MM/AAAA, sem converter fuso; código fica como está', () => {
  for (const v of ['2026-11-03', '2026-11-03T00:00:00Z', '2026-11-03T23:59:59.123-03:00', '2026-11-03 14:22:00', '2026/11/03', '3/11/2026', '03-11-2026', '03.11.2026 08:00', '03/11/26']) assert.equal(textoNaTela(v), '03/11/2026', v);
  for (const v of ['7891000100103', '20261103', '2026-13-03', '31/02/2026', '12-10-25', '1.234,56', '4.99', '03/11/2026 promoção', '0001-01-01']) assert.equal(textoNaTela(v), v);
  assert.equal(textoNaTela(20261103), '20261103');
  assert.equal(textoNaTela(null), '');
});

test('código da tela: lê o link do QR e o digitado, e recusa outra coisa', () => {
  assert.equal(codigoDaTela('https://sistema.exemplo/telas/vincular#codigo=K7M29QXT'), 'K7M29QXT');
  assert.equal(codigoDaTela('k7m2-9qxt'), 'K7M29QXT');
  assert.equal(codigoDaTela('7891000100103'), null);
  assert.equal(codigoDaTela('https://sistema.exemplo/'), null);
  assert.equal(codigoDaTelaParaLer('K7M29QXT'), 'K7M2-9QXT');
});

test('linhas por produto: só de 1 a 30; o resto vale como todas', () => {
  assert.equal(lerLinhasPorProduto('5'), 5);
  for (const t of [null, '', '0', '31', 'abc', '5.5', '-1']) assert.equal(lerLinhasPorProduto(t), null);
  assert.equal(proximasLinhasPorProduto(null, -1), 5);
  assert.equal(proximasLinhasPorProduto(null, 1), null);
  assert.equal(proximasLinhasPorProduto(5, 1), 6);
  assert.equal(proximasLinhasPorProduto(1, -1), 1);
  assert.equal(proximasLinhasPorProduto(30, 1), null);
});

test('busca: com parâmetro vai nele; sem parâmetro, o termo vai para o servidor procurar', () => {
  assert.deepEqual(corpoDaBusca('m', ['busca'], '789'), { modeloId: 'm', parametros: { busca: '789' } });
  assert.deepEqual(corpoDaBusca('m', [], '789'), { modeloId: 'm', parametros: {}, termo: '789' });
});
