import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, pedir, sql, superToken } from './apoio';
import { empresaComBase, entregadorOnline, PAULISTA, PERTO_DA_SE, SE } from './apoio-entregas';

/** O app do entregador em versão web e tamanho de celular, falando com a API real. */
const APP = process.env.E2E_ENTREGADOR_URL;
test.skip(!APP, 'defina E2E_ENTREGADOR_URL com o build web do app do entregador (apps/entregador: npx expo export -p web)');
test.use({ viewport: { width: 390, height: 800 }, baseURL: APP, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: -23.5614, longitude: -46.6559, accuracy: 15 } });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function cpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (new Set(d).size === 1) d[0] = (d[0] + 1) % 10;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += d[i] * (n + 1 - i);
    const r = (soma * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

test('cadastro, documento, aprovação, online e compra de diárias pelo app', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const tokenSuper = await superToken();
  await pedir('PUT', '/entregadores/parametros', { token: tokenSuper, corpo: { pixChave: 'pix@flow.e2e', pixNome: 'Flow Plataforma', pixCidade: 'São Paulo', diariasBonusCadastro: 1, validadeBonusDias: 30 } });
  const nomePacote = `Semana App ${randomUUID().slice(0, 4)}`;
  await pedir('POST', '/entregadores/pacotes', { token: tokenSuper, corpo: { nome: nomePacote, diarias: 7, precoCentavos: 3500, validadeDias: 30, ativo: true } });

  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.86.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Quero me cadastrar' }).click();
  const email = `app-ent-${randomUUID().slice(0, 8)}@e2e.local`;
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('Nome completo').fill('Bruna Ciclista Souza');
  await page.getByLabel('CPF').fill(cpf());
  await page.getByLabel('Celular com DDD').fill('11987654321');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel(/^Senha/).fill('SenhaBruna123');
  await page.getByRole('radio', { name: 'Bicicleta' }).click();
  await page.getByLabel('Chave Pix para receber das empresas').fill(email);
  await page.getByRole('button', { name: 'Criar cadastro' }).click();
  await expect(page.getByText('É preciso aceitar os termos para se cadastrar.')).toBeVisible();
  await page.getByLabel('Aceito os termos').click();
  await page.getByRole('button', { name: 'Criar cadastro' }).click();

  // Bicicleta: só a foto do rosto.
  await expect(page.getByText('Olá, Bruna')).toBeVisible();
  await expect(page.getByText('Falta', { exact: true })).toHaveCount(1);
  const escolha = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Da galeria' }).click();
  await (await escolha).setFiles({ name: 'rosto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Enviado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Seu cadastro está em análise/)).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-analise.png' });

  // Aprovado (com uma diária grátis), a tela muda ao atualizar.
  const [ent] = await sql<{ id: string }>(`SELECT id FROM entregadores WHERE email = $1`, [email]);
  expect((await pedir('POST', `/entregadores/${ent.id}/aprovar`, { token: tokenSuper })).status).toBe(204);
  await page.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(page.getByText('Você está offline')).toBeVisible();

  await page.getByRole('button', { name: 'Ficar online' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();
  await expect(page.getByText('Paga')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-online.png' });
  const [linha] = await sql(`SELECT online, lat, lon FROM entregadores WHERE id = $1`, [ent.id]);
  expect(linha).toMatchObject({ online: true, lat: -23.5614, lon: -46.6559 });

  // Compra: escolhe o pacote, vê o Pix e informa o pagamento.
  await page.getByRole('tab', { name: 'Créditos' }).click();
  await page.getByRole('button', { name: `Comprar ${nomePacote}` }).click();
  await expect(page.getByRole('button', { name: 'Copiar código Pix' })).toBeVisible();
  await expect(page.getByText(/^000201/)).toBeVisible();
  await page.getByRole('button', { name: 'Já paguei' }).click();
  await expect(page.getByText(/Pagamento informado/)).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-creditos.png' });
  const [compra] = await sql<{ situacao: string }>(`SELECT situacao, pagamento_informado_em FROM pedidos_credito WHERE entregador_id = $1`, [ent.id]);
  expect(compra).toMatchObject({ situacao: 'AGUARDANDO', pagamento_informado_em: expect.any(Date) });

  await page.getByRole('tab', { name: 'Início' }).click();
  await page.getByRole('button', { name: 'Ficar offline' }).click();
  await expect(page.getByText('Você está offline')).toBeVisible();
  expect((await sql(`SELECT online FROM entregadores WHERE id = $1`, [ent.id]))[0].online).toBe(false);
  expect(erros).toEqual([]);
});

test('chamada pelo app: a oferta aparece, aceita, cumpre as etapas e conclui com o código', async ({ page, context }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const ent = await entregadorOnline(tokenSuper, PERTO_DA_SE, `Eva${randomUUID().slice(0, 4)} App Teste`);
  await context.setGeolocation({ latitude: PERTO_DA_SE.lat, longitude: PERTO_DA_SE.lon, accuracy: 10 });

  // Entra no app (o entregador já está online pelo teste; o app retoma).
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.85.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('E-mail ou CPF').fill(ent.email);
  await page.getByLabel('Senha').fill('SenhaEntregador1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();

  // A empresa abre e oferece; com o app aberto, a oferta aparece em até 5 s.
  const ch = await pedir('POST', '/entregas/chamadas', {
    token: emp.adminToken,
    corpo: { tipo: 'ENTREGA', origem: { ...SE, endereco: 'Praça da Sé, 1, Sé, São Paulo', contato: '', telefone: '', instrucoes: '' }, destino: { ...PAULISTA, endereco: 'Avenida Paulista, 1578, Bela Vista, São Paulo', contato: 'Dona Maria', telefone: '11912345678', instrucoes: 'Portaria' }, serieEsperada: null, observacao: '' },
  });
  expect((await pedir('POST', `/entregas/chamadas/${ch.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } })).status).toBe(200);
  await expect(page.getByText('Nova chamada')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/s para responder/)).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-oferta.png' });
  await page.getByRole('button', { name: 'Aceitar' }).click();

  // Etapas: chega na coleta (perto da Sé), coleta, vai ao destino e conclui com o código.
  await expect(page.getByText('A caminho da coleta')).toBeVisible();
  await expect(page.getByText('Avenida Paulista, 1578, Bela Vista, São Paulo')).toBeVisible();
  await context.setGeolocation({ latitude: SE.lat, longitude: SE.lon, accuracy: 10 });
  await page.getByRole('button', { name: 'Cheguei na coleta' }).click();
  await expect(page.getByText('No local da coleta')).toBeVisible();
  await page.getByRole('button', { name: 'Coletei' }).click();
  await expect(page.getByText('A caminho do destino')).toBeVisible();
  await page.getByRole('button', { name: 'Cheguei no destino' }).click();
  await expect(page.getByText('Você ainda não está no destino.')).toBeVisible();
  await context.setGeolocation({ latitude: PAULISTA.lat, longitude: PAULISTA.lon, accuracy: 10 });
  await page.getByRole('button', { name: 'Cheguei no destino' }).click();
  await expect(page.getByText('No destino', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-destino.png' });
  const codigo = (await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: emp.adminToken })).j.codigoConfirmacao as string;
  await page.getByLabel('Código do destinatário').fill(codigo);
  // Saiu 1 volume na coleta (o padrão): a entrega confirma.
  await page.getByText('Entreguei os 1 volume').click();
  await page.getByRole('button', { name: 'Entreguei' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();
  expect((await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: emp.adminToken })).j.situacao).toBe('CONCLUIDA');

  await page.getByRole('tab', { name: 'Extrato' }).click();
  await expect(page.getByText(/Entrega · /)).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-ganhos.png' });
  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('sem internet: o app guarda as etapas e envia sozinho quando a conexão volta', async ({ page, context }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const ent = await entregadorOnline(tokenSuper, PERTO_DA_SE, `Rui${randomUUID().slice(0, 4)} App Teste`);
  await context.setGeolocation({ latitude: PERTO_DA_SE.lat, longitude: PERTO_DA_SE.lon, accuracy: 10 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.84.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('E-mail ou CPF').fill(ent.email);
  await page.getByLabel('Senha').fill('SenhaEntregador1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();

  const ch = await pedir('POST', '/entregas/chamadas', {
    token: emp.adminToken,
    corpo: { tipo: 'ENTREGA', origem: { ...SE, endereco: 'Praça da Sé, 1, Sé, São Paulo', contato: '', telefone: '', instrucoes: '' }, destino: { ...PAULISTA, endereco: 'Avenida Paulista, 1578, Bela Vista, São Paulo', contato: 'Dona Maria', telefone: '11912345678', instrucoes: '' }, serieEsperada: null, observacao: '' },
  });
  await pedir('POST', `/entregas/chamadas/${ch.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } });
  await expect(page.getByText('Nova chamada')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Aceitar' }).click();
  await expect(page.getByText('A caminho da coleta')).toBeVisible();

  // Sem internet: chega e coleta; as duas etapas ficam no celular e a tela segue.
  await context.setGeolocation({ latitude: SE.lat, longitude: SE.lon, accuracy: 10 });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Cheguei na coleta' }).click();
  await expect(page.getByText('No local da coleta')).toBeVisible();
  await expect(page.getByText(/Sem internet: uma etapa guardada/)).toBeVisible();
  await page.getByRole('button', { name: 'Coletei' }).click();
  await expect(page.getByText('A caminho do destino')).toBeVisible();
  await expect(page.getByText(/Sem internet: 2 etapas guardadas/)).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-sem-internet.png' });
  expect((await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: emp.adminToken })).j.situacao).toBe('ACEITA');

  // A internet volta: o app manda as duas, na ordem, e o aviso some.
  await context.setOffline(false);
  await expect.poll(async () => (await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: emp.adminToken })).j.situacao, { timeout: 20_000 }).toBe('COLETADA');
  await expect(page.getByText(/Sem internet:/)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('A caminho do destino')).toBeVisible();
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE id = $1`, [ch.j.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('duas chamadas ao mesmo tempo, assinatura de quem recebe e o guia da bateria', async ({ page, context }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...SE, endereco: 'Praça da Sé, 1, Sé, São Paulo' }, raioAtendimentoKm: 10, assinatura: 'NO_LUGAR_DO_CODIGO', chamadasSimultaneas: 2 } });
  const ent = await entregadorOnline(tokenSuper, PERTO_DA_SE, `Gil${randomUUID().slice(0, 4)} App Teste`);
  await context.setGeolocation({ latitude: PERTO_DA_SE.lat, longitude: PERTO_DA_SE.lon, accuracy: 10 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.83.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('E-mail ou CPF').fill(ent.email);
  await page.getByLabel('Senha').fill('SenhaEntregador1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();

  // O Início fica só com o trabalho; o que falta ajustar está na guia Avisos, com o número na guia.
  await expect(page.getByRole('button', { name: 'Ver como fazer' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Avisos (1)' }).click();
  await expect(page.getByText('Falta 1 ajuste para o app funcionar direito.')).toBeVisible();
  await expect(page.getByLabel('Localização: tudo certo')).toBeVisible();
  await expect(page.getByLabel('Bateria: pendente')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-avisos.png' });
  await page.getByRole('button', { name: 'Ver como fazer' }).click();
  await expect(page.getByText('Deixar o app sempre ligado')).toBeVisible();
  await expect(page.getByText('Xiaomi, Redmi e Poco')).toBeVisible();
  await page.getByRole('button', { name: 'Pronto' }).click();
  await expect(page.getByText('Tudo certo: nada pendente.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Avisos', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Início' }).click();

  const nova = async (destino: { lat: number; lon: number }, rua: string) =>
    (await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: { ...SE, endereco: 'Praça da Sé, 1, Sé, São Paulo', contato: '', telefone: '', instrucoes: '' }, destino: { ...destino, endereco: rua, contato: 'Dona Maria', telefone: '', instrucoes: '' }, serieEsperada: null, observacao: '' } })).j;
  const a = await nova(PAULISTA, 'Avenida Paulista, 1578, Bela Vista, São Paulo');
  const b = await nova({ lat: -23.5587, lon: -46.6612 }, 'Rua Augusta, 1000, Consolação, São Paulo');
  await pedir('POST', `/entregas/chamadas/${a.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } });
  await expect(page.getByText('Nova chamada')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Aceitar' }).click();
  await expect(page.getByText('A caminho da coleta')).toBeVisible();
  // A segunda oferta aparece por cima da chamada em andamento.
  await pedir('POST', `/entregas/chamadas/${b.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } });
  await expect(page.getByText('Nova chamada')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Aceitar' }).click();
  await expect(page.getByRole('tab', { name: `Chamada ${a.numero}` })).toBeVisible();
  await expect(page.getByRole('tab', { name: `Chamadas (2)` })).toBeVisible();

  // Cumpre a primeira até o destino; a assinatura entra no lugar do código.
  await page.getByRole('tab', { name: `Chamada ${a.numero}` }).click();
  await context.setGeolocation({ latitude: SE.lat, longitude: SE.lon, accuracy: 10 });
  await page.getByRole('button', { name: 'Cheguei na coleta' }).click();
  await page.getByRole('button', { name: 'Coletei' }).click();
  await context.setGeolocation({ latitude: PAULISTA.lat, longitude: PAULISTA.lon, accuracy: 10 });
  await page.getByRole('button', { name: 'Cheguei no destino' }).click();
  await expect(page.getByText('Peça para quem recebe assinar:')).toBeVisible();
  await expect(page.getByLabel('Código do destinatário')).toHaveCount(0);
  await page.getByText('Entreguei os 1 volume').click();
  await page.getByRole('button', { name: 'Entreguei' }).click();
  await expect(page.getByText('Informe o nome de quem recebeu.')).toBeVisible();
  const area = await page.getByLabel('Área da assinatura').boundingBox();
  if (!area) throw new Error('sem área');
  await page.mouse.move(area.x + area.width * 0.1, area.y + area.height * 0.5);
  await page.mouse.down();
  for (const [x, y] of [[0.3, 0.2], [0.5, 0.8], [0.7, 0.3], [0.9, 0.6]]) await page.mouse.move(area.x + area.width * x, area.y + area.height * y, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel('Nome de quem recebeu').fill('Maria Souza');
  await page.screenshot({ path: 'test-results/app-entregador-assinatura.png' });
  await page.getByRole('button', { name: 'Entreguei' }).click();
  await expect.poll(async () => (await pedir('GET', `/entregas/chamadas/${a.id}`, { token: emp.adminToken })).j.situacao, { timeout: 10_000 }).toBe('CONCLUIDA');
  expect((await pedir('GET', `/entregas/chamadas/${a.id}`, { token: emp.adminToken })).j.fotos).toContain('ASSINATURA');
  // Sobra a segunda.
  await expect(page.getByText('A caminho da coleta')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Chamada' })).toBeVisible();
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE id = $1`, [b.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('pegar no balcão lendo a etiqueta, volumes na coleta e a conversa com a empresa', async ({ page, context }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const ent = await entregadorOnline(tokenSuper, SE, `Edu${randomUUID().slice(0, 4)} App Teste`);
  await context.setGeolocation({ latitude: SE.lat, longitude: SE.lon, accuracy: 10 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.82.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('E-mail ou CPF').fill(ent.email);
  await page.getByLabel('Senha').fill('SenhaEntregador1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();

  const ch = (await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: { ...SE, endereco: 'Praça da Sé, 1, Sé, São Paulo', contato: '', telefone: '', instrucoes: '' }, destino: { ...PAULISTA, endereco: 'Avenida Paulista, 1578, Bela Vista, São Paulo', contato: 'Dona Maria', telefone: '', instrucoes: '' }, serieEsperada: null, observacao: '' } })).j;
  await page.getByRole('button', { name: 'Pegar no balcão (ler etiqueta)' }).click();
  await page.getByLabel('Etiqueta de coleta').fill(ch.codigoColeta);
  await page.getByRole('button', { name: 'Pegar esta chamada' }).click();
  await expect(page.getByText('No local da coleta')).toBeVisible();
  await pedir('POST', `/entregas/chamadas/${ch.id}/mensagens`, { token: emp.adminToken, corpo: { texto: 'São 2 sacolas, estão no caixa 3.' } });
  await page.getByLabel('Quantos volumes você está levando?').fill('2');
  await page.screenshot({ path: 'test-results/app-entregador-balcao.png' });
  await page.getByRole('button', { name: 'Coletei' }).click();
  await expect(page.getByText('A caminho do destino')).toBeVisible();
  await expect(page.getByText('Levando 2 volumes.')).toBeVisible();
  await page.getByRole('button', { name: /Conversa com a empresa/ }).click();
  await expect(page.getByText('São 2 sacolas, estão no caixa 3.')).toBeVisible();
  await page.getByLabel('Mensagem para a empresa').fill('Peguei, obrigado.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('Peguei, obrigado.')).toBeVisible();
  expect((await pedir('GET', `/entregas/chamadas/${ch.id}`, { token: emp.adminToken })).j).toMatchObject({ situacao: 'COLETADA', volumes: 2, mensagensNaoLidas: 1 });
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE id = $1`, [ch.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('metas e bônus das empresas e o suporte do Flow pelo app', async ({ page, context }) => {
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const ent = await entregadorOnline(tokenSuper, SE, `Gil${randomUUID().slice(0, 4)} App Teste`);
  const agora = Date.now();
  const meta = await pedir('POST', '/entregas/metas', { token: emp.adminToken, corpo: { nome: `Meta app ${randomUUID().slice(0, 4)}`, inicio: new Date(agora - 3600_000).toISOString(), fim: new Date(agora + 2 * 86_400_000).toISOString(), minimoChamadas: 3, valorCentavos: 4500, faixa: null } });
  expect(meta.status, JSON.stringify(meta.j)).toBe(200);
  const nome = meta.j[0].nome as string;
  await context.setGeolocation({ latitude: SE.lat, longitude: SE.lon, accuracy: 10 });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.83.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('E-mail ou CPF').fill(ent.email);
  await page.getByLabel('Senha').fill('SenhaEntregador1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();

  await page.getByRole('button', { name: 'Metas e bônus' }).click();
  await expect(page.getByLabel(`Meta ${nome}`, { exact: false })).toContainText('3 chamadas = R$ 45,00 de bônus');
  await expect(page.getByLabel('0 de 3 chamadas')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar' }).click();

  await page.getByRole('tab', { name: /Avisos/ }).click();
  await page.getByRole('button', { name: 'Falar com o suporte do Flow' }).click();
  await page.getByRole('button', { name: 'Abrir um chamado' }).click();
  await page.getByRole('radio', { name: 'Pagamento ou diárias' }).click();
  await page.getByLabel('Título').fill('Diária não caiu');
  await page.getByLabel('O que aconteceu').fill('Paguei o Pix ontem à noite e não apareceu.');
  await page.getByRole('button', { name: 'Enviar ao suporte' }).click();
  await expect(page.getByText('Paguei o Pix ontem à noite e não apareceu.')).toBeVisible();
  const [chamado] = await sql<{ id: string }>(`SELECT id FROM chamados_suporte WHERE entregador_id = $1`, [ent.id]);
  await pedir('POST', `/plataforma/suporte/${chamado.id}/mensagens`, { token: tokenSuper, corpo: { texto: 'Conferimos e liberamos as diárias.' } });
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByText('1 resposta nova')).toBeVisible();
  await page.getByRole('button', { name: /Chamado \d+: Diária não caiu/ }).click();
  await expect(page.getByText('Conferimos e liberamos as diárias.')).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-suporte.png' });
  await page.getByRole('button', { name: 'Meu problema foi resolvido' }).click();
  await expect(page.getByText('Pagamento ou diárias · Resolvido')).toBeVisible();
  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
