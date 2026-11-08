import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, pedir, sql, SUPER, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let e: EmpresaTeste;

const RESOLUCAO = { largura: 1920, altura: 1080, escala: 1 };

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.92.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

/** Uma TV de mentira falando direto com a API, para as regras que não dependem da tela. */
async function pedido() {
  const r = await pedir('POST', '/tv/pedidos', { corpo: RESOLUCAO, ip: `10.95.${Math.floor(Math.random() * 250)}.1` });
  expect(r.status).toBe(201);
  return r.j as { codigo: string; segredo: string };
}

async function telaVinculada(empresa: EmpresaTeste, nome = 'TV da API') {
  const { codigo, segredo } = await pedido();
  const v = await pedir('POST', '/telas/vincular', { token: empresa.adminToken, corpo: { codigo, nome, novoPerfil: { nome: `Perfil ${nome} ${codigo}`, tipo: 'TV', largura: 1920, altura: 1080 } } });
  expect(v.status).toBe(201);
  const s = await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo } });
  expect(s.j.situacao).toBe('VINCULADA');
  return { id: v.j.id as string, token: s.j.token as string, segredo };
}

const aviso = (token: string) => pedir('POST', '/tv/aviso', { token, corpo: { ...RESOLUCAO, versao: '1' } });

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
});

test('o link único mostra o QR sem login, e o site define qual tela ela é', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.92.1.1' });
  await page.goto('/tv');
  await expect(page.getByRole('heading', { name: 'Vincular esta tela' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code' })).toBeVisible();
  await expect(page.getByText('Esta tela informa 1280×720')).toBeVisible();
  const codigo = (await page.getByLabel('Código da tela').textContent())!;
  expect(codigo).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await page.screenshot({ path: 'test-results/tv-qr.png' });

  // O link do QR, aberto no computador de quem cuida das telas.
  const adm = await context.newPage();
  await entrar(adm, e.adminEmail, e.adminSenha);
  await adm.goto(`/telas/vincular#codigo=${codigo.replace('-', '')}`);
  await expect(adm.getByText(`Tela ${codigo}: informa 1280×720`)).toBeVisible();
  await adm.getByLabel('Nome da tela').fill('TV do açougue');
  await adm.getByLabel('Local').fill('Loja centro');
  await expect(adm.getByLabel('Largura (pixels)')).toHaveValue('1280');
  await adm.getByRole('button', { name: 'Vincular tela' }).click();
  await expect(adm.getByText('TV do açougue')).toBeVisible();
  await expect(adm.locator('tbody').getByText('Online', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Em alguns segundos o QR some, e a TV lembra do vínculo ao religar.
  await expect(page.getByRole('heading', { name: 'TV do açougue' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('img', { name: 'QR code' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'TV do açougue' })).toBeVisible();

  // Identificar aparece no próximo aviso.
  await adm.getByRole('button', { name: 'Identificar' }).click();
  await page.reload();
  await expect(page.getByText('Loja centro')).toBeVisible();
  await expect(page.locator('.bg-blue-700')).toBeVisible();

  // Desvincular derruba a TV de volta ao QR.
  adm.on('dialog', (d) => void d.accept());
  await adm.getByRole('button', { name: 'Desvincular' }).click();
  await expect(adm.locator('tbody').getByText('Sem equipamento', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vincular esta tela' })).toBeVisible();
  await adm.close();
});

test('painel de LED pequeno mostra só o código, sem QR', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 96 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.92.1.2' });
  await page.goto('/tv');
  await expect(page.getByLabel('Código da tela')).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/tv-led.png' });
});

test('a foto do QR não dá acesso: o token só sai com o segredo, uma vez', async () => {
  const { codigo, segredo } = await pedido();
  expect((await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo } })).j.situacao).toBe('AGUARDANDO');
  expect((await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo: codigo.padEnd(30, 'x') } })).j.situacao).toBe('VENCIDO');
  const v = await pedir('POST', '/telas/vincular', { token: e.adminToken, corpo: { codigo, nome: 'Uma vez', novoPerfil: { nome: `Único ${codigo}`, tipo: 'TV', largura: 1920, altura: 1080 } } });
  expect(v.status).toBe(201);
  const primeira = await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo } });
  expect(primeira.j.token).toMatch(/^tv_/);
  expect((await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo } })).j.situacao).toBe('VENCIDO');
  // O mesmo QR não vincula outra tela.
  const repetido = await pedir('POST', '/telas/vincular', { token: e.adminToken, corpo: { codigo, nome: 'Outra', perfilId: undefined } });
  expect(repetido.status).toBe(404);
});

test('pedido vencido pede outro QR, e o token da tela só serve para o aviso', async () => {
  const { codigo, segredo } = await pedido();
  await sql(`UPDATE pedidos_vinculo_tela SET expira_em = (now() at time zone 'utc') - interval '1 minute' WHERE segredo_hash = encode(sha256($1::bytea), 'hex')`, [segredo]);
  expect((await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo } })).j.situacao).toBe('VENCIDO');
  expect((await pedir('GET', `/telas/pedidos/${codigo}`, { token: e.adminToken })).status).toBe(404);

  const { token } = await telaVinculada(e, 'Só aviso');
  expect((await aviso(token)).status).toBe(200);
  expect((await pedir('GET', '/telas', { token })).status).toBe(401);
  expect((await pedir('GET', '/listas/hoje', { token })).status).toBe(401);
  expect((await pedir('POST', '/tv/aviso', { token: 'tv_inventado', corpo: RESOLUCAO })).status).toBe(401);
});

test('substituir: o equipamento novo herda a tela e o antigo perde o acesso', async () => {
  const antiga = await telaVinculada(e, 'Tela substituída');
  const { codigo, segredo } = await pedido();
  const v = await pedir('POST', '/telas/vincular', { token: e.adminToken, corpo: { codigo, telaId: antiga.id } });
  expect(v.j.id).toBe(antiga.id);
  const nova = await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo } });
  expect((await aviso(antiga.token)).status).toBe(401);
  const r = await aviso(nova.j.token);
  expect(r.status).toBe(200);
  expect(r.j.tela.nome).toBe('Tela substituída');
});

test('situação: offline pelo tempo, fora do horário sem alarme, e a queda fica registrada', async () => {
  const { id, token } = await telaVinculada(e, 'Tela monitorada');
  const situacao = async () => (await pedir('GET', '/telas', { token: e.adminToken })).j.find((t: { id: string }) => t.id === id);
  expect((await situacao()).situacao).toBe('ONLINE');

  await sql(`UPDATE telas SET ultimo_contato_em = (now() at time zone 'utc') - interval '3 minutes' WHERE id = $1`, [id]);
  expect((await situacao()).situacao).toBe('INSTAVEL');
  await sql(`UPDATE telas SET ultimo_contato_em = (now() at time zone 'utc') - interval '20 minutes' WHERE id = $1`, [id]);
  expect((await situacao()).situacao).toBe('OFFLINE');

  await aviso(token);
  const voltou = await situacao();
  expect(voltou.situacao).toBe('ONLINE');
  expect(voltou.quedas30Dias).toBe(1);
  expect((await pedir('GET', `/telas/${id}/quedas`, { token: e.adminToken })).j).toHaveLength(1);

  // Um horário que nunca inclui agora: de um minuto à frente do relógio até o seguinte seria frágil, então usa o oposto do dia.
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
  const inicio = `${String((Number(hora) + 2) % 24).padStart(2, '0')}:00`;
  const fim = `${String((Number(hora) + 3) % 24).padStart(2, '0')}:00`;
  expect((await pedir('PATCH', `/telas/${id}`, { token: e.adminToken, corpo: { horarioInicio: inicio, horarioFim: fim } })).status).toBe(200);
  await sql(`UPDATE telas SET ultimo_contato_em = (now() at time zone 'utc') - interval '20 minutes' WHERE id = $1`, [id]);
  expect((await situacao()).situacao).toBe('FORA_DO_HORARIO');
});

test('as telas e os perfis são de cada empresa', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const { id } = await telaVinculada(e, 'Tela isolada');
  expect((await pedir('GET', '/telas', { token: outra.adminToken })).j).toEqual([]);
  expect((await pedir('PATCH', `/telas/${id}`, { token: outra.adminToken, corpo: { nome: 'Invadida' } })).status).toBe(404);
  expect((await pedir('POST', `/telas/${id}/comando`, { token: outra.adminToken, corpo: { comando: 'RECARREGAR' } })).status).toBe(404);
  expect((await pedir('POST', `/telas/${id}/desvincular`, { token: outra.adminToken })).status).toBe(404);
  const { codigo } = await pedido();
  expect((await pedir('POST', '/telas/vincular', { token: outra.adminToken, corpo: { codigo, telaId: id } })).status).toBe(404);
});

test('perfil em uso não pode ser excluído', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const { codigo } = await pedido();
  await pedir('POST', '/telas/vincular', { token: outra.adminToken, corpo: { codigo, nome: 'Com perfil', novoPerfil: { nome: 'Em uso', tipo: 'LED', largura: 960, altura: 320 } } });
  const [perfil] = (await pedir('GET', '/telas/perfis', { token: outra.adminToken })).j;
  expect(perfil.telas).toBe(1);
  expect((await pedir('DELETE', `/telas/perfis/${perfil.id}`, { token: outra.adminToken })).status).toBe(409);
  expect((await pedir('POST', '/telas/perfis', { token: outra.adminToken, corpo: { nome: 'Em uso', tipo: 'TV', largura: 100, altura: 100 } })).status).toBe(409);
  expect((await pedir('POST', '/telas/perfis', { token: outra.adminToken, corpo: { nome: 'Pequeno', tipo: 'LED', largura: 4, altura: 100 } })).status).toBe(400);
});

test('parâmetros: o padrão é do administrador geral, e a empresa só muda o que é dela', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const ler = async () => (await pedir('GET', '/telas/parametros', { token: outra.adminToken })).j;
  expect((await ler()).vigentes.aprovacaoObrigatoria).toBe(false);
  expect((await ler()).global).toBeNull();

  expect((await pedir('PUT', '/telas/parametros/empresa', { token: outra.adminToken, corpo: { valores: { aprovacaoObrigatoria: true } } })).status).toBe(200);
  expect((await ler()).vigentes.aprovacaoObrigatoria).toBe(true);

  expect((await pedir('PUT', '/telas/parametros/empresa', { token: outra.adminToken, corpo: { valores: { fatiaAnunciosPct: 0 } } })).status).toBe(403);
  expect((await pedir('PUT', '/telas/parametros/empresa', { token: outra.adminToken, corpo: { valores: { anunciosLigados: false } } })).status).toBe(403);
  expect((await pedir('PUT', '/telas/parametros/global', { token: outra.adminToken, corpo: { valores: { fatiaAnunciosPct: 20 } } })).status).toBe(403);

  // O administrador geral sobrescreve por empresa, e aí a empresa pode recusar anúncios.
  const s = await pedir('PUT', '/telas/parametros/empresa', { token: tokenSuper, empresa: outra.id, corpo: { valores: { fatiaAnunciosPct: 5, empresaPodeRecusarAnuncios: true } } });
  expect(s.j.vigentes.fatiaAnunciosPct).toBe(5);
  expect(s.j.global).not.toBeNull();
  expect((await pedir('PUT', '/telas/parametros/empresa', { token: outra.adminToken, corpo: { valores: { anunciosLigados: false } } })).status).toBe(200);
  expect((await ler()).vigentes.anunciosLigados).toBe(false);

  expect((await pedir('PUT', '/telas/parametros/empresa', { token: tokenSuper, empresa: outra.id, corpo: { valores: { fatiaAnunciosPct: 90 } } })).status).toBe(400);
  expect((await pedir('PUT', '/telas/parametros/empresa', { token: tokenSuper, empresa: outra.id, corpo: { valores: { minutosOnline: 10, minutosOffline: 5 } } })).status).toBe(400);
  expect((await pedir('PUT', '/telas/parametros/empresa', { token: tokenSuper, empresa: outra.id, corpo: { valores: { fatiaAnunciosPct: null } } })).j.vigentes.fatiaAnunciosPct).toBe(10);
});

test('a tela Telas abre as três abas, e o administrador geral vê o padrão da plataforma', async ({ page }) => {
  await entrar(page, SUPER.email, SUPER.senha);
  await page.evaluate((id) => localStorage.setItem('etiquetas.empresaSelecionada', id), e.id);
  await page.goto('/telas');
  await expect(page.getByRole('heading', { name: 'Telas', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Perfis de resolução' }).click();
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  await page.getByLabel('Partir de um modelo').selectOption('Faixa de LED');
  await expect(page.getByLabel('Largura (pixels)')).toHaveValue('960');
  await expect(page.getByText('Formato: Faixa larga')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('tab', { name: 'Parâmetros' }).click();
  await expect(page.getByRole('heading', { name: 'Padrão da plataforma' })).toBeVisible();
  await page.screenshot({ path: 'test-results/telas-parametros.png', fullPage: true });
});

test('o link do QR aberto sem login leva ao login e depois ao formulário', async ({ page }) => {
  const { codigo } = await pedido();
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.92.1.3' });
  await page.goto(`/telas/vincular#codigo=${codigo}`);
  await page.getByLabel('E-mail').fill(e.adminEmail);
  await page.getByLabel('Senha').fill(e.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByLabel('Nome da tela')).toBeVisible();
});
