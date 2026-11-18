import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { criarEmpresa, pedir, sql, superToken } from './apoio';
import { empresaComBase, entregadorOnline, PAULISTA, PERTO_DA_SE, PNG, SE } from './apoio-entregas';

/** Entregas, etapa 2: a empresa abre a chamada e oferece; o entregador aceita, cumpre as etapas e conclui com o código. */

const parada = (p: { lat: number; lon: number }, endereco: string, extra: Record<string, string> = {}) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '', ...extra });

async function posicaoEm(token: string, p: { lat: number; lon: number }) {
  await pedir('POST', '/entregador/posicao', { token, corpo: p });
}

test('API: abrir, oferecer, recusar, aceitar, etapas com série e código, ocorrência e isolamento', async () => {
  const tokenSuper = await superToken();
  await pedir('PUT', '/entregadores/parametros', { token: tokenSuper, corpo: { pixChave: 'pix@flow.e2e', pixNome: 'Flow', pixCidade: 'São Paulo', diariasBonusCadastro: 0, validadeBonusDias: 30 } });
  const emp = await empresaComBase(tokenSuper);
  const ent = await entregadorOnline(tokenSuper);

  const nova = { tipo: 'ENTREGA', origem: parada(SE, 'Praça da Sé, 1, Sé, São Paulo'), destino: parada(PAULISTA, 'Avenida Paulista, 1578, Bela Vista, São Paulo', { contato: 'Dona Maria', telefone: '11912345678' }), serieEsperada: null, observacao: 'Frágil' };
  const previa = await pedir('POST', '/entregas/chamadas/previa', { token: emp.adminToken, corpo: nova });
  expect(previa.j).toMatchObject({ estimada: true });
  // 2 km na base, o resto a R$ 2,00 o km.
  expect(previa.j.valorCentavos).toBe(Math.round(800 + (previa.j.metros / 1000 - 2) * 200));

  const ch = await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: nova });
  expect(ch.status, JSON.stringify(ch.j)).toBe(201);
  expect(ch.j).toMatchObject({ numero: 1, situacao: 'ABERTA', valorCentavos: previa.j.valorCentavos });
  expect(ch.j.codigoConfirmacao).toMatch(/^\d{4}$/);

  // Outra empresa não vê; o entregador não usa rota de empresa.
  const outra = await criarEmpresa(tokenSuper);
  expect((await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: outra.adminToken })).status).toBe(404);
  expect((await pedir('GET', `/entregas/chamadas/${ch.j.id}`, { token: ent.token })).status).toBe(401);

  // Elegível, oferta, a posição seguinte traz a oferta; segunda oferta simultânea é recusada.
  const eleg = await pedir('GET', `/entregas/chamadas/${ch.j.id}/elegiveis`, { token: emp.adminToken });
  expect(eleg.j.find((x: { id: string }) => x.id === ent.id)).toMatchObject({ nome: 'Carlos' });
  expect((await pedir('POST', `/entregas/chamadas/${ch.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } })).j.ofertaPendente).toMatchObject({ entregadorNome: 'Carlos' });
  expect((await pedir('POST', `/entregas/chamadas/${ch.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } })).status).toBe(409);
  const pos = await pedir('POST', '/entregador/posicao', { token: ent.token, corpo: PERTO_DA_SE });
  expect(pos.j.oferta).toMatchObject({ chamadaId: ch.j.id, valorCentavos: previa.j.valorCentavos, origemResumo: 'Sé, São Paulo' });
  // Antes do aceite, nada de endereço completo nem telefone.
  expect(JSON.stringify(pos.j.oferta)).not.toContain('1578');
  expect(JSON.stringify(pos.j.oferta)).not.toContain('11912345678');

  // Recusou: sai dos elegíveis desta chamada.
  expect((await pedir('POST', `/entregador/ofertas/${pos.j.oferta.id}/recusar`, { token: ent.token })).status).toBe(204);
  expect((await pedir('GET', `/entregas/chamadas/${ch.j.id}/elegiveis`, { token: emp.adminToken })).j.find((x: { id: string }) => x.id === ent.id)).toBeUndefined();

  // Devolução de máquina com série esperada.
  const dev = await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { ...nova, tipo: 'DEVOLUCAO_MAQUINA', origem: parada(PAULISTA, 'Avenida Paulista, 1578, Bela Vista, São Paulo'), destino: parada(SE, 'Praça da Sé, 1, Sé, São Paulo'), serieEsperada: 'pos-778899' } });
  expect(dev.j).toMatchObject({ numero: 2, serieEsperada: 'POS778899' });
  await pedir('POST', `/entregas/chamadas/${dev.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } });
  const oferta = await pedir('GET', '/entregador/oferta', { token: ent.token });
  const aceita = await pedir('POST', `/entregador/ofertas/${oferta.j.id}/aceitar`, { token: ent.token });
  expect(aceita.j).toMatchObject({ situacao: 'ACEITA', pedeSerie: true, origem: { endereco: 'Avenida Paulista, 1578, Bela Vista, São Paulo' } });
  expect((await pedir('POST', `/entregador/ofertas/${oferta.j.id}/aceitar`, { token: ent.token })).status).toBe(409);
  // Ocupado: não fica offline, aparece "Em chamada" no mapa e a empresa vê a posição exata.
  expect((await pedir('POST', '/entregador/offline', { token: ent.token })).status).toBe(409);
  expect((await pedir('GET', '/entregas/mapa', { token: emp.adminToken })).j.entregadores.find((x: { id: string }) => x.id === ent.id)).toMatchObject({ situacao: 'OCUPADO' });
  expect((await pedir('GET', `/entregas/chamadas/${dev.j.id}`, { token: emp.adminToken })).j.posicaoEntregador).toMatchObject(PERTO_DA_SE);

  const avancar = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${dev.j.id}/avancar`, { token: ent.token, corpo });
  // Longe da coleta, não chega; GPS falso também não.
  expect((await avancar({ para: 'NA_COLETA', ...SE })).status).toBe(400);
  expect((await avancar({ para: 'NA_COLETA', ...PAULISTA, simulada: true })).status).toBe(403);
  expect((await avancar({ para: 'NA_COLETA', ...PAULISTA, precisao: 8 })).j.situacao).toBe('NA_COLETA');
  expect((await avancar({ para: 'COLETADA', ...PAULISTA })).j.message).toMatch(/série/);
  expect((await avancar({ para: 'COLETADA', ...PAULISTA, serie: 'POS-778800' })).j.message).toMatch(/não confere/);
  expect((await avancar({ para: 'COLETADA', ...PAULISTA, serie: 'pos 778899' })).j).toMatchObject({ situacao: 'COLETADA', serieColetada: 'POS778899' });
  expect((await avancar({ para: 'NO_DESTINO', ...SE })).j.situacao).toBe('NO_DESTINO');
  expect((await avancar({ para: 'CONCLUIDA', ...SE, codigo: '99999' })).status).toBe(400);
  const codigo = (await pedir('GET', `/entregas/chamadas/${dev.j.id}`, { token: emp.adminToken })).j.codigoConfirmacao;
  const errado = codigo === '0000' ? '0001' : '0000';
  expect((await avancar({ para: 'CONCLUIDA', ...SE, codigo: errado })).j.message).toMatch(/Restam/);
  expect((await avancar({ para: 'CONCLUIDA', ...SE, codigo })).j).toMatchObject({ situacao: 'CONCLUIDA' });
  const final = await pedir('GET', `/entregas/chamadas/${dev.j.id}`, { token: emp.adminToken });
  expect(final.j).toMatchObject({ situacao: 'CONCLUIDA', codigoConfirmacao: null, posicaoEntregador: null });
  expect(final.j.historico.map((h: { texto: string }) => h.texto)).toEqual(expect.arrayContaining(['Chamada aberta.', 'Carlos aceitou.', 'Coletado (série POS778899).', 'Entregue, com o código do destinatário.']));
  expect((await pedir('GET', '/entregador/ganhos', { token: ent.token })).j).toMatchObject({ aReceberCentavos: dev.j.valorCentavos, hojeCentavos: dev.j.valorCentavos });

  // Ocorrência: a empresa libera e a chamada volta para a fila.
  const terc = await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: nova });
  await posicaoEm(ent.token, PERTO_DA_SE);
  await pedir('POST', `/entregas/chamadas/${terc.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent.id } });
  const of3 = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of3.j.id}/aceitar`, { token: ent.token });
  expect((await pedir('POST', `/entregador/chamadas/${terc.j.id}/ocorrencia`, { token: ent.token, corpo: { motivo: 'ENDERECO_NAO_ENCONTRADO', texto: 'Portão fechado', foto: 'nao-e-imagem' } })).status).toBe(400);
  expect((await pedir('POST', `/entregador/chamadas/${terc.j.id}/ocorrencia`, { token: ent.token, corpo: { motivo: 'ENDERECO_NAO_ENCONTRADO', texto: 'Portão fechado', foto: PNG } })).j.situacao).toBe('OCORRENCIA');
  const comOc = await pedir('GET', `/entregas/chamadas/${terc.j.id}`, { token: emp.adminToken });
  expect(comOc.j.ocorrencia).toMatchObject({ motivo: 'ENDERECO_NAO_ENCONTRADO', texto: 'Portão fechado', temFoto: true });
  expect((await pedir('GET', `/entregas/chamadas/${terc.j.id}/fotos/OCORRENCIA`, { token: emp.adminToken })).j.dados).toBe(PNG);
  expect((await pedir('POST', `/entregas/chamadas/${terc.j.id}/ocorrencia`, { token: emp.adminToken, corpo: { acao: 'REABRIR' } })).j).toMatchObject({ situacao: 'ABERTA', entregador: null });
  expect((await pedir('GET', '/entregador/chamada', { token: ent.token })).j.id).toBeUndefined();

  // Oferta sem resposta expira sozinha (relógio de 5 s).
  await pedir('POST', `/entregas/chamadas/${ch.j.id}/cancelar`, { token: emp.adminToken, corpo: { motivo: 'Cliente desistiu' } });
  const ent2 = await entregadorOnline(tokenSuper, PERTO_DA_SE, 'Bia Expira Souza');
  await pedir('POST', `/entregas/chamadas/${terc.j.id}/oferecer`, { token: emp.adminToken, corpo: { entregadorId: ent2.id } });
  await sql(`UPDATE ofertas_chamada SET expira_em = now() - interval '1 second' WHERE entregador_id = $1`, [ent2.id]);
  await expect.poll(async () => (await pedir('GET', `/entregas/chamadas/${terc.j.id}`, { token: emp.adminToken })).j.ofertaPendente, { timeout: 15_000 }).toBeNull();
  const hist = (await pedir('GET', `/entregas/chamadas/${terc.j.id}`, { token: emp.adminToken })).j.historico.map((h: { texto: string }) => h.texto);
  expect(hist).toContain('Bia não respondeu a tempo.');

  // Quem só vê o mapa não abre chamada.
  const perfil = await pedir('POST', '/perfis', { token: emp.adminToken, corpo: { nome: `Só vê ${randomUUID().slice(0, 4)}`, permissoes: ['entrega.ver'] } });
  const email = `ve-${randomUUID().slice(0, 8)}@e2e.local`;
  await pedir('POST', '/usuarios', { token: emp.adminToken, corpo: { nome: 'Só vê', email, senha: 'SenhaUsuario123', perfilId: perfil.j.id } });
  const login = await pedir('POST', '/auth/login', { corpo: { email, senha: 'SenhaUsuario123' } });
  expect((await pedir('POST', '/entregas/chamadas', { token: login.j.token, corpo: nova })).status).toBe(403);
  expect((await pedir('GET', '/entregas/chamadas', { token: login.j.token })).status).toBe(200);

  await sql(`UPDATE entregadores SET online = false WHERE id = ANY($1)`, [[ent.id, ent2.id]]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.95.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}

test('Site: abrir a chamada no mapa, oferecer e acompanhar o aceite', async ({ page }) => {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const apelido = `Diego${randomUUID().slice(0, 4)}`;
  const ent = await entregadorOnline(tokenSuper, PERTO_DA_SE, `${apelido} Site Teste`);
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  const vazio = Buffer.from(PNG.split(',')[1], 'base64');
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: vazio }));
  await page.setViewportSize({ width: 1400, height: 1000 });

  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();
  await page.getByRole('button', { name: 'Nova chamada' }).click();
  await expect(page.getByLabel('Endereço da coleta')).toHaveValue('Praça da Sé, 1, Sé, São Paulo');
  await page.getByLabel('Endereço do destino').fill('Rua Direita, 200, São Paulo');
  await page.getByLabel('Contato no destino').fill('Seu João');
  // A coleta já está marcada (ponto da empresa); o clique no mapa marca o destino.
  const mapa = page.getByRole('dialog').getByTestId('mapa-entregas');
  const caixa = (await mapa.boundingBox())!;
  await page.mouse.click(caixa.x + caixa.width / 2 + 150, caixa.y + caixa.height / 2 + 60);
  await expect(page.getByText(/Valor para o entregador: R\$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/chamada-nova.png' });
  await page.getByRole('button', { name: 'Abrir chamada' }).click();

  await expect(page.getByRole('dialog', { name: /Chamada \d+ · Entrega/ })).toBeVisible();
  await expect(page.getByTestId('codigo-confirmacao')).toHaveText(/^\d{4}$/);
  const linha = page.getByText(`${apelido} · Bicicleta`, { exact: false });
  await expect(linha).toBeVisible();
  await linha.locator('xpath=..').getByRole('button', { name: 'Oferecer' }).click();
  await expect(page.getByText(`Oferecida a ${apelido}.`)).toBeVisible();
  await expect(page.getByText(/esperando resposta/)).toBeVisible();

  const oferta = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${oferta.j.id}/aceitar`, { token: ent.token });
  await expect(page.getByText('A caminho da coleta').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(`${apelido} aceitou.`)).toBeVisible();
  await page.screenshot({ path: 'test-results/chamada-aceita.png' });
  expect(erros).toEqual([]);
  await sql(`UPDATE chamadas_entrega SET situacao = 'CANCELADA' WHERE entregador_id = $1`, [ent.id]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});
