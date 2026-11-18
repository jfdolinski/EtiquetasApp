import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/**
 * Entregas, etapa 8: desistência do entregador, taxa de deslocamento no cancelamento, foto
 * obrigatória, máquinas com cada entregador, rastro e a senha esquecida do entregador.
 */

const longeDeTudo = () => ({ lat: -15 - Math.random() * 2, lon: -55 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });
const precos = {
  ENTREGA: { baseCentavos: 800, porKmCentavos: 200, kmIncluso: 2, porParadaCentavos: 300, taxaCancelamentoCentavos: 400 },
  COLETA: { baseCentavos: 900, porKmCentavos: 200, kmIncluso: 2 },
  DEVOLUCAO_MAQUINA: { baseCentavos: 1500, porKmCentavos: 200, kmIncluso: 2, taxaCancelamentoCentavos: 600 },
};

async function cenario() {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 1800, 600);
  const cfg = await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, precos, fotos: { coleta: true, entrega: false } } });
  expect(cfg.status, JSON.stringify(cfg.j)).toBe(200);
  expect(cfg.j.fotos).toEqual({ coleta: true, entrega: false });
  const nome = `Edu${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `${nome} Teste`);
  return { tokenSuper, emp, t, C, D, nome, ent };
}

test('API: desistência, foto obrigatória, máquina com o entregador, rastro e taxa no cancelamento', async () => {
  test.setTimeout(90_000);
  const { t, C, D, nome, ent } = await cenario();
  const aceitar = async (chamadaId: string) => {
    await pedir('POST', '/entregador/posicao', { token: ent.token, corpo: deslocar(C, 300) });
    expect((await pedir('POST', `/entregas/chamadas/${chamadaId}/oferecer`, { token: t, corpo: { entregadorId: ent.id } })).status).toBe(200);
    const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
    expect((await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token })).status).toBe(200);
  };
  const av = (id: string, corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${id}/avancar`, { token: ent.token, corpo });

  // Desistência antes de coletar: volta a esperar entregador e a oferta vira DESISTIU.
  const ch1 = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(D, 'Rua Cliente, 2'), serieEsperada: null, observacao: '' } })).j;
  await aceitar(ch1.id);
  expect((await pedir('POST', `/entregador/chamadas/${ch1.id}/desistir`, { token: ent.token, corpo: { motivo: 'Pneu furou' } })).status).toBe(204);
  let r = (await pedir('GET', `/entregas/chamadas/${ch1.id}`, { token: t })).j;
  expect(r).toMatchObject({ situacao: 'ABERTA', entregador: null });
  expect(r.ofertas.map((o: { resultado: string }) => o.resultado)).toEqual(['DESISTIU']);
  expect(r.historico.map((h: { texto: string }) => h.texto)).toContain(`${nome} desistiu: Pneu furou. A chamada voltou a esperar entregador.`);
  expect((await pedir('GET', '/entregador/reputacao', { token: ent.token })).j).toMatchObject({ taxaAceite: 0, ofertas30d: 1 });
  // Quem desistiu não recebe a mesma chamada de novo.
  expect((await pedir('GET', `/entregas/chamadas/${ch1.id}/elegiveis`, { token: t })).j.map((e: { id: string }) => e.id)).not.toContain(ent.id);

  // Devolução de máquina: a foto da coleta é obrigatória; depois de coletar, não dá para desistir.
  const ch2 = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'DEVOLUCAO_MAQUINA', origem: parada(D, 'Rua Cliente, 2'), destino: parada(C, 'Rua da Loja, 1'), serieEsperada: null, observacao: '' } })).j;
  await aceitar(ch2.id);
  await av(ch2.id, { para: 'NA_COLETA', ...D, precisao: 5 });
  expect((await av(ch2.id, { para: 'COLETADA', ...D, serie: 'MAQ-1234' })).j.message).toBe('Tire a foto da coleta para continuar.');
  const app = (await av(ch2.id, { para: 'COLETADA', ...D, serie: 'MAQ-1234', foto: PNG })).j;
  expect(app).toMatchObject({ situacao: 'COLETADA', pedeFotoColeta: true, pedeFotoEntrega: false });
  expect((await pedir('POST', `/entregador/chamadas/${ch2.id}/desistir`, { token: ent.token, corpo: { motivo: '' } })).j.message).toMatch(/registre uma ocorrência/);

  // A empresa vê a máquina com o entregador, a foto e o caminho.
  const maquinas = (await pedir('GET', '/entregas/maquinas', { token: t })).j;
  expect(maquinas).toEqual([expect.objectContaining({ chamadaId: ch2.id, serie: 'MAQ1234', situacao: 'COLETADA', entregador: expect.objectContaining({ id: ent.id, nome }), semSinalMinutos: 0 })]);
  r = (await pedir('GET', `/entregas/chamadas/${ch2.id}`, { token: t })).j;
  expect(r.fotos).toEqual(['COLETA']);
  expect((await pedir('GET', `/entregas/chamadas/${ch2.id}/fotos/COLETA`, { token: t })).j.dados).toBe(PNG);
  await pedir('POST', '/entregador/posicao', { token: ent.token, corpo: deslocar(D, -600) });
  const rastro = (await pedir('GET', `/entregas/chamadas/${ch2.id}/rastro`, { token: t })).j;
  expect(rastro.length).toBeGreaterThanOrEqual(3);

  // A empresa cancela depois da coleta: o entregador recebe a taxa de deslocamento da tabela.
  expect((await pedir('POST', `/entregas/chamadas/${ch2.id}/cancelar`, { token: t, corpo: { motivo: 'Cliente desistiu' } })).j).toMatchObject({ situacao: 'CANCELADA', cancelamentoPago: true, valorCentavos: 600 });
  const aPagar = (await pedir('GET', '/entregas/financeiro/a-pagar', { token: t })).j;
  expect(aPagar).toEqual([expect.objectContaining({ quantidade: 1, totalCentavos: 600 })]);
  expect((await pedir('GET', `/entregas/financeiro/a-pagar/${ent.id}`, { token: t })).j[0]).toMatchObject({ cancelada: true, valorCentavos: 600 });
  const extrato = (await pedir('GET', '/entregador/extrato?periodo=HOJE', { token: ent.token })).j;
  expect(extrato.linhas).toEqual([expect.objectContaining({ chamadaId: ch2.id, cancelada: true, valorCentavos: 600, situacao: 'A_RECEBER' })]);
  expect((await pedir('GET', '/entregas/maquinas', { token: t })).j).toEqual([]);

  // Cancelar a chamada sem entregador não paga nada.
  expect((await pedir('POST', `/entregas/chamadas/${ch1.id}/cancelar`, { token: t, corpo: { motivo: 'Sem entregador' } })).j).toMatchObject({ cancelamentoPago: false });
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('API: senha esquecida do entregador por link de uso único', async () => {
  const { ent } = await cenario();
  expect((await pedir('GET', '/entregador/recursos')).status).toBe(200);
  // Responde igual para e-mail que não existe.
  expect((await pedir('POST', '/entregador/senha/esqueci', { corpo: { email: 'ninguem@e2e.local' } })).status).toBe(204);
  const token = randomUUID() + randomUUID();
  await sql(`INSERT INTO redefinicoes_senha_entregador (id, entregador_id, token_hash, expira_em) VALUES ($1, $2, $3, (now() at time zone 'utc') + interval '1 hour')`, [randomUUID(), ent.id, createHash('sha256').update(token).digest('hex')]);
  expect((await pedir('POST', '/entregador/senha/redefinir', { corpo: { token, senha: 'curta' } })).j.message).toMatch(/ao menos/);
  expect((await pedir('POST', '/entregador/senha/redefinir', { corpo: { token, senha: 'NovaSenha123' } })).status).toBe(204);
  expect((await pedir('POST', '/entregador/senha/redefinir', { corpo: { token, senha: 'OutraSenha123' } })).j.message).toMatch(/já foi usado/);
  // A sessão antiga cai; a senha nova entra.
  expect((await pedir('GET', '/entregador/creditos', { token: ent.token })).status).toBe(401);
  expect((await pedir('POST', '/entregador/login', { corpo: { login: ent.email, senha: 'SenhaEntregador1' } })).status).toBe(401);
  expect((await pedir('POST', '/entregador/login', { corpo: { login: ent.email, senha: 'NovaSenha123' } })).j.token).toMatch(/^ent_/);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.93.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: máquinas com o entregador, foto da coleta, aviso da taxa e a página de nova senha', async ({ page }) => {
  test.setTimeout(90_000);
  const { emp, t, C, D, nome, ent } = await cenario();
  const ch = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'DEVOLUCAO_MAQUINA', origem: parada(D, 'Rua Cliente, 2'), destino: parada(C, 'Rua da Loja, 1'), serieEsperada: null, observacao: '' } })).j;
  await pedir('POST', `/entregas/chamadas/${ch.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  await pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ent.token, corpo: { para: 'NA_COLETA', ...D, precisao: 5 } });
  await pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ent.token, corpo: { para: 'COLETADA', ...D, serie: 'POS-9988', foto: PNG } });

  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();

  await page.getByRole('tab', { name: 'Máquinas' }).click();
  await expect(page.getByRole('row', { name: /POS9988/ })).toContainText(nome);
  await page.screenshot({ path: 'test-results/maquinas.png' });

  await page.getByRole('tab', { name: 'Chamadas' }).click();
  await page.getByTestId('linha-chamada').first().click();
  await expect(page.getByTestId('fotos-chamada').getByRole('button', { name: 'Foto da coleta' })).toBeVisible();
  await expect(page.getByText(`Cancelando agora, ${nome} recebe a taxa de deslocamento de R$ 6,00.`)).toBeVisible();
  await page.screenshot({ path: 'test-results/chamada-taxa.png' });
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Configuração' }).click();
  await expect(page.getByLabel('Na coleta')).toBeChecked();
  await expect(page.getByLabel('Taxa se cancelar após o aceite (R$)').first()).toHaveValue('4,00');

  // Página pública de nova senha (o link do e-mail), com um token de verdade.
  const token = randomUUID() + randomUUID();
  await sql(`INSERT INTO redefinicoes_senha_entregador (id, entregador_id, token_hash, expira_em) VALUES ($1, $2, $3, (now() at time zone 'utc') + interval '1 hour')`, [randomUUID(), ent.id, createHash('sha256').update(token).digest('hex')]);
  await page.goto(`/entregador/redefinir-senha#token=${token}`);
  await page.getByLabel('Nova senha', { exact: true }).fill('SenhaNova2026');
  await page.getByLabel('Repita a nova senha').fill('SenhaNova2026');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('status')).toContainText('Senha trocada');
  expect((await pedir('POST', '/entregador/login', { corpo: { login: ent.email, senha: 'SenhaNova2026' } })).j.token).toMatch(/^ent_/);
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE id = $1`, [ch.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
