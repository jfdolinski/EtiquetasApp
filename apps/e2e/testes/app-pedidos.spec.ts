import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API, criarEmpresa, pedir, sql, superToken, type EmpresaTeste } from './apoio';

/** Os pedidos no aplicativo, em versão web e tamanho de celular, falando com a API real. */
const APP = process.env.E2E_APP_URL;
test.skip(!APP, 'defina E2E_APP_URL com o build web do aplicativo (ver apps/mobile/README.md)');
test.use({ viewport: { width: 390, height: 780 }, baseURL: APP, hasTouch: true });

const ITENS = [
  { codigo: '10', nome: 'Arroz Tipo 1 5kg', precoCentavos: 2490, estoque: 50, codigoBarras: '7891234567895' },
  { codigo: '11', nome: 'Feijão Carioca 1kg', precoCentavos: 849, estoque: 50 },
];

async function lojaComPedido(empresa: EmpresaTeste) {
  const codigo = randomUUID().replace(/-/g, '').slice(0, 12);
  const impressora = randomUUID();
  await sql(`INSERT INTO impressoras (id, empresa_id, nome, linguagem, endereco, atualizado_em) VALUES ($1, $2, 'Térmica do caixa', 'ESCPOS', '127.0.0.1:9100', now())`, [impressora, empresa.id]);
  const config = {
    colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaUnidade: null, colunaCategoria: null, colunaEstoque: 'estoque', colunaCodigoBarras: 'ean', comFotos: false, pedidoMinimoCentavos: null,
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: false, precoCentavos: 0 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    mensagem: '', enderecoRetirada: 'Rua das Flores, 100', agendamento: { dias: 3, duracaoMinutos: 120 }, impressoraFolhaId: impressora,
  };
  await sql(`UPDATE empresas SET nome_fantasia = 'Mercadinho Bom Preço', horario_funcionamento = $2 WHERE id = $1`, [empresa.id, JSON.stringify(Array.from({ length: 7 }, () => [{ inicio: '00:00', fim: '23:59' }]))]);
  await sql(`INSERT INTO configuracoes_pedidos (id, empresa_id, ativo, codigo_link, config, itens, quantidade_itens, dados_em, validade_minutos, atualizado_em) VALUES ($1, $2, true, $3, $4, $5, 2, now() at time zone 'utc', 120, now())`, [randomUUID(), empresa.id, codigo, JSON.stringify(config), JSON.stringify(ITENS)]);
  const r = await pedir('POST', `/loja/${codigo}/pedidos`, {
    corpo: { itens: [{ codigo: '10', quantidade: 2, precoCentavos: 2490 }, { codigo: '11', quantidade: 1, precoCentavos: 849 }], nome: 'Maria Silva', telefone: '11987654321', modalidade: 'ENTREGA', endereco: { cep: '01001000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' }, agendamento: null, pagamento: 'DINHEIRO', trocoParaCentavos: 10000, observacao: '' },
  });
  expect(r.status).toBe(201);
}

async function vincular(page: Page, empresa: EmpresaTeste) {
  const v = await pedir('POST', '/app/vinculos', { token: empresa.adminToken });
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.89.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByRole('button', { name: 'Digitar o código' }).click();
  await page.getByLabel('Endereço do sistema').fill(new URL(API).origin);
  await page.getByLabel('Código').fill(v.j.codigo);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Início' })).toBeVisible();
}

test('Pedidos no celular: lista, aceitar, folha, WhatsApp e cancelar com motivo', async ({ page }) => {
  const e = await criarEmpresa(await superToken());
  await lojaComPedido(e);
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  await vincular(page, e);

  await page.getByRole('tab', { name: 'Pedidos' }).click();
  await expect(page.getByText('1 esperando alguém aceitar')).toBeVisible();
  // As seis guias cabem na largura do celular.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/app-pedidos-lista.png' });
  await page.getByRole('button', { name: 'Pedido 1, Maria Silva' }).click();

  await expect(page.getByRole('heading', { name: 'Pedido nº 1' })).toBeVisible();
  await expect(page.getByText('troco para R$ 100,00: levar R$ 36,71', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conversar no WhatsApp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imprimir a folha de lançamento' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aceitar pedido' }).click();
  await expect(page.getByRole('button', { name: 'Saiu para entrega' })).toBeVisible();
  await expect(page.getByText('Aceito por', { exact: false })).toBeVisible();

  // Sem o código no ERP, a folha não sai; com ele, vai para a fila.
  await page.getByRole('button', { name: 'Imprimir a folha de lançamento' }).click();
  await expect(page.getByText(/Cadastre o Código no ERP/)).toBeVisible();
  await sql(`UPDATE usuarios SET codigo_erp = '0457' WHERE email = $1`, [e.adminEmail]);
  await page.getByRole('button', { name: 'Imprimir a folha de lançamento' }).click();
  await expect(page.getByText('Folha enviada para a impressora.', { exact: false })).toBeVisible();
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM trabalhos_impressao WHERE empresa_id = $1 AND origem = 'PEDIDO'`, [e.id]);
  expect(n).toBe(1);
  await page.screenshot({ path: 'test-results/app-pedidos-detalhe.png', fullPage: true });

  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await page.getByLabel('Motivo do cancelamento').fill('Produto em falta');
  await page.getByRole('button', { name: 'Cancelar o pedido' }).click();
  await expect(page.getByText('Motivo do cancelamento: Produto em falta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saiu para entrega' })).toHaveCount(0);

  await page.getByRole('link', { name: '‹ Pedidos' }).click();
  await expect(page.getByText('Nenhum pedido.')).toBeVisible();
  await page.getByRole('radio', { name: 'Todos' }).click();
  await expect(page.getByText('Cancelado')).toBeVisible();
  expect(erros).toEqual([]);
});

test('sem a permissão de ver pedidos, a guia não aparece; só vendo, não há botões de mudar', async ({ page }) => {
  const e = await criarEmpresa(await superToken());
  await lojaComPedido(e);
  const perfil = await pedir('POST', '/perfis', { token: e.adminToken, corpo: { nome: `Só vê ${randomUUID().slice(0, 6)}`, permissoes: ['pedido.ver'] } });
  const email = `${randomUUID().slice(0, 8)}@e2e.local`;
  await pedir('POST', '/usuarios', { token: e.adminToken, corpo: { nome: 'Olhador', email, senha: 'SenhaUsuario123', perfilId: perfil.j.id } });
  const token = (await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaUsuario123' } })).j.token as string;
  await vincular(page, { ...e, adminToken: token });
  await page.getByRole('tab', { name: 'Pedidos' }).click();
  await page.getByRole('button', { name: 'Pedido 1, Maria Silva' }).click();
  await expect(page.getByRole('heading', { name: 'Pedido nº 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceitar pedido' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);

  const semPedidos = await pedir('POST', '/perfis', { token: e.adminToken, corpo: { nome: `Sem pedidos ${randomUUID().slice(0, 6)}`, permissoes: ['imprimir'] } });
  const email2 = `${randomUUID().slice(0, 8)}@e2e.local`;
  await pedir('POST', '/usuarios', { token: e.adminToken, corpo: { nome: 'Sem pedidos', email: email2, senha: 'SenhaUsuario123', perfilId: semPedidos.j.id } });
  const token2 = (await pedir('POST', '/auth/login', { corpo: { email: email2, senha: 'SenhaUsuario123' } })).j.token as string;
  await page.evaluate(() => localStorage.clear());
  await vincular(page, { ...e, adminToken: token2 });
  await expect(page.getByRole('tab', { name: 'Pedidos' })).toHaveCount(0);
});
