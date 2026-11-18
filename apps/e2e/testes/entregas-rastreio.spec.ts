import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API, pedir, sql, superToken, type EmpresaTeste } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/**
 * Entregas, etapa 5: chamada automática ao aceitar o pedido, link de acompanhamento do destinatário
 * (também no acompanhamento do pedido), emergência e o PDF do extrato.
 */

const longeDeTudo = () => ({ lat: -8 - Math.random() * 2, lon: -35 - Math.random() * 2 });
const ip = () => `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const SEMPRE_ABERTA = Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]);

async function prepararLoja(empresa: EmpresaTeste): Promise<string> {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: null, comFotos: false,
    pedidoMinimoCentavos: null,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: '', enderecoRetirada: 'Rua das Flores, 100', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: null,
  };
  await sql(`UPDATE empresas SET nome_fantasia = 'Padaria Rastreio', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(SEMPRE_ABERTA)]);
  await sql(
    `INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, 1, now() at time zone 'utc', 120, now())`,
    [randomUUID(), empresa.id, codigo, JSON.stringify(config), JSON.stringify([{ codigo: '10', nome: 'Pão de forma', precoCentavos: 990, estoque: 50 }])],
  );
  return codigo;
}

async function pedidoNovo(empresa: EmpresaTeste, loja: string, ponto: { lat: number; lon: number }) {
  const endereco = { cep: '50010000', rua: 'Rua do Bom Jesus', numero: '120', semNumero: false, complemento: '', bairro: 'Recife', cidade: 'Recife', uf: 'PE', localizacao: { latitude: Number(ponto.lat.toFixed(6)), longitude: Number(ponto.lon.toFixed(6)), precisaoMetros: 10 } };
  const r = await pedir('POST', `/loja/${loja}/pedidos`, {
    corpo: { itens: [{ codigo: '10', quantidade: 2, precoCentavos: 990 }], nome: 'João Cliente', telefone: '81987654321', modalidade: 'ENTREGA', endereco, agendamento: null, pagamento: 'PIX', trocoParaCentavos: null, observacao: '' },
    ip: ip(),
  });
  expect(r.status, JSON.stringify(r.j)).toBe(201);
  const [p] = await sql<{ id: string; numero: number }>(`SELECT id, numero FROM pedidos WHERE empresa_id = $1 AND numero = $2`, [empresa.id, r.j.numero]);
  return { ...p, codigo: r.j.codigo as string };
}

/** Empresa com base num ponto sorteado, chamada automática ao aceitar o pedido e distribuição ligada. */
async function cenario() {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 2200, 800);
  expect((await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Padaria, 5, Centro, Recife' }, raioAtendimentoKm: 10, chamarAoAceitarPedido: true } })).j.chamarAoAceitarPedido).toBe(true);
  const regras = (await pedir('GET', '/entregas/config', { token: t })).j.config.direcionamento;
  await pedir('PUT', '/entregas/direcionamento', { token: t, corpo: { regras: { ...regras, raioKm: 5, raioLimiteKm: 10 } } });
  const nome = `Ivo${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 400), `${nome} Teste`);
  const loja = await prepararLoja(emp);
  return { emp, t, C, D, nome, ent, loja };
}

const avancar = (ent: { token: string }, id: string, corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${id}/avancar`, { token: ent.token, corpo });

test('API: aceitar o pedido chama o entregador; rastreio, emergência, cancelamento e PDF', async () => {
  test.setTimeout(90_000);
  const { emp, t, C, D, nome, ent, loja } = await cenario();

  // Aceitar o pedido abre a chamada já distribuindo, e a oferta vai para o entregador.
  const pedido = await pedidoNovo(emp, loja, D);
  expect((await pedir('POST', `/pedidos/${pedido.id}/situacao`, { token: t, corpo: { situacao: 'EM_SEPARACAO' } })).status).toBeLessThan(300);
  const [ch] = (await pedir('GET', `/entregas/chamadas?pedidoId=${pedido.id}`, { token: t })).j;
  expect(ch).toMatchObject({ situacao: 'ABERTA', pedido: { numero: pedido.numero }, distribuicao: { ativa: true }, ofertaPendente: { entregadorNome: nome } });
  expect(ch.linkRastreio).toMatch(/^\/rastreio\/[A-Za-z0-9_-]{20,}$/);
  const [hist] = await sql<{ historico: { texto: string }[] }>(`SELECT historico FROM pedidos WHERE id = $1`, [pedido.id]);
  expect(hist.historico.map((h) => h.texto)).toContain(`Entregador chamado automaticamente (chamada nº ${ch.numero})`);
  const codigoRastreio = ch.linkRastreio.split('/')[2];

  // O destinatário: sem entregador ainda, já vê o código; o acompanhamento do pedido leva ao rastreio.
  let r = await pedir('GET', `/rastreio/${codigoRastreio}`);
  expect(r.j).toMatchObject({ situacao: 'ABERTA', texto: 'Procurando um entregador', empresa: 'Padaria Rastreio', entregador: null, posicao: null, codigoConfirmacao: ch.codigoConfirmacao });
  expect(JSON.stringify(r.j)).not.toContain('João Cliente');
  expect((await pedir('GET', `/loja/pedido/${pedido.codigo}`)).j.entrega).toEqual({ caminho: ch.linkRastreio, texto: 'Procurando um entregador', entregadorNome: null });

  // Aceitou e coletou: posição, previsão e foto aparecem para o destinatário.
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  r = await pedir('GET', `/rastreio/${codigoRastreio}`);
  expect(r.j).toMatchObject({ situacao: 'ACEITA', texto: 'O entregador está indo buscar o seu pedido', entregador: { nome, veiculo: 'BICICLETA', temFoto: true }, posicao: null });
  await avancar(ent, ch.id, { para: 'NA_COLETA', ...C, precisao: 5 });
  await avancar(ent, ch.id, { para: 'COLETADA', ...C });
  r = await pedir('GET', `/rastreio/${codigoRastreio}`);
  expect(r.j).toMatchObject({ situacao: 'COLETADA', texto: 'Saiu para entrega' });
  // O banco devolve o número com outro arredondamento na última casa.
  expect(r.j.posicao.lat).toBeCloseTo(C.lat, 6);
  expect(r.j.posicao.lon).toBeCloseTo(C.lon, 6);
  expect(r.j.previsaoMinutos).toBeGreaterThan(0);
  expect((await pedir('GET', `/rastreio/${codigoRastreio}/foto`)).j.dados).toBe(PNG);

  // Emergência: a empresa vê com a posição e marca como ciente.
  const em = await pedir('POST', `/entregador/chamadas/${ch.id}/emergencia`, { token: ent.token, corpo: { ...deslocar(C, 900), texto: 'Pneu furado' } });
  expect(em.j.emergenciaEm).toEqual(expect.any(String));
  let resumo = (await pedir('GET', `/entregas/chamadas/${ch.id}`, { token: t })).j;
  expect(resumo.emergencia).toMatchObject({ texto: 'Pneu furado', vistaEm: null });
  expect(resumo.historico.map((h: { texto: string }) => h.texto).some((x: string) => x.startsWith('EMERGÊNCIA: Pneu furado'))).toBe(true);
  resumo = (await pedir('POST', `/entregas/chamadas/${ch.id}/emergencia/ciente`, { token: t })).j;
  expect(resumo.emergencia.vistaPor).toMatch(/Admin/);

  // Entregue: o rastreio mostra o fim sem posição nem código; depois de 48 h, some.
  await avancar(ent, ch.id, { para: 'NO_DESTINO', ...D, precisao: 5 });
  await avancar(ent, ch.id, { para: 'CONCLUIDA', ...D, codigo: ch.codigoConfirmacao });
  r = await pedir('GET', `/rastreio/${codigoRastreio}`);
  expect(r.j).toMatchObject({ situacao: 'CONCLUIDA', texto: 'Entregue', posicao: null, codigoConfirmacao: null, entregador: { nome, placa: null } });
  expect((await pedir('GET', `/rastreio/${codigoRastreio}/foto`)).status).toBe(404);
  await sql(`UPDATE chamadas_entrega SET concluida_em = now() - interval '49 hours' WHERE id = $1`, [ch.id]);
  expect((await pedir('GET', `/rastreio/${codigoRastreio}`)).status).toBe(404);
  expect((await pedir('GET', '/rastreio/nao-existe-este-codigo-123')).status).toBe(404);

  // Pedido cancelado: a chamada que ainda procura entregador é cancelada junto.
  const outro = await pedidoNovo(emp, loja, D);
  await pedir('POST', `/pedidos/${outro.id}/situacao`, { token: t, corpo: { situacao: 'EM_SEPARACAO' } });
  const [ch2] = (await pedir('GET', `/entregas/chamadas?pedidoId=${outro.id}`, { token: t })).j;
  expect(ch2.situacao).toBe('ABERTA');
  await pedir('POST', `/pedidos/${outro.id}/situacao`, { token: t, corpo: { situacao: 'CANCELADO', motivo: 'Cliente desistiu' } });
  expect((await pedir('GET', `/entregas/chamadas/${ch2.id}`, { token: t })).j.situacao).toBe('CANCELADA');

  // PDF do extrato por link de uso único.
  const link = await pedir('POST', '/entregador/extrato/link?periodo=TUDO', { token: ent.token });
  expect(link.j.caminho).toMatch(/^\/entregador\/extrato\.pdf\?codigo=/);
  const pdf = await fetch(`${API}${link.j.caminho}`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get('content-type')).toBe('application/pdf');
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await fetch(`${API}${link.j.caminho}`)).status).toBe(404);

  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: o destinatário acompanha pelo link e a empresa vê a emergência', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const { emp, t, C, nome, ent, loja, D } = await cenario();
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));

  const pedido = await pedidoNovo(emp, loja, D);
  await pedir('POST', `/pedidos/${pedido.id}/situacao`, { token: t, corpo: { situacao: 'EM_SEPARACAO' } });
  const [ch] = (await pedir('GET', `/entregas/chamadas?pedidoId=${pedido.id}`, { token: t })).j;
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  await avancar(ent, ch.id, { para: 'NA_COLETA', ...C, precisao: 5 });
  await avancar(ent, ch.id, { para: 'COLETADA', ...C });

  // Cliente, sem login, num celular: acompanhamento do pedido → rastreio.
  const cliente = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const celular = await cliente.newPage();
  const errosCliente: string[] = [];
  celular.on('pageerror', (x) => errosCliente.push(x.message));
  await celular.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
  await celular.goto(`/loja/pedido/${pedido.codigo}`);
  await expect(celular.getByTestId('entrega-pedido')).toContainText('Saiu para entrega');
  await celular.getByTestId('entrega-pedido').click();
  await expect(celular).toHaveURL(new RegExp(ch.linkRastreio));
  await expect(celular.getByTestId('rastreio-situacao')).toHaveText('Saiu para entrega');
  await expect(celular.getByTestId('rastreio-codigo')).toHaveText(ch.codigoConfirmacao);
  await expect(celular.getByText(nome, { exact: true })).toBeVisible();
  await expect(celular.getByText(/Chega em cerca de \d+ min/)).toBeVisible();
  await expect(celular.getByRole('img', { name: `Foto de ${nome}` })).toBeVisible();
  await celular.screenshot({ path: 'test-results/rastreio-cliente.png', fullPage: true });
  expect(errosCliente).toEqual([]);
  await cliente.close();

  // Empresa: a emergência aparece em vermelho e some do alerta com "Ciente".
  await pedir('POST', `/entregador/chamadas/${ch.id}/emergencia`, { token: ent.token, corpo: { ...C, texto: 'Acidente leve' } });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await expect(page.getByTestId('linha-chamada').first()).toContainText('Emergência');
  await page.getByTestId('linha-chamada').first().click();
  const alerta = page.getByTestId('emergencia');
  await expect(alerta).toContainText('Acidente leve');
  await expect(page.getByTestId('link-rastreio')).toBeVisible();
  await page.screenshot({ path: 'test-results/emergencia-empresa.png' });
  await alerta.getByRole('button', { name: 'Ciente' }).click();
  await expect(alerta).toContainText('Visto por');
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE id = $1`, [ch.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
