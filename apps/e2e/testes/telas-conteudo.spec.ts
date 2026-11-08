import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, pedir, sql, superToken, type EmpresaTeste } from './apoio';

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

async function telaVinculada(empresa: EmpresaTeste, nome: string) {
  const p = await pedir('POST', '/tv/pedidos', { corpo: RESOLUCAO, ip: `10.94.${Math.floor(Math.random() * 250)}.1` });
  const v = await pedir('POST', '/telas/vincular', { token: empresa.adminToken, corpo: { codigo: p.j.codigo, nome, novoPerfil: { nome: `Perfil ${nome} ${p.j.codigo}`, tipo: 'TV', largura: 1280, altura: 720, nivelAnimacao: 'COMPLETO' } } });
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
