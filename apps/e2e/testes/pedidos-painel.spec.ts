import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, login, pedir, sql, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;

const SEMPRE_ABERTA = Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]);
const ITENS = [
  { codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, estoque: 50, codigoBarras: '7891234567895' },
  { codigo: '11', nome: 'Feijão Carioca 1kg', precoCentavos: 849, estoque: 50 },
];
const ENDERECO = { cep: '01001000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
const ip = () => `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function prepararLoja(empresa: EmpresaTeste) {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  const impressora = randomUUID();
  await sql(`INSERT INTO impressoras (id, empresa_id, nome, linguagem, endereco, atualizado_em) VALUES ($1, $2, 'Térmica do caixa', 'ESCPOS', '127.0.0.1:9100', now())`, [impressora, empresa.id]);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: 'ean', comFotos: false,
    pedidoMinimoCentavos: null,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: '', enderecoRetirada: 'Rua das Flores, 100', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: impressora,
  };
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercadinho Bom Preço', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(SEMPRE_ABERTA)]);
  await sql(
    `INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, 2, now() at time zone 'utc', 120, now())`,
    [randomUUID(), empresa.id, codigo, JSON.stringify(config), JSON.stringify(ITENS)],
  );
  return { codigo, impressora };
}

async function fazerPedido(codigo: string, extra: Record<string, unknown> = {}) {
  const r = await pedir('POST', `/loja/${codigo}/pedidos`, {
    corpo: { itens: [{ codigo: '10', quantidade: 2, precoCentavos: 2490 }, { codigo: '11', quantidade: 1, precoCentavos: 849 }], nome: 'Maria Silva', telefone: '11987654321', modalidade: 'ENTREGA', endereco: ENDERECO, agendamento: null, pagamento: 'DINHEIRO', trocoParaCentavos: 10000, observacao: 'Tocar o interfone', ...extra },
    ip: ip(),
  });
  expect(r.status).toBe(201);
  return r.j as { numero: number; codigo: string };
}

async function usuarioCom(empresa: EmpresaTeste, nome: string, permissoes: string[], codigoErp?: string) {
  const perfil = await pedir('POST', '/perfis', { token: empresa.adminToken, corpo: { nome: `${nome} ${randomUUID().slice(0, 6)}`, permissoes } });
  expect(perfil.status).toBe(201);
  const email = `${randomUUID().slice(0, 8)}@e2e.local`;
  const u = await pedir('POST', '/usuarios', { token: empresa.adminToken, corpo: { nome, email, senha: 'SenhaUsuario123', perfilId: perfil.j.id, ...(codigoErp ? { codigoErp } : {}) } });
  expect(u.status).toBe(201);
  return { id: u.j.id as string, email, token: await login(email, 'SenhaUsuario123') };
}

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test.beforeAll(async () => {
  tokenSuper = await superToken();
});

test('API: aceitar, folha na fila de impressão, proposta aceita e recusada, cancelamento, permissões e isolamento', async () => {
  const e = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  const { codigo } = await prepararLoja(e);
  const feito = await fazerPedido(codigo);
  const atendente = await usuarioCom(e, 'João Atendente', ['pedido.ver', 'pedido.gerenciar']);
  const soVe = await usuarioCom(e, 'Só vê', ['pedido.ver']);

  const lista = await pedir('GET', '/pedidos', { token: atendente.token });
  expect(lista.status).toBe(200);
  expect(lista.j).toHaveLength(1);
  const id = lista.j[0].id as string;
  expect(lista.j[0]).toMatchObject({ numero: 1, situacao: 'NOVO', clienteNome: 'Maria Silva', totalCentavos: 6329, unidades: 3, aguardandoCliente: false });
  expect((await pedir('GET', '/pedidos?busca=98765', { token: atendente.token })).j).toHaveLength(1);
  expect((await pedir('GET', '/pedidos?situacao=CONCLUIDO', { token: atendente.token })).j).toHaveLength(0);

  // Outra empresa não vê; quem só vê não mexe.
  expect((await pedir('GET', `/pedidos/${id}`, { token: outra.adminToken })).status).toBe(404);
  expect((await pedir('GET', '/pedidos', { token: outra.adminToken })).j).toHaveLength(0);
  expect((await pedir('POST', `/pedidos/${id}/situacao`, { token: soVe.token, corpo: { situacao: 'EM_SEPARACAO' } })).status).toBe(403);

  // Folha só depois de aceito; não pula etapa.
  expect((await pedir('GET', `/pedidos/${id}/folha`, { token: atendente.token })).j.message).toMatch(/Aceite o pedido/);
  expect((await pedir('POST', `/pedidos/${id}/situacao`, { token: atendente.token, corpo: { situacao: 'PRONTO' } })).status).toBe(400);
  const aceito = await pedir('POST', `/pedidos/${id}/situacao`, { token: atendente.token, corpo: { situacao: 'EM_SEPARACAO' } });
  expect(aceito.j).toMatchObject({ situacao: 'EM_SEPARACAO', aceitoPorNome: 'João Atendente' });
  expect(aceito.j.historico.at(-1)).toMatchObject({ texto: 'Em separação', por: 'João Atendente' });

  // Sem o código no ERP de quem aceitou, a folha não sai.
  expect((await pedir('GET', `/pedidos/${id}/folha`, { token: atendente.token })).j.message).toMatch(/Código no ERP de João Atendente/);
  expect((await pedir('PATCH', `/usuarios/${atendente.id}`, { token: e.adminToken, corpo: { codigoErp: 'Ç12' } })).status).toBe(400);
  expect((await pedir('PATCH', `/usuarios/${atendente.id}`, { token: e.adminToken, corpo: { codigoErp: '0457' } })).status).toBe(200);
  const folha = await pedir('GET', `/pedidos/${id}/folha`, { token: atendente.token });
  expect(folha.status).toBe(200);
  expect(folha.j.impressora).toBe('Térmica do caixa');
  const barras = folha.j.blocos.filter((b: { tipo: string }) => b.tipo === 'barras').map((b: { simbologia: string; dados: string }) => `${b.simbologia}:${b.dados}`);
  expect(barras).toEqual(['CODE128:0457', 'CODE128:11987654321', 'EAN13:7891234567895', 'EAN13:7891234567895', 'CODE128:11']);

  const impresso = await pedir('POST', `/pedidos/${id}/folha/imprimir`, { token: atendente.token });
  expect(impresso.status).toBe(201);
  expect(impresso.j.trabalho).toMatchObject({ origem: 'PEDIDO', linguagem: 'ESCPOS', modeloNome: 'Pedido 1' });
  const [trabalho] = await sql(`SELECT origem, conteudo, impressora_nome FROM trabalhos_impressao WHERE id = $1`, [impresso.j.trabalho.id]);
  expect(trabalho.origem).toBe('PEDIDO');
  const bytes: Buffer = trabalho.conteudo;
  // GS k 73 (Code 128) com o código do atendente, e GS k 67 (EAN-13) do arroz, sem o dígito.
  expect(bytes.includes(Buffer.from([0x1d, 0x6b, 73, 6, ...Buffer.from('{B0457')]))).toBe(true);
  expect(bytes.includes(Buffer.from([0x1d, 0x6b, 67, 12, ...Buffer.from('789123456789')]))).toBe(true);

  // Proposta: tira o feijão e dá desconto. Enquanto espera, não avança.
  const semMudar = await pedir('POST', `/pedidos/${id}/proposta`, { token: atendente.token, corpo: { itens: [], modalidade: 'ENTREGA', taxaCentavos: 500, descontoCentavos: 0, agendamento: null, mensagem: '' } });
  expect(semMudar.j.message).toMatch(/não muda nada/);
  const proposta = await pedir('POST', `/pedidos/${id}/proposta`, { token: atendente.token, corpo: { itens: [{ codigo: '11', quantidade: 0 }], modalidade: 'ENTREGA', taxaCentavos: 500, descontoCentavos: 300, agendamento: null, mensagem: 'Acabou o feijão' } });
  expect(proposta.status).toBe(201);
  expect(proposta.j.proposta.diferencas).toEqual(['Feijão Carioca 1kg: retirado do pedido', 'Desconto: R$ 3,00']);
  expect(proposta.j.proposta.totais.totalCentavos).toBe(5180);
  expect((await pedir('POST', `/pedidos/${id}/situacao`, { token: atendente.token, corpo: { situacao: 'PRONTO' } })).j.message).toMatch(/espera/);

  const visto = await pedir('GET', `/loja/pedido/${feito.codigo}`);
  expect(visto.j.proposta).toMatchObject({ mensagem: 'Acabou o feijão', diferencas: ['Feijão Carioca 1kg: retirado do pedido', 'Desconto: R$ 3,00'] });
  expect((await pedir('POST', `/loja/pedido/${feito.codigo}/resposta`, { corpo: { versao: new Date(2020, 1, 1).toISOString(), aceita: true } })).status).toBe(409);
  const aceita = await pedir('POST', `/loja/pedido/${feito.codigo}/resposta`, { corpo: { versao: visto.j.proposta.versao, aceita: true } });
  expect(aceita.status).toBe(201);
  expect(aceita.j.proposta).toBeNull();
  expect(aceita.j.itens.map((i: { codigo: string }) => i.codigo)).toEqual(['10']);
  expect(aceita.j.totais).toMatchObject({ subtotalCentavos: 4980, taxaCentavos: 500, descontoCentavos: 300, totalCentavos: 5180, trocoCentavos: 4820 });
  // Responder de novo a mesma proposta não vale.
  expect((await pedir('POST', `/loja/pedido/${feito.codigo}/resposta`, { corpo: { versao: visto.j.proposta.versao, aceita: true } })).status).toBe(400);
  const [gravado] = await sql(`SELECT total_centavos, desconto_centavos, proposta FROM pedidos WHERE id = $1`, [id]);
  expect(gravado).toMatchObject({ total_centavos: 5180, desconto_centavos: 300, proposta: null });

  // Segunda proposta, recusada: nada muda.
  const outraProposta = await pedir('POST', `/pedidos/${id}/proposta`, { token: atendente.token, corpo: { itens: [], modalidade: 'RETIRADA', taxaCentavos: 0, descontoCentavos: 300, agendamento: null, mensagem: 'Pode retirar?' } });
  expect(outraProposta.status).toBe(201);
  const recusada = await pedir('POST', `/loja/pedido/${feito.codigo}/resposta`, { corpo: { versao: outraProposta.j.proposta.versao, aceita: false } });
  expect(recusada.j).toMatchObject({ modalidade: 'ENTREGA', proposta: null });
  const depois = await pedir('GET', `/pedidos/${id}`, { token: atendente.token });
  expect(depois.j.respostaProposta.aceita).toBe(false);
  expect(depois.j.historico.map((h: { texto: string }) => h.texto)).toContain('O cliente recusou a alteração');

  // Avança e cancela com motivo; terminado, nada mais muda.
  expect((await pedir('POST', `/pedidos/${id}/situacao`, { token: atendente.token, corpo: { situacao: 'PRONTO' } })).j.situacao).toBe('PRONTO');
  const cancelado = await pedir('POST', `/pedidos/${id}/situacao`, { token: atendente.token, corpo: { situacao: 'CANCELADO', motivo: 'Cliente desistiu' } });
  expect(cancelado.j).toMatchObject({ situacao: 'CANCELADO', motivoCancelamento: 'Cliente desistiu' });
  expect((await pedir('POST', `/pedidos/${id}/situacao`, { token: atendente.token, corpo: { situacao: 'CONCLUIDO' } })).status).toBe(400);
  expect((await pedir('GET', `/loja/pedido/${feito.codigo}`)).j).toMatchObject({ situacao: 'CANCELADO', motivoCancelamento: 'Cliente desistiu' });
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM logs_auditoria WHERE empresa_id = $1 AND acao LIKE 'pedido.%'`, [e.id]);
  expect(n).toBeGreaterThanOrEqual(7);
});

test('pela tela: aceitar, ver a folha, propor alteração e o cliente aceitar no celular', async ({ page, browser }) => {
  const e = await criarEmpresa(tokenSuper);
  const { codigo } = await prepararLoja(e);
  const feito = await fazerPedido(codigo, { endereco: { ...ENDERECO, localizacao: { latitude: -23.55052, longitude: -46.633309, precisaoMetros: 350 } } });
  const [admin] = await sql(`SELECT id FROM usuarios WHERE email = $1`, [e.adminEmail]);
  await sql(`UPDATE usuarios SET codigo_erp = '0457' WHERE id = $1`, [admin.id]);

  await page.setViewportSize({ width: 1400, height: 1000 });
  const erros: string[] = [];
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await page.getByTestId('linha-pedido').first().click();
  const detalhe = page.getByTestId('detalhe-pedido');
  await expect(detalhe.getByRole('heading', { name: 'Pedido nº 1' })).toBeVisible();
  await expect(detalhe.getByRole('link', { name: 'Conversar no WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5511987654321\?text=Ol%C3%A1%2C%20Maria!/);
  await expect(detalhe.getByText('troco para R$ 100,00: levar R$ 36,71')).toBeVisible();
  // O mapa vai pelo ponto do cliente, e a precisão ruim é avisada.
  await expect(detalhe.getByRole('link', { name: 'mapa (localização do cliente)' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-23.55052,-46.633309');
  await expect(detalhe.getByTestId('localizacao-pedido')).toContainText('aproximada (cerca de 350 m)');
  await detalhe.getByRole('button', { name: 'Aceitar pedido' }).click();
  await expect(detalhe.getByRole('button', { name: 'Saiu para entrega' })).toBeVisible();

  await detalhe.getByRole('button', { name: 'Folha de lançamento' }).click();
  const previa = page.getByTestId('previa-folha');
  await expect(previa.getByText('3. AGORA PASSE OS PRODUTOS')).toBeVisible();
  await expect(previa.getByTestId('barras-folha')).toHaveCount(5);
  await expect(previa.getByText(/^\[ \] Arroz Tipo 1 5kg +R\$ 24,90 {2}2\/2$/)).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/pedidos-folha.png' });
  await page.getByRole('button', { name: 'Imprimir em Térmica do caixa' }).click();
  await expect(page.getByText('Folha enviada para Térmica do caixa.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await detalhe.getByRole('button', { name: 'Propor alteração' }).click();
  await page.getByLabel('Quantidade de Feijão Carioca 1kg').fill('0');
  await page.getByLabel('Desconto (R$)').fill('2,00');
  await page.getByLabel('Mensagem para o cliente').fill('Acabou o feijão');
  await expect(page.getByText('Novo total: R$ 52,80 (era R$ 63,29)')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar ao cliente' }).click();
  const pendente = detalhe.getByTestId('proposta-pendente');
  await expect(pendente).toContainText('Feijão Carioca 1kg: retirado do pedido');
  await expect(pendente.getByRole('link', { name: 'Avisar o cliente no WhatsApp' })).toHaveAttribute('href', new RegExp(`loja%2Fpedido%2F${feito.codigo}`));
  await page.screenshot({ path: 'test-results/pedidos-painel.png', fullPage: true });

  // O cliente, no celular, aceita.
  const celular = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await celular.goto(`/loja/pedido/${feito.codigo}`);
  const caixa = celular.getByTestId('proposta-cliente');
  await expect(caixa).toContainText('Acabou o feijão');
  await expect(caixa).toContainText('R$ 52,80');
  await celular.screenshot({ path: 'test-results/pedidos-proposta-cliente.png', fullPage: true });
  await caixa.getByRole('button', { name: 'Aceitar' }).click();
  await expect(celular.getByTestId('proposta-cliente')).toHaveCount(0);
  await expect(celular.getByText('R$ 52,80').last()).toBeVisible();
  await celular.close();

  await page.reload();
  await page.getByTestId('linha-pedido').first().click();
  await expect(detalhe.getByText(/O cliente aceitou a última alteração/)).toBeVisible();
  await expect(detalhe.getByText('Desconto', { exact: true })).toBeVisible();
  expect(erros.filter((t) => !/Failed to load resource/.test(t))).toEqual([]);
});
