import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { API, criarEmpresa, login, pedir, sql, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let e: EmpresaTeste;

const RESOLUCAO = { largura: 1280, altura: 720, escala: 1 };
const COLUNAS = ['ean', 'descricao', 'preco', 'preco_de'];
const CONFIG = { titulo: 'Ofertas da semana', rodape: 'Enquanto durarem os estoques', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: 'preco_de', colunaDetalhe: null, segundosPorCena: 5, corFundo: '#0f172a', corDestaque: '#facc15' };
const ITENS = [
  { nome: 'Arroz Tipo 1 5kg', preco: 'R$ 24,90', precoDe: 'R$ 29,90' },
  { nome: 'Feijão Carioca 1kg', preco: 'R$ 8,49' },
];

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.93.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

async function telaVinculada(empresa: EmpresaTeste, nome: string, nivelAnimacao = 'COMPLETO') {
  const p = await pedir('POST', '/tv/pedidos', { corpo: RESOLUCAO, ip: `10.94.${Math.floor(Math.random() * 250)}.1` });
  const v = await pedir('POST', '/telas/vincular', { token: empresa.adminToken, corpo: { codigo: p.j.codigo, nome, novoPerfil: { nome: `Perfil ${nome} ${p.j.codigo}`, tipo: 'TV', largura: 1280, altura: 720, nivelAnimacao } } });
  expect(v.status).toBe(201);
  const s = await pedir('POST', '/tv/pedidos/situacao', { corpo: { segredo: p.j.segredo } });
  return { id: v.j.id as string, token: s.j.token as string };
}

/** Sem agente: a consulta só dá nome às colunas, e os dados entram direto no banco. */
async function criarConsulta(empresa: EmpresaTeste, sqlTexto = 'SELECT 1') {
  const conexao = randomUUID();
  const consulta = randomUUID();
  await sql(`INSERT INTO conexoes_banco (id, empresa_id, nome, tipo, host, porta, banco, usuario, atualizado_em) VALUES ($1, $2, $3, 'POSTGRES', 'localhost', 5432, 'erp', 'leitor', now())`, [conexao, empresa.id, `Conexão ${conexao.slice(0, 6)}`]);
  await sql(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, finalidade, sql, campos, atualizado_em) VALUES ($1, $2, $3, $4, 'OUTRA', $5, $6, now())`, [consulta, empresa.id, conexao, `Consulta ${consulta.slice(0, 6)}`, sqlTexto, JSON.stringify(COLUNAS.map((nome) => ({ nome })))]);
  return consulta;
}

const corpoConteudo = (nome: string, consultaId: string, extra: Record<string, unknown> = {}) => ({ nome, modelo: 'GRADE_OFERTAS', consultaId, config: CONFIG, intervaloMinutos: 15, validadeMinutos: 60, ...extra });

const gravarDados = (id: string, minutosAtras = 0) => sql(`UPDATE conteudos_tela SET itens = $2, quantidade_itens = $3, dados_em = (now() at time zone 'utc') - make_interval(mins => $4::int), erro = NULL WHERE id = $1`, [id, JSON.stringify(ITENS), ITENS.length, minutosAtras]);

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
});

test('cria no site, vê a pré-visualização e publica; sem dados, a tela diz por quê', async ({ page }) => {
  await telaVinculada(e, 'TV da entrada');
  const consulta = await criarConsulta(e);
  const [{ nome: nomeConsulta }] = await sql(`SELECT nome FROM consultas_sql WHERE id = $1`, [consulta]);

  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await page.getByRole('button', { name: 'Novo conteúdo' }).click();
  await page.getByLabel('Nome do conteúdo').fill('Ofertas do site');
  await page.getByText('Lista de preços', { exact: true }).click();
  await page.getByRole('combobox', { name: /^Consulta/ }).selectOption({ label: nomeConsulta });
  // As colunas conhecidas vêm sugeridas.
  await expect(page.getByLabel('Coluna do nome')).toHaveValue('descricao');
  await expect(page.getByLabel('Coluna do preço')).toHaveValue('preco');
  await expect(page.getByLabel('Preço anterior (opcional)')).toHaveValue('preco_de');

  await expect(page.getByText('Dados de exemplo. Eles nunca vão para a tela.')).toBeVisible();
  const previa = page.getByLabel('Pré-visualização da tela');
  await expect(previa.getByText('Produto de exemplo com nome comprido')).toBeVisible();
  await page.screenshot({ path: 'test-results/tela-editor.png' });

  // A validade curta demais é barrada antes de mandar.
  await page.getByLabel('Validade dos dados (minutos)').fill('20');
  await expect(page.getByText(/pelo menos duas atualizações/)).toBeVisible();
  await page.getByLabel('Validade dos dados (minutos)').fill('120');

  await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /TV da entrada/ }).check();
  await page.getByRole('button', { name: 'Publicar' }).click();
  // Sem agente, a publicação fica feita, e quem publicou sabe que ainda não está na tela.
  await expect(page.getByText(/Publicado, mas ainda não está na tela/)).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Fechar' }).click();
  const linha = page.getByRole('row', { name: /Ofertas do site/ });
  await expect(linha.getByText('Sem dados')).toBeVisible();
});

test('a TV exibe o conteúdo e tira do ar quando os dados vencem', async ({ page }) => {
  const tela = await telaVinculada(e, 'TV do corredor');
  const consultaId = await criarConsulta(e);
  const c = await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo('Grade da TV', consultaId) });
  expect(c.status).toBe(201);
  const pub = await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: e.adminToken, corpo: { telaIds: [tela.id] } });
  expect(pub.status).toBe(200);
  await gravarDados(c.j.id);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
  await page.clock.install();
  const erros: string[] = [];
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  await page.goto('/tv');

  const cena = page.getByTestId('cena-tela');
  await expect(cena.getByText('Arroz Tipo 1 5kg')).toBeVisible();
  await expect(cena.getByText('R$ 24,90')).toBeVisible();
  await expect(cena.getByText('de R$ 29,90')).toBeVisible();
  await expect(cena.getByText('Ofertas da semana')).toBeVisible();
  await expect(cena.getByText('Enquanto durarem os estoques')).toBeVisible();
  await page.clock.runFor(2000);
  await page.screenshot({ path: 'test-results/tela-grade.png' });

  // Passou da validade (60 min) sem falar com o servidor: nenhum preço fica na tela.
  await page.route('**/api/tv/**', (r) => r.abort());
  await page.clock.fastForward('01:01:00');
  await page.clock.runFor(16_000);
  await expect(cena).toHaveCount(0);
  await page.unroute('**/api/tv/**');
  expect(erros.filter((t) => !/net::ERR_FAILED|Failed to load resource/.test(t))).toEqual([]);
});

test('a animação escolhida aparece, e o automático não fica preso no leve por causa do carregamento', async ({ page }) => {
  const tela = await telaVinculada(e, 'TV animada', 'AUTOMATICO');
  const consultaId = await criarConsulta(e);
  expect((await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo('Animação errada', consultaId, { config: { ...CONFIG, animacaoEntrada: 'DANCAR' } }) })).status).toBe(400);
  const c = await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo('Grade animada', consultaId, { config: { ...CONFIG, segundosPorCena: 3, animacaoEntrada: 'QUICAR', animacaoPreco: 'BRILHAR' } }) });
  expect(c.status).toBe(201);
  expect((await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: e.adminToken, corpo: { telaIds: [tela.id] } })).status).toBe(200);
  await gravarDados(c.j.id);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
  await page.goto('/tv');
  const animacoes = () =>
    page.evaluate(() => ({
      cena: getComputedStyle(document.querySelector('[data-testid="cena-tela"]')!).animationName,
      celula: getComputedStyle(document.querySelector('[data-testid="celula-tela"]')!).animationName,
      preco: getComputedStyle(document.querySelector('[data-testid="celula-tela"] [data-testid="preco-tela"]')!).animationName,
    }));
  await expect(page.getByTestId('cena-tela').getByText('Arroz Tipo 1 5kg')).toBeVisible();
  // Antes de medir: leve, a cena inteira entra com a animação escolhida, e o preço fica parado.
  expect(await animacoes()).toEqual({ cena: 'tvQuica', celula: 'none', preco: 'none' });
  // Medido depois de a página assentar, o navegador folgado ganha a animação completa.
  await expect.poll(animacoes, { timeout: 15_000 }).toEqual({ cena: 'tvSurge', celula: 'tvQuica', preco: 'tvBrilho' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/tela-animacao-quicar.png' });
});

/** Uma foto de verdade, para o olho conferir o encaixe: mais alta que larga, como a maioria das embalagens. */
function fotoDeProduto(page: Page, cor: string) {
  return page.evaluate((c) => {
    const t = document.createElement('canvas');
    t.width = 400;
    t.height = 600;
    const g = t.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 400, 600);
    g.fillStyle = c;
    g.fillRect(60, 40, 280, 520);
    return t.toDataURL('image/png').split(',')[1];
  }, cor);
}

/**
 * Um agente de verdade para a API, ativado e conectado pelo protocolo, mas que responde às consultas com
 * linhas prontas: neste computador de desenvolvimento roda o agente de produção, e nada de banco é preciso aqui.
 */
async function agenteSimulado(empresa: EmpresaTeste, linhas: unknown[][]) {
  const agente = await pedir('POST', '/agentes', { token: empresa.adminToken, corpo: { nome: `Agente ${randomUUID().slice(0, 6)}` } });
  expect(agente.status).toBe(201);
  const agenteId = agente.j.agente.id as string;
  const ativado = await pedir('POST', '/agente/ativar', { corpo: { cnpj: agente.j.cnpj, codigo: agente.j.codigo, hostname: 'E2E' }, ip: '10.95.' + Math.floor(Math.random() * 250) + '.1' });
  expect(ativado.status).toBe(200);
  const Conector = WebSocket as unknown as new (url: string, opcoes: { headers: Record<string, string> }) => WebSocket;
  const ws = new Conector(`${API.replace(/^http/, 'ws')}/agente/conectar`, { headers: { authorization: `Bearer ${ativado.j.token}` } });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data)) as { tipo: string; id?: string };
    if (m.tipo !== 'consultar' || !m.id) return;
    ws.send(JSON.stringify({ tipo: 'resposta', id: m.id, dados: { ok: true, resultado: { colunas: COLUNAS.map((nome) => ({ nome, tipo: 'text' })), linhas, truncado: false, duracaoMs: 1 } } }));
  });
  await new Promise<void>((resolver, rejeitar) => {
    ws.addEventListener('open', () => resolver());
    ws.addEventListener('error', () => rejeitar(new Error('agente simulado não conectou')));
  });
  ws.send(JSON.stringify({ tipo: 'ola', dados: { versao: 'e2e', protocolo: 1, hostname: 'E2E', sistemaOperacional: 'e2e' } }));
  const conexao = await pedir('POST', '/conexoes', { token: empresa.adminToken, corpo: { agenteId, nome: `Conexão ${agenteId.slice(0, 6)}`, tipo: 'POSTGRES', host: 'localhost', porta: 5432, banco: 'erp', usuario: 'leitor', senha: 'x' } });
  expect(conexao.status).toBe(201);
  const consulta = randomUUID();
  await sql(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, finalidade, sql, campos, atualizado_em) VALUES ($1, $2, $3, $4, 'OUTRA', 'SELECT 1', $5, now())`, [consulta, empresa.id, conexao.j.id, `Consulta ${consulta.slice(0, 6)}`, JSON.stringify(COLUNAS.map((nome) => ({ nome })))]);
  return { consulta, nomeConsulta: `Consulta ${consulta.slice(0, 6)}`, fechar: () => ws.close() };
}

test('fotos: do catálogo à TV, com o agente respondendo, e cabem em todos os modelos e formatos', async ({ page }) => {
  test.setTimeout(240_000);
  const EAN_FOTO = '7891000100103';
  const EAN_REMEDIO = '7891000100110';
  const EAN_IA = '7891000100127';
  const EAN_SEM = '7891000100134';
  await page.goto('/tv');
  const vermelha = Buffer.from(await fotoDeProduto(page, '#dc2626'), 'base64');
  const azul = Buffer.from(await fotoDeProduto(page, '#2563eb'), 'base64');
  const pedidos: string[] = [];
  let fotoChegou = false;
  const catalogo = createServer((req, res) => {
    const url = req.url ?? '';
    pedidos.push(url);
    const json = (corpo: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (url.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(url.includes('remedio') ? azul : vermelha);
    }
    if (url === `/api/v1/barcodes/${EAN_FOTO}`) return json({ name: 'Arroz', images: [{ url: 'http://localhost:8097/files/provisoria.png', placeholder: true }, { url: 'http://localhost:8097/files/arroz.png' }] });
    if (url === `/api/v1/barcodes/${EAN_REMEDIO}`) return json({ name: 'Remédio', is_medicine: true, images: [{ url: 'http://localhost:8097/files/remedio.png' }] });
    if (url === `/api/v1/barcodes/${EAN_IA}`) return json({ name: 'Inventado', images: [{ url: 'http://localhost:8097/files/ia.png', ai_generated: true }] });
    if (fotoChegou && url === `/api/v1/barcodes/${EAN_SEM}`) return json({ name: 'Cadastrado agora', images: [{ url: 'http://localhost:8097/files/novo.png' }] });
    return json({ error: 'não encontrado' }, 404);
  });
  await new Promise<void>((r) => catalogo.listen(8097, r));
  const f = await criarEmpresa(await superToken());
  const nome = 'Produto com um nome extremamente comprido que o ERP cortaria em algum lugar 5kg embalagem econômica';
  // Código interno ("123"), e o mesmo EAN com zeros à esquerda, como alguns ERPs guardam.
  const codigos = [EAN_FOTO, EAN_REMEDIO, EAN_IA, EAN_SEM, '123', `0${EAN_FOTO}`, EAN_FOTO, EAN_REMEDIO, EAN_FOTO, EAN_REMEDIO, EAN_FOTO, EAN_FOTO];
  const agente = await agenteSimulado(f, codigos.map((codigo, i) => [codigo, `${i + 1} ${nome}`, '12349.90', '15999.90']));
  try {
    const tela = await telaVinculada(f, 'TV das fotos');

    // No editor: liga as fotos, a coluna do código vem sugerida, e a pré-visualização mostra o resultado.
    await page.setViewportSize({ width: 1400, height: 1000 });
    await entrar(page, f.adminEmail, f.adminSenha);
    await page.goto('/telas');
    await page.getByRole('tab', { name: 'Conteúdo' }).click();
    await page.getByRole('button', { name: 'Novo conteúdo' }).click();
    await page.getByLabel('Nome do conteúdo').fill('Ofertas com foto');
    await page.getByRole('combobox', { name: /^Consulta/ }).selectOption({ label: agente.nomeConsulta });
    await page.getByRole('checkbox', { name: /Mostrar a foto dos produtos/ }).check();
    await expect(page.getByLabel('Coluna do código de barras')).toHaveValue('ean');
    await expect(page.getByText('Clique em “Carregar dados reais” para ver as fotos.')).toBeVisible();
    await page.getByRole('button', { name: 'Carregar dados reais' }).click();
    // Arroz em 6 linhas (uma com zeros à esquerda) e remédio em 3; o de IA, o sem foto e o interno ficam só com texto.
    await expect(page.getByText('9 produto(s) com foto e 3 sem.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('3 produto(s) são medicamentos: confira as regras da Anvisa para propaganda antes de publicar.')).toBeVisible();
    const previa = page.getByLabel('Pré-visualização da tela');
    await expect.poll(() => previa.locator('[data-testid="foto-produto"] img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
    await page.screenshot({ path: 'test-results/tela-editor-fotos.png' });

    // Nem provisória nem de IA; código interno nem chega a perguntar; o mesmo produto, uma vez só.
    expect(pedidos.filter((p) => p.startsWith('/files/')).sort()).toEqual(['/files/arroz.png', '/files/remedio.png']);
    expect(pedidos.filter((p) => p.includes('/123'))).toEqual([]);
    expect(pedidos.filter((p) => p === `/api/v1/barcodes/${EAN_FOTO}`)).toHaveLength(1);

    // O catálogo cadastrou o produto depois da primeira busca: carregar de novo acha a foto, sem esperar o prazo.
    fotoChegou = true;
    await page.getByRole('button', { name: 'Carregar dados reais' }).click();
    await expect(page.getByText('10 produto(s) com foto e 2 sem.')).toBeVisible({ timeout: 30_000 });

    // Publica: a foto já guardada entra junto, e a TV recebe sem o código do produto.
    await page.getByRole('checkbox', { name: /TV das fotos/ }).check();
    await page.getByRole('button', { name: 'Publicar' }).click();
    const linha = page.getByRole('row', { name: /Ofertas com foto/ });
    await expect(linha.getByText('No ar')).toBeVisible({ timeout: 30_000 });
    const programacao = await pedir('POST', '/tv/programacao', { token: tela.token });
    expect(programacao.status).toBe(200);
    const recebidos = programacao.j.programas[0].itens as { foto?: string; codigo?: string }[];
    expect(recebidos.filter((i) => i.foto)).toHaveLength(10);
    expect(recebidos.every((i) => i.codigo === undefined)).toBe(true);
    expect(recebidos[2].foto).toBeUndefined();

    // Atualizar de novo não gasta consumo do catálogo: já está guardado, com ou sem foto.
    const antes = pedidos.length;
    const [{ id: conteudoId }] = await sql<{ id: string }>(`SELECT id FROM conteudos_tela WHERE empresa_id = $1`, [f.id]);
    expect((await pedir('POST', `/telas/conteudos/${conteudoId}/atualizar`, { token: f.adminToken })).j.situacao).toBe('NO_AR');
    expect(pedidos.length).toBe(antes);

    // O arquivo é público, com o tipo certo e cache longo. Id desconhecido não abre nada.
    const arquivo = await fetch(new URL(recebidos[0].foto!, API).toString());
    expect(arquivo.status).toBe(200);
    expect(arquivo.headers.get('content-type')).toBe('image/png');
    expect(arquivo.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${API}/tv/fotos/${randomUUID()}`)).status).toBe(404);

    // Na TV, em cada modelo e formato.
    const tv = await page.context().newPage();
    await tv.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
    const problemas: string[] = [];
    for (const modelo of ['GRADE_OFERTAS', 'DESTAQUE', 'LISTA_PRECOS']) {
      await sql(`UPDATE conteudos_tela SET modelo = $2, atualizado_em = now() WHERE id = $1`, [conteudoId, modelo]);
      for (const [largura, altura] of [[1920, 1080], [1080, 1920], [1280, 800], [960, 320], [128, 64]]) {
        await tv.setViewportSize({ width: largura, height: altura });
        await tv.goto('/tv');
        await tv.evaluate(() => localStorage.removeItem('etiquetas.tv.programacao'));
        await tv.goto('/tv');
        await expect(tv.getByTestId('cena-tela')).toBeVisible();
        await tv.waitForTimeout(900);
        const medidas = await tv.evaluate(() => {
          const dentro = (a: DOMRect, b: DOMRect) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
          const cobre = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          const erros: string[] = [];
          const celulas = [...document.querySelectorAll('[data-testid="celula-tela"]')];
          for (const celula of celulas) {
            const r = celula.getBoundingClientRect();
            const preco = celula.querySelector('[data-testid="preco-tela"]');
            const foto = celula.querySelector('[data-testid="foto-produto"]');
            if (!preco) erros.push('sem preço');
            else {
              const p = preco.getBoundingClientRect();
              // O pulso da animação aumenta o preço em 5%: mede o tamanho sem ele.
              const semPulso = new DOMRect(p.x + p.width * 0.03, p.y + p.height * 0.03, p.width * 0.94, p.height * 0.94);
              if (!dentro(semPulso, r)) erros.push('preço cortado');
              if (foto && cobre(semPulso, foto.getBoundingClientRect())) erros.push('foto sobre o preço');
            }
            if (foto && !dentro(foto.getBoundingClientRect(), r)) erros.push('foto cortada');
            const nomeProduto = celula.querySelector('[data-testid="nome-tela"]');
            if (foto && nomeProduto && nomeProduto.getBoundingClientRect().width < r.width * 0.3) erros.push('nome espremido');
          }
          for (const t of document.querySelectorAll<HTMLElement>('[data-testid="texto-celula"]')) {
            const bloco = t.getBoundingClientRect();
            for (const filho of t.children) if (filho.getBoundingClientRect().bottom > bloco.bottom + 1) erros.push('texto invadindo o preço');
          }
          // Com ou sem foto, a mesma letra: preço de tamanhos diferentes na mesma cena parece oferta maior.
          const tamanhos = [...document.querySelectorAll<HTMLElement>('[data-testid="celula-tela"] [data-testid="preco-tela"]')].map((p) => parseFloat(getComputedStyle(p).fontSize));
          if (tamanhos.length > 1 && Math.max(...tamanhos) > Math.min(...tamanhos) * 1.02) erros.push('preços de tamanhos diferentes');
          return { celulas: celulas.length, fotos: document.querySelectorAll('[data-testid="foto-produto"] img').length, erros };
        });
        if (medidas.celulas === 0) problemas.push(`${modelo} ${largura}x${altura}: sem células`);
        // Painel pequeno se lê de longe: nome e preço, sem foto.
        if (largura > 200 && medidas.fotos === 0) problemas.push(`${modelo} ${largura}x${altura}: sem foto`);
        if (largura <= 200 && medidas.fotos > 0) problemas.push(`${modelo} ${largura}x${altura}: foto em painel pequeno`);
        for (const m of new Set(medidas.erros)) problemas.push(`${modelo} ${largura}x${altura}: ${m}`);
        await tv.screenshot({ path: `test-results/fotos-${modelo}-${largura}x${altura}.png` });
      }
    }
    expect(problemas).toEqual([]);

    // Foto que não abre: o cartão volta a mostrar só o texto, sem quadro quebrado.
    await tv.setViewportSize({ width: 1280, height: 720 });
    await sql(`UPDATE conteudos_tela SET modelo = 'GRADE_OFERTAS', atualizado_em = now() WHERE id = $1`, [conteudoId]);
    await tv.route('**/api/tv/fotos/**', (r) => r.fulfill({ status: 404 }));
    await tv.evaluate(() => localStorage.removeItem('etiquetas.tv.programacao'));
    await tv.goto('/tv');
    await expect(tv.getByTestId('cena-tela')).toBeVisible();
    await expect(tv.getByTestId('foto-produto')).toHaveCount(0);
    await expect(tv.getByTestId('preco-tela').first()).toBeVisible();
    await tv.close();

    // Desligou a opção: a TV deixa de receber as fotos.
    const atual = (await pedir('GET', '/telas/conteudos', { token: f.adminToken })).j[0];
    expect((await pedir('PUT', `/telas/conteudos/${conteudoId}`, { token: f.adminToken, corpo: { ...corpoConteudo('Ofertas com foto', agente.consulta), config: { ...atual.config, comFotos: false } } })).status).toBe(200);
    expect(((await pedir('POST', '/tv/programacao', { token: tela.token })).j.programas[0].itens as { foto?: string }[]).some((i) => i.foto)).toBe(false);

    // Coluna do código é obrigatória com as fotos ligadas; e a foto de uma empresa não se confunde com a de outra.
    const semColuna = await pedir('PUT', `/telas/conteudos/${conteudoId}`, { token: f.adminToken, corpo: { ...corpoConteudo('Ofertas com foto', agente.consulta), config: { ...atual.config, comFotos: true, colunaCodigo: null } } });
    expect(semColuna.status).toBe(400);
    expect(semColuna.j.message).toContain('código de barras');
    const [{ total }] = await sql<{ total: string }>(`SELECT count(*) AS total FROM fotos_produto_tela WHERE empresa_id = $1`, [e.id]);
    expect(Number(total)).toBe(0);
  } finally {
    agente.fechar();
    await new Promise((r) => catalogo.close(r));
  }
});

// Cada TV tem a sua fonte de sistema, e algumas são bem mais largas: o desenho precisa aguentar as duas.
for (const [rotuloFonte, fonte] of [['do sistema', ''], ['larga', 'Verdana, "DejaVu Sans"']] as const)
test(`nome e preço cabem em todos os modelos e formatos, com fonte ${rotuloFonte}`, async ({ page }) => {
  test.setTimeout(180_000);
  const tela = await telaVinculada(e, `TV dos formatos ${rotuloFonte}`);
  const consultaId = await criarConsulta(e);
  const c = await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo(`Formatos ${rotuloFonte}`, consultaId) });
  await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: e.adminToken, corpo: { telaIds: [tela.id] } });
  // O pior caso: nome enorme e preço alto, em todos os produtos.
  const itens = Array.from({ length: 12 }, (_, i) => ({ nome: `Produto ${i + 1} com um nome extremamente comprido que o ERP cortaria em algum lugar 5kg embalagem econômica`, preco: 'R$ 12.349,90', precoDe: 'R$ 15.999,90', detalhe: 'Unidade' }));
  await sql(`UPDATE conteudos_tela SET itens = $2, quantidade_itens = $3, dados_em = (now() at time zone 'utc'), erro = NULL WHERE id = $1`, [c.j.id, JSON.stringify(itens), itens.length]);
  await page.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
  if (fonte) {
    await page.addInitScript((f) => {
      const colocar = () => {
        const s = document.createElement('style');
        s.textContent = `* { font-family: ${f} !important; }`;
        document.documentElement.appendChild(s);
      };
      document.addEventListener('DOMContentLoaded', colocar);
    }, fonte);
  }

  const problemas: string[] = [];
  for (const modelo of ['GRADE_OFERTAS', 'DESTAQUE', 'LISTA_PRECOS']) {
    await sql(`UPDATE conteudos_tela SET modelo = $2, atualizado_em = now() WHERE id = $1`, [c.j.id, modelo]);
    for (const [largura, altura] of [[1920, 1080], [1080, 1920], [1280, 800], [960, 320], [128, 64]]) {
      await page.setViewportSize({ width: largura, height: altura });
      await page.evaluate(() => localStorage.removeItem('etiquetas.tv.programacao')).catch(() => undefined);
      await page.goto('/tv');
      await expect(page.getByTestId('cena-tela')).toBeVisible();
      await page.waitForTimeout(900);
      const medidas = await page.evaluate(() => {
        const dentro = (a: DOMRect, b: { left: number; right: number; top: number; bottom: number }) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
        const janela = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const celulas = [...document.querySelectorAll('[data-testid="celula-tela"]')];
        const erros: string[] = [];
        const titulo = document.querySelector<HTMLElement>('[data-testid="titulo-tela"]');
        if (titulo && titulo.scrollWidth > titulo.clientWidth + 1) erros.push('título cortado');
        for (const textoCelula of document.querySelectorAll<HTMLElement>('[data-testid="texto-celula"]')) {
          const bloco = textoCelula.getBoundingClientRect();
          for (const filho of textoCelula.children) {
            if (filho.getBoundingClientRect().bottom > bloco.bottom + 1) erros.push('texto invadindo o preço');
          }
        }
        for (const celula of celulas) {
          const r = celula.getBoundingClientRect();
          if (!dentro(r, janela)) erros.push('célula fora da tela');
          const preco = celula.querySelector('[data-testid="preco-tela"]');
          if (!preco) erros.push('sem preço');
          // O pulso da animação aumenta o preço em 5%: mede o tamanho sem ele.
          else if (!dentro(new DOMRect(preco.getBoundingClientRect().x + preco.getBoundingClientRect().width * 0.03, preco.getBoundingClientRect().y + preco.getBoundingClientRect().height * 0.03, preco.getBoundingClientRect().width * 0.94, preco.getBoundingClientRect().height * 0.94), r)) erros.push('preço cortado');
        }
        return { celulas: celulas.length, erros };
      });
      if (medidas.celulas === 0) problemas.push(`${modelo} ${largura}x${altura}: sem células`);
      for (const m of new Set(medidas.erros)) problemas.push(`${modelo} ${largura}x${altura}: ${m}`);
      await page.screenshot({ path: `test-results/formato-${fonte ? 'larga-' : ''}${modelo}-${largura}x${altura}.png` });
    }
  }
  expect(problemas).toEqual([]);
});

test('vinculada sem programação continua aguardando, e dados novos chegam pela versão', async () => {
  const tela = await telaVinculada(e, 'TV sem nada');
  const aviso = () => pedir('POST', '/tv/aviso', { token: tela.token, corpo: { ...RESOLUCAO, versao: '2' } });
  const prog = () => pedir('POST', '/tv/programacao', { token: tela.token, corpo: {} });
  const antes = await aviso();
  expect(antes.status).toBe(200);
  expect((await prog()).j.programas).toEqual([]);

  const consultaId = await criarConsulta(e);
  const c = await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo('Versões', consultaId) });
  // Rascunho não vai para a tela, mesmo com dados.
  await gravarDados(c.j.id);
  expect((await prog()).j.programas).toEqual([]);

  await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: e.adminToken, corpo: { telaIds: [tela.id] } });
  await gravarDados(c.j.id);
  const depois = await aviso();
  expect(depois.j.versaoProgramacao).not.toBe(antes.j.versaoProgramacao);
  const p = (await prog()).j;
  expect(p.programas.map((x: { nome: string }) => x.nome)).toEqual(['Versões']);
  expect(p.programas[0].itens).toEqual(ITENS);
  expect(p.fuso).toBeTruthy();
  // O player não recebe o nome das colunas do banco do cliente.
  expect(JSON.stringify(p)).not.toContain('colunaPreco');

  // Vencido: sai sem depender de ninguém.
  await gravarDados(c.j.id, 61);
  expect((await prog()).j.programas).toEqual([]);
  const lista = await pedir('GET', '/telas/conteudos', { token: e.adminToken });
  expect(lista.j.find((x: { id: string }) => x.id === c.j.id).situacao).toBe('DADOS_VENCIDOS');

  // Fora da data: também não.
  await gravarDados(c.j.id);
  await sql(`UPDATE conteudos_tela SET data_fim = '2020-01-01' WHERE id = $1`, [c.j.id]);
  expect((await prog()).j.programas).toEqual([]);
  await sql(`UPDATE conteudos_tela SET data_fim = NULL WHERE id = $1`, [c.j.id]);
  expect((await prog()).j.programas).toHaveLength(1);

  // Tirar do ar.
  expect((await pedir('POST', `/telas/conteudos/${c.j.id}/despublicar`, { token: e.adminToken })).j.situacao).toBe('RASCUNHO');
  expect((await prog()).j.programas).toEqual([]);

  // Token de TV não abre nada além do player, e token inválido não abre o player.
  expect((await pedir('GET', '/telas/conteudos', { token: tela.token })).status).toBe(401);
  expect((await pedir('POST', '/tv/programacao', { token: 'tv_invalido', corpo: {} })).status).toBe(401);
  expect((await pedir('POST', '/tv/programacao', { corpo: {} })).status).toBe(401);
});

test('uma empresa não enxerga nem usa o que é de outra', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const telaDaOutra = await telaVinculada(outra, 'TV da outra');
  const consultaDaOutra = await criarConsulta(outra);
  const minhaConsulta = await criarConsulta(e);
  const minhaTela = await telaVinculada(e, 'TV minha');

  // Consulta de outra empresa não entra.
  expect((await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo('Roubo', consultaDaOutra) })).status).toBe(400);
  expect((await pedir('POST', '/telas/conteudos/previa', { token: e.adminToken, corpo: { consultaId: consultaDaOutra } })).status).toBe(400);
  const consultas = await pedir('GET', '/telas/conteudos/consultas', { token: e.adminToken });
  expect(consultas.j.map((c: { id: string }) => c.id)).not.toContain(consultaDaOutra);

  const c = await pedir('POST', '/telas/conteudos', { token: e.adminToken, corpo: corpoConteudo('Só minha', minhaConsulta) });
  expect(c.status).toBe(201);

  // Tela de outra empresa não recebe, e nada fica pela metade.
  const r = await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: e.adminToken, corpo: { telaIds: [minhaTela.id, telaDaOutra.id] } });
  expect(r.status).toBe(400);
  const [{ publicado }] = await sql(`SELECT publicado FROM conteudos_tela WHERE id = $1`, [c.j.id]);
  expect(publicado).toBe(false);

  // A outra empresa não vê, não edita, não publica, não apaga.
  expect((await pedir('GET', '/telas/conteudos', { token: outra.adminToken })).j).toEqual([]);
  expect((await pedir('PUT', `/telas/conteudos/${c.j.id}`, { token: outra.adminToken, corpo: corpoConteudo('Hack', consultaDaOutra) })).status).toBe(404);
  expect((await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: outra.adminToken, corpo: { telaIds: [telaDaOutra.id] } })).status).toBe(404);
  expect((await pedir('POST', `/telas/conteudos/${c.j.id}/despublicar`, { token: outra.adminToken })).status).toBe(404);
  expect((await pedir('DELETE', `/telas/conteudos/${c.j.id}`, { token: outra.adminToken })).status).toBe(404);
});

test('consulta de busca é recusada, e aprovação obrigatória impede publicar', async () => {
  const empresa = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV aprovação');
  const busca = await criarConsulta(empresa, 'SELECT * FROM produtos WHERE codigo = {param.codigo}');
  const r = await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoConteudo('Busca', busca) });
  expect(r.status).toBe(400);
  expect(r.j.message).toMatch(/valores digitados/);
  const lista = await pedir('GET', '/telas/conteudos/consultas', { token: empresa.adminToken });
  expect(lista.j.find((c: { id: string }) => c.id === busca).pedeParametro).toBe(true);

  const consulta = await criarConsulta(empresa);
  const c = await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoConteudo('Aprovada', consulta) });
  await pedir('PUT', '/telas/parametros/empresa', { token: empresa.adminToken, corpo: { valores: { aprovacaoObrigatoria: true } } });
  const p = await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: empresa.adminToken, corpo: { telaIds: [tela.id] } });
  expect(p.status).toBe(409);
  expect(p.j.message).toMatch(/aprovação/);
});

// PNG de verdade: 1x1 e 16x9 não fazem diferença para a TV, só para os avisos de formato.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const dataUrlPng = `data:image/png;base64,${PNG.toString('base64')}`;

const enviarImagem = (empresa: EmpresaTeste, extra: Record<string, unknown> = {}) => pedir('POST', '/telas/conteudos/imagens', { token: empresa.adminToken, corpo: { nome: 'banner.png', dados: dataUrlPng, largura: 1920, altura: 1080, ...extra } });
const corpoImagens = (nome: string, ids: string[], extra: Record<string, unknown> = {}) => ({ nome, modelo: 'IMAGENS', config: { ...CONFIG, colunaNome: '', colunaPreco: '', colunaPrecoDe: null, imagens: ids.map((imagemId) => ({ imagemId, segundos: 5 })), ajuste: 'CONTER' }, intervaloMinutos: 15, validadeMinutos: 60, ...extra });

test('envia imagem pelo site, publica e a TV mostra, alternando com as ofertas', async ({ page, context }) => {
  const empresa = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV das imagens');

  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, empresa.adminEmail, empresa.adminSenha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await page.getByRole('button', { name: 'Novo conteúdo' }).click();
  await page.getByLabel('Nome do conteúdo').fill('Banner da loja');
  await page.getByText('Imagens', { exact: true }).click();
  // Um banner de verdade, no tamanho da TV, desenhado na hora.
  const banner = Buffer.from(
    (await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1280;
      c.height = 720;
      const g = c.getContext('2d')!;
      g.fillStyle = '#b91c1c';
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#ffffff';
      g.font = 'bold 110px sans-serif';
      g.textAlign = 'center';
      g.fillText('Feirão de sábado', 640, 390);
      return c.toDataURL('image/png').split(',')[1];
    })) as string,
    'base64',
  );
  // Sem consulta nem colunas nesse modelo.
  await expect(page.getByRole('combobox', { name: /^Consulta/ })).toHaveCount(0);
  await expect(page.getByText('Escolha ao menos uma imagem.').first()).toBeVisible();

  // SVG não entra, e não atrapalha a imagem boa enviada junto.
  await page.getByLabel('Arquivos de imagem').setInputFiles([
    { name: 'ataque.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') },
    { name: 'banner.png', mimeType: 'image/png', buffer: banner },
  ]);
  await expect(page.getByText(/ataque\.svg: A imagem precisa ser PNG/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'banner.png' }).first()).toBeVisible();
  const naPrevia = page.getByLabel('Pré-visualização da tela').locator('img');
  await expect(naPrevia).toBeVisible();
  await expect.poll(() => naPrevia.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1280);
  // Mesmo formato do perfil: nada de aviso.
  await expect(page.getByText('As imagens têm o mesmo formato desta tela.')).toBeVisible();
  // Terminada a entrada, a imagem precisa estar opaca: a animação não pode deixá-la sumida.
  await expect.poll(() => naPrevia.evaluate((i) => getComputedStyle(i).opacity)).toBe('1');
  await page.screenshot({ path: 'test-results/tela-editor-imagens.png' });

  await page.getByRole('checkbox', { name: /TV das imagens/ }).check();
  await page.getByRole('button', { name: 'Publicar' }).click();
  const linha = page.getByRole('row', { name: /Banner da loja/ });
  await expect(linha.getByText('No ar')).toBeVisible();
  await expect(linha.getByText('1 imagem(ns)')).toBeVisible();
  await expect(linha.getByRole('button', { name: 'Atualizar dados' })).toHaveCount(0);

  // Um conteúdo de ofertas na mesma tela: as duas coisas se alternam.
  const consultaId = await criarConsulta(empresa);
  const ofertas = await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoConteudo('Ofertas', consultaId, { config: { ...CONFIG, segundosPorCena: 3 } }) });
  await pedir('POST', `/telas/conteudos/${ofertas.j.id}/publicar`, { token: empresa.adminToken, corpo: { telaIds: [tela.id] } });
  await gravarDados(ofertas.j.id);

  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1280, height: 720 });
  await tv.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
  await tv.goto('/tv');
  const cenaImagem = tv.getByTestId('cena-imagem');
  await expect(cenaImagem).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => cenaImagem.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => cenaImagem.locator('img').evaluate((i) => getComputedStyle(i).opacity)).toBe('1');
  await tv.screenshot({ path: 'test-results/tela-tv-imagem.png' });
  await expect(tv.getByTestId('cena-tela').getByText('Arroz Tipo 1 5kg')).toBeVisible({ timeout: 15_000 });
  await expect(cenaImagem).toBeVisible({ timeout: 15_000 });
});

test('imagens: regras da API, sem validade, em uso e isolamento', async () => {
  const empresa = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV regras');

  // Tipo pelos bytes: declarar PNG não adianta.
  const falsa = await enviarImagem(empresa, { dados: `data:image/png;base64,${Buffer.from('<svg></svg>').toString('base64')}` });
  expect(falsa.status).toBe(400);
  expect(falsa.j.message).toMatch(/PNG, JPEG/);

  // O limite é o parâmetro, definido pelo administrador geral.
  await pedir('PUT', '/telas/parametros/global', { token: tokenSuper, empresa: empresa.id, corpo: { valores: { imagemTamanhoMaximoMb: 1 } } });
  const grande = await enviarImagem(empresa, { dados: `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(1_100_000)]).toString('base64')}` });
  await pedir('PUT', '/telas/parametros/global', { token: tokenSuper, empresa: empresa.id, corpo: { valores: { imagemTamanhoMaximoMb: null } } });
  expect(grande.status).toBe(400);
  expect(grande.j.message).toMatch(/passa de 1 MB/);

  const img = await enviarImagem(empresa);
  expect(img.status).toBe(201);
  const id = img.j.id as string;

  // A TV baixa sem login, com o tipo conferido e cache longo.
  const arquivo = await fetch(`http://localhost:3000/api/tv/imagens/${id}`);
  expect(arquivo.status).toBe(200);
  expect(arquivo.headers.get('content-type')).toContain('image/png');
  expect(arquivo.headers.get('x-content-type-options')).toBe('nosniff');
  expect(arquivo.headers.get('cache-control')).toContain('immutable');
  expect(Buffer.from(await arquivo.arrayBuffer()).equals(PNG)).toBe(true);
  expect((await fetch('http://localhost:3000/api/tv/imagens/00000000-0000-4000-8000-000000000000')).status).toBe(404);

  // Isolamento: a outra empresa não lista, não usa, não apaga.
  expect((await pedir('GET', '/telas/conteudos/imagens', { token: outra.adminToken })).j).toEqual([]);
  expect((await pedir('POST', '/telas/conteudos', { token: outra.adminToken, corpo: corpoImagens('Roubo', [id]) })).status).toBe(400);
  expect((await pedir('DELETE', `/telas/conteudos/imagens/${id}`, { token: outra.adminToken })).status).toBe(404);

  // Vazio e tempo fora do limite não passam.
  expect((await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoImagens('Vazio', []) })).status).toBe(400);

  const c = await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoImagens('Banners', [id]) });
  expect(c.status).toBe(201);
  expect(c.j.consultaId).toBeNull();
  expect(c.j.validadeMinutos).toBe(0);
  const pub = await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: empresa.adminToken, corpo: { telaIds: [tela.id] } });
  expect(pub.status).toBe(200);
  expect(pub.j.situacao).toBe('NO_AR');
  expect(pub.j.erro).toBeNull();

  const prog = () => pedir('POST', '/tv/programacao', { token: tela.token, corpo: {} });
  const p = (await prog()).j.programas[0];
  expect(p.imagens).toEqual([{ url: `/api/tv/imagens/${id}`, segundos: 5 }]);

  // Não depende de consulta nem vence: um ano depois continua no ar.
  await sql(`UPDATE conteudos_tela SET dados_em = (now() at time zone 'utc') - interval '365 days' WHERE id = $1`, [c.j.id]);
  expect((await prog()).j.programas).toHaveLength(1);
  const lista = await pedir('GET', '/telas/conteudos', { token: empresa.adminToken });
  expect(lista.j[0].situacao).toBe('NO_AR');
  const [{ proxima_atualizacao_em: proxima }] = await sql(`SELECT proxima_atualizacao_em FROM conteudos_tela WHERE id = $1`, [c.j.id]);
  expect(proxima).toBeNull();

  // Em uso não sai da galeria; depois de tirar, sai.
  const usada = await pedir('DELETE', `/telas/conteudos/imagens/${id}`, { token: empresa.adminToken });
  expect(usada.status).toBe(409);
  expect((await pedir('GET', '/telas/conteudos/imagens', { token: empresa.adminToken })).j[0].usos).toBe(1);
  await pedir('POST', `/telas/conteudos/${c.j.id}/despublicar`, { token: empresa.adminToken });
  await pedir('DELETE', `/telas/conteudos/${c.j.id}`, { token: empresa.adminToken });
  expect((await pedir('DELETE', `/telas/conteudos/imagens/${id}`, { token: empresa.adminToken })).status).toBe(204);
  expect((await fetch(`http://localhost:3000/api/tv/imagens/${id}`)).status).toBe(404);
});

async function usuarioCom(empresa: EmpresaTeste, nome: string, permissoes: string[]) {
  const perfil = await pedir('POST', '/perfis', { token: empresa.adminToken, corpo: { nome: `${nome} ${randomUUID().slice(0, 6)}`, permissoes } });
  expect(perfil.status).toBe(201);
  const email = `${randomUUID().slice(0, 8)}@e2e.local`;
  const u = await pedir('POST', '/usuarios', { token: empresa.adminToken, corpo: { nome, email, senha: 'SenhaUsuario123', perfilId: perfil.j.id } });
  expect(u.status).toBe(201);
  return { id: u.j.id as string, email, senha: 'SenhaUsuario123', token: await login(email, 'SenhaUsuario123') };
}

test('aprovação: papéis, o que está no ar não muda, reenvio e isolamento', async () => {
  const empresa = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV aprovada');
  const consultaId = await criarConsulta(empresa);
  const editor = await usuarioCom(empresa, 'Editor', ['tela.ver', 'tela.editar']);
  const aprovador = await usuarioCom(empresa, 'Aprovador', ['tela.ver', 'tela.aprovar']);
  const programas = async () => (await pedir('POST', '/tv/programacao', { token: tela.token, corpo: {} })).j.programas as { nome: string; config: { titulo: string } }[];
  const lista = async () => (await pedir('GET', '/telas/conteudos/aprovacoes', { token: aprovador.token })).j as { id: string; impedimento: string | null; aprovacao: { versao: string; proposta: { config: { titulo: string } } } }[];

  await pedir('PUT', '/telas/parametros/empresa', { token: empresa.adminToken, corpo: { valores: { aprovacaoObrigatoria: true, criadorPodeAprovar: false } } });
  expect((await pedir('GET', '/telas/conteudos/regras', { token: editor.token })).j.aprovacaoObrigatoria).toBe(true);

  // Quem só edita não desliga a aprovação do que ele mesmo vai publicar.
  for (const valores of [{ aprovacaoObrigatoria: false }, { criadorPodeAprovar: true }]) {
    const burla = await pedir('PUT', '/telas/parametros/empresa', { token: editor.token, corpo: { valores } });
    expect(burla.status).toBe(403);
    expect(burla.j.message).toMatch(/permissão de aprovar/);
  }
  expect((await pedir('GET', '/telas/parametros', { token: editor.token })).j.editaveis).toEqual([]);
  expect((await pedir('GET', '/telas/conteudos/regras', { token: editor.token })).j.aprovacaoObrigatoria).toBe(true);

  const corpo = corpoConteudo('Vitrine', consultaId);
  const c = await pedir('POST', '/telas/conteudos', { token: editor.token, corpo });
  expect(c.status).toBe(201);
  const id = c.j.id as string;
  const pedirA = (t: string, titulo: string, extra: Record<string, unknown> = {}) => pedir('POST', `/telas/conteudos/${id}/aprovacao`, { token: t, corpo: { conteudo: { ...corpo, config: { ...CONFIG, titulo }, ...extra }, telaIds: [tela.id] } });

  // Publicar direto não passa, nem por quem pode aprovar.
  expect((await pedir('POST', `/telas/conteudos/${id}/publicar`, { token: empresa.adminToken, corpo: { telaIds: [tela.id] } })).status).toBe(409);

  // Enviado: esperando, e nada na TV.
  const pedido = await pedirA(editor.token, 'Primeira versão');
  expect(pedido.status).toBe(200);
  expect(pedido.j.aprovacao.situacao).toBe('PENDENTE');
  expect(pedido.j.publicado).toBe(false);
  expect(await programas()).toEqual([]);
  let [item] = await lista();
  expect(item.aprovacao.proposta.config.titulo).toBe('Primeira versão');
  expect(item.impedimento).toBeNull();

  // Sem a permissão não entra; outra empresa não enxerga.
  expect((await pedir('GET', '/telas/conteudos/aprovacoes', { token: editor.token })).status).toBe(403);
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: editor.token, corpo: { versao: item.aprovacao.versao } })).status).toBe(403);
  expect((await pedir('GET', '/telas/conteudos/aprovacoes', { token: outra.adminToken })).j).toEqual([]);
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: outra.adminToken, corpo: { versao: item.aprovacao.versao } })).status).toBe(404);
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao/previa`, { token: outra.adminToken })).status).toBe(404);

  // Quem enviou não decide: a empresa pediu uma segunda pessoa.
  const proprio = await usuarioCom(empresa, 'Faz tudo', ['tela.ver', 'tela.editar', 'tela.aprovar']);
  await pedirA(proprio.token, 'Enviada por quem aprova');
  const envio = (await pedir('GET', '/telas/conteudos/aprovacoes', { token: proprio.token })).j[0];
  expect(envio.impedimento).toMatch(/segunda pessoa/);
  const seu = await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: proprio.token, corpo: { versao: envio.aprovacao.versao } });
  expect(seu.status).toBe(403);
  expect(seu.j.message).toMatch(/segunda pessoa/);

  // O administrador geral só com o parâmetro.
  [item] = await lista();
  const geral = await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: tokenSuper, empresa: empresa.id, corpo: { versao: item.aprovacao.versao } });
  expect(geral.status).toBe(403);
  expect(geral.j.message).toMatch(/administrador geral/);

  // Reenviar enquanto alguém olha: a decisão sobre a versão antiga não vale.
  const antiga = item.aprovacao.versao;
  await pedirA(editor.token, 'Segunda versão');
  const velha = await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: aprovador.token, corpo: { versao: antiga } });
  expect(velha.status).toBe(409);
  expect(velha.j.message).toMatch(/enviado de novo/);
  expect(await programas()).toEqual([]);

  // Recusar pede motivo, guarda a proposta e sai da fila.
  [item] = await lista();
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao/recusar`, { token: aprovador.token, corpo: { versao: item.aprovacao.versao, motivo: '' } })).status).toBe(400);
  const recusa = await pedir('POST', `/telas/conteudos/${id}/aprovacao/recusar`, { token: aprovador.token, corpo: { versao: item.aprovacao.versao, motivo: 'O título está errado' } });
  expect(recusa.j.aprovacao.situacao).toBe('RECUSADO');
  expect(recusa.j.aprovacao.motivo).toBe('O título está errado');
  expect(recusa.j.aprovacao.decididaPorNome).toBe('Aprovador');
  expect(recusa.j.aprovacao.proposta.config.titulo).toBe('Segunda versão');
  expect(await lista()).toEqual([]);
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: aprovador.token, corpo: { versao: item.aprovacao.versao } })).status).toBe(409);

  // Aprovar publica o que foi enviado, com a consulta rodando em nome de quem preparou.
  await pedirA(editor.token, 'Terceira versão');
  [item] = await lista();
  const aprovado = await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: aprovador.token, corpo: { versao: item.aprovacao.versao } });
  expect(aprovado.status).toBe(200);
  expect(aprovado.j.publicado).toBe(true);
  expect(aprovado.j.config.titulo).toBe('Terceira versão');
  expect(aprovado.j.telaIds).toEqual([tela.id]);
  expect(aprovado.j.aprovacao.situacao).toBe('APROVADO');
  expect(aprovado.j.aprovacao.decididaPorNome).toBe('Aprovador');
  const [{ responsavel_id: responsavel }] = await sql(`SELECT responsavel_id FROM conteudos_tela WHERE id = $1`, [id]);
  expect(responsavel).toBe(editor.id);
  await gravarDados(id);
  expect((await programas())[0].config.titulo).toBe('Terceira versão');

  // Decidir de novo não publica duas vezes.
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: aprovador.token, corpo: { versao: item.aprovacao.versao } })).status).toBe(409);

  // No ar: salvar direto não passa, e a mudança só vale depois de aprovada.
  const direto = await pedir('PUT', `/telas/conteudos/${id}`, { token: editor.token, corpo: { ...corpo, config: { ...CONFIG, titulo: 'Sem aprovar' } } });
  expect(direto.status).toBe(409);
  expect((await programas())[0].config.titulo).toBe('Terceira versão');
  const mudanca = await pedirA(editor.token, 'Mudança no ar');
  expect(mudanca.j.situacao).toBe('NO_AR');
  expect(mudanca.j.config.titulo).toBe('Terceira versão');
  expect((await programas())[0].config.titulo).toBe('Terceira versão');
  // Tirar do ar é segurança: não espera aprovação, e o pedido continua.
  expect((await pedir('POST', `/telas/conteudos/${id}/despublicar`, { token: editor.token })).status).toBe(200);
  expect(await programas()).toEqual([]);
  expect(await lista()).toHaveLength(1);
  // Desistir: fila vazia, e o conteúdo fica como estava.
  const desistiu = await pedir('POST', `/telas/conteudos/${id}/aprovacao/cancelar`, { token: editor.token });
  expect(desistiu.j.aprovacao).toBeNull();
  expect(desistiu.j.config.titulo).toBe('Terceira versão');
  expect(await lista()).toEqual([]);

  // A imagem de um pedido aberto fica presa: aprovar não pode trazer imagem apagada, e outra empresa não usa.
  const img = (await enviarImagem(empresa, { nome: 'logo.png' })).j.id as string;
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao`, { token: editor.token, corpo: { conteudo: { ...corpo, config: { ...CONFIG, logoImagemId: img } }, telaIds: [tela.id] } })).status).toBe(200);
  expect((await pedir('DELETE', `/telas/conteudos/imagens/${img}`, { token: editor.token })).status).toBe(409);
  // Tela de outra empresa não entra no pedido.
  const telaOutra = await telaVinculada(outra, 'TV alheia');
  expect((await pedir('POST', `/telas/conteudos/${id}/aprovacao`, { token: editor.token, corpo: { conteudo: corpo, telaIds: [telaOutra.id] } })).status).toBe(400);

  // Com o parâmetro, o administrador geral decide.
  await pedir('PUT', '/telas/parametros/global', { token: tokenSuper, empresa: empresa.id, corpo: { valores: { administradorGeralAprova: true } } });
  [item] = await lista();
  const peloGeral = await pedir('POST', `/telas/conteudos/${id}/aprovacao/aprovar`, { token: tokenSuper, empresa: empresa.id, corpo: { versao: item.aprovacao.versao } });
  await pedir('PUT', '/telas/parametros/global', { token: tokenSuper, empresa: empresa.id, corpo: { valores: { administradorGeralAprova: null } } });
  expect(peloGeral.status).toBe(200);

  const auditoria = await sql(`SELECT acao FROM logs_auditoria WHERE entidade_id = $1 AND acao LIKE 'tela.conteudo_%'`, [id]);
  for (const acao of ['tela.conteudo_pedir_aprovacao', 'tela.conteudo_aprovar', 'tela.conteudo_recusar', 'tela.conteudo_cancelar_aprovacao']) expect(auditoria.map((a) => a.acao)).toContain(acao);
});

test('aprovação pelo site: envia, recusa com motivo, corrige e aprova, e a TV mostra', async ({ page, context }) => {
  test.setTimeout(120_000);
  const empresa = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV do site');
  const consultaId = await criarConsulta(empresa);
  const editor = await usuarioCom(empresa, 'Editora Ana', ['tela.ver', 'tela.editar']);
  const aprovador = await usuarioCom(empresa, 'Gerente Bia', ['tela.ver', 'tela.aprovar']);

  // Ligado pela tela de parâmetros.
  await page.setViewportSize({ width: 1400, height: 1100 });
  await entrar(page, empresa.adminEmail, empresa.adminSenha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Parâmetros' }).click();
  await page.getByRole('combobox', { name: 'Aprovação obrigatória' }).selectOption('true');
  await page.getByRole('combobox', { name: 'Quem criou pode aprovar' }).selectOption('false');
  await page.getByRole('button', { name: 'Salvar parâmetros' }).click();
  await expect.poll(async () => (await pedir('GET', '/telas/conteudos/regras', { token: editor.token })).j.aprovacaoObrigatoria).toBe(true);
  await page.getByRole('button', { name: 'Sair' }).click();

  // Quem edita não vê a aba, e o botão é outro.
  await entrar(page, editor.email, editor.senha);
  await page.goto('/telas');
  await expect(page.getByRole('tab', { name: /Aprovação/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await page.getByRole('button', { name: 'Novo conteúdo' }).click();
  await page.getByLabel('Nome do conteúdo').fill('Vitrine da semana');
  await page.getByRole('combobox', { name: /^Consulta/ }).selectOption(consultaId);
  await page.getByRole('combobox', { name: 'Coluna do nome' }).selectOption('descricao');
  await page.getByRole('combobox', { name: 'Coluna do preço' }).selectOption('preco');
  await page.getByLabel('Título').fill('Titulo com erro');
  await page.getByRole('checkbox', { name: /TV do site/ }).check();
  await expect(page.getByRole('button', { name: 'Publicar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  const linha = page.getByRole('row', { name: /Vitrine da semana/ });
  await expect(linha.getByText('Esperando aprovação')).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();

  // Quem aprova vê o pedido, a pré-visualização e recusa.
  await entrar(page, aprovador.email, aprovador.senha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Aprovação (1)' }).click();
  await expect(page.getByText(/enviado por Editora Ana/)).toBeVisible();
  await page.getByRole('button', { name: 'Ver e decidir' }).click();
  const previa = page.getByLabel('Pré-visualização da tela');
  await expect(previa.getByTestId('titulo-tela')).toHaveText('Titulo com erro');
  await page.screenshot({ path: 'test-results/aprovacao-decidir.png' });
  await page.getByRole('button', { name: 'Recusar' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar recusa' })).toBeDisabled();
  await page.getByLabel('O que precisa mudar').fill('Corrigir o acento do título');
  await page.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(page.getByText('Nada esperando aprovação.')).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();

  // Quem editou vê o motivo, abre onde parou e envia de novo.
  await entrar(page, editor.email, editor.senha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await expect(linha.getByText('Recusado', { exact: true })).toBeVisible();
  await expect(linha.getByText(/Gerente Bia: Corrigir o acento/)).toBeVisible();
  await page.screenshot({ path: 'test-results/aprovacao-recusado.png' });
  await linha.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByText(/Recusado por Gerente Bia/)).toBeVisible();
  await expect(page.getByLabel('Título')).toHaveValue('Titulo com erro');
  await page.getByLabel('Título').fill('Título certo');
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(linha.getByText('Esperando aprovação')).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();

  await entrar(page, aprovador.email, aprovador.senha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Aprovação (1)' }).click();
  await page.getByRole('button', { name: 'Ver e decidir' }).click();
  await expect(page.getByLabel('Pré-visualização da tela').getByTestId('titulo-tela')).toHaveText('Título certo');
  await page.getByRole('button', { name: 'Aprovar e publicar' }).click();
  await expect(page.getByText('Nada esperando aprovação.')).toBeVisible();
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await expect(linha.getByText(/Aprovado por Gerente Bia/)).toBeVisible();

  const [{ id }] = await sql(`SELECT id FROM conteudos_tela WHERE empresa_id = $1 AND nome = 'Vitrine da semana'`, [empresa.id]);
  await gravarDados(id);
  const tv = await context.newPage();
  await tv.setViewportSize({ width: 1280, height: 720 });
  await tv.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
  await tv.goto('/tv');
  await expect(tv.getByTestId('titulo-tela')).toHaveText('Título certo');

  // Mudança no conteúdo no ar: mostra o que muda, e a TV segue igual até aprovar.
  await page.getByRole('button', { name: 'Sair' }).click();
  await entrar(page, editor.email, editor.senha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await linha.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByRole('button', { name: /Salvar/ })).toHaveCount(0);
  await page.getByLabel('Título').fill('Título novo');
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(linha.getByText('Mudança esperando aprovação')).toBeVisible();
  await tv.reload();
  await expect(tv.getByTestId('titulo-tela')).toHaveText('Título certo');
  await page.getByRole('button', { name: 'Sair' }).click();

  await entrar(page, aprovador.email, aprovador.senha);
  await page.goto('/telas');
  await page.getByRole('tab', { name: 'Aprovação (1)' }).click();
  await expect(page.getByText(/mudança em conteúdo no ar/)).toBeVisible();
  await page.getByRole('button', { name: 'Ver e decidir' }).click();
  await expect(page.getByText('O que muda em relação ao que está no ar').locator('..').getByText('Título', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/aprovacao-mudanca.png' });
});

test('mantém a TV acordada: vídeo tocando, sem erro, e o site mostra o que o navegador deixou', async ({ browser }) => {
  // Cada caso espera um aviso de verdade, que sai a cada 30 s.
  test.setTimeout(180_000);
  const empresa = await criarEmpresa(tokenSuper);
  const situacaoNoSite = async (id: string) => ((await pedir('GET', '/telas', { token: empresa.adminToken })).j as { id: string; telaAcesa: string | null }[]).find((t) => t.id === id)?.telaAcesa;

  async function abrir(nome: string, preparar: string) {
    const tela = await telaVinculada(empresa, nome);
    const contexto = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const tv = await contexto.newPage();
    const erros: string[] = [];
    tv.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
    await tv.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
    await tv.addInitScript(preparar);
    await tv.goto('/tv');
    return { tela, tv, contexto, erros };
  }

  // Sem o pedido oficial, como em muitas TVs: o vídeo segura sozinho, e tocando de verdade.
  const soVideo = await abrir('TV só vídeo', `Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => undefined });`);
  const video = soVideo.tv.getByTestId('video-acordada');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2 && !!v.currentSrc)).toBe(true);
  const antes = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).not.toBe(antes);
  expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, Math.round(v.getBoundingClientRect().width)])).toEqual([true, true, 2]);
  // O primeiro aviso sai antes de o vídeo abrir e não acusa nada: quem conta é o seguinte.
  expect(await situacaoNoSite(soVideo.tela.id)).toBeNull();
  await expect.poll(() => situacaoNoSite(soVideo.tela.id), { timeout: 40_000 }).toBe('SO_VIDEO');
  expect(soVideo.erros).toEqual([]);
  await soVideo.contexto.close();

  // Com o pedido aceito.
  const aceito = await abrir('TV aceita', `Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => ({ request: async () => Object.assign(new EventTarget(), { release: async () => undefined }) }) });`);
  await expect.poll(() => situacaoNoSite(aceito.tela.id), { timeout: 40_000 }).toBe('PEDIDO_ACEITO');
  await aceito.contexto.close();

  // Sem nenhum dos dois: o site avisa, e a página segue funcionando.
  const nada = await abrir('TV recusa', `Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => ({ request: () => Promise.reject(new Error('negado')) }) }); HTMLMediaElement.prototype.play = () => Promise.reject(new Error('negado')); Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get: () => true });`);
  await expect.poll(() => situacaoNoSite(nada.tela.id), { timeout: 40_000 }).toBe('RECUSADO');
  await nada.contexto.close();

  // Player antigo não informa: fica vazio, sem erro.
  const antiga = await telaVinculada(empresa, 'TV antiga');
  expect((await pedir('POST', '/tv/aviso', { token: antiga.token, corpo: { ...RESOLUCAO, versao: '4' } })).status).toBe(200);
  expect(await situacaoNoSite(antiga.id)).toBeNull();
  // Valor inventado não entra.
  expect((await pedir('POST', '/tv/aviso', { token: antiga.token, corpo: { ...RESOLUCAO, telaAcesa: 'qualquer' } })).status).toBe(400);
});

test('logomarca e fundo: regras da API, isolamento, em uso e o que a TV recebe', async () => {
  const empresa = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV aparência');
  const consultaId = await criarConsulta(empresa);
  const consultaOutra = await criarConsulta(outra);
  const logo = (await enviarImagem(empresa, { nome: 'logo.png' })).j.id as string;
  const fundo = (await enviarImagem(empresa, { nome: 'fundo.png' })).j.id as string;

  // O endereço é público, mas o id de outra empresa não vira logomarca aqui.
  for (const campo of ['logoImagemId', 'fundoImagemId']) {
    const roubo = await pedir('POST', '/telas/conteudos', { token: outra.adminToken, corpo: corpoConteudo(`Roubo ${campo}`, consultaOutra, { config: { ...CONFIG, [campo]: logo } }) });
    expect(roubo.status).toBe(400);
    expect(roubo.j.message).toMatch(/não são desta empresa/);
  }
  expect((await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoConteudo('Véu errado', consultaId, { config: { ...CONFIG, fundoImagemId: fundo, fundoVeu: 10 } }) })).status).toBe(400);
  expect((await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: corpoConteudo('Id errado', consultaId, { config: { ...CONFIG, logoImagemId: 'nao-e-id' } }) })).status).toBe(400);

  const corpo = corpoConteudo('Com marca', consultaId, { config: { ...CONFIG, logoImagemId: logo, fundoImagemId: fundo, fundoVeu: 60 } });
  const c = await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo });
  expect(c.status).toBe(201);
  await pedir('POST', `/telas/conteudos/${c.j.id}/publicar`, { token: empresa.adminToken, corpo: { telaIds: [tela.id] } });
  await gravarDados(c.j.id);

  const p = (await pedir('POST', '/tv/programacao', { token: tela.token, corpo: {} })).j.programas[0];
  expect(p.logo).toBe(`/api/tv/imagens/${logo}`);
  expect(p.fundo).toEqual({ url: `/api/tv/imagens/${fundo}`, veu: 60 });

  // Logomarca e fundo também contam como uso: sem isto, excluir a imagem deixaria a tela sem ela.
  for (const id of [logo, fundo]) expect((await pedir('DELETE', `/telas/conteudos/imagens/${id}`, { token: empresa.adminToken })).status).toBe(409);
  const galeria = (await pedir('GET', '/telas/conteudos/imagens', { token: empresa.adminToken })).j as { id: string; usos: number }[];
  expect(galeria.find((i) => i.id === logo)?.usos).toBe(1);

  // Tirar a logomarca libera a imagem e a TV deixa de receber.
  const semLogo = await pedir('PUT', `/telas/conteudos/${c.j.id}`, { token: empresa.adminToken, corpo: { ...corpo, config: { ...corpo.config as object, logoImagemId: null } } });
  expect(semLogo.status).toBe(200);
  await gravarDados(c.j.id);
  const p2 = (await pedir('POST', '/tv/programacao', { token: tela.token, corpo: {} })).j.programas[0];
  expect(p2.logo).toBeUndefined();
  expect((await pedir('DELETE', `/telas/conteudos/imagens/${logo}`, { token: empresa.adminToken })).status).toBe(204);

  // No modelo de imagens, nada disso fica guardado nem preso: o banner já traz a arte.
  const banner = (await enviarImagem(empresa, { nome: 'banner.png' })).j.id as string;
  const soImagens = corpoImagens('Só banner', [banner]);
  const i = await pedir('POST', '/telas/conteudos', { token: empresa.adminToken, corpo: { ...soImagens, config: { ...soImagens.config, fundoImagemId: fundo } } });
  expect(i.status).toBe(201);
  expect(i.j.config.fundoImagemId).toBeNull();
});

test('logomarca e fundo pelo site, cabendo em todos os modelos e formatos', async ({ page, context }) => {
  test.setTimeout(240_000);
  const empresa = await criarEmpresa(tokenSuper);
  const tela = await telaVinculada(empresa, 'TV da marca');
  const consultaId = await criarConsulta(empresa);

  await page.setViewportSize({ width: 1400, height: 1200 });
  await entrar(page, empresa.adminEmail, empresa.adminSenha);
  await page.goto('/telas');
  // Logomarca bem larga e fundo claro e movimentado: os casos que atrapalham.
  const desenhar = (largura: number, altura: number, tipo: 'logo' | 'fundo') =>
    page.evaluate(
      ([l, a, t]) => {
        const c = document.createElement('canvas');
        c.width = l as number;
        c.height = a as number;
        const g = c.getContext('2d')!;
        if (t === 'logo') {
          g.fillStyle = '#ef4444';
          g.fillRect(0, 0, c.width, c.height);
          g.fillStyle = '#ffffff';
          g.font = `bold ${c.height * 0.7}px sans-serif`;
          g.textAlign = 'center';
          g.fillText('MINHA LOJA', c.width / 2, c.height * 0.75);
        } else {
          for (let x = 0; x < c.width; x += 80) {
            for (let y = 0; y < c.height; y += 80) {
              g.fillStyle = (x + y) % 160 ? '#ffffff' : '#60a5fa';
              g.fillRect(x, y, 80, 80);
            }
          }
        }
        return c.toDataURL('image/png').split(',')[1];
      },
      [largura, altura, tipo],
    );
  await page.getByRole('tab', { name: 'Conteúdo' }).click();
  await page.getByRole('button', { name: 'Novo conteúdo' }).click();
  await page.getByLabel('Nome do conteúdo').fill('Ofertas com marca');
  await page.getByRole('combobox', { name: /^Consulta/ }).selectOption(consultaId);
  await page.getByRole('combobox', { name: 'Coluna do nome' }).selectOption('descricao');
  await page.getByRole('combobox', { name: 'Coluna do preço' }).selectOption('preco');
  await page.getByLabel('Título').fill('Ofertas da semana');

  await page.getByLabel('Arquivo: Logomarca').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(await desenhar(900, 200, 'logo'), 'base64') });
  const previa = page.getByLabel('Pré-visualização da tela');
  await expect(previa.getByTestId('logo-tela')).toBeVisible();
  await page.getByLabel('Arquivo: Imagem de fundo').setInputFiles({ name: 'fundo.png', mimeType: 'image/png', buffer: Buffer.from(await desenhar(1920, 1080, 'fundo'), 'base64') });
  await expect(previa.getByTestId('fundo-tela')).toBeVisible();
  await expect.poll(() => previa.getByTestId('fundo-tela').locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1920);
  await page.getByRole('combobox', { name: 'Como a imagem de fundo aparece' }).selectOption('90');
  await expect.poll(() => previa.getByTestId('veu-tela').evaluate((v) => getComputedStyle(v).opacity)).toBe('0.9');
  await page.getByRole('combobox', { name: 'Como a imagem de fundo aparece' }).selectOption('75');
  await page.screenshot({ path: 'test-results/marca-editor.png' });

  // Cor média sobre imagem: quem edita fica sabendo antes de publicar.
  await page.getByLabel('Cor de fundo').fill('#808080');
  await expect(page.getByText(/o texto pode ficar difícil de ler/)).toBeVisible();
  await page.getByLabel('Cor de fundo').fill('#0f172a');
  await expect(page.getByText(/o texto pode ficar difícil de ler/)).toHaveCount(0);

  await page.getByRole('checkbox', { name: /TV da marca/ }).check();
  await page.getByRole('button', { name: 'Publicar' }).click();
  // Sem agente neste teste a consulta falha, a tela diz por quê, e os dados entram direto no banco.
  await expect(page.getByText(/Publicado, mas ainda não está na tela/)).toBeVisible();
  const [{ id }] = await sql(`SELECT id FROM conteudos_tela WHERE empresa_id = $1 AND nome = 'Ofertas com marca'`, [empresa.id]);

  // O pior caso: nome enorme e preço alto, em todos os produtos.
  const itens = Array.from({ length: 12 }, (_, i) => ({ nome: `Produto ${i + 1} com um nome extremamente comprido que o ERP cortaria em algum lugar 5kg embalagem econômica`, preco: 'R$ 12.349,90', precoDe: 'R$ 15.999,90', detalhe: 'Unidade' }));
  await sql(`UPDATE conteudos_tela SET itens = $2, quantidade_itens = $3, dados_em = (now() at time zone 'utc'), erro = NULL WHERE id = $1`, [id, JSON.stringify(itens), itens.length]);

  const tv = await context.newPage();
  await tv.addInitScript((t) => localStorage.setItem('etiquetas.tv.token', t), tela.token);
  const problemas: string[] = [];
  for (const modelo of ['GRADE_OFERTAS', 'DESTAQUE', 'LISTA_PRECOS']) {
    await sql(`UPDATE conteudos_tela SET modelo = $2, atualizado_em = now() WHERE id = $1`, [id, modelo]);
    for (const [largura, altura] of [[1920, 1080], [1080, 1920], [1280, 800], [960, 320], [128, 64]]) {
      await tv.setViewportSize({ width: largura, height: altura });
      await tv.evaluate(() => localStorage.removeItem('etiquetas.tv.programacao')).catch(() => undefined);
      await tv.goto('/tv');
      await expect(tv.getByTestId('cena-tela')).toBeVisible();
      await tv.waitForTimeout(900);
      const m = await tv.evaluate(() => {
        const r = (s: string) => document.querySelector(`[data-testid="${s}"]`)?.getBoundingClientRect() ?? null;
        const logo = r('logo-tela');
        const titulo = document.querySelector('[data-testid="titulo-tela"] span')?.getBoundingClientRect() ?? null;
        const primeira = r('celula-tela');
        const img = document.querySelector<HTMLImageElement>('[data-testid="fundo-tela"] img');
        const erros: string[] = [];
        const janela = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        if (logo && (logo.left < -1 || logo.top < -1 || logo.right > janela.right + 1 || logo.bottom > janela.bottom + 1)) erros.push('logomarca fora da tela');
        if (logo && titulo && logo.right > titulo.left + 1) erros.push('logomarca sobre o título');
        if (logo && primeira && logo.bottom > primeira.top + 1) erros.push('logomarca sobre os produtos');
        if (titulo && (titulo.left < -1 || titulo.right > janela.right + 1)) erros.push('título fora da tela');
        if (img && !img.naturalWidth) erros.push('fundo não abriu');
        if (img && (img.getBoundingClientRect().width < innerWidth - 1 || img.getBoundingClientRect().height < innerHeight - 1)) erros.push('fundo sem cobrir a tela');
        return { logo: !!logo, fundo: !!img, celulas: document.querySelectorAll('[data-testid="celula-tela"]').length, erros };
      });
      const pequena = Math.min(largura, altura) < 200;
      const faixa = altura === 320;
      if (m.logo !== (!pequena && !faixa)) problemas.push(`${modelo} ${largura}x${altura}: logomarca ${m.logo ? 'apareceu' : 'sumiu'}`);
      if (m.fundo !== !pequena) problemas.push(`${modelo} ${largura}x${altura}: fundo ${m.fundo ? 'apareceu' : 'sumiu'}`);
      if (m.celulas === 0) problemas.push(`${modelo} ${largura}x${altura}: sem células`);
      for (const erro of m.erros) problemas.push(`${modelo} ${largura}x${altura}: ${erro}`);
      await tv.screenshot({ path: `test-results/marca-${modelo}-${largura}x${altura}.png` });
    }
  }
  expect(problemas).toEqual([]);

  // A imagem some do servidor: a cena continua, só com a cor e o título.
  await tv.setViewportSize({ width: 1280, height: 720 });
  await sql(`UPDATE conteudos_tela SET modelo = 'DESTAQUE', atualizado_em = now() WHERE id = $1`, [id]);
  await tv.route('**/api/tv/imagens/**', (r) => r.abort());
  await tv.evaluate(async () => {
    localStorage.removeItem('etiquetas.tv.programacao');
    for (const k of await caches.keys().catch(() => [])) await caches.delete(k);
  });
  await tv.goto('/tv');
  await expect(tv.getByTestId('cena-tela')).toBeVisible();
  await expect(tv.getByTestId('logo-tela')).toHaveCount(0);
  await expect(tv.getByTestId('fundo-tela')).toHaveCount(0);
  await expect(tv.getByTestId('titulo-tela')).toBeVisible();
  await expect(tv.getByTestId('preco-tela').first()).toBeVisible();
});
