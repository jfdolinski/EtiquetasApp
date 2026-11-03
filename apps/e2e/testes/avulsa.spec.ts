import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, montarListaDeHoje, superToken, type EmpresaTeste } from './apoio';

let e: EmpresaTeste;
let modeloId: string;
const A = { ean: '789', descricao: 'Café', preco: '4.99' };
const B = { ean: '790', descricao: 'Arroz', preco: '9.00' };

test.beforeAll(async () => {
  e = await criarEmpresa(await superToken());
  ({ modeloId } = await montarListaDeHoje(e));
});

/** Só a consulta é simulada (precisaria de agente), respondendo como uma consulta que não filtra: sempre tudo. */
async function abrir(page: Page, parametros: string[]) {
  const pedidos: any[] = [];
  await page.route('**/api/avulsa/modelos', (r) => r.fulfill({ json: [{ id: modeloId, nome: 'Gôndola', impressoraId: null, impressoraLinguagem: 'ZPL', parametros, campos: ['ean', 'descricao', 'preco'], folha: null }] }));
  await page.route('**/api/avulsa/buscar', async (r) => {
    const corpo = r.request().postDataJSON();
    pedidos.push(corpo);
    await r.fulfill({ json: { registros: [A, B], colunas: [], banidos: 0 } });
  });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.84.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(e.adminEmail);
  await page.getByLabel('Senha').fill(e.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
  await page.goto('/avulsa');
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('etiquetas.avulsa.')).forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  return pedidos;
}

test('busca sem resultado não traz a lista inteira: avisa e libera a linha para digitar', async ({ page }) => {
  await abrir(page, ['busca']);
  await page.getByLabel('Código, EAN ou nome').fill('000');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Produto não encontrado.')).toBeVisible();
  // Uma linha só, a digitada: nada de Café e Arroz na lista.
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByLabel('ean', { exact: true })).toHaveValue('000');
  // O cursor já está no próximo campo: é só digitar.
  await expect(page.getByLabel('descricao', { exact: true })).toBeFocused();
  await page.keyboard.type('Produto novo');
  await page.getByLabel('preco', { exact: true }).fill('5,50');
  await expect(page.getByLabel('descricao', { exact: true })).toHaveValue('Produto novo');
});

test('data aparece como DD/MM/AAAA na grade, o valor original vai à impressão e dá para digitar outra', async ({ page }) => {
  await abrir(page, ['busca']);
  const produto = { ean: '789', descricao: 'Café', validade: '2026-11-03T00:00:00Z' };
  await page.route('**/api/avulsa/buscar', (r) => r.fulfill({ json: { registros: [produto], colunas: [], banidos: 0 } }));
  let enviados: any[] = [];
  await page.route('**/api/avulsa/imprimir', async (r) => {
    enviados = r.request().postDataJSON().itens;
    await r.fulfill({ status: 201, json: { trabalhos: [], avisos: [] } });
  });
  await page.getByLabel('Código, EAN ou nome').fill('789');
  await page.getByRole('button', { name: 'Buscar' }).click();
  const celula = page.getByLabel('validade', { exact: true });
  await expect(celula).toHaveValue('03/11/2026');
  // Entrar e sair sem mudar nada não troca o valor; digitar não é reformatado no meio do caminho.
  await celula.click();
  await page.getByLabel('descricao', { exact: true }).click();
  await expect(celula).toHaveValue('03/11/2026');
  await celula.fill('');
  await celula.pressSequentially('04/11/2026');
  await expect(celula).toHaveValue('04/11/2026');
  await page.getByLabel('descricao', { exact: true }).click();
  await expect(celula).toHaveValue('04/11/2026');
  expect(enviados).toEqual([]);
});

test('código digitado na linha, sem produto: sem janela de escolha, com a linha liberada', async ({ page }) => {
  await abrir(page, ['busca']);
  await page.getByRole('button', { name: '+ Nova linha' }).click();
  await page.getByLabel('ean', { exact: true }).fill('12345');
  await page.getByLabel('ean', { exact: true }).blur();
  await expect(page.getByText('Produto não encontrado.')).toBeVisible();
  await expect(page.getByText('Vários produtos para')).toHaveCount(0);
  await expect(page.getByLabel('descricao', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('descricao', { exact: true })).toBeFocused();
  await expect(page.getByLabel('descricao', { exact: true })).toHaveValue('');
});

test('o que existe continua vindo: código exato e nome', async ({ page }) => {
  await abrir(page, ['busca']);
  await page.getByLabel('Código, EAN ou nome').fill('790');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByLabel('descricao', { exact: true })).toHaveValue('Arroz');
  await page.getByLabel('Código, EAN ou nome').fill('cafe');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('busca incompleta avisa: "não encontrado" não é certeza', async ({ page }) => {
  await abrir(page, []);
  await page.unroute('**/api/avulsa/buscar');
  await page.route('**/api/avulsa/buscar', (r) => r.fulfill({ json: { registros: [], colunas: [], banidos: 0, incompleta: true } }));
  await page.getByLabel('Código, EAN ou nome').fill('999');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText(/Produto não encontrado\. A consulta tem muitas linhas/)).toBeVisible();
});

test('consulta sem parâmetro: o campo de busca aparece, manda o termo ao servidor e exige digitar', async ({ page }) => {
  const pedidos = await abrir(page, []);
  const buscar = page.getByRole('button', { name: 'Buscar' });
  await expect(buscar).toBeDisabled();
  await page.getByLabel('Código, EAN ou nome').fill('feijao');
  await buscar.click();
  await expect(page.getByText('Produto não encontrado.')).toBeVisible();
  expect(pedidos.at(-1)).toMatchObject({ parametros: {}, termo: 'feijao' });

  await page.getByRole('button', { name: '+ Nova linha' }).click();
  await page.getByLabel('ean', { exact: true }).first().fill('777');
  await page.getByLabel('ean', { exact: true }).first().blur();
  await expect.poll(() => pedidos.at(-1)?.termo).toBe('777');
});
