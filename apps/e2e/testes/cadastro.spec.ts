import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { cnpjValido, criarEmpresa, login, pedir, sql, SUPER, superToken, type EmpresaTeste } from './apoio';

const SENHA = 'SenhaCadastro123';
const MENSAGEM = 'Cadastro recebido. Você poderá entrar assim que um administrador aprovar.';
const novoEmail = () => `novo-${randomUUID().slice(0, 8)}@e2e.local`;
const cadastrar = (cnpj: string, email: string, senha = SENHA) => pedir('POST', '/cadastros', { corpo: { cnpj, email, senha } });

let tokenSuper: string;
let e: EmpresaTeste;
let cnpjDeE: string;

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
  [{ cnpj: cnpjDeE }] = await sql(`SELECT cnpj FROM empresas WHERE id = $1`, [e.id]);
});

test('empresa ativa: usuário fica pendente até o administrador aprovar com um perfil', async () => {
  const email = novoEmail();
  const r = await cadastrar(cnpjDeE, email);
  expect(r.status).toBe(202);
  expect(r.j.mensagem).toBe(MENSAGEM);

  const barrado = await pedir('POST', '/auth/login', { corpo: { email, senha: SENHA } });
  expect(barrado.status).toBe(401);
  expect(barrado.j.message).toContain('aguarda a aprovação');
  // Senha errada não revela que existe um pedido.
  expect((await pedir('POST', '/auth/login', { corpo: { email, senha: 'errada123' } })).j.message).toBe('E-mail ou senha inválidos.');

  expect((await pedir('GET', '/usuarios/pendentes/contagem', { token: e.adminToken })).j.quantidade).toBe(1);
  const lista = await pedir('GET', '/usuarios', { token: e.adminToken });
  const pendente = lista.j.find((u: any) => u.email === email);
  expect(pendente.cadastroPendente).toBe(true);

  // Editar não serve de atalho para aprovar.
  expect((await pedir('PATCH', `/usuarios/${pendente.id}`, { token: e.adminToken, corpo: { ativo: true } })).status).toBe(400);
  expect((await pedir('POST', `/usuarios/${pendente.id}/aprovar`, { token: e.adminToken, corpo: {} })).status).toBe(400);

  const perfis = await pedir('GET', '/perfis', { token: e.adminToken });
  const aprovado = await pedir('POST', `/usuarios/${pendente.id}/aprovar`, { token: e.adminToken, corpo: { perfilId: perfis.j[0].id } });
  expect(aprovado.status, JSON.stringify(aprovado.j)).toBe(200);
  await login(email, SENHA);
  expect((await pedir('POST', `/usuarios/${pendente.id}/aprovar`, { token: e.adminToken, corpo: { perfilId: perfis.j[0].id } })).status).toBe(404);
  expect((await pedir('GET', '/usuarios/pendentes/contagem', { token: e.adminToken })).j.quantidade).toBe(0);
});

test('recusar apaga o pedido e o e-mail fica livre', async () => {
  const email = novoEmail();
  await cadastrar(cnpjDeE, email);
  const pendente = (await pedir('GET', '/usuarios', { token: e.adminToken })).j.find((u: any) => u.email === email);
  expect((await pedir('POST', `/usuarios/${pendente.id}/recusar`, { token: e.adminToken })).status).toBe(204);
  expect((await pedir('POST', '/auth/login', { corpo: { email, senha: SENHA } })).j.message).toBe('E-mail ou senha inválidos.');
  expect((await cadastrar(cnpjDeE, email)).status).toBe(202);
});

test('recusar não apaga usuário de verdade, e outra empresa não mexe no pedido', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const email = novoEmail();
  await cadastrar(cnpjDeE, email);
  const lista = (await pedir('GET', '/usuarios', { token: e.adminToken })).j;
  const pendente = lista.find((u: any) => u.email === email);
  const ativo = lista.find((u: any) => u.email === e.adminEmail);
  expect((await pedir('POST', `/usuarios/${ativo.id}/recusar`, { token: e.adminToken })).status).toBe(404);

  const perfis = await pedir('GET', '/perfis', { token: outra.adminToken });
  expect((await pedir('POST', `/usuarios/${pendente.id}/aprovar`, { token: outra.adminToken, corpo: { perfilId: perfis.j[0].id } })).status).toBe(404);
  expect((await pedir('POST', `/usuarios/${pendente.id}/recusar`, { token: outra.adminToken })).status).toBe(404);
  // Perfil de outra empresa não vale.
  expect((await pedir('POST', `/usuarios/${pendente.id}/aprovar`, { token: e.adminToken, corpo: { perfilId: perfis.j[0].id } })).status).toBe(400);
});

test('sem a permissão de editar usuários não aprova', async () => {
  const perfil = await pedir('POST', '/perfis', { token: e.adminToken, corpo: { nome: `Vê ${randomUUID().slice(0, 6)}`, permissoes: ['usuario.ver'] } });
  const email = novoEmail();
  await pedir('POST', '/usuarios', { token: e.adminToken, corpo: { nome: 'Leitor', email, senha: SENHA, perfilId: perfil.j.id } });
  const token = await login(email, SENHA);
  const novo = novoEmail();
  await cadastrar(cnpjDeE, novo);
  const pendente = (await pedir('GET', '/usuarios', { token })).j.find((u: any) => u.email === novo);
  expect((await pedir('POST', `/usuarios/${pendente.id}/aprovar`, { token, corpo: { perfilId: perfil.j.id } })).status).toBe(403);
  expect((await pedir('POST', `/usuarios/${pendente.id}/recusar`, { token })).status).toBe(403);
});

test('CNPJ novo: empresa nasce pendente e o super-admin aprova; quem pediu vira administrador', async () => {
  const cnpj = cnpjValido();
  const email = novoEmail();
  const segundo = novoEmail();
  expect((await cadastrar(cnpj, email)).j.mensagem).toBe(MENSAGEM);
  expect((await cadastrar(cnpj, segundo)).j.mensagem).toBe(MENSAGEM);

  const [empresa] = await sql(`SELECT id, ativa, aprovacao_pendente, razao_social FROM empresas WHERE cnpj = $1`, [cnpj]);
  expect(empresa).toMatchObject({ ativa: false, aprovacao_pendente: true });
  expect(empresa.razao_social.length).toBeGreaterThan(1);

  expect((await pedir('POST', '/auth/login', { corpo: { email, senha: SENHA } })).status).toBe(401);
  expect((await pedir('GET', '/cadastros/pendentes', { token: e.adminToken })).status).toBe(403);
  expect((await pedir('POST', `/cadastros/empresas/${empresa.id}/aprovar`, { token: e.adminToken })).status).toBe(403);
  const fila = await pedir('GET', '/cadastros/pendentes', { token: tokenSuper });
  expect(fila.j.empresas.find((x: any) => x.id === empresa.id).emails).toEqual([email, segundo]);

  // Editar a empresa não libera sem passar pela aprovação.
  expect((await pedir('PATCH', `/empresas/${empresa.id}`, { token: tokenSuper, corpo: { ativa: true } })).status).toBe(400);

  expect((await pedir('POST', `/cadastros/empresas/${empresa.id}/aprovar`, { token: tokenSuper })).status).toBe(204);
  expect((await pedir('POST', `/cadastros/empresas/${empresa.id}/aprovar`, { token: tokenSuper })).status).toBe(404);
  const token = await login(email, SENHA);
  const eu = await pedir('GET', '/auth/me', { token });
  expect(eu.j.perfil.nome).toBe('Administrador');
  expect(eu.j.empresa.id).toBe(empresa.id);
  // O segundo pedido agora é com esse administrador.
  expect((await pedir('POST', '/auth/login', { corpo: { email: segundo, senha: SENHA } })).status).toBe(401);
  expect((await pedir('GET', '/usuarios/pendentes/contagem', { token })).j.quantidade).toBe(1);
});

test('recusar empresa pendente apaga tudo e o CNPJ volta a poder ser cadastrado', async () => {
  const cnpj = cnpjValido();
  const email = novoEmail();
  await cadastrar(cnpj, email);
  const [empresa] = await sql(`SELECT id FROM empresas WHERE cnpj = $1`, [cnpj]);
  expect((await pedir('POST', `/cadastros/empresas/${empresa.id}/recusar`, { token: tokenSuper })).status).toBe(204);
  expect(await sql(`SELECT id FROM empresas WHERE cnpj = $1`, [cnpj])).toEqual([]);
  expect(await sql(`SELECT id FROM usuarios WHERE email = $1`, [email])).toEqual([]);
  expect((await sql(`SELECT acao FROM logs_auditoria WHERE entidade_id = $1 AND acao = 'cadastro.recusar_empresa'`, [empresa.id])).length).toBe(1);
  expect((await cadastrar(cnpj, email)).status).toBe(202);
});

test('empresa de verdade não é recusada por essa rota', async () => {
  expect((await pedir('POST', `/cadastros/empresas/${e.id}/recusar`, { token: tokenSuper })).status).toBe(404);
  expect((await pedir('POST', `/cadastros/empresas/${e.id}/aprovar`, { token: tokenSuper })).status).toBe(404);
});

test('empresa existente fora do ar fica como está; o pedido aparece para o super-admin', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const [{ cnpj }] = await sql(`SELECT cnpj FROM empresas WHERE id = $1`, [outra.id]);
  await sql(`UPDATE empresas SET status_assinatura = 'BLOQUEADA' WHERE id = $1`, [outra.id]);
  const email = novoEmail();
  const r = await cadastrar(cnpj, email);
  expect(r.j.mensagem).toBe(MENSAGEM);
  const [depois] = await sql(`SELECT ativa, status_assinatura, aprovacao_pendente FROM empresas WHERE id = $1`, [outra.id]);
  expect(depois).toEqual({ ativa: true, status_assinatura: 'BLOQUEADA', aprovacao_pendente: false });
  const fila = await pedir('GET', '/cadastros/pendentes', { token: tokenSuper });
  expect(fila.j.usuarios.find((u: any) => u.email === email).empresa.id).toBe(outra.id);
});

test('validações: CNPJ, e-mail repetido e senha curta', async () => {
  expect((await cadastrar('11.111.111/1111-11', novoEmail())).status).toBe(400);
  expect((await cadastrar(cnpjDeE, e.adminEmail)).status).toBe(409);
  expect((await cadastrar(cnpjDeE, novoEmail(), 'curta')).status).toBe(400);
  expect((await cadastrar(cnpjDeE, 'nao-e-email')).status).toBe(400);
});

async function entrar(page: Page, email: string, senha: string) {
  // Um IP por login: o limite de 10 logins por minuto é da API, não destes testes.
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('pela tela: cadastrar, administrador aprova e o usuário entra', async ({ page }) => {
  const outra = await criarEmpresa(tokenSuper);
  const [{ cnpj }] = await sql(`SELECT cnpj FROM empresas WHERE id = $1`, [outra.id]);
  const email = novoEmail();
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));

  await page.goto('/');
  await page.getByRole('link', { name: 'Cadastre-se' }).click();
  await page.getByLabel('CNPJ da empresa').fill('11.111.111/1111-11');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('CNPJ inválido. Confira os números.')).toBeVisible();
  await page.getByLabel('CNPJ da empresa').fill(cnpj);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText(MENSAGEM)).toBeVisible();
  await page.screenshot({ path: 'test-results/cadastro-enviado.png' });

  await entrar(page, email, SENHA);
  await expect(page.getByText(/aguarda a aprovação/)).toBeVisible();

  await entrar(page, outra.adminEmail, outra.adminSenha);
  await expect(page.getByRole('link', { name: /Usuários.*1/ })).toBeVisible();
  await page.getByRole('link', { name: /Usuários/ }).click();
  await expect(page.getByRole('heading', { name: 'Aguardando aprovação' })).toBeVisible();
  await page.screenshot({ path: 'test-results/usuarios-pendentes.png' });
  await page.getByLabel(`Perfil de ${email}`).selectOption({ label: 'Administrador' });
  await page.getByRole('button', { name: `Aprovar ${email}` }).click();
  await expect(page.getByRole('heading', { name: 'Aguardando aprovação' })).toBeHidden();
  await page.getByRole('button', { name: 'Sair' }).click();

  await entrar(page, email, SENHA);
  await expect(page.getByRole('heading', { name: 'Olá', level: 1 })).toBeVisible();
  expect(erros).toEqual([]);
});

test('pela tela: super-admin aprova empresa nova em Empresas', async ({ page }) => {
  const cnpj = cnpjValido();
  const email = novoEmail();
  await cadastrar(cnpj, email);
  await entrar(page, SUPER.email, SUPER.senha);
  await expect(page.getByRole('link', { name: /Empresas.*\d/ })).toBeVisible();
  await page.getByRole('link', { name: /Empresas/ }).click();
  await expect(page.getByRole('heading', { name: 'Aguardando aprovação' })).toBeVisible();
  await page.screenshot({ path: 'test-results/empresas-pendentes.png', fullPage: true });
  await page.getByRole('button', { name: `Aprovar ${email}` }).click();
  await expect(page.getByRole('button', { name: `Aprovar ${email}` })).toBeHidden();
  await login(email, SENHA);
});
