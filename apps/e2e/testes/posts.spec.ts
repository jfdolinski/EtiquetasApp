import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { criarEmpresa, montarListaDeHoje, pedir, superToken, API, type EmpresaTeste } from './apoio';

const PORTA = 8097;
const BASE = `http://localhost:${PORTA}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const DATA_PNG = `data:image/png;base64,${PNG.toString('base64')}`;
const EAN = '7891000100103';
const REMEDIO = '7891000100110';

let catalogo: Server;
const chavesRecebidas: (string | undefined)[] = [];
let a: EmpresaTeste;
let b: EmpresaTeste;

test.beforeAll(async () => {
  catalogo = createServer((req, res) => {
    chavesRecebidas.push(req.headers['x-api-key'] as string | undefined);
    const url = req.url ?? '';
    const json = (corpo: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (url.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    if (url === `/api/v1/barcodes/${EAN}`) {
      return json({ name: 'Do catálogo', is_medicine: false, images: [{ url: `${BASE}/files/provisoria.png`, placeholder: true }, { url: `${BASE}/files/ia.png`, ai_generated: true }, { url: `${BASE}/files/real.png` }] });
    }
    if (url === `/api/v1/barcodes/${REMEDIO}`) return json({ name: 'Remédio', is_medicine: true, images: [{ url: `${BASE}/files/remedio.png` }] });
    return json({ error: 'não encontrado' }, 404);
  });
  await new Promise<void>((r) => catalogo.listen(PORTA, r));
  const token = await superToken();
  a = await criarEmpresa(token);
  b = await criarEmpresa(token);
});

test.afterAll(async () => {
  await new Promise((r) => catalogo.close(r));
});

async function entrar(page: Page, e: EmpresaTeste) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.81.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(e.adminEmail);
  await page.getByLabel('Senha').fill(e.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

/** Largura e altura de um PNG, direto do cabeçalho do arquivo. */
function tamanhoPng(b: Buffer) {
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

test('catálogo: tira a provisória, marca a de IA e usa a chave da empresa, sem nunca devolvê-la', async () => {
  const r = await pedir('GET', `/posts/catalogo/${EAN}`, { token: a.adminToken });
  expect(r.status).toBe(200);
  expect(r.j.imagens).toEqual([{ url: `${BASE}/files/ia.png`, ia: true }, { url: `${BASE}/files/real.png`, ia: false }]);
  expect((await pedir('GET', '/posts/catalogo/000', { token: a.adminToken })).j).toMatchObject({ encontrado: false, aviso: null });

  const marca = { nome: 'Mercado A', corPrincipal: '#123456', corDestaque: '#abcdef', logoId: null };
  const salvo = await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: { ...marca, chaveCatalogo: 'chave-secreta-a' } });
  expect(salvo.status).toBe(200);
  expect(salvo.j.temChaveCatalogo).toBe(true);
  expect(JSON.stringify(salvo.j)).not.toContain('chave-secreta-a');
  await pedir('GET', `/posts/catalogo/${EAN}`, { token: a.adminToken });
  expect(chavesRecebidas.at(-1)).toBe('chave-secreta-a');
  await pedir('GET', `/posts/catalogo/${EAN}`, { token: b.adminToken });
  expect(chavesRecebidas.at(-1)).toBeUndefined();

  // Salvar sem mandar a chave mantém; mandar vazia remove.
  expect((await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: marca })).j.temChaveCatalogo).toBe(true);
  expect((await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: { ...marca, chaveCatalogo: '' } })).j.temChaveCatalogo).toBe(false);
});

test('o caminho até a imagem do catálogo só serve para o catálogo', async () => {
  const baixar = (url: string) => pedir('GET', `/posts/catalogo-imagem?url=${encodeURIComponent(url)}`, { token: a.adminToken });
  expect((await baixar('http://localhost:3000/api/health')).status).toBe(400);
  expect((await baixar(`${BASE}/api/v1/catalog.json`)).status).toBe(400);
  const certa = await fetch(`${API}/posts/catalogo-imagem?url=${encodeURIComponent(`${BASE}/files/real.png`)}`, { headers: { authorization: `Bearer ${a.adminToken}` } });
  expect(certa.status).toBe(200);
  expect(certa.headers.get('content-type')).toContain('image/png');
  expect((await pedir('GET', `/posts/catalogo-imagem?url=${encodeURIComponent(`${BASE}/files/real.png`)}`)).status).toBe(401);
});

test('galeria e posts são de cada empresa', async () => {
  const img = await pedir('POST', '/posts/imagens', { token: a.adminToken, corpo: { nome: 'a.png', dados: DATA_PNG } });
  expect(img.status).toBe(201);
  const arquivo = (token: string) => fetch(`${API}/posts/imagens/${img.j.id}/arquivo`, { headers: { authorization: `Bearer ${token}` } });
  expect((await arquivo(a.adminToken)).status).toBe(200);
  expect((await arquivo(b.adminToken)).status).toBe(404);
  expect((await pedir('DELETE', `/posts/imagens/${img.j.id}`, { token: b.adminToken })).status).toBe(404);
  const logo = await pedir('PUT', '/posts/marca', { token: b.adminToken, corpo: { nome: 'B', corPrincipal: '#000000', corDestaque: '#ffffff', logoId: img.j.id } });
  expect(logo.status).toBe(400);

  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
  expect((await pedir('POST', '/posts/imagens', { token: a.adminToken, corpo: { nome: 'a.svg', dados: svg } })).status).toBe(400);

  const corpo = { titulo: 'Aviso', modelo: 'AVISO', formato: 'QUADRADO', conteudo: { titulo: 'Horário de fim de ano', texto: 'Abriremos até as 18 h.', rodape: '', produtos: [], imagem: null }, legenda: '', ajustes: {} };
  const post = await pedir('POST', '/posts', { token: a.adminToken, corpo });
  expect(post.status).toBe(201);
  expect((await pedir('GET', `/posts/${post.j.id}`, { token: b.adminToken })).status).toBe(404);
  expect((await pedir('PATCH', `/posts/${post.j.id}`, { token: b.adminToken, corpo })).status).toBe(404);
  expect((await pedir('DELETE', `/posts/${post.j.id}`, { token: b.adminToken })).status).toBe(404);
  expect((await pedir('GET', '/posts', { token: b.adminToken })).j.map((p: any) => p.id)).not.toContain(post.j.id);
  expect((await pedir('POST', '/posts', { token: a.adminToken, corpo: { ...corpo, modelo: 'OFERTA' } })).status).toBe(400);
  expect((await pedir('GET', '/posts')).status).toBe(401);
});

test('da Lista do dia ao PNG: dados do ERP, foto real do catálogo e tamanho certo', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 40[0-9]/.test(m.text())) erros.push(m.text());
  });
  await montarListaDeHoje(a, { produtos: [EAN] });
  await entrar(page, a);
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Criar post' }).click();

  await expect(page.getByRole('heading', { name: 'Novo post', level: 1 })).toBeVisible();
  // Nome e preço do ERP, não do catálogo.
  await expect(page.getByLabel('Nome do produto')).toHaveValue(`Produto ${EAN}`);
  await expect(page.getByLabel('Preço')).toHaveValue('R$ 4,99');
  // A foto real entra sozinha; a de IA fica escondida até pedirem.
  const real = page.locator(`[data-imagem="CATALOGO:${BASE}/files/real.png"]`);
  await expect(real).toHaveAttribute('aria-pressed', 'true');
  const ia = page.locator(`[data-imagem="CATALOGO:${BASE}/files/ia.png"]`);
  await expect(ia).toHaveCount(0);
  await page.getByLabel(/Mostrar 1 imagem/).check();
  await expect(ia).toBeVisible();

  await page.getByRole('button', { name: 'Sugerir legenda' }).click();
  await expect(page.getByLabel('Legenda')).toHaveValue(/R\$ 4,99/);

  const baixar = async () => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar imagem' }).click()]);
    expect(d.suggestedFilename()).toMatch(/\.png$/);
    return tamanhoPng(await readFile(await d.path()));
  };
  expect(await baixar()).toEqual({ largura: 1080, altura: 1080 });
  await page.getByRole('button', { name: 'Stories e status' }).click();
  expect(await baixar()).toEqual({ largura: 1080, altura: 1920 });

  // Imagem própria: vai para a galeria e fica marcada.
  await page.getByLabel(/Enviar imagem própria/).setInputFiles({ name: 'minha.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('[data-imagem^="GALERIA:"][aria-pressed="true"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Editar post', level: 1 })).toBeVisible();
  // Reaberto, segue com a imagem própria: não volta para a do catálogo.
  await expect(page.locator('[data-imagem^="GALERIA:"][aria-pressed="true"]').first()).toBeVisible();
  await expect(real).toHaveAttribute('aria-pressed', 'false');

  await page.goto('/posts');
  await expect(page.getByRole('link', { name: `Produto ${EAN}` })).toBeVisible();
  expect(erros).toEqual([]);
});

test('edição livre move o elemento e o preço de um medicamento traz o aviso', async ({ page }) => {
  await montarListaDeHoje(b, { produtos: [REMEDIO] });
  await entrar(page, b);
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Criar post' }).click();
  await expect(page.getByText('marca este produto como medicamento')).toBeVisible();

  await page.getByLabel('Edição livre').check();
  await expect(page.getByRole('button', { name: 'Voltar ao modelo' })).toHaveCount(0);
  const tela = page.locator('canvas').first();
  await expect(tela).toBeVisible();
  const caixa = (await tela.boundingBox())!;
  // O centro da arte é a imagem do produto.
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2.5);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width / 2 + 40, caixa.y + caixa.height / 2.5 + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Voltar ao modelo' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao modelo' }).click();
  await expect(page.getByRole('button', { name: 'Voltar ao modelo' })).toHaveCount(0);

  await page.getByLabel('Modelo').selectOption('AVISO');
  await expect(page.getByLabel('Rodapé')).toHaveValue('');
  await page.getByLabel('Modelo').selectOption('PRODUTO');
  await expect(page.getByLabel('Rodapé')).toHaveValue(/Ofertas válidas/);

  // No celular a arte encolhe junto: nada de rolar a página para o lado.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('as cores da marca aparecem nos seletores', async ({ page }) => {
  await entrar(page, a);
  await page.goto('/posts');
  await page.getByRole('button', { name: 'Marca da empresa' }).click();
  const cor = page.getByLabel('Cor principal');
  await expect(cor).toBeVisible();
  expect((await cor.boundingBox())!.height).toBeGreaterThanOrEqual(36);
});
