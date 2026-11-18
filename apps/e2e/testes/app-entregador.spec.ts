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
  await page.getByRole('button', { name: 'Entreguei' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();
  expect((await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: emp.adminToken })).j.situacao).toBe('CONCLUIDA');

  await page.getByRole('tab', { name: 'Extrato' }).click();
  await expect(page.getByText(/Entrega · /)).toBeVisible();
  await page.screenshot({ path: 'test-results/app-entregador-ganhos.png' });
  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
