import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API, criarEmpresa, montarListaDeHoje, pedir, sql, superToken, type EmpresaTeste } from './apoio';
import { deslocar, entregadorOnline, PNG } from './apoio-entregas';

/**
 * Vitrine do visual: 10 telas do site, 10 do app das empresas e 10 do app do entregador, com dados
 * de exemplo. Não é teste de regra: só roda com VITRINE=1 e grava em apps/e2e/vitrine/.
 */
test.skip(!process.env.VITRINE, 'só com VITRINE=1');
test.describe.configure({ mode: 'serial' });

const APP = process.env.E2E_APP_URL;
const ENTREGADOR = process.env.E2E_ENTREGADOR_URL;
const BASE = { lat: -23.5505, lon: -46.6333 };
const SEMPRE_ABERTA = Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]);
const ITENS = [
  { codigo: '10', nome: 'Arroz Tipo 1 Camil 5kg', precoCentavos: 2490, estoque: 50 },
  { codigo: '11', nome: 'Feijão Carioca Kicaldo 1kg', precoCentavos: 899, estoque: 80 },
  { codigo: '12', nome: 'Café Pilão Tradicional 500g', precoCentavos: 1849, estoque: 30 },
  { codigo: '13', nome: 'Leite Integral Italac 1L', precoCentavos: 549, estoque: 120 },
  { codigo: '14', nome: 'Óleo de Soja Liza 900ml', precoCentavos: 789, estoque: 60 },
  { codigo: '15', nome: 'Açúcar Refinado União 1kg', precoCentavos: 529, estoque: 90 },
];
const ip = () => `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const foto = (page: Page, app: string, nome: string) => page.screenshot({ path: `vitrine/${app}/${nome}.png` });
const tiles = (page: Page) => page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));

let emp: EmpresaTeste;
let loja = '';
let codigoPedido = '';
let rastreio = '';

async function pedidoDaLoja(nome: string, ponto: { lat: number; lon: number }, itens: { codigo: string; quantidade: number; precoCentavos: number }[]) {
  const endereco = { cep: '01310100', rua: 'Avenida Paulista', numero: String(1000 + Math.floor(Math.random() * 900)), semNumero: false, complemento: 'ap 42', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', localizacao: { latitude: Number(ponto.lat.toFixed(6)), longitude: Number(ponto.lon.toFixed(6)), precisaoMetros: 12 } };
  const r = await pedir('POST', `/loja/${loja}/pedidos`, { corpo: { itens, nome, telefone: '11987654321', modalidade: 'ENTREGA', endereco, agendamento: null, pagamento: 'PIX', trocoParaCentavos: null, observacao: 'Interfone 42' }, ip: ip() });
  expect(r.status, JSON.stringify(r.j)).toBe(201);
  const [p] = await sql<{ id: string; numero: number }>(`SELECT id, numero FROM pedidos WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 1`, [emp.id]);
  return { ...p, codigo: r.j.codigo as string };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const tokenSuper = await superToken();
  emp = await criarEmpresa(tokenSuper);
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercado Bom Preço', horario_funcionamento = $2 WHERE id = $1`, [emp.id, JSON.stringify(SEMPRE_ABERTA)]);
  await sql(`UPDATE usuarios SET nome = 'Marina Duarte' WHERE email = $1`, [emp.adminEmail]);
  await montarListaDeHoje(emp, { produtos: ['7891000100103', '7891000100110', '7891000100127', '7891000100134', '7891000100141'] });
  loja = randomUUID().replace(/-/g, '').slice(0, 12);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: null, comFotos: false,
    pedidoMinimoCentavos: null,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 700 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: 'Entregamos na região da Paulista em até 1 hora.', enderecoRetirada: 'Rua Augusta, 500', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: null,
  };
  await sql(`INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, $6, now() at time zone 'utc', 600, now())`, [randomUUID(), emp.id, loja, JSON.stringify(config), JSON.stringify(ITENS), ITENS.length]);
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...BASE, endereco: 'Rua Augusta, 500, Consolação, São Paulo' }, raioAtendimentoKm: 10 } });
  const p1 = await pedidoDaLoja('Carla Nogueira', deslocar(BASE, -900, -1400), [{ codigo: '10', quantidade: 2, precoCentavos: 2490 }, { codigo: '12', quantidade: 1, precoCentavos: 1849 }]);
  await pedidoDaLoja('Rafael Antunes', deslocar(BASE, 600, 800), [{ codigo: '13', quantidade: 6, precoCentavos: 549 }]);
  await pedidoDaLoja('Beatriz Lima', deslocar(BASE, -300, 1200), [{ codigo: '11', quantidade: 3, precoCentavos: 899 }, { codigo: '14', quantidade: 2, precoCentavos: 789 }]);
  codigoPedido = p1.codigo;
  await pedir('POST', `/pedidos/${p1.id}/situacao`, { token: emp.adminToken, corpo: { situacao: 'EM_SEPARACAO' } });
  // Entregadores online por perto e uma chamada em andamento.
  const ana = await entregadorOnline(tokenSuper, deslocar(BASE, 400, 300), 'Ana Paula Souza');
  await entregadorOnline(tokenSuper, deslocar(BASE, -700, -500), 'Bruno Ferreira Costa');
  await entregadorOnline(tokenSuper, deslocar(BASE, 900, -900), 'Diego Martins Rocha');
  const rasc = (await pedir('GET', `/entregas/pedidos/${p1.id}/rascunho`, { token: emp.adminToken })).j;
  const ch = (await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: { ...BASE, endereco: 'Rua Augusta, 500, Consolação, São Paulo', contato: '', telefone: '', instrucoes: '' }, destino: rasc.destino, serieEsperada: null, observacao: rasc.observacao, pedidoId: p1.id } })).j;
  await pedir('POST', `/entregas/chamadas/${ch.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ana.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ana.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ana.token });
  await pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ana.token, corpo: { para: 'NA_COLETA', ...BASE, precisao: 5 } });
  await pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ana.token, corpo: { para: 'COLETADA', ...BASE } });
  await pedir('POST', '/entregador/posicao', { token: ana.token, corpo: deslocar(BASE, -500, -700) });
  rastreio = String(ch.linkRastreio);
});

async function entrar(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(emp.adminEmail);
  await page.getByLabel('Senha').fill(emp.adminSenha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('site: 10 telas', async ({ page }) => {
  test.setTimeout(180_000);
  await tiles(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await foto(page, 'site', '01-entrar');
  await entrar(page);
  await page.waitForTimeout(800);
  await foto(page, 'site', '02-inicio');
  await page.getByRole('link', { name: 'Lista do dia' }).click();
  await page.waitForTimeout(1000);
  await foto(page, 'site', '03-lista-do-dia');
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await page.waitForTimeout(1200);
  await foto(page, 'site', '04-pedidos');
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.waitForTimeout(1200);
  await foto(page, 'site', '05-entregas-chamadas');
  await page.getByTestId('linha-chamada').first().click();
  await page.waitForTimeout(1200);
  await foto(page, 'site', '06-entregas-chamada-aberta');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Mapa' }).click();
  await page.waitForTimeout(1200);
  await foto(page, 'site', '07-entregas-mapa');
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await page.waitForTimeout(800);
  await foto(page, 'site', '08-entregas-configuracao');
  await page.getByRole('link', { name: 'Usuários' }).click();
  await page.waitForTimeout(800);
  await foto(page, 'site', '09-usuarios');
  await page.getByRole('link', { name: 'Minha conta' }).first().click();
  await page.waitForTimeout(800);
  await foto(page, 'site', '10-minha-conta');
});

test('site no celular: loja e acompanhamento da entrega', async ({ page }) => {
  await tiles(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/loja/${loja}`);
  await page.waitForTimeout(1500);
  await foto(page, 'site', '11-loja-do-cliente');
  await page.goto(rastreio);
  await page.waitForTimeout(1500);
  await foto(page, 'site', '12-acompanhar-entrega');
  void codigoPedido;
});

test('app das empresas: 10 telas', async ({ page }) => {
  test.skip(!APP, 'defina E2E_APP_URL');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const v = await pedir('POST', '/app/vinculos', { token: emp.adminToken });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto(APP!);
  await page.waitForTimeout(1200);
  await foto(page, 'app', '01-vincular');
  await page.getByRole('button', { name: 'Digitar o código' }).click();
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('Código').fill(v.j.codigo);
  await foto(page, 'app', '02-digitar-codigo');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('localhost:3000')).toBeVisible();
  await foto(page, 'app', '03-confirmar-vinculo');
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Início' })).toBeVisible();
  await page.waitForTimeout(1200);
  await foto(page, 'app', '04-inicio');
  await page.getByRole('tab', { name: 'Lista do dia' }).click();
  await page.waitForTimeout(1200);
  await foto(page, 'app', '05-lista-do-dia');
  await page.getByRole('checkbox').first().click();
  await page.waitForTimeout(300);
  await foto(page, 'app', '06-lista-marcada');
  await page.getByRole('tab', { name: 'Etiqueta avulsa' }).click();
  await page.waitForTimeout(1000);
  await foto(page, 'app', '07-etiqueta-avulsa');
  await page.getByRole('tab', { name: 'Pedidos' }).click();
  await page.waitForTimeout(1200);
  await foto(page, 'app', '08-pedidos');
  await page.getByText('Carla Nogueira').first().click();
  await page.waitForTimeout(1000);
  await foto(page, 'app', '09-pedido-aberto');
  await page.getByRole('tab', { name: /Avisos/ }).click();
  await page.waitForTimeout(1000);
  await foto(page, 'app', '10-avisos');
});

test('app do entregador: 10 telas', async ({ page, context }) => {
  test.skip(!ENTREGADOR, 'defina E2E_ENTREGADOR_URL');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['geolocation']);
  const tokenSuper = await superToken();
  const perto = deslocar(BASE, 300, 200);
  await context.setGeolocation({ latitude: perto.lat, longitude: perto.lon, accuracy: 10 });
  const ent = await entregadorOnline(tokenSuper, perto, 'Lucas Pereira Alves');
  await pedir('POST', '/entregador/offline', { token: ent.token });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip() });
  await page.goto(ENTREGADOR!);
  await page.waitForTimeout(1200);
  await foto(page, 'entregador', '01-entrar');
  await page.getByText('Quero me cadastrar').click();
  await page.waitForTimeout(800);
  await foto(page, 'entregador', '02-cadastro');
  await page.goto(ENTREGADOR!);
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('E-mail ou CPF').fill(ent.email);
  await page.getByLabel('Senha').fill('SenhaEntregador1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Você está offline')).toBeVisible();
  await foto(page, 'entregador', '03-inicio-offline');
  await page.getByRole('button', { name: 'Ficar online' }).click();
  await expect(page.getByText('Você está online')).toBeVisible();
  await foto(page, 'entregador', '04-inicio-online');
  const ch = (await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: { ...BASE, endereco: 'Rua Augusta, 500, Consolação, São Paulo', contato: '', telefone: '', instrucoes: '' }, destino: { ...deslocar(BASE, 1500, 900), endereco: 'Rua Haddock Lobo, 595, Cerqueira César, São Paulo', contato: 'Sônia Ribeiro', telefone: '11912345678', instrucoes: 'Portaria' }, serieEsperada: null, observacao: 'Pedido nº 482' } })).j;
  await pedir('POST', `/entregas/chamadas/${ch.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } });
  await expect(page.getByText('Nova chamada')).toBeVisible({ timeout: 15_000 });
  await foto(page, 'entregador', '05-oferta');
  await page.getByRole('button', { name: 'Aceitar' }).click();
  await expect(page.getByText('A caminho da coleta')).toBeVisible();
  await foto(page, 'entregador', '06-chamada');
  await page.getByRole('tab', { name: /Avisos/ }).click();
  await page.waitForTimeout(800);
  await foto(page, 'entregador', '07-avisos');
  await page.getByRole('tab', { name: 'Extrato' }).click();
  await page.waitForTimeout(1000);
  await foto(page, 'entregador', '08-extrato');
  await page.getByRole('tab', { name: 'Créditos' }).click();
  await page.waitForTimeout(1000);
  await foto(page, 'entregador', '09-creditos');
  await page.getByRole('tab', { name: 'Perfil' }).click();
  await page.waitForTimeout(800);
  await foto(page, 'entregador', '10-perfil');
  await sql(`UPDATE entregadores SET online = false WHERE online = true`);
});
