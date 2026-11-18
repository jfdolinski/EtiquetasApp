import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/** Entregas, etapa 6: várias paradas na mesma chamada, adicionais por horário e região, mapa da demanda. */

const longeDeTudo = () => ({ lat: -3 - Math.random() * 2, lon: -39 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });
const SEMPRE = { nome: 'Teste o dia todo', dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59', percentual: 10, fixoCentavos: 0 };
const precos = { ENTREGA: { baseCentavos: 800, porKmCentavos: 200, kmIncluso: 2, porParadaCentavos: 300 }, COLETA: { baseCentavos: 900, porKmCentavos: 200, kmIncluso: 2 }, DEVOLUCAO_MAQUINA: { baseCentavos: 1500, porKmCentavos: 200, kmIncluso: 2 } };

test('API: três entregas na mesma chamada, com adicionais, código e link por parada', async () => {
  test.setTimeout(90_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D1 = deslocar(C, 1500);
  const D2 = deslocar(C, 2500, 1000);
  const D3 = deslocar(C, 3000, -1500);
  const base = { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, precos };

  // Adicionais: um que nunca soma é recusado; horário o dia todo (10 %) e a região de D3 (R$ 5,00).
  expect((await pedir('PUT', '/entregas/config', { token: t, corpo: { ...base, adicionais: { horarios: [{ ...SEMPRE, percentual: 0 }], regioes: [] } } })).j.message).toMatch(/não soma nada/);
  const cfg = await pedir('PUT', '/entregas/config', { token: t, corpo: { ...base, adicionais: { horarios: [SEMPRE], regioes: [{ nome: 'Bairro longe', centro: D3, raioKm: 0.5, percentual: 0, fixoCentavos: 500 }] } } });
  expect(cfg.status, JSON.stringify(cfg.j)).toBe(200);
  expect(cfg.j.adicionais.regioes[0]).toMatchObject({ nome: 'Bairro longe', fixoCentavos: 500 });

  const nome = `Ari${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `${nome} Teste`);
  const nova = { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(D1, 'Rua Um, 10'), serieEsperada: null, observacao: '', paradasExtras: [parada(D2, 'Rua Dois, 20'), parada(D3, 'Rua Três, 30')] };

  // Coleta não tem várias paradas.
  expect((await pedir('POST', '/entregas/chamadas/previa', { token: t, corpo: { ...nova, tipo: 'COLETA' } })).j.message).toBe('Várias paradas só na entrega.');
  const previa = (await pedir('POST', '/entregas/chamadas/previa', { token: t, corpo: nova })).j;
  const tabela = Math.round(800 + Math.max(0, previa.metros / 1000 - 2) * 200 + 2 * 300);
  expect(previa.valorTabelaCentavos).toBe(tabela);
  expect(previa.adicionais).toEqual([
    { nome: 'Teste o dia todo', centavos: Math.round(tabela * 0.1) },
    { nome: 'Bairro longe', centavos: 500 },
  ]);
  expect(previa.valorCentavos).toBe(tabela + Math.round(tabela * 0.1) + 500);

  const ch = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: nova })).j;
  expect(ch).toMatchObject({ valorCentavos: previa.valorCentavos, paradaAtual: 0, adicionais: previa.adicionais });
  expect(ch.paradasExtras.map((p: { ordem: number; parada: { endereco: string } }) => [p.ordem, p.parada.endereco])).toEqual([[1, 'Rua Dois, 20'], [2, 'Rua Três, 30']]);
  const [p2, p3] = ch.paradasExtras as { codigoConfirmacao: string; linkRastreio: string }[];
  expect(new Set([ch.codigoConfirmacao, p2.codigoConfirmacao, p3.codigoConfirmacao]).size).toBeGreaterThanOrEqual(1);
  expect(p3.linkRastreio).toMatch(/^\/rastreio\//);

  // Oferta mostra que são três entregas; aceita e coleta.
  await pedir('POST', `/entregas/chamadas/${ch.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  expect(of.j.entregas).toBe(3);
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ent.token, corpo });
  await av({ para: 'NA_COLETA', ...C, precisao: 5 });
  let app = (await av({ para: 'COLETADA', ...C })).j;
  expect(app.destinos.map((d: { ordem: number; entregue: boolean }) => [d.ordem, d.entregue])).toEqual([[0, false], [1, false], [2, false]]);

  // O terceiro destinatário espera a vez: sem posição, com o código dele e quantas faltam.
  const r3 = (await pedir('GET', `/rastreio/${p3.linkRastreio.split('/')[2]}`)).j;
  expect(r3).toMatchObject({ texto: 'Saiu para entrega: 2 entregas antes da sua', posicao: null, codigoConfirmacao: p3.codigoConfirmacao, parada: { ordem: 3, total: 3 } });

  // Primeira entrega com o código principal: volta a "a caminho" e o destino vira a parada 2.
  await av({ para: 'NO_DESTINO', ...D1, precisao: 5 });
  app = (await av({ para: 'CONCLUIDA', ...D1, codigo: ch.codigoConfirmacao })).j;
  expect(app).toMatchObject({ situacao: 'COLETADA', paradaAtual: 1, destino: { endereco: 'Rua Dois, 20' } });
  const meio = (await pedir('GET', `/entregas/chamadas/${ch.id}`, { token: t })).j;
  expect(meio).toMatchObject({ situacao: 'COLETADA', paradaAtual: 1, codigoConfirmacao: null });
  expect(meio.historico.map((h: { texto: string }) => h.texto)).toContain('Entregue, com o código do destinatário (parada 1 de 3).');
  const r2 = (await pedir('GET', `/rastreio/${p2.linkRastreio.split('/')[2]}`)).j;
  expect(r2.posicao).not.toBeNull();
  expect((await pedir('GET', `/rastreio/${ch.linkRastreio.split('/')[2]}`)).j).toMatchObject({ texto: 'Entregue', codigoConfirmacao: null });

  // Parada 2: chegada no ponto dela e o código dela; a 3 conclui a chamada.
  expect((await av({ para: 'NO_DESTINO', ...D1, precisao: 5 })).status).toBe(400);
  await av({ para: 'NO_DESTINO', ...D2, precisao: 5 });
  expect((await av({ para: 'CONCLUIDA', ...D2, codigo: ch.codigoConfirmacao === p2.codigoConfirmacao ? '0000' : ch.codigoConfirmacao })).status).toBe(400);
  await av({ para: 'CONCLUIDA', ...D2, codigo: p2.codigoConfirmacao });
  await av({ para: 'NO_DESTINO', ...D3, precisao: 5 });
  expect((await av({ para: 'CONCLUIDA', ...D3, codigo: p3.codigoConfirmacao })).j.situacao).toBe('CONCLUIDA');
  const fim = (await pedir('GET', `/entregas/chamadas/${ch.id}`, { token: t })).j;
  expect(fim.situacao).toBe('CONCLUIDA');
  expect(fim.paradasExtras.every((p: { entregueEm: string | null; codigoConfirmacao: string | null }) => p.entregueEm && !p.codigoConfirmacao)).toBe(true);

  // Demanda: os três pontos de entrega, por hora e por dia.
  const dem = (await pedir('GET', '/entregas/demanda?dias=7', { token: t })).j;
  expect(dem.total).toBe(1);
  expect(dem.celulas.reduce((s: number, c: { quantidade: number }) => s + c.quantidade, 0)).toBe(3);
  expect(dem.porHora.reduce((s: number, n: number) => s + n, 0)).toBe(1);
  expect((await pedir('GET', '/entregas/demanda?dias=5', { token: t })).status).toBe(400);

  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.94.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: adicional na Configuração, chamada com parada extra e a aba Demanda', async ({ page }) => {
  test.setTimeout(90_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const C = longeDeTudo();
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...C, endereco: 'Rua da Loja, 1, Centro' }, raioAtendimentoKm: 10, precos } });
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();

  // Configuração: um adicional de horário o dia todo.
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await expect(page.getByLabel('Por parada extra (R$)')).toHaveValue('3,00');
  await page.getByRole('button', { name: '+ Adicional de horário' }).click();
  const ad = page.getByTestId('adicionais');
  await ad.getByLabel('Nome do adicional de horário').fill('Dia todo');
  await ad.getByLabel('Das').fill('00:00');
  await ad.getByLabel('Até').fill('23:59');
  await ad.getByLabel('Percentual (%)').fill('10');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('tab', { name: 'Mapa' })).toHaveAttribute('aria-selected', 'true');
  const [cfg] = await sql<{ adicionais: { horarios: { nome: string; percentual: number }[] } }>(`SELECT adicionais FROM configuracoes_entregas WHERE empresa_id = $1`, [emp.id]);
  expect(cfg.adicionais.horarios[0]).toMatchObject({ nome: 'Dia todo', percentual: 10 });

  // Nova chamada com uma parada a mais, marcadas no mapa.
  await page.getByRole('tab', { name: 'Chamadas' }).click();
  await page.getByRole('button', { name: 'Nova chamada' }).click();
  const dialogo = page.getByRole('dialog');
  const mapa = dialogo.getByTestId('mapa-entregas');
  const caixa = (await mapa.boundingBox())!;
  await page.getByLabel('Endereço do destino').fill('Rua Um, 10');
  await page.mouse.click(caixa.x + caixa.width / 2 + 120, caixa.y + caixa.height / 2 + 40);
  await dialogo.getByRole('button', { name: '+ Adicionar parada' }).click();
  await page.getByLabel('Endereço da parada 2').fill('Rua Dois, 20');
  // O formulário cresceu: o mapa pode ter mudado de lugar.
  const caixa2 = (await mapa.boundingBox())!;
  await page.mouse.click(caixa2.x + caixa2.width / 2 - 100, caixa2.y + caixa2.height / 2 + 80);
  await expect(dialogo.getByTestId('previa-adicionais')).toContainText('Dia todo');
  await page.screenshot({ path: 'test-results/chamada-paradas.png' });
  await dialogo.getByRole('button', { name: 'Abrir chamada' }).click();
  await expect(page.getByTestId('parada-extra')).toContainText('Parada 2 de 2');
  await expect(page.getByTestId('parada-extra')).toContainText('Código desta parada');
  await page.keyboard.press('Escape');

  // Demanda.
  await page.getByRole('tab', { name: 'Demanda' }).click();
  await expect(page.getByTestId('demanda-total')).toContainText('1 chamada no período, em 2 áreas');
  await page.screenshot({ path: 'test-results/demanda.png', fullPage: true });
  expect(erros).toEqual([]);
});
