import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API, cnpjValido, criarEmpresa, pedir, sql, superToken } from './apoio';
// O mesmo simulador e o mesmo gerador de certificado dos testes da API.
import { gerarPfxDeTeste } from '../../api/src/nfse/certificado-de-teste';
import { iniciarSimuladorSefin, type SimuladorSefin } from '../../api/src/nfse/simulador-sefin';

/**
 * NFS-e pelo padrão nacional contra um simulador da Sefin Nacional (HTTPS com certificado do
 * cliente, DPS em gzip+base64, assinatura conferida). A API aponta para ele por NFSE_SEFIN_URL.
 */

let sim: SimuladorSefin;
test.beforeAll(async () => {
  sim = await iniciarSimuladorSefin(8096);
});
test.afterAll(async () => {
  // A emissão automática da plataforma não fica ligada para os outros testes.
  const t = await superToken();
  const e = (await pedir('GET', '/plataforma/nfse/emissor', { token: t })).j.emissor;
  if (e) await pedir('PUT', '/plataforma/nfse/emissor', { token: t, corpo: { ...semResumo(e), automatico: { mensalidade: false } } });
  await sim.parar();
});

function semResumo(e: Record<string, unknown>) {
  const { certificado: _c, diasParaVencer: _d, problema: _p, ...dados } = e;
  return dados;
}

const servico = (descricao: string) => ({ codigoTributacaoNacional: '010501', codigoTributacaoMunicipal: null, codigoNbs: null, descricao, aliquotaIss: 2, issRetido: false, percentualTributos: 6 });

async function esperarSituacao(caminho: string, token: string, situacao: string, empresa?: string) {
  await expect.poll(async () => (await pedir('GET', caminho, { token, empresa })).j.situacao, { timeout: 30_000 }).toBe(situacao);
  return (await pedir('GET', caminho, { token, empresa })).j;
}

async function baixar(caminho: string, token: string) {
  const r = await fetch(API + caminho, { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.91.${Math.floor(Math.random() * 250)}.1` } });
  return { status: r.status, tipo: r.headers.get('content-type') ?? '', corpo: Buffer.from(await r.arrayBuffer()) };
}

/** Configura o emissor da plataforma com um CNPJ novo e o certificado dele, mantendo a numeração. */
async function emissorDaPlataforma(t: string) {
  const cnpj = cnpjValido();
  const atual = (await pedir('GET', '/plataforma/nfse/emissor', { token: t })).j.emissor;
  const dados = {
    ambiente: 'PRODUCAO_RESTRITA',
    cnpj,
    inscricaoMunicipal: '123456',
    razaoSocial: 'Flow Plataforma de Teste Ltda',
    codigoMunicipio: '3550308',
    regime: 'SIMPLES',
    regimeEspecial: 0,
    email: 'fiscal@flow.test',
    telefone: null,
    serie: '1',
    proximoNumero: atual?.proximoNumero ?? 1,
    servico: servico('Licença de uso do sistema Flow'),
    automatico: { mensalidade: true },
  };
  const salvo = await pedir('PUT', '/plataforma/nfse/emissor', { token: t, corpo: dados });
  expect(salvo.status, JSON.stringify(salvo.j)).toBe(200);
  return { cnpj, dados, pfx: gerarPfxDeTeste(cnpj, 'senha-certificado', { nome: 'FLOW PLATAFORMA DE TESTE LTDA' }) };
}

test('API: mensalidade vira NFS-e ao registrar o pagamento, a empresa recebe e a plataforma cancela', async () => {
  test.setTimeout(120_000);
  const t = await superToken();
  const { cnpj, dados, pfx } = await emissorDaPlataforma(t);

  // Certificado: senha errada e de outro CNPJ são recusados; o certo aparece sem a chave.
  expect((await pedir('POST', '/plataforma/nfse/emissor/certificado', { token: t, corpo: { arquivo: pfx.pfxBase64, senha: 'errada' } })).j.message).toMatch(/Senha do certificado/);
  const outro = gerarPfxDeTeste(cnpjValido(), 'x');
  expect((await pedir('POST', '/plataforma/nfse/emissor/certificado', { token: t, corpo: { arquivo: outro.pfxBase64, senha: 'x' } })).j.message).toMatch(/não do CNPJ do emissor/);
  const cert = await pedir('POST', '/plataforma/nfse/emissor/certificado', { token: t, corpo: { arquivo: pfx.pfxBase64, senha: 'senha-certificado' } });
  expect(cert.status, JSON.stringify(cert.j)).toBe(200);
  expect(cert.j).toMatchObject({ problema: null, certificado: { titular: 'FLOW PLATAFORMA DE TESTE LTDA', documento: cnpj } });
  expect(JSON.stringify(cert.j)).not.toContain('senha-certificado');
  expect((await sql(`SELECT certificado_cifrado FROM emissores_nfse WHERE empresa_id IS NULL`))[0].certificado_cifrado).toMatch(/^v1:/);
  // Número já usado não volta.
  if (dados.proximoNumero > 1) expect((await pedir('PUT', '/plataforma/nfse/emissor', { token: t, corpo: { ...dados, proximoNumero: 1 } })).j.message).toMatch(/maior que/);

  // Pagamento da mensalidade: a nota sai sozinha, com a empresa como tomadora.
  const emp = await criarEmpresa(t);
  expect((await pedir('PUT', `/cobranca/empresas/${emp.id}/assinatura`, { token: t, corpo: { valorMensal: 149.9, diaVencimento: 10, vencimentoAtual: '2026-11-10' } })).status).toBe(200);
  const pag = await pedir('POST', `/cobranca/empresas/${emp.id}/pagamentos`, { token: t, corpo: { meses: 1, pagoEm: '2026-11-20' } });
  expect(pag.status, JSON.stringify(pag.j)).toBe(201);
  await expect.poll(async () => (await pedir('GET', `/cobranca/empresas/${emp.id}/pagamentos`, { token: t })).j[0].nota?.situacao, { timeout: 30_000 }).toBe('EMITIDA');
  const pagamento = (await pedir('GET', `/cobranca/empresas/${emp.id}/pagamentos`, { token: t })).j[0];
  const nota = (await pedir('GET', `/plataforma/nfse/notas/${pagamento.nota.id}`, { token: t })).j;
  expect(nota).toMatchObject({ origem: 'MENSALIDADE', valorCentavos: 14990, competencia: '2026-11-20', tomador: { documento: expect.stringMatching(/^\d{14}$/) }, descricao: 'Licença de uso do sistema Flow - mensalidade de 11/2026' });
  expect(nota.chaveAcesso).toMatch(/^\d{50}$/);
  // O que chegou ao simulador: DPS assinada, leiaute da Produção Restrita (NT 009).
  const dps = sim.notas.get(nota.chaveAcesso)!.xml;
  expect(dps).toContain('<tpAmb>2</tpAmb>');
  expect(dps).toContain('<finNFSe>0</finNFSe>');
  expect(dps).toContain('<pTotTribSN>6.00</pTotTribSN>');
  expect(dps).not.toContain('<pAliq>');
  // Pedir de novo não duplica.
  expect((await pedir('POST', `/plataforma/nfse/pagamentos/${pagamento.id}/nota`, { token: t })).status).toBe(409);

  // A empresa vê a nota recebida e baixa o PDF e o XML; outra empresa não.
  const recebidas = (await pedir('GET', '/nfse/notas?tipo=RECEBIDAS', { token: emp.adminToken })).j;
  expect(recebidas.map((n: { id: string }) => n.id)).toContain(nota.id);
  const pdf = await baixar(`/nfse/notas/${nota.id}/pdf`, emp.adminToken);
  expect(pdf.status).toBe(200);
  expect(pdf.corpo.subarray(0, 5).toString()).toBe('%PDF-');
  const xml = await baixar(`/nfse/notas/${nota.id}/xml`, emp.adminToken);
  expect(xml.corpo.toString()).toContain(`<infNFSe Id="NFS${nota.chaveAcesso}">`);
  const intrusa = await criarEmpresa(t);
  expect((await pedir('GET', `/nfse/notas/${nota.id}`, { token: intrusa.adminToken })).status).toBe(404);
  expect((await pedir('GET', '/nfse/notas?tipo=RECEBIDAS', { token: intrusa.adminToken })).j).toEqual([]);
  // A empresa não cancela a nota da plataforma.
  expect((await pedir('POST', `/nfse/notas/${nota.id}/cancelar`, { token: emp.adminToken, corpo: { motivo: 1, texto: 'Tentando cancelar a nota de outro' } })).status).toBe(404);

  // Cancelamento: texto curto recusado; o certo cancela na Sefin.
  expect((await pedir('POST', `/plataforma/nfse/notas/${nota.id}/cancelar`, { token: t, corpo: { motivo: 1, texto: 'curto' } })).j.message).toMatch(/15/);
  const cancelada = await pedir('POST', `/plataforma/nfse/notas/${nota.id}/cancelar`, { token: t, corpo: { motivo: 1, texto: 'Valor da mensalidade lançado errado' } });
  expect(cancelada.status, JSON.stringify(cancelada.j)).toBe(200);
  expect(cancelada.j).toMatchObject({ situacao: 'CANCELADA', motivoCancelamento: 'Valor da mensalidade lançado errado' });
  expect(sim.notas.get(nota.chaveAcesso)!.cancelada).toBe(true);
  expect((await pedir('POST', `/plataforma/nfse/notas/${nota.id}/cancelar`, { token: t, corpo: { motivo: 1, texto: 'Valor da mensalidade lançado errado' } })).status).toBe(400);
  expect((await sql(`SELECT count(*)::int n FROM logs_auditoria WHERE acao = 'nfse.cancelar' AND entidade_id = $1`, [nota.id]))[0].n).toBe(1);
});

test('API: Sefin fora do ar tenta de novo com a mesma DPS; recusa vira erro e "Emitir de novo" resolve', async () => {
  test.setTimeout(120_000);
  const t = await superToken();
  const { pfx } = await emissorDaPlataforma(t);
  await pedir('POST', '/plataforma/nfse/emissor/certificado', { token: t, corpo: { arquivo: pfx.pfxBase64, senha: 'senha-certificado' } });

  // Fora do ar: fica na fila com o aviso; a próxima tentativa (adiantada aqui) emite.
  sim.falhar(1);
  const avulsa = await pedir('POST', '/plataforma/nfse/notas', { token: t, corpo: { tomador: { nome: 'Cliente Avulso Ltda', documento: '11.444.777/0001-61' }, descricao: 'Implantação do sistema', valorCentavos: 50000 } });
  expect(avulsa.status, JSON.stringify(avulsa.j)).toBe(201);
  await expect.poll(async () => (await pedir('GET', `/plataforma/nfse/notas/${avulsa.j.id}`, { token: t })).j.erro ?? '', { timeout: 20_000 }).toMatch(/indisponível/);
  expect((await pedir('GET', `/plataforma/nfse/notas/${avulsa.j.id}`, { token: t })).j.situacao).toBe('PENDENTE');
  await sql(`UPDATE notas_fiscais SET proxima_tentativa_em = now() WHERE id = $1`, [avulsa.j.id]);
  const emitida = await esperarSituacao(`/plataforma/nfse/notas/${avulsa.j.id}`, t, 'EMITIDA');
  expect(emitida.tomador).toMatchObject({ documento: '11444777000161', nome: 'Cliente Avulso Ltda' });

  // A resposta se perdeu (a nota existe na Sefin, mas aqui ficou na fila): o reenvio recupera pela consulta da DPS.
  await sql(`UPDATE notas_fiscais SET situacao = 'PENDENTE', chave_acesso = NULL, xml_nfse = NULL, proxima_tentativa_em = now() WHERE id = $1`, [avulsa.j.id]);
  const recuperada = await esperarSituacao(`/plataforma/nfse/notas/${avulsa.j.id}`, t, 'EMITIDA');
  expect(recuperada.chaveAcesso).toBe(emitida.chaveAcesso);

  // Recusa de regra: ERRO com a mensagem da Sefin; emitir de novo usa o mesmo número.
  sim.recusar(1);
  const recusada = await pedir('POST', '/plataforma/nfse/notas', { token: t, corpo: { tomador: null, descricao: 'Treinamento da equipe', valorCentavos: 12000 } });
  const comErro = await esperarSituacao(`/plataforma/nfse/notas/${recusada.j.id}`, t, 'ERRO');
  expect(comErro.erro).toMatch(/E0310/);
  const deNovo = await pedir('POST', `/plataforma/nfse/notas/${recusada.j.id}/emitir-de-novo`, { token: t });
  expect(deNovo.status, JSON.stringify(deNovo.j)).toBe(200);
  const ok = await esperarSituacao(`/plataforma/nfse/notas/${recusada.j.id}`, t, 'EMITIDA');
  expect(ok.numeroDps).toBe(comErro.numeroDps);
  expect(ok.tomador).toBeNull();
  expect((await pedir('POST', `/plataforma/nfse/notas/${recusada.j.id}/emitir-de-novo`, { token: t })).status).toBe(400);
});

test('API: a empresa emite a nota do pedido concluído (taxa de entrega, CPF do cliente) e respeita as permissões', async () => {
  test.setTimeout(90_000);
  const t = await superToken();
  const emp = await criarEmpresa(t);
  const a = emp.adminToken;
  expect((await pedir('GET', '/nfse/emissor', { token: a })).j.emissor).toBeNull();
  expect((await pedir('POST', '/nfse/notas', { token: a, corpo: { tomador: null, valorCentavos: 100 } })).j.message).toMatch(/Configure/);
  const cnpj = cnpjValido();
  const dados = { ambiente: 'PRODUCAO_RESTRITA', cnpj, inscricaoMunicipal: null, razaoSocial: 'Loja de Teste Ltda', codigoMunicipio: '4106902', regime: 'NORMAL', regimeEspecial: 0, email: null, telefone: null, serie: '2', proximoNumero: 1, servico: servico('Serviço de entrega'), automatico: { pedidos: true, valorPedido: 'TAXA_ENTREGA' } };
  expect((await pedir('PUT', '/nfse/emissor', { token: a, corpo: { ...dados, servico: { ...dados.servico, codigoTributacaoNacional: '123' } } })).j.message).toMatch(/6 dígitos/);
  expect((await pedir('PUT', '/nfse/emissor', { token: a, corpo: dados })).status).toBe(200);
  const pfx = gerarPfxDeTeste(cnpj, 'loja');
  expect((await pedir('POST', '/nfse/emissor/certificado', { token: a, corpo: { arquivo: pfx.pfxBase64, senha: 'loja' } })).j.problema).toBeNull();

  // Pedido concluído agora, com taxa de entrega e CPF: a nota sai sozinha.
  const pedidoId = randomUUID();
  await sql(
    `INSERT INTO pedidos (id, empresa_id, numero, codigo_hash, codigo_cifrado, situacao, cliente_nome, cliente_telefone, cliente_documento, modalidade, pagamento, itens, subtotal_centavos, taxa_centavos, total_centavos, origem_hash, atualizado_em)
     VALUES ($1, $2, 1, $3, 'x', 'CONCLUIDO', 'Maria Cliente', '11987654321', '52998224725', 'ENTREGA', 'PIX', '[]', 5000, 700, 5700, 'x', $4::timestamptz at time zone 'utc')`,
    // Em UTC, como o Prisma grava (o now() do banco de testes sai no fuso da sessão).
    [pedidoId, emp.id, randomUUID(), new Date().toISOString()],
  );
  await expect.poll(async () => (await pedir('GET', `/nfse/pedidos/${pedidoId}`, { token: a })).j.nota?.situacao, { timeout: 30_000 }).toBe('EMITIDA');
  const nota = (await pedir('GET', `/nfse/pedidos/${pedidoId}`, { token: a })).j.nota;
  expect(nota).toMatchObject({ origem: 'PEDIDO', valorCentavos: 700, pedidoNumero: 1, tomador: { documento: '52998224725', nome: 'Maria Cliente' }, descricao: 'Serviço de entrega - entrega do pedido nº 1' });
  const dps = sim.notas.get(nota.chaveAcesso)!.xml;
  expect(dps).toContain('<toma><CPF>52998224725</CPF><xNome>Maria Cliente</xNome></toma>');
  expect(dps).toContain('<opSimpNac>1</opSimpNac>');
  expect(dps).toContain('<pTotTrib><pTotTribFed>6.00</pTotTribFed>');
  expect((await pedir('POST', `/nfse/pedidos/${pedidoId}/nota`, { token: a })).status).toBe(409);
  // A emitida aparece em Emitidas da empresa e não na lista da plataforma.
  expect((await pedir('GET', '/nfse/notas', { token: a })).j.map((n: { id: string }) => n.id)).toContain(nota.id);
  expect((await pedir('GET', `/plataforma/nfse/notas/${nota.id}`, { token: t })).status).toBe(404);

  // Permissões: quem só vê não emite nem configura.
  const perfil = await pedir('POST', '/perfis', { token: a, corpo: { nome: 'Só notas', permissoes: ['nfse.ver'] } });
  const email = `notas-${randomUUID().slice(0, 6)}@e2e.local`;
  await pedir('POST', '/usuarios', { token: a, corpo: { nome: 'Só vê notas', email, senha: 'SenhaUsuario123', perfilId: perfil.j.id } });
  const so = (await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaUsuario123' } })).j.token;
  expect((await pedir('GET', '/nfse/notas', { token: so })).status).toBe(200);
  expect((await pedir('POST', '/nfse/notas', { token: so, corpo: { tomador: null, valorCentavos: 100 } })).status).toBe(403);
  expect((await pedir('PUT', '/nfse/emissor', { token: so, corpo: dados })).status).toBe(403);
  expect((await pedir('POST', `/nfse/notas/${nota.id}/cancelar`, { token: so, corpo: { motivo: 2, texto: 'Serviço não foi prestado' } })).status).toBe(403);
  // Desliga a emissão automática desta empresa (o relógio não procura mais os pedidos dela).
  await sql(`UPDATE emissores_nfse SET automatico = '{"pedidos": false}' WHERE empresa_id = $1`, [emp.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.93.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Tela: a empresa configura os dados fiscais, envia o certificado, emite uma nota avulsa e cancela', async ({ page }) => {
  test.setTimeout(120_000);
  const t = await superToken();
  const emp = await criarEmpresa(t);
  const cnpj = cnpjValido();
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Notas fiscais' }).click();
  await expect(page.getByText('Preencha os dados fiscais na aba Configuração')).toBeVisible();
  await page.getByRole('button', { name: 'Configuração' }).click();
  await page.getByLabel('CNPJ').fill(cnpj);
  await page.getByLabel('Razão social').fill('Oficina de Teste Ltda');
  await page.getByLabel('Código do município (IBGE)').fill('3550308');
  await page.getByLabel('Código nacional').fill('140101');
  await page.getByLabel('Descrição padrão do serviço').fill('Manutenção de equipamentos');
  await page.getByRole('button', { name: 'Salvar dados fiscais' }).click();
  await expect(page.getByText('Dados fiscais salvos.')).toBeVisible();

  const pfx = gerarPfxDeTeste(cnpj, 'oficina', { nome: 'OFICINA DE TESTE LTDA' });
  await page.getByTestId('arquivo-certificado').setInputFiles({ name: 'certificado.pfx', mimeType: 'application/x-pkcs12', buffer: Buffer.from(pfx.pfxBase64, 'base64') });
  await page.getByLabel('Senha do certificado').fill('oficina');
  await page.getByRole('button', { name: 'Enviar certificado' }).click();
  await expect(page.getByTestId('certificado-atual')).toContainText('OFICINA DE TESTE LTDA');
  await page.screenshot({ path: 'test-results/nfse-configuracao.png', fullPage: true });

  await page.getByRole('button', { name: 'Emitidas' }).click();
  await page.getByRole('button', { name: 'Nova nota avulsa' }).click();
  await page.getByLabel('Tomador (nome ou razão social)').fill('João da Silva');
  await page.getByLabel('CPF ou CNPJ').fill('529.982.247-25');
  await page.getByLabel('Valor do serviço (R$)').fill('180,50');
  await page.getByRole('button', { name: 'Emitir nota' }).click();
  const detalhe = page.getByRole('dialog');
  await expect(detalhe.getByText('Emitida', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(detalhe.getByTestId('chave-acesso')).toHaveText(/^\d{50}$/);
  await expect(detalhe.getByText('R$ 180,50')).toBeVisible();
  await page.screenshot({ path: 'test-results/nfse-nota.png' });

  const download = page.waitForEvent('download');
  await detalhe.getByRole('button', { name: 'Baixar PDF (DANFSe)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^nfse-\d+\.pdf$/);

  await detalhe.getByRole('button', { name: 'Cancelar nota' }).click();
  await detalhe.getByRole('combobox', { name: 'Motivo' }).selectOption('2');
  await detalhe.getByLabel('Explique (de 15 a 255 letras)').fill('O serviço não foi prestado ao cliente');
  await detalhe.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(detalhe.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(detalhe.getByText('O serviço não foi prestado ao cliente').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nota-fiscal').first()).toContainText('Cancelada');
});
