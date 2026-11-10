import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { criarEmpresa, pedir, sql, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;

const SEMPRE_ABERTA = Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]);
const FECHADA = Array.from({ length: 7 }, () => []);
const CONFIG = {
  colunaCodigo: 'codigo',
  colunaNome: 'descricao',
  colunaPreco: 'preco',
  colunaPrecoDe: null,
  colunaUnidade: null,
  colunaCategoria: null,
  colunaEstoque: 'estoque',
  colunaCodigoBarras: null,
  comFotos: false,
  pedidoMinimoCentavos: 3000,
  modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: true, precoCentavos: 300 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
  mensagem: 'Pedidos até as 17h saem no mesmo dia',
  enderecoRetirada: 'Rua das Flores, 100',
  agendamento: { dias: 3, duracaoMinutos: 120 },
};
const ITENS = [
  { codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, precoDeCentavos: 2990, unidade: 'PCT', categoria: 'Mercearia', estoque: 5, codigoBarras: '7891234567895' },
  { codigo: '11', nome: 'Feijão Carioca 1kg', precoCentavos: 849, unidade: 'KG', categoria: 'Mercearia', estoque: 20 },
  { codigo: '20', nome: 'Detergente Limão', precoCentavos: 299, categoria: 'Limpeza', estoque: 50 },
];
const ENDERECO = { cep: '01001000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
const ip = () => `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Catálogo no ar, como a atualização deixaria, sem precisar do agente. */
async function lojaNoAr(empresa: EmpresaTeste, opcoes: { horario?: unknown; itens?: unknown; config?: unknown } = {}) {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercadinho Bom Preço', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(opcoes.horario ?? SEMPRE_ABERTA)]);
  await sql(
    `INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em)
     VALUES ($1, $2, true, $3, $4, $5, $6, now() at time zone 'utc', 120, now())
     ON CONFLICT (empresa_id) DO UPDATE SET ativo = true, codigo_link = $3, config = $4, itens = $5, quantidade_itens = $6, dados_em = now() at time zone 'utc'`,
    [randomUUID(), empresa.id, codigo, JSON.stringify(opcoes.config ?? CONFIG), JSON.stringify(opcoes.itens ?? ITENS), ((opcoes.itens as unknown[]) ?? ITENS).length],
  );
  return codigo;
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  itens: [{ codigo: '10', quantidade: 2, precoCentavos: 2490 }],
  nome: 'Maria Silva',
  telefone: '(11) 98765-4321',
  modalidade: 'ENTREGA',
  endereco: ENDERECO,
  agendamento: null,
  pagamento: 'PIX',
  trocoParaCentavos: null,
  observacao: '',
  ...extra,
});

test.beforeAll(async () => {
  tokenSuper = await superToken();
});

test('o cliente compra pelo celular: busca, carrinho, CEP, troco, preço que mudou e acompanhamento', async ({ page }) => {
  const e = await criarEmpresa(tokenSuper);
  const codigo = await lojaNoAr(e);
  await page.setViewportSize({ width: 390, height: 844 });
  // A busca de CEP real sai para a internet: aqui a resposta é fixa.
  await page.route('**/api/loja/*/cep/*', (r) => r.fulfill({ json: { cep: '01001000', rua: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' } }));
  const erros: string[] = [];
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  await page.goto(`/loja/${codigo}`);

  await expect(page.getByRole('heading', { name: 'Mercadinho Bom Preço' })).toBeVisible();
  await expect(page.getByText('Pedidos até as 17h saem no mesmo dia')).toBeVisible();
  await expect(page.getByText('Aberto agora')).toBeVisible();
  await expect(page.getByTestId('produto-loja')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Limpeza' }).click();
  await expect(page.getByTestId('produto-loja')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Todos' }).click();
  await page.getByLabel('Buscar produto').fill('feijao');
  await expect(page.getByTestId('produto-loja')).toHaveCount(1);
  await page.getByRole('button', { name: 'Adicionar Feijão Carioca 1kg' }).click();
  await expect(page.getByText('Faltam R$ 21,51 para o pedido mínimo')).toBeVisible();
  await page.getByLabel('Buscar produto').fill('');
  await page.getByRole('button', { name: 'Adicionar Arroz Tipo 1 5kg' }).click();
  // O estoque limita a quantidade.
  for (let i = 0; i < 6; i++) if (await page.getByRole('button', { name: 'Mais um Arroz Tipo 1 5kg' }).isEnabled()) await page.getByRole('button', { name: 'Mais um Arroz Tipo 1 5kg' }).click();
  await expect(page.getByLabel('Quantidade de Arroz Tipo 1 5kg')).toHaveText('5');
  await page.getByRole('button', { name: 'Tirar um Arroz Tipo 1 5kg' }).click();
  await page.getByRole('button', { name: 'Tirar um Arroz Tipo 1 5kg' }).click();
  await page.getByRole('button', { name: 'Tirar um Arroz Tipo 1 5kg' }).click();
  await expect(page.getByText('3 itens · R$ 58,29')).toBeVisible();
  await page.screenshot({ path: 'test-results/loja-catalogo.png' });

  // O carrinho fica guardado no aparelho.
  await page.reload();
  await expect(page.getByText('3 itens · R$ 58,29')).toBeVisible();
  await page.getByRole('button', { name: 'Ver carrinho' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await page.getByLabel('Nome').fill('Maria Silva');
  await page.getByLabel('Celular (WhatsApp)').fill('11987654321');
  await expect(page.getByLabel('Celular (WhatsApp)')).toHaveValue('(11) 98765-4321');
  await page.getByLabel('CEP').fill('01001000');
  await expect(page.getByLabel('Rua')).toHaveValue('Praça da Sé');
  await expect(page.getByLabel('Estado')).toHaveValue('SP');
  await expect(page.getByText('Informe o número, ou marque “sem número”.')).toBeVisible();
  await page.getByLabel('Número', { exact: true }).fill('10');
  await page.getByText('Dinheiro', { exact: true }).click();
  await page.getByLabel('Troco para quanto?').fill('100');
  await expect(page.getByTestId('troco')).toHaveText('Seu troco: R$ 36,71');
  await page.screenshot({ path: 'test-results/loja-finalizar.png', fullPage: true });

  // Enquanto o cliente preenchia, o preço do feijão mudou no sistema.
  const novos = ITENS.map((i) => (i.codigo === '11' ? { ...i, precoCentavos: 999 } : i));
  await sql(`UPDATE configuracoes_pedidos SET itens = $2 WHERE empresa_id = $1`, [e.id, JSON.stringify(novos)]);
  await page.getByRole('button', { name: /Enviar pedido/ }).click();
  await expect(page.getByRole('alert')).toContainText('Feijão Carioca 1kg: o preço mudou de R$ 8,49 para R$ 9,99.');
  await expect(page.getByRole('button', { name: 'Enviar pedido · R$ 64,79' })).toBeVisible();
  expect((await sql(`SELECT count(*)::int AS n FROM pedidos WHERE empresa_id = $1`, [e.id]))[0].n).toBe(0);
  await page.getByRole('button', { name: 'Enviar pedido · R$ 64,79' }).click();

  await expect(page.getByRole('heading', { name: 'Pedido nº 1 enviado!' })).toBeVisible();
  const [salvo] = await sql(`SELECT * FROM pedidos WHERE empresa_id = $1`, [e.id]);
  expect(salvo).toMatchObject({ numero: 1, situacao: 'NOVO', cliente_nome: 'Maria Silva', cliente_telefone: '11987654321', modalidade: 'ENTREGA', pagamento: 'DINHEIRO', troco_para_centavos: 10000, subtotal_centavos: 5979, taxa_centavos: 500, total_centavos: 6479 });
  expect(salvo.endereco).toMatchObject({ cep: '01001000', numero: '10', uf: 'SP' });
  expect(salvo.itens.map((i: { codigo: string; quantidade: number; precoCentavos: number }) => [i.codigo, i.quantidade, i.precoCentavos])).toEqual([['10', 2, 2490], ['11', 1, 999]]);

  await page.getByRole('link', { name: 'Acompanhar o pedido' }).click();
  await expect(page.getByRole('heading', { name: 'Pedido nº 1' })).toBeVisible();
  await expect(page.getByTestId('situacao-pedido')).toHaveText(/Recebido/);
  await expect(page.getByText('Total')).toBeVisible();
  await expect(page.getByText('troco para R$ 100,00: devolver R$ 35,21', { exact: false })).toBeVisible();
  // A loja muda a situação (o painel vem na etapa 3): o cliente vê sem recarregar a mão.
  await sql(`UPDATE pedidos SET situacao = 'PRONTO' WHERE empresa_id = $1`, [e.id]);
  await page.reload();
  await expect(page.getByTestId('situacao-pedido')).toHaveText(/Saiu para entrega/);
  await page.screenshot({ path: 'test-results/loja-acompanhamento.png', fullPage: true });

  // De volta ao catálogo: o carrinho esvaziou e o pedido aparece em "Seus pedidos".
  await page.goto(`/loja/${codigo}`);
  await expect(page.getByRole('link', { name: 'nº 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver carrinho' })).toHaveCount(0);
  expect(erros.filter((t) => !/Failed to load resource/.test(t))).toEqual([]);
});

test('API pública: link, regras, preço nunca vem do cliente, limite por aparelho e isolamento', async () => {
  const e = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  const codigo = await lojaNoAr(e);
  const codigoOutra = await lojaNoAr(outra, { itens: [{ codigo: '99', nome: 'Produto da outra', precoCentavos: 5000, estoque: 3 }] });

  expect((await pedir('GET', '/loja/naoexiste1234')).status).toBe(404);
  const c = await pedir('GET', `/loja/${codigo}`);
  expect(c.status).toBe(200);
  expect(c.j.itens.map((i: { codigo: string }) => i.codigo)).toEqual(['10', '11', '20']);
  expect(c.j.itens[0]).not.toHaveProperty('codigoBarras');
  expect(c.j.modalidades.map((m: { modalidade: string }) => m.modalidade)).toEqual(['ENTREGA', 'AGENDADA', 'RETIRADA']);
  expect(c.j.categorias).toEqual(['Limpeza', 'Mercearia']);
  // Cada link só mostra a própria empresa.
  expect((await pedir('GET', `/loja/${codigoOutra}`)).j.itens.map((i: { codigo: string }) => i.codigo)).toEqual(['99']);

  // Preço adulterado: recusado, com o preço certo para o cliente confirmar.
  const adulterado = await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ itens: [{ codigo: '10', quantidade: 2, precoCentavos: 1 }] }), ip: ip() });
  expect(adulterado.status).toBe(409);
  expect(adulterado.j.mudancas).toEqual([{ codigo: '10', nome: 'Arroz Tipo 1 5kg', tipo: 'PRECO', antes: 1, depois: 2490 }]);
  // Produto da outra empresa não existe aqui.
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ itens: [{ codigo: '99', quantidade: 1, precoCentavos: 5000 }] }), ip: ip() })).j.mudancas[0].tipo).toBe('SUMIU');
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ telefone: '1133334444' }), ip: ip() })).status).toBe(400);
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ itens: [{ codigo: '11', quantidade: 1, precoCentavos: 849 }] }), ip: ip() })).j.message).toMatch(/pedido mínimo/);
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ modalidade: 'EXPRESSA' }), ip: ip() })).status).toBe(400);
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: { ...pedido(), extra: 1 }, ip: ip() })).status).toBe(400);

  // Agendada: só uma faixa oferecida vale.
  const faixa = c.j.faixas[c.j.faixas.length - 1];
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ modalidade: 'AGENDADA', agendamento: { ...faixa, inicio: '03:17' } }), ip: ip() })).status).toBe(400);
  const agendado = await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ modalidade: 'AGENDADA', agendamento: faixa }), ip: ip() });
  expect(agendado.status).toBe(201);
  expect(agendado.j.numero).toBe(1);
  // Retirada: sem endereço, e a numeração continua.
  const retirada = await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ modalidade: 'RETIRADA', endereco: null }), ip: ip() });
  expect(retirada.j.numero).toBe(2);
  const acompanhar = await pedir('GET', `/loja/pedido/${retirada.j.codigo}`);
  expect(acompanhar.j).toMatchObject({ numero: 2, situacao: 'NOVO', modalidade: 'RETIRADA', endereco: null, enderecoRetirada: 'Rua das Flores, 100', empresa: 'Mercadinho Bom Preço' });
  expect(acompanhar.j.totais).toEqual({ subtotalCentavos: 4980, taxaCentavos: 0, descontoCentavos: 0, totalCentavos: 4980, trocoCentavos: null });
  expect((await pedir('GET', `/loja/pedido/${retirada.j.codigo}x`)).status).toBe(404);
  // O código do acompanhamento não fica legível no banco.
  const [guardado] = await sql(`SELECT codigo_hash, codigo_cifrado FROM pedidos WHERE empresa_id = $1 AND numero = 2`, [e.id]);
  expect(guardado.codigo_hash).toBe(createHash('sha256').update(retirada.j.codigo).digest('hex'));
  expect(guardado.codigo_cifrado).not.toContain(retirada.j.codigo);
  // A outra empresa numera do começo.
  expect((await pedir('POST', `/loja/${codigoOutra}/pedidos`, { corpo: pedido({ itens: [{ codigo: '99', quantidade: 1, precoCentavos: 5000 }] }), ip: ip() })).j.numero).toBe(1);

  // Limite por aparelho, na mesma loja.
  const mesmoIp = ip();
  const origem = createHash('sha256').update(`${e.id}:${mesmoIp}`).digest('hex');
  for (let n = 0; n < 10; n++) {
    await sql(`INSERT INTO pedidos (id, empresa_id, numero, codigo_hash, codigo_cifrado, cliente_nome, cliente_telefone, modalidade, pagamento, itens, subtotal_centavos, taxa_centavos, total_centavos, origem_hash, criado_em, atualizado_em) VALUES ($1, $2, $3, $4, 'x', 'Robô', '11987654321', 'RETIRADA', 'PIX', '[]', 0, 0, 0, $5, now() at time zone 'utc', now())`, [randomUUID(), e.id, 1000 + n, randomUUID(), origem]);
  }
  expect((await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido(), ip: mesmoIp })).status).toBe(429);

  // Desligado: indisponível; fechada: só a agendada, e sem horário não há faixa, então nada.
  await sql(`UPDATE configuracoes_pedidos SET ativo = false WHERE empresa_id = $1`, [e.id]);
  expect((await pedir('GET', `/loja/${codigo}`)).status).toBe(503);
  const fechada = await lojaNoAr(e, { horario: FECHADA });
  const f = await pedir('GET', `/loja/${fechada}`);
  expect(f.j.aberta).toBe(false);
  expect(f.j.modalidades).toEqual([]);
  // Detergente: o arroz já está reservado pelos pedidos acima.
  expect((await pedir('POST', `/loja/${fechada}/pedidos`, { corpo: pedido({ itens: [{ codigo: '20', quantidade: 11, precoCentavos: 299 }] }), ip: ip() })).j.message).toMatch(/fechada/);
  // O link antigo deixou de valer quando o código mudou.
  expect((await pedir('GET', `/loja/${codigo}`)).status).toBe(404);
});

test('o cliente cancela até a separação e, depois que sai, confirma o recebimento', async ({ page }) => {
  const e = await criarEmpresa(tokenSuper);
  const codigo = await lojaNoAr(e);
  const novo = async () => (await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido(), ip: ip() })).j as { numero: number; codigo: string };
  const situacao = (n: number, s: string) => sql(`UPDATE pedidos SET situacao = $3 WHERE empresa_id = $1 AND numero = $2`, [e.id, n, s]);

  // API: cancela recebido e em separação; depois de sair, não; confirmar só depois de sair.
  const a = await novo();
  expect((await pedir('POST', `/loja/pedido/${a.codigo}/recebido`, { corpo: {} })).status).toBe(409);
  const cancelado = await pedir('POST', `/loja/pedido/${a.codigo}/cancelar`, { corpo: {} });
  expect(cancelado.j).toMatchObject({ situacao: 'CANCELADO', motivoCancelamento: 'Cancelado pelo cliente' });
  expect((await pedir('POST', `/loja/pedido/${a.codigo}/cancelar`, { corpo: {} })).status).toBe(409);
  const b = await novo();
  await situacao(b.numero, 'EM_SEPARACAO');
  expect((await pedir('POST', `/loja/pedido/${b.codigo}/cancelar`, { corpo: { motivo: 'Comprei em outro lugar' } })).j.motivoCancelamento).toBe('Cancelado pelo cliente: Comprei em outro lugar');
  const c = await novo();
  await situacao(c.numero, 'PRONTO');
  expect((await pedir('POST', `/loja/pedido/${c.codigo}/cancelar`, { corpo: {} })).j.message).toMatch(/fale com a loja/);
  expect((await pedir('POST', `/loja/pedido/${c.codigo}/recebido`, { corpo: {} })).j.situacao).toBe('CONCLUIDO');
  expect((await pedir('POST', `/loja/pedido/${c.codigo}x/cancelar`, { corpo: {} })).status).toBe(404);
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM logs_auditoria WHERE empresa_id = $1 AND acao IN ('pedido.cancelado_cliente', 'pedido.recebido_cliente')`, [e.id]);
  expect(n).toBe(3);

  // Pela tela, no celular.
  await page.setViewportSize({ width: 390, height: 844 });
  const d = await novo();
  await page.goto(`/loja/pedido/${d.codigo}`);
  const acoes = page.getByTestId('acoes-cliente');
  await expect(acoes.getByRole('button', { name: 'Confirmar recebimento' })).toHaveCount(0);
  await acoes.getByRole('button', { name: 'Cancelar pedido' }).click();
  await acoes.getByLabel('Motivo (opcional)').fill('Pedi errado');
  await page.screenshot({ path: 'test-results/loja-cancelar.png', fullPage: true });
  await acoes.getByRole('button', { name: 'Sim, cancelar' }).click();
  await expect(page.getByTestId('situacao-pedido')).toHaveText('Cancelado');
  await expect(page.getByText('Cancelado pelo cliente: Pedi errado')).toBeVisible();
  await expect(page.getByTestId('acoes-cliente')).toHaveCount(0);

  const f = await novo();
  await situacao(f.numero, 'PRONTO');
  await page.goto(`/loja/pedido/${f.codigo}`);
  await expect(page.getByTestId('acoes-cliente').getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);
  page.once('dialog', (x) => void x.accept());
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByTestId('situacao-pedido')).toHaveText(/Concluído/);
  await expect(page.getByTestId('acoes-cliente')).toHaveCount(0);
  // A loja vê no histórico que foi o cliente.
  const [{ historico }] = await sql(`SELECT historico FROM pedidos WHERE empresa_id = $1 AND numero = $2`, [e.id, f.numero]);
  expect(historico.at(-1)).toMatchObject({ texto: 'O cliente confirmou o recebimento', por: null });
});

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('reserva o estoque dos pedidos em aberto, logomarca e repetir a compra com o estoque de agora', async ({ page }) => {
  const e = await criarEmpresa(tokenSuper);
  const codigo = await lojaNoAr(e);

  // Reserva: 3 dos 5 arrozes em pedido recebido somem do link; saiu para entrega, voltam a valer pelo ERP.
  const primeiro = (await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ itens: [{ codigo: '10', quantidade: 3, precoCentavos: 2490 }] }), ip: ip() })).j;
  const estoqueDoArroz = async () => (await pedir('GET', `/loja/${codigo}`)).j.itens.find((i: { codigo: string }) => i.codigo === '10')?.estoque;
  expect(await estoqueDoArroz()).toBe(2);
  const demais = await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ itens: [{ codigo: '10', quantidade: 3, precoCentavos: 2490 }] }), ip: ip() });
  expect(demais.status).toBe(409);
  expect(demais.j.mudancas).toEqual([{ codigo: '10', nome: 'Arroz Tipo 1 5kg', tipo: 'ESTOQUE', antes: 3, depois: 2 }]);
  await sql(`UPDATE pedidos SET situacao = 'EM_SEPARACAO' WHERE empresa_id = $1 AND numero = $2`, [e.id, primeiro.numero]);
  expect(await estoqueDoArroz()).toBe(2);
  await sql(`UPDATE pedidos SET situacao = 'PRONTO' WHERE empresa_id = $1 AND numero = $2`, [e.id, primeiro.numero]);
  expect(await estoqueDoArroz()).toBe(5);

  // Logomarca: só imagem de verdade; aparece no catálogo e no acompanhamento.
  expect((await pedir('PUT', '/pedidos/configuracao/logo', { token: e.adminToken, corpo: { dados: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') } })).status).toBe(400);
  const comLogo = await pedir('PUT', '/pedidos/configuracao/logo', { token: e.adminToken, corpo: { dados: `data:image/png;base64,${PNG_1x1}` } });
  expect(comLogo.status).toBe(200);
  expect(comLogo.j.logo.startsWith(`/api/loja/${codigo}/logo?v=`)).toBe(true);
  const imagem = await fetch(`http://localhost:3000${comLogo.j.logo}`);
  expect(imagem.headers.get('content-type')).toBe('image/png');
  expect((await pedir('GET', `/loja/${codigo}`)).j.logo).toBe(comLogo.j.logo);
  const acompanhamento = await pedir('GET', `/loja/pedido/${primeiro.codigo}`);
  expect(acompanhamento.j).toMatchObject({ logo: comLogo.j.logo, codigoLoja: codigo });

  // Repetir: o arroz agora tem estoque 2 (o 2º pedido reserva 3? não: foi recusado), o preço do feijão mudou.
  await sql(`UPDATE pedidos SET situacao = 'CONCLUIDO' WHERE empresa_id = $1 AND numero = $2`, [e.id, primeiro.numero]);
  const outro = (await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido({ itens: [{ codigo: '10', quantidade: 4, precoCentavos: 2490 }, { codigo: '11', quantidade: 1, precoCentavos: 849 }] }), ip: ip() })).j;
  await sql(`UPDATE configuracoes_pedidos SET itens = $2 WHERE empresa_id = $1`, [e.id, JSON.stringify(ITENS.map((i) => (i.codigo === '11' ? { ...i, precoCentavos: 999 } : i)))]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/loja/pedido/${outro.codigo}`);
  await expect(page.getByTestId('logo-loja')).toBeVisible();
  await page.getByRole('button', { name: 'Repetir a compra' }).click();
  await expect.poll(() => page.url()).toContain(`/loja/${codigo}?carrinho=1`);
  await expect(page.getByRole('heading', { name: 'Seu carrinho' })).toBeVisible();
  // Os 4 arrozes deste pedido estão reservados por ele mesmo: sobra 1 no estoque.
  await expect(page.getByRole('status')).toContainText('Arroz Tipo 1 5kg: só resta 1, em vez de 4.');
  await expect(page.getByRole('status')).toContainText('Feijão Carioca 1kg: o preço agora é R$ 9,99 (era R$ 8,49).');
  await expect(page.getByLabel('Quantidade de Arroz Tipo 1 5kg')).toHaveText('1');
  await expect(page.getByTestId('logo-loja')).toBeVisible();
  await page.screenshot({ path: 'test-results/loja-repetir.png', fullPage: true });
});

test('logomarca pela tela de configuração', async ({ page }) => {
  const e = await criarEmpresa(tokenSuper);
  await lojaNoAr(e);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(e.adminEmail);
  await page.getByLabel('Senha').fill(e.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await page.getByLabel('Arquivo da logomarca').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1x1, 'base64') });
  await expect(page.getByAltText('Logomarca atual')).toBeVisible();
  const [{ logo_mime }] = await sql(`SELECT logo_mime FROM configuracoes_pedidos WHERE empresa_id = $1`, [e.id]);
  expect(logo_mime).toBe('image/png');
  await page.getByRole('button', { name: 'Tirar', exact: true }).click();
  await expect(page.getByAltText('Logomarca atual')).toHaveCount(0);
});

test('prévia do link (WhatsApp): nome e logomarca da empresa, nada do cliente, texto escapado', async () => {
  const e = await criarEmpresa(tokenSuper);
  const codigo = await lojaNoAr(e);
  await pedir('PUT', '/pedidos/configuracao/logo', { token: e.adminToken, corpo: { dados: `data:image/png;base64,${PNG_1x1}` } });
  const html = async (caminho: string) => {
    const r = await fetch(`http://localhost:3000/api${caminho}`, { headers: { 'x-forwarded-for': ip() } });
    return { status: r.status, tipo: r.headers.get('content-type'), corpo: await r.text() };
  };

  const loja = await html(`/loja/${codigo}/previa`);
  expect(loja.status).toBe(200);
  expect(loja.tipo).toMatch(/text\/html/);
  expect(loja.corpo).toContain('<title>Mercadinho Bom Preço</title>');
  expect(loja.corpo).toContain('<meta property="og:title" content="Mercadinho Bom Preço">');
  expect(loja.corpo).toContain('<meta property="og:description" content="Pedidos até as 17h saem no mesmo dia">');
  expect(loja.corpo).toContain(`<meta property="og:image" content="http://localhost:3000/api/loja/${codigo}/logo?v=`);
  expect(loja.corpo).toContain(`<meta property="og:url" content="http://localhost:3000/loja/${codigo}">`);

  const feito = (await pedir('POST', `/loja/${codigo}/pedidos`, { corpo: pedido(), ip: ip() })).j;
  const doPedido = await html(`/loja/pedido/${feito.codigo}/previa`);
  expect(doPedido.corpo).toContain(`<title>Pedido nº ${feito.numero} – Mercadinho Bom Preço</title>`);
  expect(doPedido.corpo).not.toContain('Maria');
  expect(doPedido.corpo).not.toContain('98765');

  const inexistente = await html('/loja/naoexiste1234/previa');
  expect(inexistente.status).toBe(404);
  expect(inexistente.corpo).toContain('<title>Pedidos</title>');

  await sql(`UPDATE empresas SET nome_fantasia = $2 WHERE id = $1`, [e.id, 'Loja "Boa" <script>alert(1)</script>']);
  const perigoso = await html(`/loja/${codigo}/previa`);
  expect(perigoso.corpo).not.toContain('<script>');
  expect(perigoso.corpo).toContain('<title>Loja &quot;Boa&quot; &lt;script&gt;alert(1)&lt;/script&gt;</title>');
});

test('cartão do produto: abre ao tocar, mostra os campos escolhidos e a foto, e o voltar do celular fecha', async ({ page }) => {
  const e = await criarEmpresa(tokenSuper);
  const comDetalhe = ITENS.map((i) => (i.codigo === '10' ? { ...i, detalhes: [{ rotulo: 'Marca', valor: 'Camil' }, { rotulo: 'Validade', valor: '31/12/2026' }] } : i));
  const codigo = await lojaNoAr(e, { itens: comDetalhe });
  await pedir('PUT', '/pedidos/configuracao/logo', { token: e.adminToken, corpo: { dados: `data:image/png;base64,${PNG_1x1}` } });
  const foto = (await pedir('GET', `/loja/${codigo}`)).j.logo as string;
  await sql(`UPDATE configuracoes_pedidos SET itens = $2 WHERE empresa_id = $1`, [e.id, JSON.stringify(comDetalhe.map((i) => (i.codigo === '10' ? { ...i, foto } : i)))]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/loja/${codigo}`);
  await page.getByRole('button', { name: 'Ver detalhes de Arroz Tipo 1 5kg' }).click();
  const cartao = page.getByTestId('detalhe-produto');
  await expect(cartao.getByRole('heading', { name: 'Arroz Tipo 1 5kg' })).toBeVisible();
  await expect(cartao.getByRole('img', { name: 'Arroz Tipo 1 5kg' })).toBeVisible();
  await expect(cartao.getByText('5 disponíveis')).toBeVisible();
  await expect(cartao.getByText('Mercearia')).toBeVisible();
  await expect(cartao.getByTestId('detalhes-produto')).toContainText('MarcaCamil');
  await expect(cartao.getByTestId('detalhes-produto')).toContainText('Validade31/12/2026');
  await cartao.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(cartao.getByLabel('Quantidade de Arroz Tipo 1 5kg')).toHaveText('1');
  await page.screenshot({ path: 'test-results/loja-cartao-produto.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detalhe-produto')).toHaveCount(0);
  await expect(page.getByText('1 item · R$ 24,90')).toBeVisible();

  // O "voltar" fecha o cartão e continua na loja.
  await page.getByRole('button', { name: 'Ver detalhes de Feijão Carioca 1kg' }).click();
  await expect(page.getByTestId('detalhe-produto')).toBeVisible();
  await expect(page.getByTestId('detalhes-produto')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId('detalhe-produto')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/loja/${codigo}`);
});

test('campos do detalhe na configuração: escolhe, renomeia e só entram colunas da consulta', async ({ page }) => {
  const e = await criarEmpresa(tokenSuper);
  await lojaNoAr(e);
  const conexao = randomUUID();
  const consulta = randomUUID();
  await sql(`INSERT INTO conexoes_banco (id, empresa_id, nome, tipo, host, porta, banco, usuario, atualizado_em) VALUES ($1, $2, 'Conexão', 'POSTGRES', 'localhost', 5432, 'erp', 'leitor', now())`, [conexao, e.id]);
  await sql(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, finalidade, sql, campos, atualizado_em) VALUES ($1, $2, $3, 'Produtos detalhe', 'OUTRA', 'SELECT 1', $4, now())`, [consulta, e.id, conexao, JSON.stringify(['codigo', 'descricao', 'preco', 'estoque', 'marca', 'preco_custo'].map((nome) => ({ nome })))]);
  await sql(`UPDATE configuracoes_pedidos SET consulta_id = $2 WHERE empresa_id = $1`, [e.id, consulta]);
  const [{ config }] = await sql(`SELECT config FROM configuracoes_pedidos WHERE empresa_id = $1`, [e.id]);
  const corpo = (campos: unknown) => ({ ativo: false, consultaId: consulta, config: { ...config, colunaUnidade: null, colunaCategoria: null, colunaCodigoBarras: null, camposDetalhe: campos }, intervaloMinutos: 15, validadeMinutos: 120, horario: Array.from({ length: 7 }, () => []) });
  expect((await pedir('PUT', '/pedidos/configuracao', { token: e.adminToken, corpo: corpo([{ coluna: 'nao_existe', rotulo: 'X' }]) })).status).toBe(400);
  expect((await pedir('PUT', '/pedidos/configuracao', { token: e.adminToken, corpo: corpo([{ coluna: 'marca', rotulo: '' }]) })).status).toBe(400);

  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(e.adminEmail);
  await page.getByLabel('Senha').fill(e.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await page.getByLabel('Mostrar marca no detalhe').check();
  await expect(page.getByLabel('Nome de marca para o cliente')).toHaveValue('Marca');
  await page.getByLabel('Nome de marca para o cliente').fill('Fabricante');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(/Configuração salva/)).toBeVisible({ timeout: 40_000 });
  const [{ config: salvo }] = await sql(`SELECT config FROM configuracoes_pedidos WHERE empresa_id = $1`, [e.id]);
  expect(salvo.camposDetalhe).toEqual([{ coluna: 'marca', rotulo: 'Fabricante' }]);
});
