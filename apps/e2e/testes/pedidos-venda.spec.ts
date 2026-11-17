import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, login, pedir, sql, superToken, vincularCelular, type EmpresaTeste } from './apoio';

/** O vendedor lança o pedido pelo aplicativo (aqui pela API, com o token do celular) e a loja vê no painel. */
const ITENS = [
  { codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, estoque: 50, codigoBarras: '7891234567895' },
  { codigo: '11', nome: 'Feijão Carioca 1kg', precoCentavos: 849, estoque: 50 },
];
const ENDERECO = { cep: '01001000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
const FECHADA = Array.from({ length: 7 }, () => []);
const ip = () => `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function prepararLoja(empresa: EmpresaTeste, vendas: Record<string, unknown> | null) {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  const impressora = randomUUID();
  await sql(`INSERT INTO impressoras (id, empresa_id, nome, linguagem, endereco, atualizado_em) VALUES ($1, $2, 'Térmica do caixa', 'ESCPOS', '127.0.0.1:9100', now())`, [impressora, empresa.id]);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: 'ean', comFotos: false,
    pedidoMinimoCentavos: 10000,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: '', enderecoRetirada: 'Rua das Flores, 100', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: impressora,
    ...(vendas ? { vendas } : {}),
  };
  // Loja fechada o dia todo: o link só aceitaria agendada, o vendedor vende assim mesmo.
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercadinho Bom Preço', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(FECHADA)]);
  await sql(
    `INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, 2, now() at time zone 'utc', 120, now())`,
    [randomUUID(), empresa.id, codigo, JSON.stringify(config), JSON.stringify(ITENS)],
  );
  return { codigo };
}

async function usuarioCom(empresa: EmpresaTeste, nome: string, permissoes: string[], codigoErp?: string) {
  const perfil = await pedir('POST', '/perfis', { token: empresa.adminToken, corpo: { nome: `${nome} ${randomUUID().slice(0, 6)}`, permissoes } });
  expect(perfil.status).toBe(201);
  const email = `${randomUUID().slice(0, 8)}@e2e.local`;
  const u = await pedir('POST', '/usuarios', { token: empresa.adminToken, corpo: { nome, email, senha: 'SenhaUsuario123', perfilId: perfil.j.id, ...(codigoErp ? { codigoErp } : {}) } });
  expect(u.status).toBe(201);
  return { id: u.j.id as string, email, token: await login(email, 'SenhaUsuario123') };
}

const venda = (extra: Record<string, unknown> = {}) => ({
  itens: [{ codigo: '10', quantidade: 2, precoCentavos: 2490, observacao: 'Pacote fechado' }, { codigo: '11', quantidade: 1, precoCentavos: 849 }],
  nome: 'Carlos Pereira', telefone: '11912345678', modalidade: 'ENTREGA', endereco: ENDERECO, agendamento: null, pagamento: 'PIX', trocoParaCentavos: null, observacao: '', descontoCentavos: 0,
  ...extra,
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('API: venda do vendedor nasce aceita, com desconto no limite, reserva estoque e aparece no painel', async () => {
  const tokenSuper = await superToken();
  const e = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  await prepararLoja(e, null);
  const vendedor = await usuarioCom(e, 'Vendedor Paulo', ['pedido.vender'], '0457');
  const soVe = await usuarioCom(e, 'Só vê', ['pedido.ver']);
  const celular = await vincularCelular(vendedor.token);

  // Desligado por padrão; sem a permissão, nada; outra empresa sem configuração.
  expect((await pedir('GET', '/pedidos/venda/catalogo', { token: celular.token })).j.message).toMatch(/desligadas/);
  expect((await pedir('GET', '/pedidos/venda/catalogo', { token: soVe.token })).status).toBe(403);
  expect((await pedir('GET', '/pedidos/venda/catalogo', { token: outra.adminToken })).j.message).toMatch(/ainda não foram configurados/);

  await sql(`UPDATE configuracoes_pedidos SET config = config || $2::jsonb WHERE empresa_id = $1`, [e.id, JSON.stringify({ vendas: { ativo: true, foraDoHorario: true, exigirMinimo: false, descontoMaximoPercentual: 10 } })]);
  const cat = await pedir('GET', '/pedidos/venda/catalogo', { token: celular.token });
  expect(cat.status).toBe(200);
  expect(cat.j).toMatchObject({ aberta: false, pedidoMinimoCentavos: null, descontoMaximoPercentual: 10 });
  expect(cat.j.modalidades.map((m: { modalidade: string }) => m.modalidade)).toEqual(['ENTREGA', 'RETIRADA']);
  // O vendedor recebe o código de barras, para a câmera; o link do cliente não.
  expect(cat.j.itens[0].codigoBarras).toBe('7891234567895');

  // Subtotal 58,29: até 5,82 de desconto.
  const caro = await pedir('POST', '/pedidos/venda', { token: celular.token, corpo: venda({ descontoCentavos: 600 }) });
  expect(caro.status).toBe(400);
  expect(caro.j.message).toMatch(/até R\$ 5,82/);
  const precoVelho = await pedir('POST', '/pedidos/venda', { token: celular.token, corpo: venda({ itens: [{ codigo: '10', quantidade: 1, precoCentavos: 2000 }] }) });
  expect(precoVelho.status).toBe(409);
  expect(precoVelho.j.mudancas[0]).toMatchObject({ tipo: 'PRECO', antes: 2000, depois: 2490 });

  const r = await pedir('POST', '/pedidos/venda', { token: celular.token, corpo: venda({ descontoCentavos: 500 }) });
  expect(r.status).toBe(201);
  expect(r.j).toMatchObject({ numero: 1 });
  const [p] = await sql(`SELECT situacao, origem, vendedor_id, aceito_por_id, desconto_centavos, total_centavos, historico FROM pedidos WHERE id = $1`, [r.j.id]);
  expect(p).toMatchObject({ situacao: 'EM_SEPARACAO', origem: 'VENDEDOR', vendedor_id: vendedor.id, aceito_por_id: vendedor.id, desconto_centavos: 500, total_centavos: 5829 });
  expect(p.historico[0]).toMatchObject({ texto: 'Venda lançada no aplicativo', por: 'Vendedor Paulo' });
  const [audit] = await sql(`SELECT count(*)::int AS n FROM logs_auditoria WHERE empresa_id = $1 AND acao = 'pedido.vender'`, [e.id]);
  expect(audit.n).toBe(1);

  // A reserva vale para o vendedor e para o link.
  const depois = await pedir('GET', '/pedidos/venda/catalogo', { token: celular.token });
  expect(depois.j.itens.find((i: { codigo: string }) => i.codigo === '10').estoque).toBe(48);

  // O cliente acompanha com o desconto; a loja vê de quem é a venda; o vendedor vê as dele.
  const acompanhamento = await pedir('GET', `/loja/pedido/${r.j.codigo}`);
  expect(acompanhamento.j.totais).toMatchObject({ subtotalCentavos: 5829, taxaCentavos: 500, descontoCentavos: 500, totalCentavos: 5829 });
  expect(acompanhamento.j.itens[0].observacao).toBe('Pacote fechado');
  const lista = await pedir('GET', '/pedidos', { token: soVe.token });
  expect(lista.j[0]).toMatchObject({ numero: 1, vendedorNome: 'Vendedor Paulo' });
  expect((await pedir('GET', '/pedidos?busca=Paulo', { token: soVe.token })).j).toHaveLength(1);
  expect((await pedir('GET', '/pedidos', { token: vendedor.token })).status).toBe(403);
  const minhas = await pedir('GET', '/pedidos/venda/minhas', { token: celular.token });
  expect(minhas.j.map((x: { numero: number }) => x.numero)).toEqual([1]);
  expect((await pedir('GET', '/pedidos/venda/minhas', { token: outra.adminToken })).j).toHaveLength(0);

  // A folha sai com o código do vendedor, que aceitou.
  const folha = await pedir('GET', `/pedidos/${r.j.id}/folha`, { token: e.adminToken });
  expect(folha.j.blocos.find((b: { tipo: string }) => b.tipo === 'barras')).toMatchObject({ dados: '0457' });

  // Mínimo exigido e loja fechada sem vender fora do horário.
  await sql(`UPDATE configuracoes_pedidos SET config = config || $2::jsonb WHERE empresa_id = $1`, [e.id, JSON.stringify({ vendas: { ativo: true, foraDoHorario: false, exigirMinimo: true, descontoMaximoPercentual: 0 } })]);
  expect((await pedir('POST', '/pedidos/venda', { token: celular.token, corpo: venda() })).j.message).toMatch(/fechada/);
  await sql(`UPDATE empresas SET horario_funcionamento = $2 WHERE id = $1`, [e.id, JSON.stringify(Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]))]);
  expect((await pedir('POST', '/pedidos/venda', { token: celular.token, corpo: venda() })).j.message).toMatch(/pedido mínimo/);
});

test('Site: seção Vendas no app e a venda marcada no painel', async ({ page }) => {
  const e = await criarEmpresa(await superToken());
  await prepararLoja(e, { ativo: true, foraDoHorario: true, exigirMinimo: false, descontoMaximoPercentual: 5 });
  const vendedor = await usuarioCom(e, 'Vendedor Paulo', ['pedido.vender']);
  expect((await pedir('POST', '/pedidos/venda', { token: vendedor.token, corpo: venda({ modalidade: 'RETIRADA', endereco: null }) })).status).toBe(201);
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await expect(page.getByText('Venda de Vendedor Paulo')).toBeVisible();
  await page.getByTestId('linha-pedido').first().click();
  await expect(page.getByText(/Venda de Vendedor Paulo pelo aplicativo em/)).toBeVisible();

  await page.getByRole('tab', { name: 'Configuração' }).click();
  await expect(page.getByRole('checkbox', { name: /Vendedores lançam pedidos pelo aplicativo/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Vender com a loja fechada/ })).toBeChecked();
  await expect(page.getByLabel(/Desconto máximo do vendedor/)).toHaveValue('5');
  await page.getByText('Vendedores lançam pedidos pelo aplicativo').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/pedidos-vendas-config.png' });
  await page.getByRole('checkbox', { name: /Vendedores lançam pedidos pelo aplicativo/ }).uncheck();
  await expect(page.getByRole('checkbox', { name: /Vender com a loja fechada/ })).toHaveCount(0);
  expect(erros).toEqual([]);
});
