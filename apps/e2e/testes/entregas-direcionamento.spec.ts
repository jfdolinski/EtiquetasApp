import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/**
 * Entregas, etapa 3: a distribuição automática filtra, ordena, oferece em sequência ou em grupo,
 * amplia o raio a cada rodada e grava o porquê de cada oferta.
 * Cada teste usa um ponto sorteado longe de São Paulo, para não achar entregadores de outros testes.
 */

const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: 'Cliente', telefone: '11912345678', instrucoes: '' });
const longeDeTudo = () => ({ lat: -27 - Math.random() * 2, lon: -49 - Math.random() * 2 });

const REGRAS = {
  automatico: true,
  modo: 'SEQUENCIA',
  tamanhoGrupo: 2,
  raioKm: 3,
  maxTentativas: 2,
  minutosNovaTentativa: 1,
  ampliarRaioKm: 2,
  raioLimiteKm: 5,
  pesos: { proximidade: 50, tempoLivre: 25, aceite: 10, avaliacao: 10, preferido: 5 },
  preferidosPrimeiro: false,
  somentePreferidos: false,
  veiculos: { ENTREGA: ['MOTO', 'CARRO', 'BICICLETA'], COLETA: ['MOTO', 'CARRO', 'BICICLETA', 'A_PE'], DEVOLUCAO_MAQUINA: ['MOTO', 'CARRO'] },
};

type Chamada = { id: string; situacao: string; ofertaPendente: { entregadorNome: string } | null; ofertas: { entregadorNome: string; resultado: string; motivo: string | null }[]; distribuicao: { ativa: boolean; rodada: number; raioKm: number; semEntregadorDesde: string | null }; historico: { texto: string }[] };

test('API: regras, simulador, sequência com rodadas, grupo, preferidos e bloqueio', async () => {
  test.setTimeout(120_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const nome = (n: string) => `${n}${randomUUID().slice(0, 4)}`;
  const [na, nb, nd, np] = [nome('Ana'), nome('Bruno'), nome('Davi'), nome('Pedro')];
  const a = await entregadorOnline(tokenSuper, deslocar(C, 500), `${na} Teste`);
  const b = await entregadorOnline(tokenSuper, deslocar(C, 1500), `${nb} Teste`);
  const d = await entregadorOnline(tokenSuper, deslocar(C, -4000), `${nd} Teste`);
  const pe = await entregadorOnline(tokenSuper, deslocar(C, 200), `${np} Teste`, 'A_PE');
  const todos = [a, b, d, pe];

  // Regras: os pesos precisam somar 100.
  const ruim = await pedir('PUT', '/entregas/direcionamento', { token: t, corpo: { regras: { ...REGRAS, pesos: { ...REGRAS.pesos, proximidade: 40 } } } });
  expect(ruim.status).toBe(400);
  expect(ruim.j.message).toBe('Os pesos somam 90; precisam somar 100.');
  const salvas = await pedir('PUT', '/entregas/direcionamento', { token: t, corpo: { regras: REGRAS } });
  expect(salvas.status, JSON.stringify(salvas.j)).toBe(200);
  expect(salvas.j.direcionamento).toEqual(REGRAS);

  // Simulador: a pé não faz entrega, Davi está fora dos 3 km; Ana (mais perto) primeiro.
  const sim = await pedir('POST', '/entregas/direcionamento/simular', { token: t, corpo: { regras: REGRAS, ponto: C, tipo: 'ENTREGA' } });
  expect(sim.status, JSON.stringify(sim.j)).toBe(200);
  expect(sim.j.classificados.map((c: { nome: string }) => c.nome)).toEqual([na, nb]);
  const fora = Object.fromEntries(sim.j.descartados.map((x: { nome: string; motivo: string }) => [x.nome, x.motivo]));
  expect(fora[np]).toBe('a pé não atende este serviço');
  expect(fora[nd]).toMatch(/^a 4,0 km, fora do raio de 3 km$/);
  // Preferido sempre primeiro muda a ordem (Bruno vira preferido).
  expect((await pedir('PUT', `/entregas/entregadores/${b.id}`, { token: t, corpo: { preferido: true, bloqueado: false } })).status).toBe(200);
  const simPref = await pedir('POST', '/entregas/direcionamento/simular', { token: t, corpo: { regras: { ...REGRAS, preferidosPrimeiro: true }, ponto: C, tipo: 'ENTREGA' } });
  expect(simPref.j.classificados.map((c: { nome: string; preferido: boolean }) => [c.nome, c.preferido])).toEqual([[nb, true], [na, false]]);

  // Chamada nova já sai distribuindo: primeira oferta para Ana, com o porquê.
  const nova = { tipo: 'ENTREGA', origem: parada(C, 'Rua da Coleta, 10, Centro, Cidade Teste'), destino: parada(deslocar(C, 0, 3000), 'Rua do Destino, 20, Bairro, Cidade Teste'), serieEsperada: null, observacao: '' };
  const ch = await pedir<Chamada>('POST', '/entregas/chamadas', { token: t, corpo: nova });
  expect(ch.status, JSON.stringify(ch.j)).toBe(201);
  expect(ch.j.distribuicao).toMatchObject({ ativa: true, rodada: 0, raioKm: 3 });
  expect(ch.j.ofertaPendente).toMatchObject({ entregadorNome: na });
  expect(ch.j.ofertas[0].motivo).toMatch(/^0,5 km, .* → 1º de 2 \(/);
  const ofA = await pedir('GET', '/entregador/oferta', { token: a.token });
  expect(ofA.j.motivo).toBe('Você foi o 1º de 2: você está a 0,5 km da coleta.');

  // Ana recusa: o relógio passa para Bruno sem esperar o prazo.
  await pedir('POST', `/entregador/ofertas/${ofA.j.id}/recusar`, { token: a.token });
  const obter = async () => (await pedir<Chamada>('GET', `/entregas/chamadas/${ch.j.id}`, { token: t })).j;
  await expect.poll(async () => (await obter()).ofertaPendente?.entregadorNome, { timeout: 15_000 }).toBe(nb);
  const ofB = await pedir('GET', '/entregador/oferta', { token: b.token });
  await pedir('POST', `/entregador/ofertas/${ofB.j.id}/recusar`, { token: b.token });

  // Duas tentativas na rodada: espera e amplia o raio para 5 km.
  await expect.poll(async () => (await obter()).distribuicao.semEntregadorDesde, { timeout: 15_000 }).not.toBeNull();
  let atual = await obter();
  expect(atual.distribuicao).toMatchObject({ ativa: true, rodada: 1, raioKm: 5 });
  expect(atual.historico.map((h) => h.texto)).toContain('Ninguém aceitou em até 3 km. Nova tentativa a cada 1 min com raio de 5 km.');
  // Sem esperar o minuto: a próxima rodada já acha o Davi a 4 km.
  for (const e of todos) await pedir('POST', '/entregador/posicao', { token: e.token, corpo: e === a ? deslocar(C, 500) : e === b ? deslocar(C, 1500) : e === d ? deslocar(C, -4000) : deslocar(C, 200) });
  await sql(`UPDATE chamadas_entrega SET proxima_tentativa_em = now() WHERE id = $1`, [ch.j.id]);
  await expect.poll(async () => (await obter()).ofertaPendente?.entregadorNome, { timeout: 15_000 }).toBe(nd);
  const ofD = await pedir('GET', '/entregador/oferta', { token: d.token });
  expect((await pedir('POST', `/entregador/ofertas/${ofD.j.id}/aceitar`, { token: d.token })).j.situacao).toBe('ACEITA');
  atual = await obter();
  expect(atual.distribuicao.ativa).toBe(false);
  expect(atual.ofertas.map((o) => [o.entregadorNome, o.resultado])).toEqual([[na, 'RECUSADA'], [nb, 'RECUSADA'], [nd, 'ACEITA']]);

  // Em grupo: Ana e Bruno recebem juntos; quem aceita primeiro fica, a outra oferta cai.
  await pedir('PUT', '/entregas/direcionamento', { token: t, corpo: { regras: { ...REGRAS, modo: 'GRUPO' } } });
  const grupo = await pedir<Chamada>('POST', '/entregas/chamadas', { token: t, corpo: nova });
  expect(grupo.j.ofertas.filter((o) => o.resultado === 'PENDENTE').map((o) => o.entregadorNome).sort()).toEqual([na, nb].sort());
  const [gA, gB] = await Promise.all([pedir('GET', '/entregador/oferta', { token: a.token }), pedir('GET', '/entregador/oferta', { token: b.token })]);
  expect((await pedir('POST', `/entregador/ofertas/${gB.j.id}/aceitar`, { token: b.token })).j.situacao).toBe('ACEITA');
  const tarde = await pedir('POST', `/entregador/ofertas/${gA.j.id}/aceitar`, { token: a.token });
  expect(tarde.status).toBe(409);
  expect((await pedir('GET', '/entregador/oferta', { token: a.token })).j.id).toBeUndefined();

  // Sem distribuição: liga à mão e para; parar cancela a oferta automática.
  await pedir('PUT', '/entregas/direcionamento', { token: t, corpo: { regras: { ...REGRAS, automatico: false } } });
  const manual = await pedir<Chamada>('POST', '/entregas/chamadas', { token: t, corpo: nova });
  expect(manual.j.distribuicao.ativa).toBe(false);
  expect(manual.j.ofertaPendente).toBeNull();
  const ligada = await pedir<Chamada>('POST', `/entregas/chamadas/${manual.j.id}/distribuir`, { token: t });
  expect(ligada.j.ofertaPendente).toMatchObject({ entregadorNome: na });
  const parada2 = await pedir<Chamada>('POST', `/entregas/chamadas/${manual.j.id}/parar-distribuicao`, { token: t });
  expect(parada2.j).toMatchObject({ distribuicao: { ativa: false }, ofertaPendente: null });
  expect(parada2.j.ofertas[0].resultado).toBe('CANCELADA');

  // Bloqueada, Ana some dos elegíveis da escolha manual; a lista da empresa mostra todos.
  expect((await pedir('GET', `/entregas/chamadas/${manual.j.id}/elegiveis`, { token: t })).j.map((e: { nome: string }) => e.nome)).toContain(na);
  const lista = await pedir('PUT', `/entregas/entregadores/${a.id}`, { token: t, corpo: { preferido: false, bloqueado: true } });
  expect(lista.j.find((e: { id: string }) => e.id === a.id)).toMatchObject({ bloqueado: true, preferido: false });
  expect(lista.j.find((e: { id: string }) => e.id === b.id)).toMatchObject({ preferido: true });
  expect((await pedir('GET', `/entregas/chamadas/${manual.j.id}/elegiveis`, { token: t })).j.map((e: { nome: string }) => e.nome)).not.toContain(na);
  expect((await pedir('POST', `/entregas/chamadas/${manual.j.id}/oferecer`, { token: t, corpo: { entregadorId: a.id } })).status).toBe(409);
  expect((await pedir('PUT', `/entregas/entregadores/${a.id}`, { token: t, corpo: { preferido: true, bloqueado: true } })).status).toBe(400);

  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA', distribuicao_ativa = false WHERE empresa_id = $1`, [emp.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = ANY($1)`, [todos.map((e) => e.id)]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: regras, simulador e chamada distribuída automaticamente', async ({ page }) => {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const C = longeDeTudo();
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...C, endereco: 'Rua da Loja, 1, Centro, Cidade Teste' }, raioAtendimentoKm: 10 } });
  const apelido = `Rui${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 800), `${apelido} Site Teste`);
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
  await page.setViewportSize({ width: 1400, height: 1000 });

  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.getByRole('tab', { name: 'Direcionamento' }).click();
  await page.getByLabel('Peso: Proximidade da coleta').fill('60');
  await expect(page.getByText('Os pesos somam 110; precisam somar 100.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar regras' })).toBeDisabled();
  await page.getByLabel('Peso: Tempo sem chamada').fill('15');
  await page.getByLabel('Toda chamada nova vai direto para a distribuição automática').check();
  // Simula no ponto da empresa (já marcado), com as regras da tela.
  await page.getByRole('button', { name: 'Simular' }).click();
  await expect(page.getByText(new RegExp(`A primeira oferta iria para ${apelido}`))).toBeVisible();
  await page.screenshot({ path: 'test-results/direcionamento-simulador.png', fullPage: true });
  await page.getByRole('button', { name: 'Salvar regras' }).click();
  await expect(page.getByText('Regras salvas.')).toBeVisible();
  const [cfg] = await sql<{ direcionamento: { automatico: boolean; pesos: Record<string, number> } }>(`SELECT direcionamento FROM configuracoes_entregas WHERE empresa_id = $1`, [emp.id]);
  expect(cfg.direcionamento).toMatchObject({ automatico: true, pesos: { proximidade: 60, tempoLivre: 15 } });

  // Chamada nova com "Distribuir automaticamente" marcado de saída.
  await page.getByRole('tab', { name: 'Chamadas' }).click();
  await page.getByRole('button', { name: 'Nova chamada' }).click();
  await expect(page.getByLabel('Distribuir automaticamente')).toBeChecked();
  await page.getByLabel('Endereço do destino').fill('Rua do Cliente, 300, Cidade Teste');
  const mapa = page.getByRole('dialog').getByTestId('mapa-entregas');
  const caixa = (await mapa.boundingBox())!;
  await page.mouse.click(caixa.x + caixa.width / 2 + 120, caixa.y + caixa.height / 2 + 40);
  await expect(page.getByText(/Valor para o entregador: R\$/)).toBeVisible();
  await page.getByRole('button', { name: 'Abrir chamada' }).click();
  await expect(page.getByTestId('distribuicao')).toContainText('Distribuição automática');
  await expect(page.getByText(new RegExp(`Oferecida a ${apelido}, esperando resposta`))).toBeVisible();
  await expect(page.getByText(/Escolhido pela distribuição: 0,8 km/)).toBeVisible();
  await page.screenshot({ path: 'test-results/direcionamento-chamada.png' });

  // Aba Entregadores: quem recebeu a oferta aparece e pode virar preferido.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Entregadores' }).click();
  await page.getByRole('button', { name: `Preferir ${apelido}` }).click();
  await expect(page.getByRole('button', { name: `Tirar dos preferidos ${apelido}` })).toBeVisible();
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA', distribuicao_ativa = false WHERE empresa_id = $1`, [emp.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
