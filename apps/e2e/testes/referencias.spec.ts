import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { criarEmpresa, pedir, sql, SUPER, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let e: EmpresaTeste;

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
});

const aliasNovo = () => `campo_${randomUUID().slice(0, 8).replace(/-/g, '')}`;

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('o índice nasce com os campos do sistema e as obrigatórias', async () => {
  const r = await pedir('GET', '/referencias', { token: e.adminToken });
  expect(r.status).toBe(200);
  const codigo = r.j.find((x: any) => x.alias === 'codigo');
  expect(codigo).toMatchObject({ sistema: true, obrigatoriaEm: ['LISTA_DIARIA', 'BUSCA_PRODUTO'] });
  expect(r.j.find((x: any) => x.alias === 'preco')).toMatchObject({ sistema: false, obrigatoriaEm: [] });
});

test('só o super-admin altera; quem vê consultas pode ler; sem login, não', async () => {
  const corpo = { alias: aliasNovo(), nome: 'Teste' };
  expect((await pedir('POST', '/referencias', { token: e.adminToken, corpo })).status).toBe(403);
  const [alguma] = (await pedir('GET', '/referencias', { token: tokenSuper })).j;
  expect((await pedir('PATCH', `/referencias/${alguma.id}`, { token: e.adminToken, corpo: { nome: 'Invadido' } })).status).toBe(403);
  expect((await pedir('DELETE', `/referencias/${alguma.id}`, { token: e.adminToken })).status).toBe(403);
  expect((await pedir('GET', '/referencias')).status).toBe(401);
  const perfil = await pedir('POST', '/perfis', { token: e.adminToken, corpo: { nome: `Sem SQL ${aliasNovo()}`, permissoes: ['imprimir'] } });
  const email = `sem-sql-${aliasNovo()}@e2e.local`;
  await pedir('POST', '/usuarios', { token: e.adminToken, corpo: { nome: 'Sem SQL', email, senha: 'SenhaSemSql123', perfilId: perfil.j.id } });
  const login = await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaSemSql123' } });
  expect((await pedir('GET', '/referencias', { token: login.j.token })).status).toBe(403);
});

test('cadastro: criar, marcar como obrigatório, editar e excluir', async () => {
  const alias = aliasNovo();
  const r = await pedir('POST', '/referencias', { token: tokenSuper, corpo: { alias, nome: 'Código NCM', exemplo: '09012100', alternativos: [`${alias}_a`, ` ${alias.toUpperCase()}_B `], obrigatoriaEm: ['LISTA_DIARIA'] } });
  expect(r.status, JSON.stringify(r.j)).toBe(201);
  expect(r.j.alternativos).toEqual([`${alias}_a`, `${alias}_b`]);
  expect(r.j.obrigatoriaEm).toEqual(['LISTA_DIARIA']);
  const editado = await pedir('PATCH', `/referencias/${r.j.id}`, { token: tokenSuper, corpo: { obrigatoriaEm: [], ativa: false } });
  expect(editado.j).toMatchObject({ obrigatoriaEm: [], ativa: false });
  expect((await pedir('DELETE', `/referencias/${r.j.id}`, { token: tokenSuper })).status).toBe(204);
  const log = await sql(`SELECT acao FROM logs_auditoria WHERE entidade_id = $1 ORDER BY criado_em`, [r.j.id]);
  expect(log.map((l) => l.acao)).toEqual(['referencia.criar', 'referencia.editar', 'referencia.excluir']);
});

test('nomes inválidos ou repetidos são recusados', async () => {
  for (const alias of ['Com Espaco', 'preço', '1abc', '']) {
    expect((await pedir('POST', '/referencias', { token: tokenSuper, corpo: { alias, nome: 'X y' } })).status, alias).toBe(400);
  }
  expect((await pedir('POST', '/referencias', { token: tokenSuper, corpo: { alias: 'codigo', nome: 'X y' } })).status).toBe(409);
  // Nome alternativo de outro campo também não: a mesma coluna teria dois significados.
  expect((await pedir('POST', '/referencias', { token: tokenSuper, corpo: { alias: 'ean', nome: 'X y' } })).status).toBe(409);
  expect((await pedir('POST', '/referencias', { token: tokenSuper, corpo: { alias: aliasNovo(), nome: 'X y', alternativos: ['descricao'] } })).status).toBe(409);
  expect((await pedir('POST', '/referencias', { token: tokenSuper, corpo: { alias: aliasNovo(), nome: 'X y', obrigatoriaEm: ['INVENTADA'] } })).status).toBe(400);
});

test('campo do sistema: dá para mudar texto e obrigatoriedade, mas não o nome nem excluir', async () => {
  const quantidade = (await pedir('GET', '/referencias', { token: tokenSuper })).j.find((x: any) => x.alias === 'quantidade');
  expect((await pedir('PATCH', `/referencias/${quantidade.id}`, { token: tokenSuper, corpo: { alias: 'qtd_nova' } })).status).toBe(400);
  expect((await pedir('PATCH', `/referencias/${quantidade.id}`, { token: tokenSuper, corpo: { alternativos: ['outra'] } })).status).toBe(400);
  expect((await pedir('PATCH', `/referencias/${quantidade.id}`, { token: tokenSuper, corpo: { ativa: false } })).status).toBe(400);
  expect((await pedir('DELETE', `/referencias/${quantidade.id}`, { token: tokenSuper })).status).toBe(400);
  const ok = await pedir('PATCH', `/referencias/${quantidade.id}`, { token: tokenSuper, corpo: { nome: quantidade.nome, obrigatoriaEm: quantidade.obrigatoriaEm, alternativos: [...quantidade.alternativos].reverse() } });
  expect(ok.status, JSON.stringify(ok.j)).toBe(200);
});

test('pela tela: marcar um campo como obrigatório e ele aparece assim no índice', async ({ page }) => {
  const alias = aliasNovo();
  await entrar(page, SUPER.email, SUPER.senha);
  await page.getByRole('link', { name: 'Índice de campos' }).click();
  await expect(page.getByRole('heading', { name: 'Índice de campos', level: 1 })).toBeVisible();
  await page.screenshot({ path: 'test-results/indice-campos.png', fullPage: true });
  await page.getByRole('button', { name: 'Novo campo' }).click();
  await page.getByLabel('Alias').fill(alias);
  await page.getByLabel('O que é').fill('Código NCM');
  await page.getByLabel('Lista do dia').check();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByLabel('Procurar campo').fill(alias);
  await expect(page.getByRole('row', { name: new RegExp(alias) }).getByText('Lista do dia')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: `Excluir ${alias}` }).click();
  await expect(page.getByRole('button', { name: `Excluir ${alias}` })).toBeHidden();
  // Sem o campo novo obrigatório sobrando para os outros testes.
  expect((await sql(`SELECT id FROM referencias_campo WHERE alias = $1`, [alias])).length).toBe(0);
});

test('pela tela: administrador de empresa só lê; o sistema não oferece Excluir', async ({ page }) => {
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.getByRole('link', { name: 'Índice de campos' }).click();
  await expect(page.getByRole('cell', { name: 'codigo_barras Sistema' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo campo' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^Editar / })).toHaveCount(0);
});

test('editor de consulta: inserir alias e ver o que falta conforme a finalidade', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const ag = await pedir('POST', '/agentes', { token: e.adminToken, corpo: { nome: `A ${aliasNovo()}` } });
  const con = await pedir('POST', '/conexoes', { token: e.adminToken, corpo: { nome: `PG ${aliasNovo()}`, tipo: 'POSTGRES', agenteId: ag.j.agente?.id ?? ag.j.id, host: 'localhost', porta: 5432, banco: 'erp', usuario: 'u', senha: 's' } });
  expect(con.status, JSON.stringify(con.j)).toBe(201);
  // O agente não está no ar nos testes: só a execução é simulada.
  await page.route('**/api/consultas/previa', (r) =>
    r.fulfill({ json: { resultado: { colunas: [{ nome: 'cod', tipo: 'INT4' }, { nome: 'preco', tipo: 'NUMERIC' }, { nome: 'cor', tipo: 'TEXT' }], linhas: [], truncado: false, duracaoMs: 1 }, campos: [{ nome: 'cod', tipoBanco: 'INT4', categoria: 'numero' }, { nome: 'preco', tipoBanco: 'NUMERIC', categoria: 'numero' }, { nome: 'cor', tipoBanco: 'TEXT', categoria: 'texto' }], sqlExecutado: 'select', parametros: [], placeholders: [], avisos: [] } }),
  );
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.goto('/consultas/nova');
  await page.getByLabel('SQL').fill('SELECT p.nome');
  await page.getByLabel('Inserir AS descricao: Descrição do produto').click();
  await expect(page.getByLabel('SQL')).toHaveValue('SELECT p.nome AS descricao');

  await page.getByRole('button', { name: 'Testar' }).click();
  const indice = page.getByRole('complementary');
  await expect(indice.getByRole('button', { name: /Inserir AS codigo:/ }).getByText('✓ cod')).toBeVisible();
  await expect(indice.getByRole('button', { name: /Inserir AS descricao:/ }).getByText('Falta')).toBeVisible();
  await expect(page.getByText('a consulta precisa deste campo: descricao')).toBeVisible();
  // A coluna ganha o significado; a desconhecida fica como campo livre.
  await expect(indice.getByText('Código do produto').first()).toBeVisible();
  await expect(indice.getByText('Campo livre')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-indice.png', fullPage: true });

  // Finalidade "Outra" não exige nada.
  await page.getByLabel('Finalidade').selectOption('OUTRA');
  await expect(indice.getByText('Falta')).toHaveCount(0);
  expect(erros).toEqual([]);
});
