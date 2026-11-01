import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, codigoTotp, montarListaDeHoje, pedir, SUPER, superToken, vincularCelular, type EmpresaTeste } from './apoio';

let e: EmpresaTeste;

test.beforeAll(async () => {
  e = await criarEmpresa(await superToken());
});

async function entrar(page: Page, email: string, senha: string) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // Só depois de o login terminar: navegar antes perderia o token.
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

/** Erros de console fazem o teste falhar: tela quebrada silenciosa não passa. */
function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 40[0-9]/.test(m.text())) erros.push(m.text());
  });
  return erros;
}

const TELAS: [string, string][] = [
  ['/', 'Olá'],
  ['/hoje', 'Lista do dia'],
  ['/avulsa', 'Etiqueta avulsa'],
  ['/historico', 'Histórico de impressão'],
  ['/modelos', 'Modelos de etiqueta'],
  ['/impressoras', 'Impressoras'],
  ['/consultas', 'Consultas SQL'],
  ['/bancos', 'Conexões de dados'],
  ['/agentes', 'Agentes'],
  ['/agendamentos', 'Agendamentos'],
  ['/banidos', 'Produtos banidos'],
  ['/notificacoes', 'Notificações'],
  ['/usuarios', 'Usuários'],
  ['/perfis', 'Perfis'],
  ['/auditoria', 'Auditoria'],
  ['/minha-conta', 'Minha conta'],
];

test('administrador entra e todas as telas abrem sem erro', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page, e.adminEmail, e.adminSenha);
  for (const [rota, titulo] of TELAS) {
    await page.goto(rota);
    await expect(page.getByRole('heading', { name: titulo, level: 1 }).first(), rota).toBeVisible();
  }
  expect(erros).toEqual([]);
});

test('editor de modelo e pré-visualização em PDF funcionam com a CSP', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const { modeloId } = await montarListaDeHoje(outra, { linguagem: 'PDF' });
  const erros = vigiarErros(page);
  await entrar(page, outra.adminEmail, outra.adminSenha);
  await page.goto(`/modelos/${modeloId}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  // QR e código de barras usam bwip-js; fontes vêm do próprio site.
  await page.goto('/minha-conta');
  await page.getByRole('button', { name: 'Mostrar QR code' }).click();
  await expect(page.getByRole('img', { name: 'QR code' }).first()).toBeVisible();
  expect(erros).toEqual([]);
});

test('super-admin vê a saúde do sistema; administrador comum não', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page, SUPER.email, SUPER.senha);
  await page.getByRole('link', { name: 'Saúde do sistema' }).click();
  await expect(page.getByText('Tamanho do banco')).toBeVisible();
  expect(erros).toEqual([]);
});

test('Minha conta: QR do celular aparece e some quando o celular vincula', async ({ page }) => {
  const erros = vigiarErros(page);
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.goto('/minha-conta');
  await page.getByRole('button', { name: 'Mostrar QR code' }).click();
  await expect(page.getByText('Abra o aplicativo e leia este QR code.')).toBeVisible();
  await page.screenshot({ path: 'test-results/minha-conta.png', fullPage: true });
  const codigo = (await page.locator('p.font-mono.text-lg').innerText()).trim();
  expect(codigo).toMatch(/^[A-Z2-9]{10}$/);

  const r = await pedir('POST', '/app/vincular', { corpo: { codigo, nome: 'Celular da Tela', plataforma: 'ANDROID' } });
  expect(r.status).toBe(200);
  await expect(page.getByText('Celular da Tela')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Abra o aplicativo e leia este QR code.')).toBeHidden();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Desvincular' }).first().click();
  await expect(page.getByText('Celular da Tela')).toBeHidden();
  expect((await pedir('GET', '/auth/me', { token: r.j.token })).status).toBe(401);
  expect(erros).toEqual([]);
});

test('duas etapas pela tela: ativar, ver códigos e entrar pedindo o código', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  await entrar(page, outra.adminEmail, outra.adminSenha);
  await page.goto('/minha-conta');
  await page.getByLabel('Confirme sua senha').fill(outra.adminSenha);
  await page.getByRole('button', { name: 'Começar' }).click();
  const segredo = (await page.locator('span.font-mono').first().innerText()).trim();
  await page.getByLabel('Código').fill(codigoTotp(segredo));
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Guarde estes códigos agora.')).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.getByLabel('E-mail').fill(outra.adminEmail);
  await page.getByLabel('Senha').fill(outra.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Digite o código do seu aplicativo autenticador.')).toBeVisible();
  await page.getByLabel('Código').fill(codigoTotp(segredo, 1));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá', level: 1 })).toBeVisible();
});

test('Produtos banidos: liberar selecionados respeita o filtro', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  await pedir('POST', '/banidos', { token: outra.adminToken, corpo: { codigos: ['1111111', '2222222', '3333333'] } });
  await entrar(page, outra.adminEmail, outra.adminSenha);
  await page.goto('/banidos');
  await page.getByLabel('Marcar todos').check();
  await page.getByLabel('Procurar por código ou motivo').fill('2222222');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Liberar selecionados (1)' }).click();
  await expect(page.getByText('1 código(s) liberado(s).')).toBeVisible();
  const restantes = (await pedir('GET', '/banidos', { token: outra.adminToken })).j.map((b: any) => b.codigoBarras).sort();
  expect(restantes).toEqual(['1111111', '3333333']);
});

test('lista aprovada no celular aparece na tela do computador', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const { itemIds } = await montarListaDeHoje(outra);
  const c = await vincularCelular(outra.adminToken);
  await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo: { itens: [{ id: itemIds[0], quantidade: 1 }] } });
  await entrar(page, outra.adminEmail, outra.adminSenha);
  await page.goto('/hoje');
  await expect(page.getByText('Produto 7891000100110')).toBeVisible();
  await page.goto('/historico');
  await expect(page.getByRole('cell', { name: 'Lista do dia' }).first()).toBeVisible();
});
