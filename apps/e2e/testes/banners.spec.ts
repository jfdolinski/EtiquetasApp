import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { criarEmpresa, pedir, sql, SUPER, superToken, type EmpresaTeste } from './apoio';

// Um pixel: basta para a tela carregar uma imagem de verdade.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const HOJE = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

let tokenSuper: string;
let e: EmpresaTeste;

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
});

const nome = () => `Anunciante ${randomUUID().slice(0, 8)}`;

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('o servidor informa o horário da API e do banco, sem login', async () => {
  const r = await pedir('GET', '/health');
  expect(r.status).toBe(200);
  expect(r.j.banco).toBe('ok');
  const { api, banco, fusoSistema } = r.j.horarios;
  expect(Math.abs(new Date(api).getTime() - Date.now())).toBeLessThan(60_000);
  expect(Math.abs(new Date(banco).getTime() - new Date(api).getTime())).toBeLessThan(5000);
  expect(fusoSistema).toBeTruthy();
});

test('só o super-admin cadastra; todo usuário logado recebe os vigentes', async () => {
  const corpo = { anunciante: nome(), texto: 'Oferta', inicio: HOJE };
  expect((await pedir('POST', '/banners', { token: e.adminToken, corpo })).status).toBe(403);
  expect((await pedir('GET', '/banners', { token: e.adminToken })).status).toBe(403);
  expect((await pedir('GET', '/banners/vigentes')).status).toBe(401);
  const criado = await pedir('POST', '/banners', { token: tokenSuper, corpo });
  expect(criado.status).toBe(201);
  expect((await pedir('PATCH', `/banners/${criado.j.id}`, { token: e.adminToken, corpo: { texto: 'Invadido' } })).status).toBe(403);
  expect((await pedir('DELETE', `/banners/${criado.j.id}`, { token: e.adminToken })).status).toBe(403);
  const vigentes = await pedir('GET', '/banners/vigentes', { token: e.adminToken });
  const visto = vigentes.j.find((b: any) => b.id === criado.j.id);
  expect(visto).toBeTruthy();
  // O valor e o contato do anunciante não chegam às empresas.
  expect(visto.valorMensal).toBeUndefined();
  expect(visto.contato).toBeUndefined();
  await pedir('DELETE', `/banners/${criado.j.id}`, { token: tokenSuper });
});

test('recusa link que executa código, imagem SVG e banner vazio', async () => {
  const base = { anunciante: nome(), inicio: HOJE };
  const tenta = (extra: object) => pedir('POST', '/banners', { token: tokenSuper, corpo: { ...base, ...extra } });
  expect((await tenta({ texto: 'x', link: 'javascript:alert(1)' })).status).toBe(400);
  expect((await tenta({ imagem: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status).toBe(400);
  expect((await tenta({})).status).toBe(400);
  expect((await tenta({ texto: 'x', fim: '2020-01-01' })).status).toBe(400);
});

test('fora do período ou inativo não aparece', async () => {
  const cria = async (extra: object) => (await pedir('POST', '/banners', { token: tokenSuper, corpo: { anunciante: nome(), texto: 'x', inicio: HOJE, ...extra } })).j.id as string;
  const futuro = await cria({ inicio: '2099-01-01' });
  const passado = await cria({ inicio: '2020-01-01', fim: '2020-12-31' });
  const inativo = await cria({ ativo: false });
  const vigentes = (await pedir('GET', '/banners/vigentes', { token: e.adminToken })).j.map((b: any) => b.id);
  for (const id of [futuro, passado, inativo]) {
    expect(vigentes).not.toContain(id);
    await pedir('DELETE', `/banners/${id}`, { token: tokenSuper });
  }
});

test('conta exibição e clique de usuário, não os do super-admin', async () => {
  const id = (await pedir('POST', '/banners', { token: tokenSuper, corpo: { anunciante: nome(), texto: 'x', inicio: HOJE } })).j.id;
  expect((await pedir('POST', `/banners/${id}/exibicao`, { token: e.adminToken })).status).toBe(204);
  expect((await pedir('POST', `/banners/${id}/clique`, { token: e.adminToken })).status).toBe(204);
  await pedir('POST', `/banners/${id}/exibicao`, { token: tokenSuper });
  const [linha] = await sql<{ exibicoes: number; cliques: number }>('SELECT exibicoes, cliques FROM banners_publicitarios WHERE id = $1', [id]);
  expect(linha).toEqual({ exibicoes: 1, cliques: 1 });
  await pedir('DELETE', `/banners/${id}`, { token: tokenSuper });
});

test('a tela mostra o relógio e a propaganda, com link e sem botão de fechar', async ({ page }) => {
  const anunciante = nome();
  const { j } = await pedir('POST', '/banners', { token: tokenSuper, corpo: { anunciante, texto: 'Propaganda de teste', imagem: PNG, link: 'https://exemplo.com.br/oferta', inicio: HOJE } });
  await entrar(page, e.adminEmail, e.adminSenha);
  await expect(page.getByLabel('Data e hora do sistema')).toHaveText(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}:\d{2}$/);
  // Com outros banners no ar eles revezam: confere pelo cadastro deste.
  const espaco = page.getByRole('complementary', { name: 'Publicidade' });
  await expect(espaco).toBeVisible();
  await expect(espaco.getByRole('button')).toHaveCount(0);
  await expect(espaco.getByRole('link').first()).toHaveAttribute('rel', /sponsored/);
  await expect(page.getByRole('link', { name: 'Banners' })).toHaveCount(0);
  await pedir('DELETE', `/banners/${j.id}`, { token: tokenSuper });
});

test('o super-admin cadastra pela tela e vê os relógios na Saúde', async ({ page }) => {
  const anunciante = nome();
  await entrar(page, SUPER.email, SUPER.senha);
  await page.getByRole('link', { name: 'Banners' }).click();
  await page.getByRole('button', { name: 'Novo banner' }).click();
  await page.getByLabel('Anunciante', { exact: true }).fill(anunciante);
  await page.getByLabel('Texto').fill('Anuncie aqui');
  await page.getByLabel('Valor por mês (R$)').fill('150,50');
  await page.getByRole('button', { name: 'Salvar' }).click();
  const linha = page.getByRole('row').filter({ hasText: anunciante });
  await expect(linha).toContainText('150,50');
  await expect(linha).toContainText('No ar');

  await page.getByRole('link', { name: 'Saúde do sistema' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Banco de dados' })).toContainText('Certo');
  await expect(page.getByRole('row').filter({ hasText: 'Site' })).toContainText('Certo');

  await page.getByRole('link', { name: 'Banners' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: `Excluir ${anunciante}` }).click();
  await expect(page.getByRole('row').filter({ hasText: anunciante })).toHaveCount(0);
});
