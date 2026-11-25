import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/** Entregas, etapa 10: espera paga, devolução à origem, checklist da maquininha, padrões da plataforma e pedidos do ERP. */

const longeDeTudo = () => ({ lat: -10 - Math.random() * 2, lon: -48 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });
const lista = { carregador: true, bobina: false, chip: true, estado: 'BOA', observacao: '' };
const precos = {
  ENTREGA: { baseCentavos: 800, porKmCentavos: 200, kmIncluso: 2, esperaToleranciaMinutos: 0, esperaPorBlocoCentavos: 300 },
  COLETA: { baseCentavos: 900, porKmCentavos: 200, kmIncluso: 2 },
  DEVOLUCAO_MAQUINA: { baseCentavos: 1500, porKmCentavos: 200, kmIncluso: 2 },
};

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.95.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('API: espera paga, devolução à origem e checklist da maquininha', async () => {
  test.setTimeout(120_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 1500);
  expect((await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, precos } })).status).toBe(200);
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `Ivo${randomUUID().slice(0, 4)} Teste`);
  // Leva máquina: aceita o termo de custódia (etapa 12).
  await pedir('POST', '/entregador/termo-custodia', { token: ent.token });
  const aceitar = async (id: string) => {
    expect((await pedir('POST', `/entregas/chamadas/${id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } })).status).toBe(200);
    const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
    expect((await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token })).status).toBe(200);
  };
  const av = (id: string, corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${id}/avancar`, { token: ent.token, corpo });
  const obter = async (id: string) => (await pedir('GET', `/entregas/chamadas/${id}`, { token: t })).j;

  // Espera: 25 min no local com tolerância 0 = 2 blocos de R$ 3,00.
  const ch = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(D, 'Rua Cliente, 9'), serieEsperada: null, observacao: '' } })).j;
  await aceitar(ch.id);
  expect((await av(ch.id, { para: 'NA_COLETA', ...C, precisao: 5, em: new Date(Date.now() - 25 * 60_000).toISOString() })).status).toBe(200);
  expect((await av(ch.id, { para: 'COLETADA', ...C })).status).toBe(200);
  let c = await obter(ch.id);
  expect(c).toMatchObject({ esperaCentavos: 600, esperaMinutos: 20, valorCentavos: ch.valorCentavos + 600 });
  expect(c.historico.some((h: { texto: string }) => /Espera de 25 min no local: R\$\s?6,00/.test(h.texto))).toBe(true);

  // Devolução: cliente ausente; a empresa manda voltar à origem.
  expect((await av(ch.id, { para: 'NO_DESTINO', ...D, precisao: 5 })).status).toBe(200);
  expect((await pedir('POST', `/entregador/chamadas/${ch.id}/ocorrencia`, { token: ent.token, corpo: { motivo: 'CLIENTE_AUSENTE', texto: 'Ninguém atende', foto: PNG } })).status).toBe(200);
  const dev = await pedir('POST', `/entregas/chamadas/${ch.id}/ocorrencia`, { token: t, corpo: { acao: 'DEVOLVER' } });
  expect(dev.status, JSON.stringify(dev.j)).toBe(200);
  expect(dev.j).toMatchObject({ situacao: 'COLETADA', codigoConfirmacao: null });
  expect(dev.j.codigoDevolucao).toMatch(/^\d{4}$/);
  expect(dev.j.devolucao.valorCentavos).toBeGreaterThanOrEqual(400);
  expect(dev.j.valorCentavos).toBe(c.valorCentavos + dev.j.devolucao.valorCentavos);
  const app = (await pedir('GET', '/entregador/chamada', { token: ent.token })).j;
  expect(app.devolvendo).toBe(true);
  expect(app.destino.lat).toBeCloseTo(C.lat, 5);
  const rastreio = (await pedir('GET', `/rastreio/${String(c.linkRastreio).split('/').pop()}`)).j;
  expect(rastreio).toMatchObject({ texto: 'Não foi possível entregar; o pedido voltou para a empresa', codigoConfirmacao: null, posicao: null });
  expect((await av(ch.id, { para: 'NO_DESTINO', ...D, precisao: 5 })).status).toBe(400);
  expect((await av(ch.id, { para: 'NO_DESTINO', ...C, precisao: 5 })).status).toBe(200);
  expect((await av(ch.id, { para: 'CONCLUIDA', ...C, codigo: ch.codigoConfirmacao === dev.j.codigoDevolucao ? '9999' : ch.codigoConfirmacao })).status).toBe(400);
  expect((await av(ch.id, { para: 'CONCLUIDA', ...C, codigo: dev.j.codigoDevolucao })).j.situacao).toBe('CONCLUIDA');
  const extrato = (await pedir('GET', '/entregador/extrato?periodo=TUDO', { token: ent.token })).j;
  expect(extrato.linhas.find((l: { chamadaId: string }) => l.chamadaId === ch.id)).toMatchObject({ esperaCentavos: 600, devolucaoCentavos: dev.j.devolucao.valorCentavos });

  // Maquininha: série diferente vira ocorrência; a empresa aceita a máquina que está lá.
  const m = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'DEVOLUCAO_MAQUINA', origem: parada(D, 'Rua Cliente, 9'), destino: parada(C, 'Rua da Loja, 1'), serieEsperada: 'ABC12345', observacao: '' } })).j;
  await aceitar(m.id);
  expect((await av(m.id, { para: 'NA_COLETA', ...D, precisao: 5 })).status).toBe(200);
  expect((await av(m.id, { para: 'COLETADA', ...D, serie: 'ABC12345', foto: PNG })).j.message).toMatch(/checklist/);
  const errada = await av(m.id, { para: 'COLETADA', ...D, serie: 'XYZ99999', checklist: lista, foto: PNG });
  expect(errada.j.situacao).toBe('OCORRENCIA');
  c = await obter(m.id);
  expect(c.ocorrencia).toMatchObject({ motivo: 'SERIE_DIFERENTE', serieLida: 'XYZ99999', situacaoAnterior: 'NA_COLETA', temFoto: true });
  expect((await pedir('POST', `/entregas/chamadas/${m.id}/ocorrencia`, { token: t, corpo: { acao: 'DEVOLVER' } })).status).toBe(409);
  expect((await pedir('POST', `/entregas/chamadas/${m.id}/ocorrencia`, { token: t, corpo: { acao: 'CONTINUAR' } })).j).toMatchObject({ situacao: 'NA_COLETA', serieEsperada: 'XYZ99999' });
  expect((await av(m.id, { para: 'COLETADA', ...D, serie: 'xyz-99999', checklist: lista, foto: PNG })).j.situacao).toBe('COLETADA');
  expect((await av(m.id, { para: 'NO_DESTINO', ...C, precisao: 5 })).status).toBe(200);
  expect((await av(m.id, { para: 'CONCLUIDA', ...C, serie: 'XYZ99999', codigo: m.codigoConfirmacao, foto: PNG })).j.message).toMatch(/checklist/);
  expect((await av(m.id, { para: 'CONCLUIDA', ...C, serie: 'XYZ99999', checklist: { ...lista, estado: 'AVARIADA', observacao: 'Tela trincada' }, codigo: m.codigoConfirmacao, foto: PNG })).j.situacao).toBe('CONCLUIDA');
  c = await obter(m.id);
  expect(c.checklists).toMatchObject({ COLETA: lista, ENTREGA: { estado: 'AVARIADA', observacao: 'Tela trincada' } });
  expect(c.historico.some((h: { texto: string }) => h.texto.includes('com avaria (Tela trincada)'))).toBe(true);

  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('API: valor mínimo e tabela padrão da plataforma', async () => {
  const tokenSuper = await superToken();
  const antes = (await pedir('GET', '/entregadores/parametros', { token: tokenSuper })).j;
  const tabela = { ...precos, ENTREGA: { ...precos.ENTREGA, baseCentavos: 1234 } };
  try {
    expect((await pedir('PUT', '/entregadores/parametros', { token: tokenSuper, corpo: { ...antes, valorMinimoCentavos: -1 } })).status).toBe(400);
    const r = await pedir('PUT', '/entregadores/parametros', { token: tokenSuper, corpo: { ...antes, valorMinimoCentavos: 9000, tabelaPadrao: tabela } });
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    // Empresa que nunca salvou a tabela fica com a da plataforma; a chamada não sai abaixo do mínimo.
    const nova = await criarEmpresa(tokenSuper);
    expect((await pedir('GET', '/entregas/config', { token: nova.adminToken })).j.config.precos.ENTREGA.baseCentavos).toBe(1234);
    const C = longeDeTudo();
    const previa = await pedir('POST', '/entregas/chamadas/previa', { token: nova.adminToken, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua A, 1'), destino: parada(deslocar(C, 800), 'Rua B, 2'), serieEsperada: null, observacao: '' } });
    expect(previa.j).toMatchObject({ valorCentavos: 9000, minimoAplicado: true });
  } finally {
    await pedir('PUT', '/entregadores/parametros', { token: tokenSuper, corpo: antes });
  }
  expect((await pedir('GET', '/entregadores/parametros', { token: tokenSuper })).j).toMatchObject({ valorMinimoCentavos: antes.valorMinimoCentavos ?? 0, tabelaPadrao: antes.tabelaPadrao ?? null });
});

test('Pedidos do ERP: configurar, ler sem agente avisa, chamar à mão e uma chamada só por pedido', async ({ page }) => {
  test.setTimeout(90_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 1200);
  await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, precos } });
  // Sem agente: a consulta só dá nome às colunas; os pedidos entram direto no banco, como a leitura faria.
  const conexao = randomUUID();
  await sql(`INSERT INTO conexoes_banco (id, empresa_id, nome, tipo, host, porta, banco, usuario, atualizado_em) VALUES ($1, $2, $3, 'POSTGRES', 'localhost', 5432, 'erp', 'leitor', now())`, [conexao, emp.id, `Conexão ${conexao.slice(0, 6)}`]);
  const consulta = async (nome: string, sqlTexto: string, colunas: string[]) => {
    const id = randomUUID();
    await sql(`INSERT INTO consultas_sql (id, empresa_id, conexao_id, nome, finalidade, sql, campos, atualizado_em) VALUES ($1, $2, $3, $4, 'OUTRA', $5, $6, now())`, [id, emp.id, conexao, `${nome} ${id.slice(0, 4)}`, sqlTexto, JSON.stringify(colunas.map((n) => ({ nome: n })))]);
    return id;
  };
  const boa = await consulta('Pedidos a entregar', 'SELECT numero AS pedido, nome AS cliente, fone AS telefone, endereco, lat, lon FROM pedidos', ['pedido', 'cliente', 'telefone', 'endereco', 'lat', 'lon']);
  const busca = await consulta('Busca', 'SELECT numero AS pedido, endereco FROM pedidos WHERE numero = {param.numero}', ['pedido', 'endereco']);
  const semNumero = await consulta('Sem número', 'SELECT nome AS cliente, endereco FROM pedidos', ['cliente', 'endereco']);
  const cfg = (consultaId: string) => ({ consultaId, ativo: true, intervaloMinutos: 2, chamarAutomatico: true, importarExistentes: false });
  expect((await pedir('PUT', '/entregas/pedidos-erp', { token: t, corpo: cfg(busca) })).j.message).toMatch(/valores digitados/);
  expect((await pedir('PUT', '/entregas/pedidos-erp', { token: t, corpo: cfg(semNumero) })).j.message).toMatch(/número do pedido/);
  expect((await pedir('PUT', '/entregas/pedidos-erp', { token: t, corpo: { ...cfg(boa), intervaloMinutos: 0 } })).status).toBe(400);
  const salvo = await pedir('PUT', '/entregas/pedidos-erp', { token: t, corpo: cfg(boa) });
  expect(salvo.status, JSON.stringify(salvo.j)).toBe(200);
  // Sem agente, a leitura falha e o motivo fica na tela; nada é chamado.
  const lido = await pedir('POST', '/entregas/pedidos-erp/ler', { token: t });
  expect(lido.j.erro).toBeTruthy();
  expect(lido.j.pedidos).toHaveLength(0);
  // Outra empresa não vê nem chama.
  const outra = await empresaComBase(tokenSuper);
  const pedidoId = randomUUID();
  const dados = { codigo: 'P-100', tipo: 'ENTREGA', cliente: 'Ana Cliente', telefone: '11999990000', endereco: 'Rua Cliente, 9', ponto: D, observacao: 'Portão azul', serie: null };
  await sql(`INSERT INTO pedidos_erp_entrega (id, empresa_id, codigo, dados, situacao, mensagem, atualizado_em) VALUES ($1, $2, 'P-100', $3, 'PENDENTE', 'Esperando a empresa chamar o entregador.', now())`, [pedidoId, emp.id, JSON.stringify(dados)]);
  expect((await pedir('GET', '/entregas/pedidos-erp', { token: outra.adminToken })).j.pedidos).toHaveLength(0);
  expect((await pedir('GET', `/entregas/pedidos-erp/${pedidoId}/rascunho`, { token: outra.adminToken })).status).toBe(404);
  // O mesmo número não entra duas vezes.
  await expect(sql(`INSERT INTO pedidos_erp_entrega (id, empresa_id, codigo, dados, situacao, atualizado_em) VALUES ($1, $2, 'P-100', '{}', 'PENDENTE', now())`, [randomUUID(), emp.id])).rejects.toThrow();

  // Site: a aba mostra o pedido; "Chamar entregador" abre a nova chamada já preenchida.
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.getByRole('tab', { name: 'Pedidos do ERP' }).click();
  await expect(page.getByTestId('leitura-erp')).toContainText('Lendo a consulta');
  await expect(page.getByText('Última leitura falhou')).toBeVisible();
  const linha = page.getByTestId('pedido-erp').filter({ hasText: 'P-100' });
  await expect(linha).toContainText('Ana Cliente');
  await expect(linha).toContainText('Esperando a empresa');
  await linha.getByRole('button', { name: 'Chamar entregador' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('Entregador para o pedido P-100 do ERP');
  await expect(dialogo.getByText('Valor para o entregador')).toBeVisible();
  await page.screenshot({ path: 'test-results/pedido-erp-chamada.png' });
  await dialogo.getByRole('button', { name: /Abrir chamada/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Pedido P-100 do ERP.');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Pedidos do ERP' }).click();
  await expect(linha).toContainText('Chamada aberta');
  await expect(linha.getByRole('button', { name: 'Chamar entregador' })).toHaveCount(0);

  // Pela API, o mesmo pedido não abre outra chamada.
  const de = (await pedir('GET', `/entregas/pedidos-erp/${pedidoId}/rascunho`, { token: t })).j;
  const outraChamada = await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: de.tipo, origem: de.origem, destino: de.destino, serieEsperada: null, observacao: de.observacao, pedidoErpId: pedidoId } });
  expect(outraChamada.status).toBe(409);
  expect(outraChamada.j.message).toMatch(/já tem a chamada/);
  // Ignorar e voltar.
  const ign = randomUUID();
  await sql(`INSERT INTO pedidos_erp_entrega (id, empresa_id, codigo, dados, situacao, atualizado_em) VALUES ($1, $2, 'P-200', $3, 'PENDENTE', now())`, [ign, emp.id, JSON.stringify({ ...dados, codigo: 'P-200' })]);
  expect((await pedir('POST', `/entregas/pedidos-erp/${ign}/ignorar`, { token: t })).j.pedidos.find((p: { id: string }) => p.id === ign).situacao).toBe('IGNORADO');
  expect((await pedir('POST', `/entregas/pedidos-erp/${ign}/voltar`, { token: t })).j.pedidos.find((p: { id: string }) => p.id === ign).situacao).toBe('PENDENTE');
  expect(erros).toEqual([]);
});
