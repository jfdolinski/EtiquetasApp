import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, pedir, sql, SUPER, superToken } from './apoio';

/** Entregas, etapa 1: cadastro do entregador, aprovação, diárias por Pix confirmado à mão, online e mapa da empresa. */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SE = { lat: -23.5505, lon: -46.6333 };
const PAULISTA = { lat: -23.5614, lon: -46.6559 };

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

async function cadastrar(extra: Record<string, unknown> = {}) {
  const email = `ent-${randomUUID().slice(0, 8)}@e2e.local`;
  const r = await pedir('POST', '/entregador/cadastro', {
    corpo: { nome: 'Rafael Entregador Teste', cpf: cpf(), celular: '11987654321', email, senha: 'SenhaEntregador1', veiculo: 'MOTO', placa: 'ABC1D23', chavePix: email, aceitaTermos: true, ...extra },
  });
  expect(r.status, JSON.stringify(r.j)).toBe(201);
  return { token: r.j.token as string, id: r.j.perfil.id as string, email };
}

async function aprovado(tokenSuper: string, diarias = 0) {
  const e = await cadastrar();
  for (const tipo of ['SELFIE', 'CNH', 'CRLV']) expect((await pedir('PUT', `/entregador/documentos/${tipo}`, { token: e.token, corpo: { imagem: PNG } })).status).toBe(200);
  expect((await pedir('POST', `/entregadores/${e.id}/aprovar`, { token: tokenSuper })).status).toBe(204);
  if (diarias) expect((await pedir('POST', `/entregadores/${e.id}/bonus`, { token: tokenSuper, corpo: { diarias, validadeDias: 30, motivo: 'Teste' } })).status).toBe(204);
  return e;
}

async function pixDaPlataforma(tokenSuper: string) {
  const r = await pedir('PUT', '/entregadores/parametros', { token: tokenSuper, corpo: { pixChave: 'pix@flow.e2e', pixNome: 'Flow Plataforma', pixCidade: 'São Paulo', diariasBonusCadastro: 0, validadeBonusDias: 30 } });
  expect(r.status).toBe(200);
}

test('API: cadastro, aprovação, compra de diárias, online e mapa da empresa', async () => {
  const tokenSuper = await superToken();
  // Parâmetros da plataforma são compartilhados: sem diárias grátis neste teste.
  await pixDaPlataforma(tokenSuper);
  const e = await cadastrar();

  // Pendente: entra, mas não fica online nem compra.
  expect((await pedir('POST', '/entregador/online', { token: e.token, corpo: SE })).j).toMatchObject({ online: false, aviso: 'NAO_APROVADO' });
  expect((await pedir('GET', '/entregador/eu', { token: e.token })).j).toMatchObject({ situacao: 'PENDENTE', documentosFaltando: ['SELFIE', 'CNH', 'CRLV'] });
  // Mesmo CPF ou e-mail não cadastra de novo.
  expect((await pedir('POST', '/entregador/cadastro', { corpo: { nome: 'Outro Nome', cpf: cpf(), celular: '11987654321', email: e.email, senha: 'SenhaEntregador1', veiculo: 'A_PE', chavePix: 'x@y.z', aceitaTermos: true } })).status).toBe(409);
  // SVG ou texto não é documento.
  expect((await pedir('PUT', '/entregador/documentos/SELFIE', { token: e.token, corpo: { imagem: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } })).status).toBe(400);

  // Sem documentos não aprova; recusa com motivo, corrige e volta para análise.
  expect((await pedir('POST', `/entregadores/${e.id}/aprovar`, { token: tokenSuper })).status).toBe(400);
  expect((await pedir('POST', `/entregadores/${e.id}/recusar`, { token: tokenSuper, corpo: { motivo: 'Foto ilegível' } })).status).toBe(204);
  expect((await pedir('GET', '/entregador/eu', { token: e.token })).j).toMatchObject({ situacao: 'RECUSADO', motivo: 'Foto ilegível' });
  for (const tipo of ['SELFIE', 'CNH', 'CRLV']) expect((await pedir('PUT', `/entregador/documentos/${tipo}`, { token: e.token, corpo: { imagem: PNG } })).status).toBe(200);
  expect((await pedir('POST', '/entregador/reenviar', { token: e.token })).j.situacao).toBe('PENDENTE');
  const doc = await pedir('GET', `/entregadores/${e.id}/documentos/CNH`, { token: tokenSuper });
  expect(doc.j.dados).toBe(PNG);
  expect((await pedir('POST', `/entregadores/${e.id}/aprovar`, { token: tokenSuper })).status).toBe(204);
  // Aprovado não troca documento sozinho.
  expect((await pedir('PUT', '/entregador/documentos/CNH', { token: e.token, corpo: { imagem: PNG } })).status).toBe(403);

  // Sem diárias: não fica online.
  expect((await pedir('POST', '/entregador/online', { token: e.token, corpo: SE })).j).toMatchObject({ online: false, aviso: 'SEM_CREDITO' });

  // Compra: pacote, Pix, "já paguei" com comprovante, confirmação do super-admin.
  const pacote = await pedir('POST', '/entregadores/pacotes', { token: tokenSuper, corpo: { nome: `Semana ${randomUUID().slice(0, 4)}`, diarias: 7, precoCentavos: 3500, validadeDias: 30, ativo: true } });
  expect(pacote.status).toBe(201);
  await pixDaPlataforma(tokenSuper);
  const compra = await pedir('POST', '/entregador/creditos/pedidos', { token: e.token, corpo: { pacoteId: pacote.j.id } });
  expect(compra.status).toBe(201);
  expect(compra.j.pixCopiaECola).toContain('540535.00');
  expect(compra.j.pixCopiaECola).toContain(compra.j.txid);
  expect((await pedir('POST', `/entregador/creditos/pedidos/${compra.j.id}/pagamento`, { token: e.token, corpo: { comprovante: PNG } })).j.pagamentoInformadoEm).toBeTruthy();
  const fila = await pedir('GET', '/entregadores/creditos?situacao=AGUARDANDO', { token: tokenSuper });
  expect(fila.j.find((p: { id: string }) => p.id === compra.j.id)).toMatchObject({ temComprovante: true, entregador: { id: e.id } });
  expect((await pedir('POST', `/entregadores/creditos/${compra.j.id}/confirmar`, { token: tokenSuper })).status).toBe(204);
  expect((await pedir('POST', `/entregadores/creditos/${compra.j.id}/confirmar`, { token: tokenSuper })).status).toBe(409);
  expect((await pedir('GET', '/entregador/creditos', { token: e.token })).j).toMatchObject({ saldo: 7 });

  // Online: desconta uma diária; o aviso seguinte no mesmo dia não desconta outra.
  expect((await pedir('POST', '/entregador/online', { token: e.token, corpo: { ...PAULISTA, precisao: 12 } })).j).toMatchObject({ online: true, aviso: null, saldoDiarias: 6 });
  expect((await pedir('POST', '/entregador/posicao', { token: e.token, corpo: PAULISTA })).j).toMatchObject({ online: true, saldoDiarias: 6 });
  // GPS falso não grava a posição.
  expect((await pedir('POST', '/entregador/posicao', { token: e.token, corpo: { lat: -22.9, lon: -43.2, simulada: true } })).j.aviso).toBe('GPS_FALSO');
  const [linha] = await sql(`SELECT lat, lon FROM entregadores WHERE id = $1`, [e.id]);
  expect(linha).toMatchObject(PAULISTA);
  expect((await pedir('GET', '/entregador/creditos', { token: e.token })).j.extrato[0]).toMatchObject({ tipo: 'CONSUMO', quantidade: -1 });

  // Empresa: sem ponto de partida não vê ninguém; com ele, vê o entregador aproximado e pelo primeiro nome.
  const emp = await criarEmpresa(tokenSuper);
  expect((await pedir('GET', '/entregas/mapa', { token: emp.adminToken })).j.entregadores).toEqual([]);
  expect((await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...SE, endereco: 'Praça da Sé' }, raioAtendimentoKm: 5 } })).status).toBe(200);
  const mapa = await pedir('GET', '/entregas/mapa', { token: emp.adminToken });
  const visto = mapa.j.entregadores.find((x: { id: string }) => x.id === e.id);
  expect(visto).toMatchObject({ nome: 'Rafael', veiculo: 'MOTO', situacao: 'LIVRE' });
  expect(visto.lat).not.toBe(PAULISTA.lat);
  expect(JSON.stringify(mapa.j)).not.toContain('cpf');
  // Outra empresa longe (Rio) não vê.
  const longe = await criarEmpresa(tokenSuper);
  await pedir('PUT', '/entregas/config', { token: longe.adminToken, corpo: { base: { lat: -22.9068, lon: -43.1729, endereco: 'Rio' }, raioAtendimentoKm: 20 } });
  expect((await pedir('GET', '/entregas/mapa', { token: longe.adminToken })).j.entregadores.find((x: { id: string }) => x.id === e.id)).toBeUndefined();

  // Os tokens não se misturam.
  expect((await pedir('GET', '/entregas/mapa', { token: e.token })).status).toBe(401);
  expect((await pedir('GET', '/entregador/eu', { token: emp.adminToken })).status).toBe(401);
  expect((await pedir('GET', '/entregadores', { token: emp.adminToken })).status).toBe(403);

  // Suspenso sai do mapa na hora.
  expect((await pedir('POST', `/entregadores/${e.id}/suspender`, { token: tokenSuper, corpo: { motivo: 'Reclamação' } })).status).toBe(204);
  expect((await pedir('GET', '/entregas/mapa', { token: emp.adminToken })).j.entregadores.find((x: { id: string }) => x.id === e.id)).toBeUndefined();
  expect((await pedir('POST', '/entregador/posicao', { token: e.token, corpo: PAULISTA })).j.aviso).toBe('NAO_APROVADO');

  // Sair encerra a sessão.
  expect((await pedir('POST', '/entregador/sair', { token: e.token })).status).toBe(204);
  expect((await pedir('GET', '/entregador/eu', { token: e.token })).status).toBe(401);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

/** Os blocos do mapa vêm do OpenStreetMap: no teste, uma imagem vazia no lugar. */
async function semInternetNoMapa(page: Page) {
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
}

test('Site: super-admin aprova e confirma a compra; a empresa marca o ponto e vê o entregador no mapa', async ({ page }) => {
  const tokenSuper = await superToken();
  await pixDaPlataforma(tokenSuper);
  const pendente = await cadastrar({ nome: 'Juliana Pendente Silva', veiculo: 'BICICLETA', placa: null });
  await pedir('PUT', '/entregador/documentos/SELFIE', { token: pendente.token, corpo: { imagem: PNG } });
  const online = await aprovado(tokenSuper, 2);
  await pixDaPlataforma(tokenSuper);
  const pacote = await pedir('POST', '/entregadores/pacotes', { token: tokenSuper, corpo: { nome: `Mês ${randomUUID().slice(0, 4)}`, diarias: 30, precoCentavos: 12000, validadeDias: 60, ativo: true } });
  const compra = await pedir('POST', '/entregador/creditos/pedidos', { token: online.token, corpo: { pacoteId: pacote.j.id } });
  await pedir('POST', `/entregador/creditos/pedidos/${compra.j.id}/pagamento`, { token: online.token, corpo: {} });
  expect((await pedir('POST', '/entregador/online', { token: online.token, corpo: PAULISTA })).j.online).toBe(true);

  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  await semInternetNoMapa(page);
  await page.setViewportSize({ width: 1400, height: 1000 });

  // Super-admin: aprova o pendente e confirma a compra.
  await entrar(page, SUPER.email, SUPER.senha);
  await page.getByRole('link', { name: 'Entregadores' }).click();
  await page.getByLabel('Buscar').fill(pendente.email);
  const linha = page.getByRole('row', { name: /Juliana Pendente Silva/ });
  await expect(linha).toBeVisible();
  await linha.getByRole('button', { name: 'Abrir' }).click();
  await expect(page.getByRole('img', { name: 'Foto do rosto' })).toBeVisible();
  await page.screenshot({ path: 'test-results/entregadores-aprovacao.png' });
  await page.getByRole('button', { name: 'Aprovar cadastro' }).click();
  await expect(linha).toHaveCount(0);
  await page.getByLabel('Situação').selectOption('APROVADO');
  await expect(linha).toContainText('Aprovado');

  await page.getByRole('tab', { name: 'Compras de diárias' }).click();
  const linhaCompra = page.getByRole('row', { name: new RegExp(compra.j.txid) });
  await expect(linhaCompra).toContainText('R$ 120,00');
  await page.screenshot({ path: 'test-results/entregadores-compras.png' });
  await linhaCompra.getByRole('button', { name: 'Confirmar' }).click();
  await expect(linhaCompra).toHaveCount(0);
  expect((await pedir('GET', '/entregador/creditos', { token: online.token })).j.saldo).toBe(31);

  await page.getByRole('tab', { name: 'Pacotes e Pix' }).click();
  await expect(page.getByLabel('Chave Pix')).toHaveValue('pix@flow.e2e');

  // Empresa: marca o ponto clicando no mapa e vê o entregador.
  const emp = await criarEmpresa(tokenSuper);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.getByRole('tab', { name: 'Mapa' }).click();
  await expect(page.getByText(/Marque o ponto de partida da empresa/)).toBeVisible();
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await page.getByTestId('mapa-entregas').click();
  await expect(page.getByText('Marcado no mapa')).toBeVisible();
  // O clique cai em algum lugar do Brasil: ajusta o ponto pela API e confere o resto pela tela.
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('tab', { name: 'Mapa' })).toHaveAttribute('aria-selected', 'true');
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...SE, endereco: 'Praça da Sé, São Paulo' }, raioAtendimentoKm: 5 } });
  await page.reload();
  await page.getByRole('tab', { name: 'Mapa' }).click();
  await expect(page.getByRole('row', { name: /Rafael/ }).first()).toBeVisible();
  await expect(page.locator('.leaflet-interactive').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/entregas-mapa.png' });

  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [online.id]);
});
