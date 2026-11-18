import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken, type EmpresaTeste } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/** Entregas, etapa 11: assinatura na entrega, mais de uma chamada por vez e pedidos juntos numa chamada. */

const longeDeTudo = () => ({ lat: -12 - Math.random() * 2, lon: -50 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });
const ip = () => `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const SEMPRE_ABERTA = Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]);
const ITENS = [{ codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, estoque: 50 }];
const assinatura = { tracos: [[[0.1, 0.5], [0.3, 0.2], [0.5, 0.8], [0.8, 0.3]]], recebedor: 'Ana Souza' };

/** Loja com entrega (para os pedidos do Flow). */
async function lojaComEntrega(empresa: EmpresaTeste): Promise<string> {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: null, comFotos: false,
    pedidoMinimoCentavos: null,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: '', enderecoRetirada: 'Rua das Flores, 100', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: null,
  };
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercadinho Juntos', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(SEMPRE_ABERTA)]);
  await sql(`INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, 1, now() at time zone 'utc', 120, now())`, [randomUUID(), empresa.id, codigo, JSON.stringify(config), JSON.stringify(ITENS)]);
  return codigo;
}

async function pedidoEmSeparacao(empresa: EmpresaTeste, loja: string, ponto: { lat: number; lon: number }, nome: string) {
  const endereco = { cep: '30130000', rua: 'Rua da Bahia', numero: '900', semNumero: false, complemento: '', bairro: 'Centro', cidade: 'Belo Horizonte', uf: 'MG', localizacao: { latitude: Number(ponto.lat.toFixed(6)), longitude: Number(ponto.lon.toFixed(6)), precisaoMetros: 12 } };
  const r = await pedir('POST', `/loja/${loja}/pedidos`, { corpo: { itens: [{ codigo: '10', quantidade: 1, precoCentavos: 2490 }], nome, telefone: '11987654321', modalidade: 'ENTREGA', endereco, agendamento: null, pagamento: 'DINHEIRO', trocoParaCentavos: null, observacao: '' }, ip: ip() });
  expect(r.status, JSON.stringify(r.j)).toBe(201);
  const [p] = await sql<{ id: string; numero: number }>(`SELECT id, numero FROM pedidos WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 1`, [empresa.id]);
  expect((await pedir('POST', `/pedidos/${p.id}/situacao`, { token: empresa.adminToken, corpo: { situacao: 'EM_SEPARACAO' } })).status).toBeLessThan(300);
  return { ...p, codigo: r.j.codigo as string };
}

async function preparar(opcoes: { assinatura?: string; chamadasSimultaneas?: number } = {}) {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const C = longeDeTudo();
  const r = await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, ...opcoes } });
  expect(r.status, JSON.stringify(r.j)).toBe(200);
  return { tokenSuper, emp, t: emp.adminToken, C };
}

test('API: assinatura no lugar do código e mais de uma chamada por vez', async () => {
  test.setTimeout(90_000);
  const { tokenSuper, emp, t, C } = await preparar({ assinatura: 'NO_LUGAR_DO_CODIGO', chamadasSimultaneas: 2 });
  expect((await pedir('GET', '/entregas/config', { token: t })).j.config).toMatchObject({ assinatura: 'NO_LUGAR_DO_CODIGO', chamadasSimultaneas: 2 });
  expect((await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, chamadasSimultaneas: 5 } })).status).toBe(400);
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `Ivo${randomUUID().slice(0, 4)} Teste`);
  const nova = async (norte: number) => (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(deslocar(C, norte), `Rua Cliente, ${norte}`), serieEsperada: null, observacao: '' } })).j;
  const aceitar = async (id: string) => {
    const o = await pedir('POST', `/entregas/chamadas/${id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
    if (o.status !== 200) return o;
    const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
    return pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  };

  // Duas chamadas ao mesmo tempo (a empresa permite 2); a terceira não.
  const a = await nova(1500);
  const b = await nova(2000);
  expect((await aceitar(a.id)).status).toBe(200);
  expect((await pedir('GET', `/entregas/chamadas/${b.id}/elegiveis`, { token: t })).j.map((e: { id: string }) => e.id)).toContain(ent.id);
  expect((await aceitar(b.id)).status).toBe(200);
  const minhas = (await pedir('GET', '/entregador/chamadas', { token: ent.token })).j;
  expect(minhas.map((c: { id: string }) => c.id)).toEqual([a.id, b.id]);
  expect((await pedir('POST', '/entregador/posicao', { token: ent.token, corpo: deslocar(C, 300) })).j.chamadaIds).toEqual([a.id, b.id]);
  const c3 = await nova(2500);
  expect((await aceitar(c3.id)).status).toBe(409);
  // Outra empresa não oferece a quem está em chamada desta.
  const outra = await preparar();
  await pedir('PUT', '/entregas/config', { token: outra.t, corpo: { base: { ...C, endereco: 'Outra loja' }, raioAtendimentoKm: 10 } });
  const daOutra = (await pedir('POST', '/entregas/chamadas', { token: outra.t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Outra loja'), destino: parada(deslocar(C, 900), 'Rua X, 1'), serieEsperada: null, observacao: '' } })).j;
  expect((await pedir('GET', `/entregas/chamadas/${daOutra.id}/elegiveis`, { token: outra.t })).j.map((e: { id: string }) => e.id)).not.toContain(ent.id);

  // Assinatura no lugar do código: o cliente não vê código; sem assinatura não conclui.
  const D = deslocar(C, 1500);
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${a.id}/avancar`, { token: ent.token, corpo });
  const rastreio = (await pedir('GET', `/rastreio/${String(a.linkRastreio).split('/').pop()}`)).j;
  expect(rastreio.codigoConfirmacao).toBeNull();
  expect((await av({ para: 'NA_COLETA', ...C, precisao: 5 })).status).toBe(200);
  expect((await av({ para: 'COLETADA', ...C })).status).toBe(200);
  expect((await av({ para: 'NO_DESTINO', ...D, precisao: 5 })).status).toBe(200);
  expect((await av({ para: 'CONCLUIDA', ...D })).j.message).toMatch(/assinar/);
  expect((await av({ para: 'CONCLUIDA', ...D, assinatura: { ...assinatura, recebedor: '' } })).j.message).toMatch(/nome/);
  expect((await av({ para: 'CONCLUIDA', ...D, assinatura })).j.situacao).toBe('CONCLUIDA');
  const fim = (await pedir('GET', `/entregas/chamadas/${a.id}`, { token: t })).j;
  expect(fim.fotos).toContain('ASSINATURA');
  expect(fim.historico.some((h: { texto: string }) => h.texto === 'Entregue, com a assinatura de quem recebeu. Recebido por Ana Souza.')).toBe(true);
  const foto = (await pedir('GET', `/entregas/chamadas/${a.id}/fotos/ASSINATURA`, { token: t })).j.dados as string;
  expect(foto.startsWith('data:image/png;base64,')).toBe(true);
  expect(Buffer.from(foto.split(',')[1], 'base64').length).toBeGreaterThan(200);
  // Terminou uma: sobra a outra.
  expect((await pedir('GET', '/entregador/chamadas', { token: ent.token })).j.map((c: { id: string }) => c.id)).toEqual([b.id]);

  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE empresa_id = ANY($1) AND situacao <> 'CONCLUIDA'`, [[emp.id, outra.emp.id]]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('API: pedidos do Flow e do ERP juntos numa chamada, cada um anda na sua parada', async () => {
  test.setTimeout(120_000);
  const { tokenSuper, emp, t, C } = await preparar();
  const loja = await lojaComEntrega(emp);
  const P1 = deslocar(C, 600);
  const P2 = deslocar(C, 1200);
  const P3 = deslocar(C, 1800);
  // Criados fora de ordem, para conferir a ordem pelo menor caminho.
  const longe = await pedidoEmSeparacao(emp, loja, P2, 'Bia Longe');
  const perto = await pedidoEmSeparacao(emp, loja, P1, 'Ana Perto');
  const erpId = randomUUID();
  await sql(`INSERT INTO pedidos_erp_entrega (id, empresa_id, codigo, dados, situacao, atualizado_em) VALUES ($1, $2, 'E-77', $3, 'PENDENTE', now())`, [erpId, emp.id, JSON.stringify({ codigo: 'E-77', tipo: 'ENTREGA', cliente: 'Caio ERP', telefone: '', endereco: 'Rua do ERP, 7', ponto: P3, observacao: '', serie: null })]);

  const lista = (await pedir('GET', '/entregas/juntar/pedidos', { token: t })).j;
  expect(lista.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([longe.id, perto.id, erpId]));
  expect((await pedir('POST', '/entregas/juntar', { token: t, corpo: { pedidoIds: [perto.id], pedidoErpIds: [] } })).j.message).toMatch(/dois/);
  const r = (await pedir('POST', '/entregas/juntar', { token: t, corpo: { pedidoIds: [longe.id, perto.id], pedidoErpIds: [erpId] } })).j;
  expect(r).toMatchObject({ pedidoId: perto.id, pedidoErpId: null, semPonto: [] });
  expect(r.paradasExtras.map((p: { pedidoId: string | null; pedidoErpId: string | null }) => p.pedidoId ?? p.pedidoErpId)).toEqual([longe.id, erpId]);

  const criada = await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'ENTREGA', origem: r.origem, destino: r.destino, pedidoId: r.pedidoId, pedidoErpId: r.pedidoErpId, paradasExtras: r.paradasExtras, serieEsperada: null, observacao: r.observacao } });
  expect(criada.status, JSON.stringify(criada.j)).toBe(201);
  const ch = criada.j;
  expect(ch.paradasExtras.map((p: { pedido: { numero: number } | null; pedidoErp: string | null }) => p.pedido?.numero ?? p.pedidoErp)).toEqual([longe.numero, 'E-77']);
  expect((await sql(`SELECT situacao, chamada_id FROM pedidos_erp_entrega WHERE id = $1`, [erpId]))[0]).toMatchObject({ situacao: 'CHAMADA', chamada_id: ch.id });
  // O mesmo pedido não entra em outra chamada.
  expect((await pedir('GET', `/entregas/pedidos/${longe.id}/rascunho`, { token: t })).j.chamadaAtiva).toMatchObject({ numero: ch.numero });
  expect((await pedir('POST', '/entregas/juntar', { token: t, corpo: { pedidoIds: [longe.id, perto.id], pedidoErpIds: [] } })).status).toBe(409);
  // O pedido da parada mostra o acompanhamento dela.
  expect((await pedir('GET', `/loja/pedido/${longe.codigo}`)).j.entrega.caminho).toBe(ch.paradasExtras[0].linkRastreio);

  // Cumpre: na coleta os dois pedidos saem para entrega; cada parada conclui o seu.
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `Leo${randomUUID().slice(0, 4)} Teste`);
  expect((await pedir('POST', `/entregas/chamadas/${ch.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } })).status).toBe(200);
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  expect(of.j.entregas).toBe(3);
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ent.token, corpo });
  const situacao = async (id: string) => (await sql<{ situacao: string }>(`SELECT situacao FROM pedidos WHERE id = $1`, [id]))[0].situacao;
  expect((await av({ para: 'NA_COLETA', ...C, precisao: 5 })).status).toBe(200);
  expect((await av({ para: 'COLETADA', ...C })).status).toBe(200);
  expect([await situacao(perto.id), await situacao(longe.id)]).toEqual(['PRONTO', 'PRONTO']);
  const codigos = (await pedir('GET', `/entregas/chamadas/${ch.id}`, { token: t })).j;
  await av({ para: 'NO_DESTINO', ...P1, precisao: 5 });
  await av({ para: 'CONCLUIDA', ...P1, codigo: codigos.codigoConfirmacao });
  await av({ para: 'NO_DESTINO', ...P2, precisao: 5 });
  expect((await av({ para: 'CONCLUIDA', ...P2, codigo: codigos.paradasExtras[0].codigoConfirmacao })).j.situacao).toBe('COLETADA');
  expect(await situacao(longe.id)).toBe('CONCLUIDO');
  expect(await situacao(perto.id)).toBe('PRONTO');
  await av({ para: 'NO_DESTINO', ...P3, precisao: 5 });
  expect((await av({ para: 'CONCLUIDA', ...P3, codigo: codigos.paradasExtras[1].codigoConfirmacao })).j.situacao).toBe('CONCLUIDA');
  expect(await situacao(perto.id)).toBe('CONCLUIDO');
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: comprovação e chamadas ao mesmo tempo na Configuração; juntar pedidos abre a chamada com as paradas', async ({ page }) => {
  test.setTimeout(90_000);
  const { emp, C } = await preparar();
  const loja = await lojaComEntrega(emp);
  await pedidoEmSeparacao(emp, loja, deslocar(C, 700), 'Ana Perto');
  await pedidoEmSeparacao(emp, loja, deslocar(C, 1400), 'Bia Longe');
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await page.getByLabel('Comprovação da entrega').selectOption('JUNTO_AO_CODIGO');
  await page.getByLabel('Chamadas ao mesmo tempo por entregador').selectOption('2');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('tab', { name: 'Mapa' })).toHaveAttribute('aria-selected', 'true');
  expect((await pedir('GET', '/entregas/config', { token: emp.adminToken })).j.config).toMatchObject({ assinatura: 'JUNTO_AO_CODIGO', chamadasSimultaneas: 2 });

  await page.getByRole('tab', { name: 'Chamadas' }).click();
  await page.getByRole('button', { name: 'Juntar pedidos' }).click();
  const itens = page.getByTestId('pedido-para-juntar');
  await expect(itens).toHaveCount(2);
  await itens.nth(0).getByRole('checkbox').check();
  await itens.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Montar a chamada com 2 pedidos' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('Pedidos juntos (2)');
  await expect(dialogo).toContainText('Parada 2 · com pedido');
  await expect(dialogo.getByText('Valor para o entregador')).toBeVisible();
  await page.screenshot({ path: 'test-results/pedidos-juntos.png' });
  await dialogo.getByRole('button', { name: 'Abrir chamada' }).click();
  await expect(page.getByRole('dialog')).toContainText(/Parada 2 de 2 · pedido nº \d+/);
  await expect(page.getByRole('dialog')).toContainText('Comprovação: código e assinatura.');
  expect(erros).toEqual([]);
});
