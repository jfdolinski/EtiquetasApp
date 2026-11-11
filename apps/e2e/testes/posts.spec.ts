import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { criarEmpresa, montarListaDeHoje, pedir, sql, superToken, API, type EmpresaTeste } from './apoio';

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

test('catálogo: só com a chave da empresa; tira a provisória, marca a de IA e nunca devolve a chave', async () => {
  // Sem chave, nada vai ao catálogo.
  const antes = chavesRecebidas.length;
  expect((await pedir('GET', `/posts/catalogo/${EAN}`, { token: b.adminToken })).j).toMatchObject({ encontrado: false, aviso: expect.stringMatching(/chave do catálogo/) });
  expect((await pedir('GET', `/posts/catalogo-imagem?url=${encodeURIComponent(`${BASE}/files/real.png`)}`, { token: b.adminToken })).status).toBe(400);
  expect(chavesRecebidas.length).toBe(antes);

  const marca = { nome: 'Mercado A', corPrincipal: '#123456', corDestaque: '#abcdef', logoId: null };
  const salvo = await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: { ...marca, chaveCatalogo: 'chave-secreta-a' } });
  expect(salvo.status).toBe(200);
  expect(salvo.j.temChaveCatalogo).toBe(true);
  expect(JSON.stringify(salvo.j)).not.toContain('chave-secreta-a');
  const r = await pedir('GET', `/posts/catalogo/${EAN}`, { token: a.adminToken });
  expect(r.status).toBe(200);
  expect(r.j.imagens).toEqual([{ url: `${BASE}/files/ia.png`, ia: true }, { url: `${BASE}/files/real.png`, ia: false }]);
  expect(chavesRecebidas.at(-1)).toBe('chave-secreta-a');
  expect((await pedir('GET', '/posts/catalogo/000', { token: a.adminToken })).j).toMatchObject({ encontrado: false, aviso: null });

  // Salvar sem mandar a chave mantém; mandar vazia remove.
  expect((await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: marca })).j.temChaveCatalogo).toBe(true);
  expect((await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: { ...marca, chaveCatalogo: '' } })).j.temChaveCatalogo).toBe(false);
  // Os próximos testes usam o catálogo com as empresas A e B.
  expect((await pedir('PUT', '/posts/marca', { token: a.adminToken, corpo: { ...marca, chaveCatalogo: 'chave-secreta-a' } })).j.temChaveCatalogo).toBe(true);
  expect((await pedir('PUT', '/posts/marca', { token: b.adminToken, corpo: { ...marca, nome: 'Mercado B', chaveCatalogo: 'chave-secreta-b' } })).j.temChaveCatalogo).toBe(true);
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
  await expect(page.getByRole('textbox', { name: /^Nome do produto/ })).toHaveValue(`Produto ${EAN}`);
  await expect(page.getByLabel('Preço', { exact: true })).toHaveValue('R$ 4,99');
  // A foto real entra sozinha; a de IA fica escondida até pedirem.
  const real = page.locator(`[data-imagem="CATALOGO:${BASE}/files/real.png"]`);
  await expect(real).toHaveAttribute('aria-pressed', 'true');
  const ia = page.locator(`[data-imagem="CATALOGO:${BASE}/files/ia.png"]`);
  await expect(ia).toHaveCount(0);
  await page.getByLabel(/Mostrar 1 imagem/).check();
  await expect(ia).toBeVisible();

  await page.getByRole('tab', { name: 'Legenda' }).click();
  await page.getByRole('button', { name: 'Sugerir legenda' }).click();
  await expect(page.getByRole('textbox', { name: 'Legenda', exact: true })).toHaveValue(/R\$ 4,99/);
  await page.getByRole('tab', { name: 'Dados' }).click();

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

test('edição livre: arrastar, estilo, elementos novos, desfazer, e tudo volta ao reabrir', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 40[0-9]/.test(m.text())) erros.push(m.text());
  });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await montarListaDeHoje(b, { produtos: [REMEDIO] });
  await entrar(page, b);
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Criar post' }).click();
  await expect(page.getByText('marca este produto como medicamento')).toBeVisible();

  // Arrastar um elemento pela arte: o clique seleciona, o arraste muda a posição.
  const tela = page.locator('canvas').first();
  await expect(tela).toBeVisible();
  const caixa = (await tela.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2.5);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width / 2 + 60, caixa.y + caixa.height / 2.5 + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('group', { name: /^Propriedades: / })).toBeVisible();
  const voltar = page.getByRole('button', { name: 'Voltar ao modelo' }).first();
  await expect(voltar).toBeVisible();

  // Mudar o preço pelo painel: fonte nova, cor, efeitos.
  await page.getByRole('button', { name: 'Selecionar Preço', exact: true }).click();
  const painel = page.getByRole('group', { name: 'Propriedades: Preço' });
  await painel.getByRole('button', { name: 'Fonte do elemento' }).click();
  await page.getByLabel('Procurar fonte').fill('bung');
  await page.getByRole('option', { name: 'Bungee' }).click();
  await expect(painel.getByRole('button', { name: 'Fonte do elemento' })).toHaveText(/Bungee/);
  await painel.getByRole('textbox', { name: 'Texto', exact: true }).fill('R$ 1,99');
  await page.getByRole('tab', { name: 'Dados' }).click();
  await expect(page.getByLabel('Preço', { exact: true })).toHaveValue('R$ 1,99');

  // Elemento novo, com texto próprio, sumindo e voltando com desfazer/refazer.
  await page.getByRole('tab', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: 'Adicionar Texto' }).click();
  const novo = page.getByRole('group', { name: /^Propriedades: Texto: / });
  await novo.getByRole('textbox', { name: 'Texto', exact: true }).fill('Só amanhã');
  await page.getByRole('button', { name: 'Adicionar QR code' }).click();
  await page.getByRole('group', { name: 'Propriedades: QR code' }).getByRole('textbox', { name: /QR code/ }).fill('https://exemplo.com.br');
  await expect(page.getByRole('button', { name: 'Selecionar QR code' })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByRole('button', { name: 'Selecionar QR code' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refazer' }).click();
  await page.getByRole('button', { name: 'Refazer' }).click();
  await expect(page.getByRole('button', { name: 'Selecionar QR code' })).toBeVisible();

  // Aparência e todos os dados que aparecem na arte.
  await page.getByRole('tab', { name: 'Aparência' }).click();
  await page.getByRole('button', { name: /Vermelho oferta/ }).click();
  await page.getByLabel('Tipo de fundo').selectOption('degrade');
  await page.getByRole('tab', { name: 'Dados' }).click();
  await page.getByLabel('Variação').selectOption('LADO_A_LADO');
  await page.getByRole('textbox', { name: 'Chamada' }).fill('Compre agora');
  await page.getByLabel('Instagram').fill('@loja');
  await expect(page.getByRole('button', { name: 'Selecionar Chamada', exact: true })).toBeVisible();

  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar em JPG' }).click()]);
  expect(d.suggestedFilename()).toMatch(/\.jpg$/);

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByLabel('Variação')).toHaveValue('LADO_A_LADO');
  await expect(page.getByRole('textbox', { name: 'Chamada' })).toHaveValue('Compre agora');
  await expect(page.getByRole('button', { name: 'Selecionar QR code' })).toBeVisible();
  await page.getByRole('tab', { name: 'Aparência' }).click();
  await expect(page.getByLabel('Tipo de fundo')).toHaveValue('degrade');

  // Tirar da arte e trazer de volta pela lista de camadas.
  await page.getByRole('button', { name: 'Selecionar Chamada', exact: true }).click();
  await page.getByRole('button', { name: 'Tirar da arte' }).click();
  await expect(page.getByRole('button', { name: 'Mostrar Chamada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar Chamada', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ocultar Chamada', exact: true })).toBeVisible();

  await page.goto('/posts');
  await page.getByRole('button', { name: /^Duplicar / }).first().click();
  await expect(page.getByRole('heading', { name: 'Novo post', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Nome do post')).toHaveValue(/^Cópia de /);
  expect(erros).toEqual([]);
});

test('os três tamanhos saem de uma vez, cada um com sua medida', async ({ page }) => {
  await montarListaDeHoje(b, { produtos: [EAN] });
  await entrar(page, b);
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Criar post' }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
  const baixados: { nome: string; tamanho: { largura: number; altura: number } }[] = [];
  page.on('download', (d) => void d.path().then(async (p) => baixados.push({ nome: d.suggestedFilename(), tamanho: tamanhoPng(await readFile(p)) })));
  await page.getByRole('button', { name: 'Baixar os 3 tamanhos' }).click();
  await expect.poll(() => baixados.length, { timeout: 15_000 }).toBe(3);
  const porNome = Object.fromEntries(baixados.map((x) => [x.nome.match(/(quadrado|retrato|stories)\.png$/)![1], x.tamanho]));
  expect(porNome).toEqual({ quadrado: { largura: 1080, altura: 1080 }, retrato: { largura: 1080, altura: 1350 }, stories: { largura: 1080, altura: 1920 } });
});

test('modelo muda o rodapé padrão e no celular a arte encolhe junto', async ({ page }) => {
  await montarListaDeHoje(b, { produtos: [REMEDIO] });
  await entrar(page, b);
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Criar post' }).click();
  await page.getByLabel('Modelo').selectOption('AVISO');
  await expect(page.getByRole('textbox', { name: 'Rodapé' })).toHaveValue('');
  await page.getByLabel('Modelo').selectOption('PRODUTO');
  await expect(page.getByRole('textbox', { name: 'Rodapé' })).toHaveValue(/Ofertas válidas/);

  // No celular a arte encolhe junto: nada de rolar a página para o lado.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('template padrão: importa a imagem de fundo, vale para os novos posts e "só neste post" não vaza', async ({ page }) => {
  const c = await criarEmpresa(await superToken());
  await entrar(page, c);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.goto('/posts/novo');
  await page.getByRole('tab', { name: 'Aparência' }).click();
  await page.getByLabel('Enviar imagem própria para o fundo').setInputFiles({ name: 'fundo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('[data-imagem^="GALERIA:"][aria-pressed="true"]').first()).toBeVisible();
  await expect(page.getByLabel('Tipo de fundo')).toHaveValue('imagem');
  // O padrão é só deste post: nada é gravado como template sem pedir.
  await expect(page.getByLabel('Somente neste post')).toBeChecked();
  expect((await pedir('GET', '/posts/marca', { token: c.adminToken })).j.template).toBeNull();

  await page.getByLabel('Padrão para os novos posts').check();
  await page.getByRole('button', { name: 'Salvar como template padrão' }).click();
  await expect(page.getByText(/Template padrão salvo/)).toBeVisible();
  const template = (await pedir('GET', '/posts/marca', { token: c.adminToken })).j.template;
  expect(template.design.fundo.tipo).toBe('imagem');

  // Post novo nasce do template; mudar nele não mexe no padrão.
  await page.goto('/posts/novo');
  await page.getByRole('tab', { name: 'Aparência' }).click();
  await expect(page.getByLabel('Tipo de fundo')).toHaveValue('imagem');
  await page.getByRole('button', { name: /Vermelho oferta/ }).click();
  expect((await pedir('GET', '/posts/marca', { token: c.adminToken })).j.template.design.corPrincipal).toBeUndefined();

  // Começar sem ele, para um post diferente, e depois tirar o padrão.
  await page.getByRole('button', { name: 'Começar sem ele' }).click();
  await expect(page.getByLabel('Tipo de fundo')).toHaveValue('cor');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Remover padrão' }).click();
  await expect(page.getByText(/Template padrão removido/)).toBeVisible();
  await page.goto('/posts/novo');
  await page.getByRole('tab', { name: 'Aparência' }).click();
  await expect(page.getByLabel('Tipo de fundo')).toHaveValue('cor');
});

test('template só com a permissão, e o que está nele é conferido', async () => {
  const c = await criarEmpresa(await superToken());
  const bom = { modelo: 'AVISO', design: { corPrincipal: '#123456' }, ajustes: {} };
  expect((await pedir('PUT', '/posts/template', { corpo: bom })).status).toBe(401);
  expect((await pedir('PUT', '/posts/template', { token: c.adminToken, corpo: { ...bom, design: { corPrincipal: 'vermelho' } } })).status).toBe(400);
  expect((await pedir('PUT', '/posts/template', { token: c.adminToken, corpo: { ...bom, vinculos: { outro: { campo: 'a' } } } })).status).toBe(400);
  expect((await pedir('PUT', '/posts/template', { token: c.adminToken, corpo: bom })).status).toBe(200);
  // De outra empresa não se vê nem se apaga.
  const d = await criarEmpresa(await superToken());
  expect((await pedir('GET', '/posts/marca', { token: d.adminToken })).j.template).toBeNull();
  await pedir('DELETE', '/posts/template', { token: d.adminToken });
  expect((await pedir('GET', '/posts/marca', { token: c.adminToken })).j.template.design.corPrincipal).toBe('#123456');
});

test('galeria: post novo apaga o que ninguém usa, preserva o resto e cada post vê só as próprias', async ({ page }) => {
  const c = await criarEmpresa(await superToken());
  const envia = async (nome: string) => (await pedir('POST', '/posts/imagens', { token: c.adminToken, corpo: { nome, dados: DATA_PNG } })).j.id as string;
  const [usada, solta, recente, logo] = [await envia('usada.png'), await envia('solta.png'), await envia('recente.png'), await envia('logo.png')];
  await sql(`UPDATE imagens_post SET criado_em = now() - interval '2 hours' WHERE id = ANY($1::uuid[])`, [[usada, solta, logo]]);
  await pedir('PUT', '/posts/marca', { token: c.adminToken, corpo: { nome: 'C', corPrincipal: '#000000', corDestaque: '#ffffff', logoId: logo } });
  const aviso = (titulo: string, imagem: object | null) => ({ titulo, modelo: 'AVISO', formato: 'QUADRADO', conteudo: { titulo: 'x', texto: '', rodape: '', produtos: [], imagem }, legenda: '', ajustes: {} });
  const r = await pedir('POST', '/posts', { token: c.adminToken, corpo: aviso('Com imagem', { origem: 'GALERIA', id: usada }) });
  expect(r.status).toBe(201);
  const ids = (await pedir('GET', '/posts/imagens', { token: c.adminToken })).j.map((i: any) => i.id);
  expect(ids).toContain(usada);
  expect(ids).toContain(logo);
  expect(ids).toContain(recente);
  expect(ids).not.toContain(solta);
  // O post antigo segue com a imagem dele depois de outro post novo.
  await pedir('POST', '/posts', { token: c.adminToken, corpo: aviso('Sem imagem', null) });
  const arquivo = await fetch(`${API}/posts/imagens/${usada}/arquivo`, { headers: { authorization: `Bearer ${c.adminToken}` } });
  expect(arquivo.status).toBe(200);

  // No editor de um post novo, a galeria começa limpa: as de outros posts ficam recolhidas.
  await entrar(page, c);
  await page.goto('/posts/novo');
  await page.getByRole('tab', { name: 'Adicionar' }).click();
  await expect(page.getByText(/Imagens de outros posts \(\d+\)/)).toBeVisible();
  await expect(page.locator(`[data-imagem="GALERIA:${usada}"]`)).toBeHidden();
  await page.getByText(/Imagens de outros posts/).click();
  await expect(page.locator(`[data-imagem="GALERIA:${usada}"]`)).toBeVisible();
});

test('relacionamento: cada informação vem do campo escolhido, com formato, e fica salvo', async ({ page }) => {
  const c = await criarEmpresa(await superToken());
  const { itemIds } = await montarListaDeHoje(c, { produtos: [EAN] });
  await sql(`UPDATE itens_lista SET registro = $2 WHERE id = $1`, [itemIds[0], JSON.stringify({ ean: EAN, descricao: 'Nome padrão', nome_loja: 'Nome da loja', preco: '4.99', pv_promo: '3.5', antigo: '9', und: 'kg', vence: '2026-12-31' })]);
  await entrar(page, c);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.goto('/hoje');
  await page.getByRole('button', { name: 'Criar post' }).click();
  await expect(page.getByRole('textbox', { name: /^Nome do produto/ })).toHaveValue('Nome padrão');

  await page.getByLabel('Nome do produto vem de').selectOption('nome_loja');
  await expect(page.getByRole('textbox', { name: /^Nome do produto/ })).toHaveValue('Nome da loja');
  await page.getByLabel('Preço vem de').selectOption('pv_promo');
  await expect(page.getByLabel('Preço', { exact: true })).toHaveValue('R$ 3,50');
  await page.getByLabel('Preço anterior vem de').selectOption('antigo');
  await expect(page.getByLabel('Preço anterior', { exact: true })).toHaveValue('R$ 9,00');
  await page.getByLabel('Detalhe vem de').selectOption('vence');
  await page.getByLabel('Formato').last().selectOption('data');
  await expect(page.getByLabel('Detalhe', { exact: true })).toHaveValue('31/12/2026');
  // Tirar o relacionamento volta ao automático.
  await page.getByLabel('Nome do produto vem de').selectOption('');
  await expect(page.getByRole('textbox', { name: /^Nome do produto/ })).toHaveValue('Nome padrão');
  await page.getByLabel('Nome do produto vem de').selectOption('nome_loja');

  // Pelo elemento na arte: o mesmo relacionamento.
  await page.getByRole('button', { name: 'Selecionar Preço', exact: true }).click();
  const painel = page.getByRole('group', { name: 'Propriedades: Preço' });
  await expect(painel.getByLabel('Campo da consulta')).toHaveValue('pv_promo');

  // Elemento acrescentado também tira o valor de um campo, sem texto próprio.
  await page.getByRole('tab', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: 'Adicionar Texto' }).click();
  const novo = page.getByRole('group', { name: /^Propriedades: Texto: / });
  await novo.getByLabel('Campo da consulta').selectOption('und');
  await expect(page.getByRole('group', { name: 'Propriedades: Texto: kg' })).toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByLabel('Nome do produto vem de')).toHaveValue('nome_loja');
  await expect(page.getByLabel('Preço vem de')).toHaveValue('pv_promo');
  await expect(page.getByLabel('Preço', { exact: true })).toHaveValue('R$ 3,50');

  // Produto novo no mesmo post já vem pelo relacionamento: e correção à mão continua valendo.
  await page.getByLabel('Preço', { exact: true }).fill('R$ 1,00');
  await expect(page.getByLabel('Preço', { exact: true })).toHaveValue('R$ 1,00');
});

test('as cores da marca aparecem nos seletores', async ({ page }) => {
  await entrar(page, a);
  await page.goto('/posts');
  await page.getByRole('button', { name: 'Marca da empresa' }).click();
  const cor = page.getByLabel('Cor principal');
  await expect(cor).toBeVisible();
  expect((await cor.boundingBox())!.height).toBeGreaterThanOrEqual(36);
});
