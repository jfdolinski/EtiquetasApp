import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, montarListaDeHoje, pedir, sql, SUPER, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let e: EmpresaTeste;
let consultaId: string;

/** A consulta só existe para dar nome às colunas: nada aqui precisa de agente. */
async function ligarConsulta(empresa: EmpresaTeste, modeloId: string) {
  const conexao = randomUUID();
  const consulta = randomUUID();
  await sql(`INSERT INTO conexoes_banco (id, empresa_id, nome, tipo, host, porta, banco, usuario, atualizado_em) VALUES ($1, $2, $3, 'POSTGRES', 'localhost', 5432, 'erp', 'leitor', now())`, [conexao, empresa.id, `Conexão ${conexao.slice(0, 6)}`]);
  await sql(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, finalidade, sql, campos, atualizado_em) VALUES ($1, $2, $3, $4, 'BUSCA_PRODUTO', 'SELECT 1', $5, now())`, [consulta, empresa.id, conexao, `Consulta ${consulta.slice(0, 6)}`, JSON.stringify([{ nome: 'ean' }, { nome: 'descricao' }, { nome: 'preco' }])]);
  await sql(`UPDATE modelos_etiqueta SET consulta_id = $1 WHERE id = $2`, [consulta, modeloId]);
  return consulta;
}

async function entrar(page: Page, email: string, senha: string, empresa?: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.91.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
  if (empresa) await page.evaluate((id) => localStorage.setItem('etiquetas.empresaSelecionada', id), empresa);
}

test.beforeEach(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
  const { modeloId } = await montarListaDeHoje(e, { produtos: ['7891000100103'] });
  consultaId = await ligarConsulta(e, modeloId);
});

test('super-admin liga a opção, renomeia na Lista do dia e salva; a etiqueta segue com o nome original', async ({ page }) => {
  await entrar(page, SUPER.email, SUPER.senha, e.id);
  await page.goto('/hoje');
  await expect(page.locator('thead').getByText('preco', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Renomear colunas' }).click();
  await page.getByLabel('Nome da coluna preco').fill('Preço de venda');
  await page.getByRole('button', { name: 'Salvar nomes' }).click();
  await expect(page.locator('thead').getByText('Preço de venda', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Renomear colunas' })).toBeVisible();

  // Só o nome mudou: o dado continua na coluna original.
  const hoje = await pedir('GET', '/listas/hoje', { token: e.adminToken });
  expect(hoje.j.lista.modelos[0].rotulos).toEqual({ preco: 'Preço de venda' });
  expect(hoje.j.lista.itens[0].registro.preco).toBe('4.99');

  // Apagar o nome volta ao original.
  await page.getByRole('button', { name: 'Renomear colunas' }).click();
  await page.getByLabel('Nome da coluna preco').fill('');
  await page.getByRole('button', { name: 'Salvar nomes' }).click();
  await expect(page.locator('thead').getByText('preco', { exact: true })).toBeVisible();
});

test('Cancelar não guarda nada, e a Etiqueta avulsa também renomeia', async ({ page }) => {
  await entrar(page, SUPER.email, SUPER.senha, e.id);
  await page.goto('/avulsa');
  await page.getByRole('button', { name: 'Renomear colunas' }).click();
  await page.getByLabel('Nome da coluna descricao').fill('Não fica');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('thead').getByText('descricao', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Renomear colunas' }).click();
  await page.getByLabel('Nome da coluna descricao').fill('Produto');
  await page.getByRole('button', { name: 'Salvar nomes' }).click();
  await expect(page.locator('thead').getByText('Produto', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ Nova linha' }).click();
  await expect(page.getByLabel('Produto', { exact: true })).toBeVisible();
});

test('administrador comum vê os nomes, mas não tem a opção nem consegue salvar', async ({ page }) => {
  await pedir('PUT', `/consultas/${consultaId}/rotulos`, { token: tokenSuper, empresa: e.id, corpo: { rotulos: { preco: 'Valor' } } });
  const r = await pedir('PUT', `/consultas/${consultaId}/rotulos`, { token: e.adminToken, corpo: { rotulos: { preco: 'Outro' } } });
  expect(r.status).toBe(403);
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.goto('/hoje');
  await expect(page.locator('thead').getByText('Valor', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Renomear colunas' })).toHaveCount(0);
});

test('mudou a consulta, voltam os nomes originais', async () => {
  await pedir('PUT', `/consultas/${consultaId}/rotulos`, { token: tokenSuper, empresa: e.id, corpo: { rotulos: { preco: 'Valor' } } });
  const rotulos = async () => (await pedir('GET', '/listas/hoje', { token: e.adminToken })).j.lista.modelos[0].rotulos;
  expect(await rotulos()).toEqual({ preco: 'Valor' });
  await sql(`UPDATE consultas_sql SET sql = 'SELECT 2' WHERE id = $1`, [consultaId]);
  expect(await rotulos()).toEqual({});
});

test('nome longo é recusado e a consulta de outra empresa não existe', async () => {
  const longo = await pedir('PUT', `/consultas/${consultaId}/rotulos`, { token: tokenSuper, empresa: e.id, corpo: { rotulos: { preco: 'x'.repeat(61) } } });
  expect(longo.status).toBe(400);
  const outra = await criarEmpresa(tokenSuper);
  const r = await pedir('PUT', `/consultas/${consultaId}/rotulos`, { token: tokenSuper, empresa: outra.id, corpo: { rotulos: { preco: 'Valor' } } });
  expect(r.status).toBe(404);
});
