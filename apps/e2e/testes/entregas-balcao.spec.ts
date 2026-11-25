import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API, pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/** Entregas, etapa 12: etiqueta de coleta e balcão, volumes, termo de custódia, agendada, conversa e relatório. */

const longeDeTudo = () => ({ lat: -14 - Math.random() * 2, lon: -52 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });
const lista = { carregador: true, bobina: true, chip: true, estado: 'BOA', observacao: '' };

async function preparar() {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const C = longeDeTudo();
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, chamadasSimultaneas: 2 } });
  const nova = async (extra: Record<string, unknown> = {}) => {
    const r = await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(deslocar(C, 1500), 'Rua Cliente, 9'), serieEsperada: null, observacao: '', ...extra } });
    expect(r.status, JSON.stringify(r.j)).toBe(201);
    return r.j;
  };
  return { tokenSuper, emp, t: emp.adminToken, C, D: deslocar(C, 1500), nova };
}

test('API: etiqueta de coleta, pegar no balcão, volumes e a leitura na coleta', async () => {
  test.setTimeout(90_000);
  const { tokenSuper, t, C, D, nova } = await preparar();
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 40), `Ivo${randomUUID().slice(0, 4)} Teste`);
  const outro = await entregadorOnline(tokenSuper, deslocar(C, 60), `Ari${randomUUID().slice(0, 4)} Teste`);
  const a = await nova();
  expect(a.codigoColeta).toMatch(/^FC[23456789A-Z]{10}$/);
  // Imprimir marca a etiqueta como impressa.
  const pdf = await fetch(`${API}/entregas/chamadas/${a.id}/etiqueta.pdf`, { headers: { Authorization: `Bearer ${t}` } });
  expect(pdf.status).toBe(200);
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await pedir('GET', `/entregas/chamadas/${a.id}`, { token: t })).j.etiquetaImpressaEm).toBeTruthy();

  // No balcão: lê a etiqueta (do jeito que o leitor devolve) e a chamada fica com ele, já no local.
  const balcao = (token: string, codigo: string) => pedir('POST', '/entregador/balcao', { token, corpo: { codigo, ...deslocar(C, 40), precisao: 5 } });
  expect((await balcao(ent.token, '7891000100103')).status).toBe(400);
  const pegou = await balcao(ent.token, ` ${String(a.codigoColeta).toLowerCase()} `);
  expect(pegou.status, JSON.stringify(pegou.j)).toBe(200);
  expect(pegou.j).toMatchObject({ id: a.id, situacao: 'NA_COLETA', pedeEtiqueta: false });
  expect((await balcao(outro.token, a.codigoColeta)).j.message).toMatch(/outro entregador/);
  // Volumes na coleta; na entrega, faltando volume não conclui.
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${a.id}/avancar`, { token: ent.token, corpo });
  expect((await av({ para: 'COLETADA', ...C, volumes: 0 })).status).toBe(400);
  expect((await av({ para: 'COLETADA', ...C, volumes: 3 })).j).toMatchObject({ situacao: 'COLETADA', volumes: 3 });
  await av({ para: 'NO_DESTINO', ...D, precisao: 5 });
  const codigo = (await pedir('GET', `/entregas/chamadas/${a.id}`, { token: t })).j.codigoConfirmacao;
  expect((await av({ para: 'CONCLUIDA', ...D, codigo, volumesEntregues: 2 })).j.message).toMatch(/Saíram 3 volumes/);
  expect((await av({ para: 'CONCLUIDA', ...D, codigo, volumesEntregues: 3 })).j.situacao).toBe('CONCLUIDA');
  const fim = (await pedir('GET', `/entregas/chamadas/${a.id}`, { token: t })).j;
  expect(fim).toMatchObject({ volumes: 3, volumesEntregues: 3 });
  expect(fim.historico.map((h: { texto: string }) => h.texto)).toEqual(expect.arrayContaining([expect.stringMatching(/pegou no balcão \(etiqueta lida\) e já está no local da coleta/), expect.stringMatching(/3 volumes/)]));

  // Pela oferta, com a etiqueta impressa: a coleta pede a leitura e confere o pacote.
  const b = await nova();
  await fetch(`${API}/entregas/chamadas/${b.id}/etiqueta.pdf`, { headers: { Authorization: `Bearer ${t}` } });
  await pedir('POST', `/entregas/chamadas/${b.id}/oferecer`, { token: t, corpo: { entregadorId: outro.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: outro.token });
  expect((await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: outro.token })).j.pedeEtiqueta).toBe(true);
  const avB = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${b.id}/avancar`, { token: outro.token, corpo });
  await avB({ para: 'NA_COLETA', ...C, precisao: 5 });
  expect((await avB({ para: 'COLETADA', ...C, volumes: 1 })).j.message).toMatch(/Leia a etiqueta/);
  expect((await avB({ para: 'COLETADA', ...C, volumes: 1, etiqueta: a.codigoColeta })).j.message).toMatch(/não é desta chamada/);
  expect((await avB({ para: 'COLETADA', ...C, volumes: 1, etiqueta: b.codigoColeta })).j.situacao).toBe('COLETADA');
  await sql(`UPDATE entregadores SET online = false WHERE id = ANY($1)`, [[ent.id, outro.id]]);
});

test('API: termo de custódia para máquina, chamada agendada, conversa e relatório', async () => {
  test.setTimeout(90_000);
  const { tokenSuper, emp, t, C, nova } = await preparar();
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `Leo${randomUUID().slice(0, 4)} Teste`);

  // Máquina: sem o termo, não aparece; aceitou, aparece.
  const m = await nova({ tipo: 'DEVOLUCAO_MAQUINA', origem: parada(deslocar(C, 800), 'Rua Cliente, 2'), destino: parada(C, 'Rua da Loja, 1'), serieEsperada: 'POS123456' });
  const elegiveis = async () => (await pedir('GET', `/entregas/chamadas/${m.id}/elegiveis`, { token: t })).j.map((e: { id: string }) => e.id);
  expect(await elegiveis()).not.toContain(ent.id);
  expect((await pedir('POST', '/entregador/balcao', { token: ent.token, corpo: { codigo: m.codigoColeta, ...C } })).j.message).toMatch(/termo de custódia/);
  expect((await pedir('GET', '/entregador/termo-custodia', { token: ent.token })).j.texto.length).toBeGreaterThan(2);
  expect((await pedir('POST', '/entregador/termo-custodia', { token: ent.token })).j.versao).toBe(1);
  expect((await pedir('GET', '/entregador/eu', { token: ent.token })).j.termoCustodia).toBe(true);
  expect(await elegiveis()).toContain(ent.id);

  // Agendada: recusa em cima da hora; para daqui a 2 h, a distribuição espera até 30 min antes.
  expect((await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(deslocar(C, 900), 'Rua X, 1'), serieEsperada: null, observacao: '', agendadaPara: new Date(Date.now() + 5 * 60_000).toISOString() } })).j.message).toMatch(/15 minutos/);
  const daqui2h = new Date(Date.now() + 2 * 3_600_000);
  const ag = await nova({ agendadaPara: daqui2h.toISOString(), distribuir: true });
  const agLida = (await pedir('GET', `/entregas/chamadas/${ag.id}`, { token: t })).j;
  expect(agLida.agendadaPara).toBe(daqui2h.toISOString());
  expect(agLida.ofertas).toHaveLength(0);
  expect(Math.abs(new Date(agLida.distribuicao.proximaTentativaEm).getTime() - (daqui2h.getTime() - 30 * 60_000))).toBeLessThan(2000);
  expect(agLida.historico.some((h: { texto: string }) => /começa em/.test(h.texto))).toBe(true);
  await pedir('POST', `/entregas/chamadas/${ag.id}/cancelar`, { token: t, corpo: { motivo: 'teste' } });

  // Conversa: sem entregador não há com quem falar; com ele, cada lado vê e as novas aparecem na lista.
  const c = await nova();
  expect((await pedir('POST', `/entregas/chamadas/${c.id}/mensagens`, { token: t, corpo: { texto: 'Oi' } })).status).toBe(409);
  await pedir('POST', `/entregas/chamadas/${c.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  expect((await pedir('POST', `/entregas/chamadas/${c.id}/mensagens`, { token: t, corpo: { texto: 'Pode pegar pela porta dos fundos.' } })).j.mensagens).toHaveLength(1);
  expect((await pedir('GET', '/entregador/chamada', { token: ent.token })).j.mensagensNaoLidas).toBe(1);
  const doEntregador = (await pedir('GET', `/entregador/chamadas/${c.id}/mensagens`, { token: ent.token })).j;
  expect(doEntregador.mensagens[0]).toMatchObject({ autor: 'empresa', texto: 'Pode pegar pela porta dos fundos.' });
  expect((await pedir('GET', '/entregador/chamada', { token: ent.token })).j.mensagensNaoLidas).toBe(0);
  await pedir('POST', `/entregador/chamadas/${c.id}/mensagens`, { token: ent.token, corpo: { texto: 'Chego em 5 minutos.' } });
  const naLista = (await pedir('GET', '/entregas/chamadas', { token: t })).j.find((x: { id: string }) => x.id === c.id);
  expect(naLista.mensagensNaoLidas).toBe(1);
  expect((await pedir('GET', `/entregas/chamadas/${c.id}/mensagens`, { token: t })).j.mensagens.map((x: { texto: string }) => x.texto)).toEqual(['Pode pegar pela porta dos fundos.', 'Chego em 5 minutos.']);
  expect((await pedir('GET', `/entregas/chamadas/${c.id}`, { token: t })).j.mensagensNaoLidas).toBe(0);
  const outra = await empresaComBase(tokenSuper);
  expect((await pedir('GET', `/entregas/chamadas/${c.id}/mensagens`, { token: outra.adminToken })).status).toBe(404);
  expect((await pedir('POST', `/entregas/chamadas/${c.id}/mensagens`, { token: t, corpo: { texto: '   ' } })).status).toBe(400);

  // Relatório e planilha.
  const rel = (await pedir('GET', '/entregas/relatorio', { token: t })).j;
  expect(rel.resumo).toMatchObject({ total: 3, canceladas: 1 });
  const csv = await fetch(`${API}/entregas/relatorio.csv`, { headers: { Authorization: `Bearer ${t}` } });
  expect(csv.headers.get('content-type')).toContain('text/csv');
  const bytes = Buffer.from(await csv.arrayBuffer());
  // O BOM faz o Excel ler os acentos.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const texto = bytes.subarray(3).toString('utf8');
  expect(texto.startsWith('Nº;Serviço;Situação')).toBe(true);
  expect(texto.split('\r\n').filter(Boolean)).toHaveLength(4);
  expect((await pedir('GET', '/entregas/relatorio?de=2026-02-10&ate=2026-01-01', { token: t })).status).toBe(400);
  void emp;
  void PNG;
  void lista;
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.92.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: relatório, etiqueta de coleta e conversa na chamada', async ({ page }) => {
  test.setTimeout(90_000);
  const { tokenSuper, emp, t, C, nova } = await preparar();
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `Gil${randomUUID().slice(0, 4)} Teste`);
  const c = await nova();
  await pedir('POST', `/entregas/chamadas/${c.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  await pedir('POST', `/entregador/chamadas/${c.id}/mensagens`, { token: ent.token, corpo: { texto: 'Estou chegando.' } });
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await expect(page.getByTestId('mensagens-nao-lidas')).toHaveText('1 mensagem nova');
  await page.getByTestId('linha-chamada').first().click();
  const conversa = page.getByTestId('conversa');
  await expect(conversa).toContainText('Estou chegando.');
  await page.getByLabel('Mensagem para o entregador').fill('Ok, estamos esperando.');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(conversa).toContainText('Ok, estamos esperando.');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Imprimir etiqueta de coleta' }).click();
  await (await popup).close();
  await expect(page.getByTestId('etiqueta-coleta')).toContainText('Etiqueta impressa');
  await page.screenshot({ path: 'test-results/chamada-conversa-etiqueta.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Relatório' }).click();
  await expect(page.getByTestId('relatorio-numeros')).toContainText('Chamadas');
  await expect(page.getByRole('cell', { name: /Gil/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/relatorio-entregas.png' });
  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
