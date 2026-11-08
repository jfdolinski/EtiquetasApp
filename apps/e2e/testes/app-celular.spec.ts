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
  // Um IP por vínculo: o limite de 10 por minuto é da API, não destes testes.
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
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

test('Lista do dia mostra todos os campos, um abaixo do outro, e o valor longo termina em reticências', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const { itemIds } = await montarListaDeHoje(outra, { produtos: ['7891000100103'] });
  const longo = `Descrição muito comprida ${'de produto '.repeat(12)}fim`;
  const registro = { codigo: 'C1', nome: 'Café', preco: '4.99', un: 'UN', marca: 'Acme', estoque: 'Sexto', local: 'Sétimo', grupo: 'Oitavo', obs: longo };
  await sql(`UPDATE itens_lista SET registro = $2 WHERE id = $1`, [itemIds[0], JSON.stringify(registro)]);
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  for (const valor of ['C1', 'Café', '4.99', 'UN', 'Acme', 'Sexto', 'Sétimo', 'Oitavo']) await expect(page.getByText(valor, { exact: true })).toBeVisible();
  // Um abaixo do outro: cada campo começa abaixo do anterior, na mesma coluna.
  const a = (await page.getByText('C1', { exact: true }).boundingBox())!;
  const b = (await page.getByText('Café', { exact: true }).boundingBox())!;
  expect(Math.abs(b.y - a.y)).toBeGreaterThan(10);
  expect(Math.abs(b.x - a.x)).toBeLessThan(2);
  // Longo não quebra a linha: mesma altura de um valor curto, cortado no fim com reticências.
  const celula = page.getByText(longo, { exact: true });
  const caixa = (await celula.boundingBox())!;
  expect(Math.abs(caixa.height - b.height)).toBeLessThan(2);
  const corte = await celula.evaluate((el) => ({ reticencias: getComputedStyle(el).textOverflow, cortado: el.scrollWidth > el.clientWidth }));
  expect(corte).toEqual({ reticencias: 'ellipsis', cortado: true });
  // E nada vaza para o lado no celular.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/app-lista-colunas.png' });
});

test('data aparece como DD/MM/AAAA e o parâmetro limita as linhas de cada produto, valendo ao reabrir', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const { itemIds } = await montarListaDeHoje(outra, { produtos: ['7891000100103'] });
  // O banco guarda as chaves da mais curta para a mais longa: un, nome, validade, fornecedor.
  const registro = { un: 'UN', nome: 'Café', validade: '2026-11-03T00:00:00Z', fornecedor: 'Acme' };
  await sql(`UPDATE itens_lista SET registro = $2 WHERE id = $1`, [itemIds[0], JSON.stringify(registro)]);
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('03/11/2026', { exact: true })).toBeVisible();
  await expect(page.getByText('Acme', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Avisos' }).click();
  await expect(page.getByLabel('Linhas por produto escolhidas')).toHaveText('Todas');
  await page.getByRole('button', { name: 'Menos linhas' }).click();
  await expect(page.getByLabel('Linhas por produto escolhidas')).toHaveText('5');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Menos linhas' }).click();
  await expect(page.getByLabel('Linhas por produto escolhidas')).toHaveText('2');

  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  // Primeiro espera a lista carregar: antes disso, nenhum campo aparece.
  await expect(page.getByText('Café', { exact: true })).toBeVisible();
  await expect(page.getByText('03/11/2026', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Acme', { exact: true })).toHaveCount(0);

  await page.reload();
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  // Primeiro espera a lista carregar: antes disso, nenhum campo aparece.
  await expect(page.getByText('Café', { exact: true })).toBeVisible();
  await expect(page.getByText('03/11/2026', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Acme', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Avisos' }).click();
  await page.getByText('Mostrar todas', { exact: true }).click();
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('Acme', { exact: true })).toBeVisible();
});

test('o nome dado à coluna pelo super-admin aparece no aplicativo', async ({ page }) => {
  const tokenSuper = await superToken();
  const outra = await criarEmpresa(tokenSuper);
  const { modeloId } = await montarListaDeHoje(outra, { produtos: ['7891000100103'] });
  const [{ id: conexao }] = await sql<{ id: string }>(`INSERT INTO conexoes_banco (id, empresa_id, nome, tipo, host, porta, banco, usuario, atualizado_em) VALUES (gen_random_uuid(), $1, 'Conexão', 'POSTGRES', 'localhost', 5432, 'erp', 'leitor', now()) RETURNING id`, [outra.id]);
  const [{ id: consulta }] = await sql<{ id: string }>(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, sql, atualizado_em) VALUES (gen_random_uuid(), $1, $2, 'Consulta', 'SELECT 1', now()) RETURNING id`, [outra.id, conexao]);
  await sql(`UPDATE modelos_etiqueta SET consulta_id = $1 WHERE id = $2`, [consulta, modeloId]);
  await pedir('PUT', `/consultas/${consulta}/rotulos`, { token: tokenSuper, empresa: outra.id, corpo: { rotulos: { preco: 'Valor' } } });
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await expect(page.getByText('Valor', { exact: true })).toBeVisible();
  await expect(page.getByText('preco', { exact: true })).toHaveCount(0);
});

test('Telas: digita o código, define qual tela é, e ela aparece na lista', async ({ page }) => {
  const outra = await criarEmpresa(await superToken());
  const p = await pedir('POST', '/tv/pedidos', { corpo: { largura: 960, altura: 320 } });
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Telas' }).click();
  await expect(page.getByText('Nenhuma tela vinculada.')).toBeVisible();
  await page.getByLabel('Código da tela').fill('não é código');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Este não é o código de uma tela.', { exact: false })).toBeVisible();

  await page.getByLabel('Código da tela').fill(p.j.codigo);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('informa 960×320', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vincular tela' })).toBeDisabled();
  await page.getByLabel('Nome da tela').fill('Painel da fachada');
  await page.getByRole('button', { name: 'Vincular tela' }).click();
  await expect(page.getByText('Painel da fachada', { exact: true })).toBeVisible();
  await expect(page.getByText('Tela 960×320 (960×320)', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/app-telas.png' });
});

test('banner aparece no aplicativo, conta exibição e clique, e some quando sai do ar', async ({ page, context }) => {
  const erros = vigiarErros(page);
  const token = await superToken();
  const outra = await criarEmpresa(token);
  const anunciante = `Anunciante ${Date.now()}`;
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await context.route('**://exemplo.com.br/**', (r) => r.fulfill({ contentType: 'text/html', body: 'Oferta' }));
  const { j: banner } = await pedir('POST', '/banners', { token, corpo: { anunciante, texto: 'Oferta do anunciante', imagem: png, link: 'https://exemplo.com.br/oferta', valorMensal: 99, contato: 'segredo@anunciante', inicio: hoje } });
  try {
    await vincular(page, outra);
    await expect(page.getByText(`Publicidade · ${anunciante}`)).toBeVisible();
    // Nas outras guias também, e sem botão de fechar.
    await page.getByRole('tab', { name: 'Avisos' }).click();
    await expect(page.getByText(`Publicidade · ${anunciante}`)).toBeVisible();
    await expect(page.getByRole('button', { name: /fechar/i })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/app-banner.png' });
    await expect.poll(async () => (await sql<{ exibicoes: number }>('SELECT exibicoes FROM banners_publicitarios WHERE id = $1', [banner.id]))[0].exibicoes).toBe(1);

    const [aba] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Oferta do anunciante' }).click()]);
    expect(aba.url()).toContain('exemplo.com.br/oferta');
    await aba.close();
    await expect.poll(async () => (await sql<{ cliques: number }>('SELECT cliques FROM banners_publicitarios WHERE id = $1', [banner.id]))[0].cliques).toBe(1);
    // Trocar de guia e voltar não conta outra exibição.
    await page.getByRole('tab', { name: 'Início' }).click();
    expect((await sql<{ exibicoes: number }>('SELECT exibicoes FROM banners_publicitarios WHERE id = $1', [banner.id]))[0].exibicoes).toBe(1);

    const v = await pedir('POST', '/app/vinculos', { token: outra.adminToken });
    const celular = await pedir('POST', '/app/vincular', { corpo: { codigo: v.j.codigo, nome: 'Outro', plataforma: 'ANDROID', versao: '1.0.0' } });
    const vigentes = await pedir('GET', '/banners/vigentes', { token: celular.j.token });
    expect(vigentes.status).toBe(200);
    const visto = vigentes.j.find((b: any) => b.id === banner.id);
    expect(visto.valorMensal).toBeUndefined();
    expect(visto.contato).toBeUndefined();
    // O token do celular só lê: o cadastro continua fora do alcance dele.
    expect((await pedir('GET', '/banners', { token: celular.j.token })).status).toBe(403);
    expect((await pedir('DELETE', `/banners/${banner.id}`, { token: celular.j.token })).status).toBe(403);
  } finally {
    await pedir('DELETE', `/banners/${banner.id}`, { token });
  }
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Início' })).toBeVisible();
  await expect(page.getByText(`Publicidade · ${anunciante}`)).toHaveCount(0);
  expect(erros).toEqual([]);
});

test('Etiqueta avulsa: busca, soma o produto repetido, escolhe entre vários e imprime', async ({ page }) => {
  const erros = vigiarErros(page);
  const outra = await criarEmpresa(await superToken());
  const { modeloId, impressoraId } = await montarListaDeHoje(outra);
  // A busca real passa pelo agente local; aqui só ela é simulada. O resto fala com a API de verdade.
  await page.route('**/api/avulsa/modelos', (r) => r.fulfill({ json: [{ id: modeloId, nome: 'Gôndola', impressoraId, impressoraLinguagem: 'ZPL', parametros: ['busca'], campos: ['codigo', 'nome', 'preco', 'un', 'marca', 'estoque'], folha: null }] }));
  await page.route('**/api/avulsa/buscar', async (r) => {
    const termo = r.request().postDataJSON().parametros.busca;
    const A = { codigo: '789', nome: 'Café', preco: '4.99', un: 'UN', marca: 'Acme', estoque: 'SEXTO-A' };
    const B = { codigo: '790', nome: 'Café forte', preco: '5.99', un: 'UN', marca: 'Acme', estoque: 'SEXTO-B' };
    await r.fulfill({ json: { registros: termo === '789' ? [A] : termo === 'cafe' ? [A, B] : [], colunas: [], banidos: 0 } });
  });
  await vincular(page, outra);
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  const campo = page.getByLabel('Código de barras, código ou nome');

  await campo.fill('000');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Produto não encontrado.')).toBeVisible();
  // Liberado para digitar a linha toda: o código já vem preenchido.
  await expect(page.getByLabel('codigo', { exact: true })).toHaveValue('000');
  await page.getByLabel('nome', { exact: true }).fill('Produto novo');
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  await expect(page.getByText('Produto novo')).toBeVisible();
  await page.getByRole('button', { name: 'Tirar da lista' }).click();

  await campo.fill('789');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Produto adicionado à lista.')).toBeVisible();
  await expect(page.getByText('4.99', { exact: true })).toBeVisible();
  await expect(page.getByText('SEXTO-A')).toBeVisible();

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
