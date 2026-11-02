import { expect, test, type Page } from '@playwright/test';
import { API, criarEmpresa, montarListaDeHoje, pedir, sql, superToken, type EmpresaTeste } from './apoio';

/** As telas do aplicativo, em versão web e tamanho de celular, falando com a API real. */
const APP = process.env.E2E_APP_URL;
test.skip(!APP, 'defina E2E_APP_URL com o build web do aplicativo (ver apps/mobile/README.md)');
test.use({ viewport: { width: 390, height: 780 }, baseURL: APP, hasTouch: true });

let e: EmpresaTeste;

test.beforeAll(async () => {
  e = await criarEmpresa(await superToken());
});

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  return erros;
}

async function vincular(page: Page, empresa: EmpresaTeste) {
  const v = await pedir('POST', '/app/vinculos', { token: empresa.adminToken });
  await page.goto('/');
  await page.getByRole('button', { name: 'Digitar o código' }).click();
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('Código').fill(v.j.codigo);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('localhost:3000')).toBeVisible();
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Início' })).toBeVisible();
}

test('sem servidor em HTTPS nem código certo, não vincula', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Digitar o código' }).click();
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('Código').fill('ABC');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('O código tem 10 letras e números.')).toBeVisible();
  await page.getByLabel('Código').fill('ZZZZZZZZZZ');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(page.getByText(/Código inválido ou vencido/)).toBeVisible();
});

test('vincular, ver o Início, aprovar a lista e continuar vinculado ao reabrir', async ({ page }) => {
  const erros = vigiarErros(page);
  const outra = await criarEmpresa(await superToken());
  const { itemIds } = await montarListaDeHoje(outra, { produtos: ['7891000100103', '7891000100110', '7891000100127'] });
  await vincular(page, outra);

  await expect(page.getByRole('heading', { name: /^Olá/ })).toBeVisible();
  await expect(page.getByText('Lista pendente')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-inicio.png' });

  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('3 produto(s) pendente(s)')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Produto 7891000100103' }).click();
  await page.getByLabel('Quantidade de Produto 7891000100103').fill('4');
  await page.screenshot({ path: 'test-results/app-lista.png' });

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Aprovar 1' }).click();
  await expect(page.getByText('4 etiqueta(s) enviada(s) para a fila.')).toBeVisible();
  await expect(page.getByText('2 produto(s) pendente(s)')).toBeVisible();
  const [item] = await sql(`SELECT status, quantidade FROM itens_lista WHERE id = $1`, [itemIds[0]]);
  expect(item).toEqual({ status: 'NA_FILA', quantidade: 4 });

  // Descartar
  await page.getByRole('checkbox', { name: 'Produto 7891000100110' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByText('1 produto(s) descartado(s).')).toBeVisible();

  // Fechar e abrir não pede o QR de novo.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Início' })).toBeVisible();
  expect(erros).toEqual([]);
});

test('avisos aparecem, ficam lidos, e desvincular no sistema derruba o app', async ({ page }) => {
  const erros = vigiarErros(page);
  await vincular(page, e);
  await sql(
    `INSERT INTO notificacoes (id, empresa_id, evento, chave, titulo, mensagem, nivel, canal_agente, canal_sistema, agente_ids, ultimo_envio_em, atualizado_em)
     VALUES (gen_random_uuid(), $1, 'fila_parada', 'fila', 'Fila de impressão parada', '3 trabalhos esperando', 'aviso', false, true, '[]', now(), now())`,
    [e.id],
  ).catch(async () => {
    await sql(
      `INSERT INTO notificacoes (id, empresa_id, evento, chave, titulo, mensagem, nivel, canal_agente, canal_sistema, agente_ids, ultimo_envio_em)
       VALUES (gen_random_uuid(), $1, 'fila_parada', 'fila', 'Fila de impressão parada', '3 trabalhos esperando', 'aviso', false, true, '[]', now())`,
      [e.id],
    );
  });
  await page.reload();
  await page.getByRole('tab', { name: /Avisos/ }).click();
  await expect(page.getByText('Fila de impressão parada')).toBeVisible();
  await expect(page.getByText('1 sem ler')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-avisos.png' });
  await page.getByText('3 trabalhos esperando').click();
  await expect(page.getByText('Tudo lido')).toBeVisible();

  const lista = await pedir('GET', '/app/dispositivos', { token: e.adminToken });
  await pedir('DELETE', `/app/dispositivos/${lista.j[0].id}`, { token: e.adminToken });
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('Este celular foi desvinculado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Digitar o código' })).toBeVisible();
  expect(erros).toEqual([]);
});

test('Lista do dia mostra os 5 primeiros campos, um abaixo do outro', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const { itemIds } = await montarListaDeHoje(outra, { produtos: ['7891000100103'] });
  await sql(`UPDATE itens_lista SET registro = $2 WHERE id = $1`, [itemIds[0], JSON.stringify({ codigo: 'C1', nome: 'Café', preco: '4.99', un: 'UN', marca: 'Acme', estoque: 'NAO-MOSTRAR' })]);
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('C1', { exact: true })).toBeVisible();
  await expect(page.getByText('Café', { exact: true })).toBeVisible();
  await expect(page.getByText('4.99', { exact: true })).toBeVisible();
  await expect(page.getByText('NAO-MOSTRAR')).toBeHidden();
  // Um abaixo do outro: cada campo começa abaixo do anterior, na mesma coluna.
  const a = (await page.getByText('C1', { exact: true }).boundingBox())!;
  const b = (await page.getByText('Café', { exact: true }).boundingBox())!;
  expect(Math.abs(b.y - a.y)).toBeGreaterThan(10);
  expect(Math.abs(b.x - a.x)).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/app-lista-colunas.png' });
});

test('Etiqueta avulsa: busca, soma o produto repetido, escolhe entre vários e imprime', async ({ page }) => {
  const erros = vigiarErros(page);
  const outra = await criarEmpresa(await superToken());
  const { modeloId, impressoraId } = await montarListaDeHoje(outra);
  // A busca real passa pelo agente local; aqui só ela é simulada. O resto fala com a API de verdade.
  await page.route('**/api/avulsa/modelos', (r) => r.fulfill({ json: [{ id: modeloId, nome: 'Gôndola', impressoraId, impressoraLinguagem: 'ZPL', parametros: ['busca'], campos: ['codigo', 'nome', 'preco', 'un', 'marca', 'estoque'], folha: null }] }));
  await page.route('**/api/avulsa/buscar', async (r) => {
    const termo = r.request().postDataJSON().parametros.busca;
    const A = { codigo: '789', nome: 'Café', preco: '4.99', un: 'UN', marca: 'Acme', estoque: 'NAO-MOSTRAR' };
    const B = { codigo: '790', nome: 'Café forte', preco: '5.99', un: 'UN', marca: 'Acme', estoque: 'NAO-MOSTRAR' };
    await r.fulfill({ json: { registros: termo === '789' ? [A] : termo === 'cafe' ? [A, B] : [], colunas: [], banidos: 0 } });
  });
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  const campo = page.getByLabel('Código de barras, código ou nome');

  await campo.fill('000');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Nenhum produto com “000”.')).toBeVisible();

  await campo.fill('789');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Produto adicionado à lista.')).toBeVisible();
  await expect(page.getByText('4.99', { exact: true })).toBeVisible();
  await expect(page.getByText('NAO-MOSTRAR')).toBeHidden();

  await campo.fill('789');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('agora com 2 etiqueta(s)')).toBeVisible();

  // Quantidade digitada é a base da próxima leitura do mesmo produto.
  await page.getByLabel('Quantidade de 789').fill('5');
  await campo.fill('789');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('agora com 6 etiqueta(s)')).toBeVisible();
  await expect(page.getByLabel('Quantidade de 789')).toHaveValue('6');
  await page.getByLabel('Quantidade de 789').fill('2');

  await campo.fill('cafe');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Vários produtos encontrados.')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-avulsa-escolha.png' });
  await page.getByText('Café forte').click();
  await expect(page.getByRole('button', { name: 'Imprimir 2 produto(s)' })).toBeVisible();
  await page.screenshot({ path: 'test-results/app-avulsa.png' });

  // Ir a outra guia e voltar não perde a lista.
  await page.getByRole('tab', { name: 'Início' }).click();
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  await expect(page.getByText('Café forte')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Imprimir 2 produto(s)' }).click();
  await expect(page.getByText('3 etiqueta(s) enviada(s) para a fila.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Imprimir/ })).toBeHidden();
  const [{ origem, quantidade_etiquetas }] = await sql(`SELECT origem, quantidade_etiquetas FROM trabalhos_impressao WHERE empresa_id = $1`, [outra.id]);
  expect({ origem, quantidade_etiquetas }).toEqual({ origem: 'AVULSA', quantidade_etiquetas: 3 });
  expect(erros).toEqual([]);
});

test('Etiqueta avulsa com consulta sem parâmetro e padrão em PDF: busca aparece e o PDF é gerado', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const { modeloId, impressoraId } = await montarListaDeHoje(outra, { linguagem: 'PDF', produtos: [] });
  let corpo: any = null;
  await page.route('**/api/avulsa/modelos', (r) => r.fulfill({ json: [{ id: modeloId, nome: 'GONDOLA PRECO TABELA', impressoraId, impressoraLinguagem: 'PDF', parametros: [], campos: ['codigo', 'nome'], folha: null }] }));
  await page.route('**/api/avulsa/buscar', async (r) => {
    corpo = r.request().postDataJSON();
    await r.fulfill({ json: { registros: [{ codigo: '789', nome: 'Café' }], colunas: [], banidos: 0 } });
  });
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  await page.getByLabel('Código de barras, código ou nome').fill('789');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Produto adicionado à lista.')).toBeVisible();
  expect(corpo).toEqual({ modeloId, parametros: {}, termo: '789' });
  await expect(page.getByText('(PDF)')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-avulsa-pdf.png' });
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Gerar PDF de 1 produto(s)' }).click();
  await expect(page.getByText('PDF com 1 etiqueta(s) gerado.')).toBeVisible();
});

test('Etiqueta avulsa sem modelo pronto explica o que fazer, em vez de ficar vazia', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  await expect(page.getByText('Nenhum modelo pronto para etiqueta avulsa.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conferir de novo' })).toBeVisible();
});

test('Etiqueta avulsa sem conexão mostra o erro e deixa tentar de novo', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  await vincular(page, outra);
  await page.route('**/api/avulsa/modelos', (r) => r.abort());
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  await expect(page.getByText(/Sem conexão com o servidor/)).toBeVisible();
  await page.unroute('**/api/avulsa/modelos');
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByText('Nenhum modelo pronto para etiqueta avulsa.')).toBeVisible();
});

test('sem a permissão de imprimir, a guia Etiqueta avulsa não aparece', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const perfil = await pedir('POST', '/perfis', { token: outra.adminToken, corpo: { nome: 'Só painel', permissoes: ['painel.ver'] } });
  const email = `pa-${Date.now()}@e2e.local`;
  await pedir('POST', '/usuarios', { token: outra.adminToken, corpo: { nome: 'Painel', email, senha: 'SenhaPainel123', perfilId: perfil.j.id } });
  const login = await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaPainel123' } });
  await vincular(page, { ...outra, adminToken: login.j.token });
  await expect(page.getByRole('tab', { name: 'Etiqueta avulsa' })).toBeHidden();
});

test('perfil sem permissão de aprovar vê a lista, sem os botões', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  await montarListaDeHoje(outra);
  const perfil = await pedir('POST', '/perfis', { token: outra.adminToken, corpo: { nome: 'Só imprime', permissoes: ['imprimir'] } });
  const email = `op-${Date.now()}@e2e.local`;
  await pedir('POST', '/usuarios', { token: outra.adminToken, corpo: { nome: 'Operador', email, senha: 'SenhaOperador1', perfilId: perfil.j.id } });
  const login = await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaOperador1' } });
  await vincular(page, { ...outra, adminToken: login.j.token });
  await expect(page.getByText('Seu perfil não tem acesso ao painel.')).toBeVisible();
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('Seu perfil só pode ver a lista.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Aprovar/ })).toBeHidden();
});
