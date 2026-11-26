import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken, type EmpresaTeste } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/**
 * Entregas, etapa 4: chamada a partir do Pedido (o pedido anda com a entrega), avaliação, extra,
 * contestação, pagamento registrado (e desfeito) e o extrato do entregador.
 */

const longeDeTudo = () => ({ lat: -20 - Math.random() * 2, lon: -44 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });
const ip = () => `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const SEMPRE_ABERTA = Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]);
const ITENS = [{ codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, estoque: 50 }];

/** Loja com entrega e um pedido em separação, com a localização do cliente. */
async function pedidoEmSeparacao(empresa: EmpresaTeste, ponto: { lat: number; lon: number }) {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: null, comFotos: false,
    pedidoMinimoCentavos: null,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: '', enderecoRetirada: 'Rua das Flores, 100', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: null,
  };
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercadinho Entrega', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(SEMPRE_ABERTA)]);
  await sql(
    `INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, 1, now() at time zone 'utc', 120, now())`,
    [randomUUID(), empresa.id, codigo, JSON.stringify(config), JSON.stringify(ITENS)],
  );
  const endereco = { cep: '30130000', rua: 'Rua da Bahia', numero: '900', semNumero: false, complemento: 'sala 3', bairro: 'Centro', cidade: 'Belo Horizonte', uf: 'MG', localizacao: { latitude: Number(ponto.lat.toFixed(6)), longitude: Number(ponto.lon.toFixed(6)), precisaoMetros: 12 } };
  const r = await pedir('POST', `/loja/${codigo}/pedidos`, {
    corpo: { itens: [{ codigo: '10', quantidade: 1, precoCentavos: 2490 }], nome: 'Maria Silva', telefone: '11987654321', modalidade: 'ENTREGA', endereco, agendamento: null, pagamento: 'DINHEIRO', trocoParaCentavos: null, observacao: 'Tocar o interfone' },
    ip: ip(),
  });
  expect(r.status, JSON.stringify(r.j)).toBe(201);
  const [p] = await sql<{ id: string; numero: number }>(`SELECT id, numero FROM pedidos WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 1`, [empresa.id]);
  expect((await pedir('POST', `/pedidos/${p.id}/situacao`, { token: empresa.adminToken, corpo: { situacao: 'EM_SEPARACAO' } })).status).toBeLessThan(300);
  return p;
}

/** Oferece, aceita e cumpre as etapas até concluir com o código. */
async function cumprir(t: string, chamadaId: string, ent: { id: string; token: string }, origem: { lat: number; lon: number }, destino: { lat: number; lon: number }) {
  await pedir('POST', '/entregador/posicao', { token: ent.token, corpo: deslocar(origem, 300) });
  expect((await pedir('POST', `/entregas/chamadas/${chamadaId}/oferecer`, { token: t, corpo: { entregadorId: ent.id } })).status).toBe(200);
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  expect((await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token })).status).toBe(200);
  const avancar = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${chamadaId}/avancar`, { token: ent.token, corpo });
  expect((await avancar({ para: 'NA_COLETA', ...origem, precisao: 5 })).j.situacao).toBe('NA_COLETA');
  expect((await avancar({ para: 'COLETADA', ...origem })).j.situacao).toBe('COLETADA');
  expect((await avancar({ para: 'NO_DESTINO', ...destino, precisao: 5 })).j.situacao).toBe('NO_DESTINO');
  const codigo = (await pedir('GET', `/entregas/chamadas/${chamadaId}`, { token: t })).j.codigoConfirmacao;
  expect((await avancar({ para: 'CONCLUIDA', ...destino, codigo })).j.situacao).toBe('CONCLUIDA');
}

const hoje = () => new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date());

test('API: pedido → chamada, avaliação, extra, contestação, pagamento e extrato', async () => {
  test.setTimeout(90_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 2500, 1000);
  await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1, Centro, Cidade Teste' }, raioAtendimentoKm: 10 } });
  const nome = `Lia${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `${nome} Teste`);

  // Pedido → rascunho com o ponto do cliente → chamada ligada ao pedido.
  const pedido = await pedidoEmSeparacao(emp, D);
  const rasc = await pedir('GET', `/entregas/pedidos/${pedido.id}/rascunho`, { token: t });
  expect(rasc.status, JSON.stringify(rasc.j)).toBe(200);
  expect(rasc.j).toMatchObject({ numero: pedido.numero, origemDoPonto: 'CLIENTE', observacao: `Pedido nº ${pedido.numero}`, chamadaAtiva: null, destino: { contato: 'Maria Silva', telefone: '11987654321', instrucoes: 'Tocar o interfone' } });
  expect(rasc.j.destino.endereco).toContain('Rua da Bahia, 900');
  const doPedido = { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1, Centro, Cidade Teste'), destino: rasc.j.destino, serieEsperada: null, observacao: rasc.j.observacao, pedidoId: pedido.id };
  const ch1 = await pedir('POST', '/entregas/chamadas', { token: t, corpo: doPedido });
  expect(ch1.status, JSON.stringify(ch1.j)).toBe(201);
  expect(ch1.j.pedido).toEqual({ id: pedido.id, numero: pedido.numero });
  expect((await pedir('POST', '/entregas/chamadas', { token: t, corpo: doPedido })).j.message).toMatch(/já tem a chamada nº/);
  expect((await pedir('GET', `/entregas/chamadas?pedidoId=${pedido.id}`, { token: t })).j).toHaveLength(1);

  // O pedido anda com a entrega: coletou → "saiu para entrega"; entregou → concluído.
  await cumprir(t, ch1.j.id, ent, C, D);
  const [p] = await sql<{ situacao: string; historico: { texto: string }[] }>(`SELECT situacao, historico FROM pedidos WHERE id = $1`, [pedido.id]);
  expect(p.situacao).toBe('CONCLUIDO');
  expect(p.historico.map((h) => h.texto)).toEqual(expect.arrayContaining([`Saiu para entrega com ${nome} (chamada nº ${ch1.j.numero})`, `Entregue por ${nome}, com o código do cliente (chamada nº ${ch1.j.numero})`]));

  // Segunda chamada, avulsa.
  const ch2 = await pedir('POST', '/entregas/chamadas', { token: t, corpo: { ...doPedido, pedidoId: null, observacao: '' } });
  await cumprir(t, ch2.j.id, ent, C, D);

  // Avaliação: uma vez, de 1 a 5; o comentário não vai para o entregador.
  expect((await pedir('POST', `/entregas/chamadas/${ch1.j.id}/avaliar`, { token: t, corpo: { nota: 0, comentario: '' } })).status).toBe(400);
  expect((await pedir('POST', `/entregas/chamadas/${ch1.j.id}/avaliar`, { token: t, corpo: { nota: 5, comentario: 'Rápido e educado' } })).status).toBe(204);
  expect((await pedir('POST', `/entregas/chamadas/${ch1.j.id}/avaliar`, { token: t, corpo: { nota: 1, comentario: '' } })).status).toBe(409);
  expect((await pedir('GET', '/entregador/reputacao', { token: ent.token })).j).toMatchObject({ avaliacaoMedia: 5, avaliacoes: 1, taxaAceite: 1 });

  // Extra (espera) só com motivo.
  expect((await pedir('POST', `/entregas/chamadas/${ch1.j.id}/extra`, { token: t, corpo: { extraCentavos: 500, motivo: '' } })).status).toBe(400);
  expect((await pedir('POST', `/entregas/chamadas/${ch1.j.id}/extra`, { token: t, corpo: { extraCentavos: 500, motivo: 'Espera de 20 min' } })).status).toBe(204);
  const v1 = ch1.j.valorCentavos + 500;
  const v2 = ch2.j.valorCentavos;

  // A pagar e extrato do entregador.
  const aPagar = (await pedir('GET', '/entregas/financeiro/a-pagar', { token: t })).j;
  expect(aPagar).toEqual([expect.objectContaining({ entregador: expect.objectContaining({ id: ent.id, nome, chavePix: ent.email }), quantidade: 2, totalCentavos: v1 + v2 })]);
  let extrato = (await pedir('GET', '/entregador/extrato?periodo=HOJE', { token: ent.token })).j;
  expect(extrato).toMatchObject({ aReceberCentavos: v1 + v2, periodoCentavos: v1 + v2, pagoCentavos: 0 });
  expect(extrato.linhas.map((l: { numero: number; situacao: string }) => [l.numero, l.situacao]).sort()).toEqual([[ch1.j.numero, 'A_RECEBER'], [ch2.j.numero, 'A_RECEBER']].sort());
  expect(JSON.stringify(extrato)).not.toContain('Rápido e educado');

  // Contestação: uma aberta por chamada; a empresa responde uma vez.
  expect((await pedir('POST', `/entregador/chamadas/${ch2.j.id}/contestar`, { token: ent.token, corpo: { mensagem: 'Esperei 30 min no cliente.' } })).status).toBe(204);
  expect((await pedir('POST', `/entregador/chamadas/${ch2.j.id}/contestar`, { token: ent.token, corpo: { mensagem: 'De novo, por favor.' } })).status).toBe(409);
  const abertas = (await pedir('GET', '/entregas/financeiro/contestacoes', { token: t })).j;
  expect(abertas).toEqual([expect.objectContaining({ numero: ch2.j.numero, entregadorNome: nome, mensagem: 'Esperei 30 min no cliente.', pago: false })]);
  expect((await pedir('GET', '/entregas/financeiro/a-pagar', { token: t })).j[0].contestacoesAbertas).toBe(1);
  expect((await pedir('POST', `/entregas/financeiro/contestacoes/${abertas[0].id}/responder`, { token: t, corpo: { resposta: 'Vamos somar a espera.' } })).status).toBe(204);
  expect((await pedir('POST', `/entregas/financeiro/contestacoes/${abertas[0].id}/responder`, { token: t, corpo: { resposta: 'Outra' } })).status).toBe(409);

  // Pagamento: data no futuro não; registra a primeira chamada com comprovante.
  const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  expect((await pedir('POST', '/entregas/financeiro/fechamentos', { token: t, corpo: { entregadorId: ent.id, chamadaIds: [ch1.j.id], pagoEm: amanha, observacao: '' } })).status).toBe(400);
  const pago = await pedir('POST', '/entregas/financeiro/fechamentos', { token: t, corpo: { entregadorId: ent.id, chamadaIds: [ch1.j.id], pagoEm: hoje(), observacao: 'Pix 123', comprovante: PNG } });
  expect(pago.status, JSON.stringify(pago.j)).toBe(201);
  expect(pago.j).toMatchObject({ quantidade: 1, totalCentavos: v1, temComprovante: true, entregadorNome: nome });
  expect((await pedir('GET', `/entregas/financeiro/fechamentos/${pago.j.id}/comprovante`, { token: t })).j.dados).toBe(PNG);
  expect((await pedir('POST', '/entregas/financeiro/fechamentos', { token: t, corpo: { entregadorId: ent.id, chamadaIds: [ch1.j.id], pagoEm: hoje(), observacao: '' } })).status).toBe(409);
  expect((await pedir('POST', `/entregas/chamadas/${ch1.j.id}/extra`, { token: t, corpo: { extraCentavos: 900, motivo: 'Depois de pago' } })).status).toBe(409);
  expect((await pedir('GET', `/entregas/chamadas/${ch1.j.id}`, { token: t })).j).toMatchObject({ pagoEm: hoje(), extraCentavos: 500, avaliacao: { nota: 5 } });
  expect((await pedir('GET', '/entregas/financeiro/a-pagar', { token: t })).j[0]).toMatchObject({ quantidade: 1, totalCentavos: v2 });
  extrato = (await pedir('GET', '/entregador/extrato?periodo=TUDO', { token: ent.token })).j;
  expect(extrato).toMatchObject({ aReceberCentavos: v2, pagoCentavos: v1 });
  const l1 = extrato.linhas.find((l: { chamadaId: string }) => l.chamadaId === ch1.j.id);
  expect(l1).toMatchObject({ situacao: 'PAGO', pagoEm: hoje(), extraCentavos: 500, extraMotivo: 'Espera de 20 min' });
  const l2 = extrato.linhas.find((l: { chamadaId: string }) => l.chamadaId === ch2.j.id);
  expect(l2.contestacao).toMatchObject({ resposta: 'Vamos somar a espera.' });

  // Desfazer o registro devolve a chamada para "a pagar".
  expect((await pedir('DELETE', `/entregas/financeiro/fechamentos/${pago.j.id}`, { token: t })).status).toBe(204);
  expect((await pedir('GET', '/entregas/financeiro/a-pagar', { token: t })).j[0]).toMatchObject({ quantidade: 2, totalCentavos: v1 + v2 });

  // Outra empresa não vê nada disso; quem só vê o mapa não vê o financeiro.
  const outra = await empresaComBase(tokenSuper);
  expect((await pedir('GET', '/entregas/financeiro/a-pagar', { token: outra.adminToken })).j).toEqual([]);
  expect((await pedir('POST', `/entregas/chamadas/${ch2.j.id}/avaliar`, { token: outra.adminToken, corpo: { nota: 1, comentario: '' } })).status).toBe(409);
  const perfil = await pedir('POST', '/perfis', { token: t, corpo: { nome: `Só vê ${randomUUID().slice(0, 4)}`, permissoes: ['entrega.ver'] } });
  const email = `ve-${randomUUID().slice(0, 8)}@e2e.local`;
  await pedir('POST', '/usuarios', { token: t, corpo: { nome: 'Só vê', email, senha: 'SenhaUsuario123', perfilId: perfil.j.id } });
  const login = await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaUsuario123' } });
  expect((await pedir('GET', '/entregas/financeiro/a-pagar', { token: login.j.token })).status).toBe(403);

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

test('Site: chamar entregador pelo pedido, avaliar e registrar o pagamento', async ({ page }) => {
  test.setTimeout(90_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 2000);
  await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1, Centro, Cidade Teste' }, raioAtendimentoKm: 10 } });
  const nome = `Teo${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `${nome} Teste`);
  const pedido = await pedidoEmSeparacao(emp, D);
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);

  // Pedidos: "Chamar entregador" abre a chamada com o destino do cliente.
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await page.getByTestId('linha-pedido').first().click();
  const detalhe = page.getByTestId('detalhe-pedido');
  await detalhe.getByRole('button', { name: 'Chamar entregador' }).click();
  await expect(page.getByRole('dialog', { name: `Entregador para o pedido nº ${pedido.numero}` })).toBeVisible();
  await expect(page.getByLabel('Endereço do destino')).toHaveValue(/Rua da Bahia, 900/);
  await expect(page.getByLabel('Contato no destino')).toHaveValue('Maria Silva');
  await expect(page.getByText(/Valor para o entregador: R\$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/pedido-chamar-entregador.png' });
  await page.getByRole('button', { name: 'Abrir chamada' }).click();
  await expect(detalhe.getByTestId('entrega-do-pedido')).toContainText(/Chamada nº \d+: Aguardando entregador/);
  const [ch] = await sql<{ id: string }>(`SELECT id FROM chamadas_entrega WHERE pedido_id = $1`, [pedido.id]);
  await cumprir(t, ch.id, ent, C, D);
  await expect(detalhe.getByTestId('entrega-do-pedido')).toContainText('Concluída', { timeout: 20_000 });

  // Entregas: avaliar a chamada concluída.
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.getByTestId('linha-chamada').first().click();
  const pos = page.getByTestId('pos-entrega');
  await expect(pos).toContainText('A pagar');
  await pos.getByRole('radio', { name: '4 estrelas' }).click();
  await pos.getByLabel('Comentário (só a empresa vê)').fill('Chegou rápido');
  await pos.getByRole('button', { name: 'Avaliar' }).click();
  await expect(pos.getByLabel('4 de 5')).toBeVisible();
  await page.keyboard.press('Escape');

  // Financeiro: registra o pagamento e ele aparece na lista.
  await page.getByRole('tab', { name: 'Financeiro' }).click();
  await expect(page.getByText(ent.email)).toBeVisible();
  await page.getByRole('button', { name: `Registrar pagamento de ${nome}` }).click();
  const modal = page.getByRole('dialog', { name: `Pagamento a ${nome}` });
  await modal.getByLabel('Observação').fill('Pix da semana');
  await page.screenshot({ path: 'test-results/financeiro-pagamento.png' });
  await modal.getByRole('button', { name: /^Registrar pagamento de R\$/ }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText('Nenhum registro.').first()).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(nome) })).toContainText('1');
  await page.screenshot({ path: 'test-results/financeiro.png', fullPage: true });
  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
