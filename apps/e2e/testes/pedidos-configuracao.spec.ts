import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, login, pedir, sql, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let e: EmpresaTeste;

const COLUNAS = ['codigo', 'ean', 'descricao', 'preco', 'preco_de', 'grupo', 'unidade', 'estoque'];
const CONFIG = {
  colunaCodigo: 'codigo',
  colunaNome: 'descricao',
  colunaPreco: 'preco',
  colunaPrecoDe: 'preco_de',
  colunaUnidade: 'unidade',
  colunaCategoria: 'grupo',
  colunaEstoque: 'estoque',
  colunaCodigoBarras: 'ean',
  comFotos: false,
  pedidoMinimoCentavos: 3000,
  modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: true, precoCentavos: 300 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
  mensagem: 'Pedidos até as 17h saem no mesmo dia',
  enderecoRetirada: 'Rua das Flores, 100',
};
const HORARIO = [[], [{ inicio: '08:00', fim: '12:00' }, { inicio: '14:00', fim: '18:00' }], [{ inicio: '08:00', fim: '18:00' }], [], [], [], []];
const ITENS = [{ codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, precoDeCentavos: 2990, categoria: 'Mercearia', estoque: 5 }];

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.95.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

/** Sem agente: a consulta só dá nome às colunas, e os produtos entram direto no banco. */
async function criarConsulta(empresa: EmpresaTeste, sqlTexto = 'SELECT 1') {
  const conexao = randomUUID();
  const consulta = randomUUID();
  await sql(`INSERT INTO conexoes_banco (id, empresa_id, nome, tipo, host, porta, banco, usuario, atualizado_em) VALUES ($1, $2, $3, 'POSTGRES', 'localhost', 5432, 'erp', 'leitor', now())`, [conexao, empresa.id, `Conexão ${conexao.slice(0, 6)}`]);
  await sql(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, finalidade, sql, campos, atualizado_em) VALUES ($1, $2, $3, $4, 'OUTRA', $5, $6, now())`, [consulta, empresa.id, conexao, `Produtos ${consulta.slice(0, 6)}`, sqlTexto, JSON.stringify(COLUNAS.map((nome) => ({ nome })))]);
  return consulta;
}

async function usuarioCom(empresa: EmpresaTeste, nome: string, permissoes: string[]) {
  const perfil = await pedir('POST', '/perfis', { token: empresa.adminToken, corpo: { nome: `${nome} ${randomUUID().slice(0, 6)}`, permissoes } });
  expect(perfil.status).toBe(201);
  const email = `${randomUUID().slice(0, 8)}@e2e.local`;
  const u = await pedir('POST', '/usuarios', { token: empresa.adminToken, corpo: { nome, email, senha: 'SenhaUsuario123', perfilId: perfil.j.id } });
  expect(u.status).toBe(201);
  return login(email, 'SenhaUsuario123');
}

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
});

test('configura pela tela: colunas sugeridas, entrega, mínimo, horário, link e situação', async ({ page }) => {
  const consulta = await criarConsulta(e);
  const [{ nome: nomeConsulta }] = await sql(`SELECT nome FROM consultas_sql WHERE id = $1`, [consulta]);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, e.adminEmail, e.adminSenha);
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await expect(page.getByText('O link é criado quando você salva a configuração pela primeira vez.')).toBeVisible();

  await page.getByRole('combobox', { name: /^Consulta/ }).selectOption({ label: nomeConsulta });
  // As colunas conhecidas vêm sugeridas.
  await expect(page.getByRole('combobox', { name: /^Código do produto/ })).toHaveValue('codigo');
  await expect(page.getByRole('combobox', { name: /^Nome/ })).toHaveValue('descricao');
  await expect(page.getByRole('combobox', { name: /^Preço(?! anterior)/ })).toHaveValue('preco');
  await expect(page.getByRole('combobox', { name: /^Estoque/ })).toHaveValue('estoque');
  await expect(page.getByRole('combobox', { name: /^Código de barras/ })).toHaveValue('ean');

  // Retirar no local vem ligado: sem endereço da loja não salva.
  await expect(page.getByText('Informe o endereço para quem vai retirar no local.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  await page.getByLabel('Endereço para retirada').fill('Rua das Flores, 100');
  await page.getByLabel('Taxa de Entrega', { exact: true }).fill('5,00');
  await page.getByLabel('Pedido mínimo (R$, opcional)').fill('30');
  await page.getByLabel('Pedido mínimo (R$, opcional)').fill('abc');
  await expect(page.getByText('Pedido mínimo inválido.')).toBeVisible();
  await page.getByLabel('Pedido mínimo (R$, opcional)').fill('30,00');

  // Horário: segunda das 8h às 18h, copiado para os dias úteis.
  await expect(page.getByText(/Sem horário cadastrado/)).toBeVisible();
  const segunda = page.locator('div').filter({ hasText: /^Segunda/ }).first();
  await segunda.getByRole('button', { name: 'Abrir neste dia' }).click();
  await segunda.getByRole('button', { name: 'Copiar para seg a sex' }).click();
  await expect(page.getByLabel('Sexta, período 1, início')).toHaveValue('08:00');
  await expect(page.getByLabel('Sábado, período 1, início')).toHaveCount(0);

  await page.getByLabel('Receber pedidos pelo link').check();
  await page.getByLabel('Mensagem de boas-vindas').fill('Pedidos até as 17h saem no mesmo dia');
  await page.getByRole('button', { name: 'Salvar' }).click();
  // Sem agente, a leitura falha: a configuração fica salva e o motivo aparece.
  await expect(page.getByText(/Configuração salva, mas a leitura dos produtos falhou/)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('Sem produtos', { exact: true })).toBeVisible();
  const link = await page.getByTestId('link-catalogo').textContent();
  expect(link).toMatch(/\/loja\/[A-Za-z0-9_-]{12}$/);
  await page.screenshot({ path: 'test-results/pedidos-configuracao.png', fullPage: true });

  const [guardado] = await sql(`SELECT c.ativo, c.config, c.responsavel_id, e.horario_funcionamento FROM configuracoes_pedidos c JOIN empresas e ON e.id = c.empresa_id WHERE c.empresa_id = $1`, [e.id]);
  expect(guardado.ativo).toBe(true);
  expect(guardado.config.pedidoMinimoCentavos).toBe(3000);
  expect(guardado.config.modalidades.ENTREGA).toEqual({ ativa: true, precoCentavos: 500 });
  expect(guardado.horario_funcionamento[5]).toEqual([{ inicio: '08:00', fim: '18:00' }]);
  expect(guardado.horario_funcionamento[6]).toEqual([]);

  // Com produtos guardados (o que a atualização faria com o agente), o catálogo fica no ar.
  await sql(`UPDATE configuracoes_pedidos SET itens = $2, quantidade_itens = 1, dados_em = now() at time zone 'utc', erro = NULL WHERE empresa_id = $1`, [e.id, JSON.stringify(ITENS)]);
  await page.reload();
  await expect(page.getByText('No ar', { exact: true })).toBeVisible();
  await expect(page.getByText('1 produtos no catálogo')).toBeVisible();

  // Link novo: o antigo deixa de valer.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Gerar link novo' }).click();
  await expect(page.getByTestId('link-catalogo')).not.toHaveText(link!);
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM logs_auditoria WHERE empresa_id = $1 AND acao IN ('pedido.configurar', 'pedido.novo_link')`, [e.id]);
  expect(n).toBe(2);
});

test('API: regras, permissões e uma empresa não enxerga nem usa o que é de outra', async () => {
  const empresa = await criarEmpresa(tokenSuper);
  const outra = await criarEmpresa(tokenSuper);
  const consulta = await criarConsulta(empresa);
  const corpo = (extra: Record<string, unknown> = {}) => ({ ativo: false, consultaId: consulta, config: CONFIG, intervaloMinutos: 15, validadeMinutos: 120, horario: HORARIO, ...extra });

  // Antes de salvar: padrão, sem link.
  const vazio = await pedir('GET', '/pedidos/configuracao', { token: empresa.adminToken });
  expect(vazio.status).toBe(200);
  expect(vazio.j.codigoLink).toBeNull();
  expect((await pedir('POST', '/pedidos/configuracao/novo-link', { token: empresa.adminToken })).status).toBe(400);

  // Regras conferidas na API, não só na tela.
  expect((await pedir('PUT', '/pedidos/configuracao', { token: empresa.adminToken, corpo: corpo({ config: { ...CONFIG, colunaPreco: '' } }) })).status).toBe(400);
  expect((await pedir('PUT', '/pedidos/configuracao', { token: empresa.adminToken, corpo: corpo({ config: { ...CONFIG, colunaUnidade: 'nao_existe' } }) })).status).toBe(400);
  expect((await pedir('PUT', '/pedidos/configuracao', { token: empresa.adminToken, corpo: corpo({ horario: [[{ inicio: '18:00', fim: '08:00' }], [], [], [], [], [], []] }) })).status).toBe(400);
  expect((await pedir('PUT', '/pedidos/configuracao', { token: empresa.adminToken, corpo: corpo({ config: { ...CONFIG, modalidades: { ...CONFIG.modalidades, ENTREGA: { ativa: true, precoCentavos: 4.5 } } } }) })).status).toBe(400);
  const busca = await criarConsulta(empresa, 'SELECT * FROM produtos WHERE descricao ILIKE {param.busca}');
  expect((await pedir('PUT', '/pedidos/configuracao', { token: empresa.adminToken, corpo: corpo({ consultaId: busca }) })).status).toBe(400);

  const salvo = await pedir('PUT', '/pedidos/configuracao', { token: empresa.adminToken, corpo: corpo({ config: { ...CONFIG, extra: 'não entra' } }) });
  expect(salvo.status).toBe(200);
  expect(salvo.j.codigoLink).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(salvo.j.situacao).toBe('DESLIGADO');
  expect(salvo.j.config).not.toHaveProperty('extra');
  // Desligado: nada de atualizar.
  expect((await pedir('POST', '/pedidos/configuracao/atualizar', { token: empresa.adminToken })).status).toBe(400);

  // Outra empresa: não usa a consulta daqui e não vê a configuração daqui.
  expect((await pedir('PUT', '/pedidos/configuracao', { token: outra.adminToken, corpo: corpo() })).status).toBe(400);
  const daOutra = await pedir('GET', '/pedidos/configuracao', { token: outra.adminToken });
  expect(daOutra.j.codigoLink).toBeNull();
  expect((await pedir('GET', '/pedidos/configuracao/consultas', { token: outra.adminToken })).j.some((c: { id: string }) => c.id === consulta)).toBe(false);

  // Sem a permissão de configurar, nada; e não precisa de sql.ver para escolher a consulta.
  const semPermissao = await usuarioCom(empresa, 'Atendente', ['pedido.ver']);
  expect((await pedir('GET', '/pedidos/configuracao', { token: semPermissao })).status).toBe(403);
  expect((await pedir('PUT', '/pedidos/configuracao', { token: semPermissao, corpo: corpo() })).status).toBe(403);
  const configurador = await usuarioCom(empresa, 'Gerente', ['pedido.configurar']);
  const consultas = await pedir('GET', '/pedidos/configuracao/consultas', { token: configurador });
  expect(consultas.status).toBe(200);
  expect(consultas.j.find((c: { id: string }) => c.id === busca).pedeParametro).toBe(true);
});
