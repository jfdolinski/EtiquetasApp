import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/** Entregas, etapa 14: metas com bônus, roteirização de vários pedidos, API com webhook e suporte da plataforma. */

const longeDeTudo = () => ({ lat: -14 - Math.random() * 2, lon: -52 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });

async function preparar() {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const C = longeDeTudo();
  const r = await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10 } });
  expect(r.status, JSON.stringify(r.j)).toBe(200);
  const nova = async () => {
    const c = await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(deslocar(C, 1500), 'Rua Cliente, 9'), serieEsperada: null, observacao: '' } });
    expect(c.status, JSON.stringify(c.j)).toBe(201);
    return c.j;
  };
  return { tokenSuper, emp, t: emp.adminToken, C, D: deslocar(C, 1500), nova };
}

async function fazer(t: string, ent: { id: string; token: string }, c: { id: string }, C: { lat: number; lon: number }, D: { lat: number; lon: number }) {
  await pedir('POST', `/entregas/chamadas/${c.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${c.id}/avancar`, { token: ent.token, corpo });
  await av({ para: 'NA_COLETA', ...C, precisao: 5 });
  await av({ para: 'COLETADA', ...C, volumes: 1 });
  await av({ para: 'NO_DESTINO', ...D, precisao: 5 });
  const codigo = (await pedir('GET', `/entregas/chamadas/${c.id}`, { token: t })).j.codigoConfirmacao;
  expect((await av({ para: 'CONCLUIDA', ...D, codigo, volumesEntregues: 1 })).j.situacao).toBe('CONCLUIDA');
}

test('API: meta conta as chamadas concluídas e, ao acabar, lança o bônus de quem chegou lá', async () => {
  test.setTimeout(120_000);
  const { tokenSuper, t, C, D, nova } = await preparar();
  const agora = Date.now();
  const corpo = { nome: 'Semana cheia', inicio: new Date(agora - 3600_000).toISOString(), fim: new Date(agora + 86_400_000).toISOString(), minimoChamadas: 2, valorCentavos: 4000, faixa: null };
  expect((await pedir('POST', '/entregas/metas', { token: t, corpo: { ...corpo, minimoChamadas: 0 } })).status).toBe(400);
  expect((await pedir('POST', '/entregas/metas', { token: t, corpo: { ...corpo, fim: new Date(agora + 40 * 86_400_000).toISOString() } })).j.message).toMatch(/31 dias/);
  const criada = await pedir('POST', '/entregas/metas', { token: t, corpo });
  expect(criada.status, JSON.stringify(criada.j)).toBe(200);
  const meta = criada.j.find((m: { nome: string }) => m.nome === 'Semana cheia');
  // Uma meta só de madrugada de domingo: nenhuma chamada de agora conta.
  const outra = (await pedir('POST', '/entregas/metas', { token: t, corpo: { ...corpo, nome: 'Madrugada', faixa: { dias: [0], inicio: '03:00', fim: '03:01' } } })).j.find((m: { nome: string }) => m.nome === 'Madrugada');
  expect(outra.faixa).toMatchObject({ dias: [0], inicio: '03:00' });

  const ent = await entregadorOnline(tokenSuper, deslocar(C, 40), `Meta${randomUUID().slice(0, 4)} Teste`);
  await fazer(t, ent, await nova(), C, D);
  const noApp = (await pedir('GET', '/entregador/metas', { token: ent.token })).j;
  expect(noApp.find((m: { id: string }) => m.id === meta.id)).toMatchObject({ feitas: 1, minimoChamadas: 2, atingida: false, situacao: 'EM_ANDAMENTO', faixa: 'qualquer horário' });
  await fazer(t, ent, await nova(), C, D);
  const lista = (await pedir('GET', '/entregas/metas', { token: t })).j;
  expect(lista.find((m: { id: string }) => m.id === meta.id).participantes).toEqual([expect.objectContaining({ entregadorId: ent.id, feitas: 2, atingida: true, pago: false })]);
  expect(lista.find((m: { id: string }) => m.id === outra.id).participantes).toEqual([]);

  // Cancelar só antes de acabar.
  expect((await pedir('POST', `/entregas/metas/${outra.id}/cancelar`, { token: t })).status).toBe(200);
  expect((await pedir('POST', `/entregas/metas/${outra.id}/cancelar`, { token: t })).status).toBe(409);

  // Acabou: o relógio apura uma vez e o bônus entra no a pagar.
  // Pela hora deste processo (a mesma da API), não pela do banco: as chamadas concluídas ficam antes do fim.
  await sql(`UPDATE metas_entrega SET fim = $2::timestamptz at time zone 'utc' WHERE id = $1`, [meta.id, new Date(Date.now() + 1000).toISOString()]);
  await new Promise((r) => setTimeout(r, 1200));
  await expect.poll(async () => (await sql(`SELECT apurada_em FROM metas_entrega WHERE id = $1`, [meta.id]))[0].apurada_em, { timeout: 40_000 }).not.toBeNull();
  const lancamentos = (await pedir('GET', `/entregas/financeiro/a-pagar/${ent.id}/lancamentos`, { token: t })).j;
  expect(lancamentos.filter((l: { tipo: string }) => l.tipo === 'BONUS')).toEqual([expect.objectContaining({ valorCentavos: 4000, descricao: expect.stringContaining('Semana cheia') })]);
  expect((await pedir('POST', `/entregas/metas/${meta.id}/cancelar`, { token: t })).j.message).toMatch(/já terminou/);
  expect((await pedir('GET', '/entregador/metas', { token: ent.token })).j.find((m: { id: string }) => m.id === meta.id)).toMatchObject({ situacao: 'ENCERRADA', ganhou: true });
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('API: roteirizar divide os pedidos por direção e abre uma chamada por grupo', async () => {
  test.setTimeout(90_000);
  const { emp, t, C } = await preparar();
  // Três ao norte e três ao sul da loja, criados misturados.
  const pontos = [1, -1, 2, -2, 3, -3].map((k) => deslocar(C, k * 700));
  const ids: string[] = [];
  for (const [i, p] of pontos.entries()) {
    const id = randomUUID();
    ids.push(id);
    await sql(`INSERT INTO pedidos_erp_entrega (id, empresa_id, codigo, dados, situacao, atualizado_em) VALUES ($1, $2, $3, $4, 'PENDENTE', now())`, [id, emp.id, `R-${i}`, JSON.stringify({ codigo: `R-${i}`, tipo: 'ENTREGA', cliente: `Cliente ${i}`, telefone: '', endereco: `Rua ${i}, ${i}`, ponto: p, observacao: '', serie: null })]);
  }
  expect((await pedir('POST', '/entregas/roteirizar', { token: t, corpo: { pedidoIds: [], pedidoErpIds: ids, porChamada: 11 } })).status).toBe(400);
  const r = await pedir('POST', '/entregas/roteirizar', { token: t, corpo: { pedidoIds: [], pedidoErpIds: ids, porChamada: 3 } });
  expect(r.status, JSON.stringify(r.j)).toBe(200);
  expect(r.j.semPonto).toEqual([]);
  const rotulos = r.j.grupos.map((g: { pedidos: { rotulo: string }[] }) => g.pedidos.map((p) => p.rotulo));
  expect(rotulos.map((g: string[]) => g.join(',')).sort()).toEqual(['Pedido R-0 do ERP,Pedido R-2 do ERP,Pedido R-4 do ERP', 'Pedido R-1 do ERP,Pedido R-3 do ERP,Pedido R-5 do ERP']);
  expect(r.j.grupos[0].metrosEstimados).toBeGreaterThan(2000);

  const grupos = r.j.grupos.map((g: { pedidos: { id: string }[] }) => ({ pedidoIds: [], pedidoErpIds: g.pedidos.map((p) => p.id) }));
  const abertas = await pedir('POST', '/entregas/roteirizar/abrir', { token: t, corpo: { grupos, distribuir: false } });
  expect(abertas.status, JSON.stringify(abertas.j)).toBe(200);
  expect(abertas.j.erros).toEqual([]);
  expect(abertas.j.abertas).toHaveLength(2);
  for (const a of abertas.j.abertas) {
    const c = (await pedir('GET', `/entregas/chamadas/${a.id}`, { token: t })).j;
    expect((await sql(`SELECT count(*)::int AS n FROM paradas_chamada WHERE chamada_id = $1`, [a.id]))[0].n).toBe(2);
    expect(c.distribuicao.ativa).toBe(false);
  }
  expect((await sql(`SELECT count(*)::int AS n FROM pedidos_erp_entrega WHERE id = ANY($1::uuid[]) AND situacao = 'CHAMADA'`, [ids]))[0].n).toBe(6);
  // De novo: cada grupo volta com o erro, nada é aberto duas vezes.
  const repetido = (await pedir('POST', '/entregas/roteirizar/abrir', { token: t, corpo: { grupos, distribuir: false } })).j;
  expect(repetido.abertas).toEqual([]);
  expect(repetido.erros).toHaveLength(2);
  expect(repetido.erros[0].erro).toMatch(/já tem a chamada/);
});

test('API de integração: chave, chamada pela referência, avisos assinados e revogação', async () => {
  test.setTimeout(120_000);
  const { tokenSuper, emp, t, C, D } = await preparar();
  const outra = await preparar();
  const recebidos: { corpo: string; cabecalhos: Record<string, string | string[] | undefined> }[] = [];
  const servidor: Server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (p) => (corpo += p));
    req.on('end', () => {
      recebidos.push({ corpo, cabecalhos: req.headers });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((ok) => servidor.listen(8096, ok));
  try {
    expect((await pedir('POST', '/entregas/integracao/chaves', { token: t, corpo: { nome: 'Loja virtual', webhookUrl: 'http://loja.exemplo.com.br/flow' } })).j.message).toMatch(/https/);
    expect((await pedir('POST', '/entregas/integracao/chaves', { token: t, corpo: { nome: 'Loja virtual', webhookUrl: 'https://192.168.0.5/flow' } })).j.message).toMatch(/público/);
    const criada = await pedir('POST', '/entregas/integracao/chaves', { token: t, corpo: { nome: 'Loja virtual', webhookUrl: 'https://loja.exemplo.com.br/flow' } });
    expect(criada.status, JSON.stringify(criada.j)).toBe(200);
    const { token, segredoWebhook, chave } = criada.j;
    expect(token).toMatch(/^flw_/);
    expect(segredoWebhook).toMatch(/^whsec_/);
    expect(JSON.stringify((await pedir('GET', '/entregas/integracao/chaves', { token: t })).j)).not.toContain(token);
    // Só os testes mandam para a rede local (WEBHOOK_PERMITE_REDE_INTERNA); a tela recusa http e IP interno.
    await sql(`UPDATE chaves_api_entregas SET webhook_url = 'http://localhost:8096/flow' WHERE id = $1`, [chave.id]);

    expect((await pedir('POST', '/integracao/entregas/v1/chamadas', { corpo: {} })).status).toBe(401);
    expect((await pedir('POST', '/integracao/entregas/v1/chamadas', { token: 'flw_errado', corpo: {} })).status).toBe(401);
    // Token de usuário não serve na API, nem chave na rota da empresa.
    expect((await pedir('GET', '/integracao/entregas/v1/chamadas?referencia=x', { token: t })).status).toBe(401);
    expect((await pedir('GET', '/entregas/chamadas', { token })).status).toBe(401);

    const corpo = { referencia: 'PED-1001', destino: { endereco: 'Rua Cliente, 9', lat: D.lat, lon: D.lon, contato: 'Ana', telefone: '(11) 98888-7777' }, observacao: 'Interfone 12', distribuir: false };
    expect((await pedir('POST', '/integracao/entregas/v1/previa', { token, corpo })).j.valorCentavos).toBeGreaterThan(0);
    const c1 = await pedir('POST', '/integracao/entregas/v1/chamadas', { token, corpo });
    expect(c1.status, JSON.stringify(c1.j)).toBe(200);
    expect(c1.j).toMatchObject({ criada: true, chamada: { referencia: 'PED-1001', situacao: 'ABERTA', tipo: 'ENTREGA', entregador: null, paradas: 1 } });
    expect(c1.j.chamada.codigoConfirmacao).toMatch(/^\d{4}$/);
    expect(c1.j.chamada.rastreio).toMatch(/\/rastreio\//);
    const id = c1.j.chamada.id;
    // A mesma referência não abre outra.
    expect((await pedir('POST', '/integracao/entregas/v1/chamadas', { token, corpo })).j).toMatchObject({ criada: false, chamada: { id } });
    expect((await pedir('GET', '/integracao/entregas/v1/chamadas?referencia=PED-1001', { token })).j.id).toBe(id);
    const site = (await pedir('GET', `/entregas/chamadas/${id}`, { token: t })).j;
    expect(site.origem.endereco).toBe('Rua da Loja, 1');
    expect(site.destino.telefone).toBe('11988887777');
    expect(site.historico[0].texto).toBe('Chamada aberta pela integração "Loja virtual".');

    // Chave de outra empresa não vê.
    const chaveOutra = (await pedir('POST', '/entregas/integracao/chaves', { token: outra.t, corpo: { nome: 'ERP' } })).j.token;
    expect((await pedir('GET', `/integracao/entregas/v1/chamadas/${id}`, { token: chaveOutra })).status).toBe(404);
    expect((await pedir('GET', '/integracao/entregas/v1/chamadas?referencia=PED-1001', { token: chaveOutra })).status).toBe(404);

    // Aviso da chamada aberta, assinado com o segredo.
    const aviso = async (situacao: string) => {
      await expect.poll(() => recebidos.some((r) => JSON.parse(r.corpo).chamada?.id === id && JSON.parse(r.corpo).chamada.situacao === situacao), { timeout: 40_000 }).toBe(true);
      return recebidos.find((r) => JSON.parse(r.corpo).chamada?.id === id && JSON.parse(r.corpo).chamada.situacao === situacao)!;
    };
    const aberta = await aviso('ABERTA');
    const momento = aberta.cabecalhos['x-flow-momento'] as string;
    expect(aberta.cabecalhos['x-flow-assinatura']).toBe(`sha256=${createHmac('sha256', segredoWebhook).update(`${momento}.${aberta.corpo}`).digest('hex')}`);
    expect(aberta.cabecalhos['x-flow-evento']).toBe('chamada.situacao');

    // Entregador aceita: novo aviso, com o primeiro nome.
    const ent = await entregadorOnline(tokenSuper, deslocar(C, 40), `Ivo${randomUUID().slice(0, 4)} Integra`);
    await pedir('POST', `/entregas/chamadas/${id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
    const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
    await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
    expect(JSON.parse((await aviso('ACEITA')).corpo).chamada.entregador.nome).toMatch(/^Ivo/);

    // Cancelar pela API: a taxa da tabela vale como no site.
    const cancelada = await pedir('POST', `/integracao/entregas/v1/chamadas/${id}/cancelar`, { token, corpo: { motivo: 'Cliente desistiu' } });
    expect(cancelada.j.situacao, JSON.stringify(cancelada.j)).toBe('CANCELADA');
    await aviso('CANCELADA');

    // Teste do aviso e lista dos enviados.
    const teste = (await pedir('POST', `/entregas/integracao/chaves/${chave.id}/testar`, { token: t })).j;
    expect(teste).toMatchObject({ evento: 'teste', ultimoStatus: 200 });
    expect(teste.enviadoEm).toBeTruthy();
    const envios = (await pedir('GET', `/entregas/integracao/chaves/${chave.id}/envios`, { token: t })).j;
    expect(envios.filter((e: { enviadoEm: string | null }) => e.enviadoEm).length).toBeGreaterThanOrEqual(4);
    expect((await pedir('GET', `/entregas/integracao/chaves/${chave.id}/envios`, { token: outra.t })).status).toBe(404);

    // Revogada, para na hora.
    expect((await pedir('POST', `/entregas/integracao/chaves/${chave.id}/revogar`, { token: t })).j[0].revogadaEm).toBeTruthy();
    expect((await pedir('GET', `/integracao/entregas/v1/chamadas/${id}`, { token })).status).toBe(401);
    await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
    expect(emp.id).toBeTruthy();
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
});

test('API: suporte da empresa e do entregador, respondido pelo super-admin', async () => {
  test.setTimeout(60_000);
  const { tokenSuper, emp, t } = await preparar();
  const ent = await entregadorOnline(tokenSuper, longeDeTudo(), `Sup${randomUUID().slice(0, 4)} Teste`);
  expect((await pedir('POST', '/suporte', { token: t, corpo: { categoria: 'APP', assunto: 'oi', texto: 'Não imprime a etiqueta' } })).status).toBe(400);
  const aberto = await pedir('POST', '/suporte', { token: t, corpo: { categoria: 'APP', assunto: 'Etiqueta não imprime', texto: 'Fica na fila e não sai.', imagem: PNG } });
  expect(aberto.status, JSON.stringify(aberto.j)).toBe(200);
  expect(aberto.j).toMatchObject({ situacao: 'ABERTO', origem: 'EMPRESA', mensagens: [expect.objectContaining({ temImagem: true, deSuporte: false })] });
  const id = aberto.j.id;
  const doEnt = (await pedir('POST', '/entregador/suporte', { token: ent.token, corpo: { categoria: 'PAGAMENTO', assunto: 'Diária não caiu', texto: 'Paguei o Pix ontem.' } })).j;

  // O super-admin vê os dois, com o contato, e responde.
  const pendentes = (await pedir('GET', '/plataforma/suporte?situacao=PENDENTES', { token: tokenSuper })).j.map((c: { id: string }) => c.id);
  expect(pendentes).toEqual(expect.arrayContaining([id, doEnt.id]));
  expect((await pedir('GET', '/plataforma/suporte', { token: t })).status).toBe(403);
  const visto = (await pedir('GET', `/plataforma/suporte/${id}`, { token: tokenSuper })).j;
  expect(visto.contato.email).toBe(emp.adminEmail);
  expect((await pedir('GET', `/plataforma/suporte/${id}/imagens/${visto.mensagens[0].id}`, { token: tokenSuper })).j.dados).toMatch(/^data:image\/png/);
  const resposta = await pedir('POST', `/plataforma/suporte/${id}/mensagens`, { token: tokenSuper, corpo: { texto: 'Confira se o agente está online.' } });
  expect(resposta.j.situacao).toBe('RESPONDIDO');
  await pedir('POST', `/plataforma/suporte/${doEnt.id}/mensagens`, { token: tokenSuper, corpo: { texto: 'O Pix foi conferido, já liberamos.' } });

  // Cada lado vê só os seus; a resposta conta como não lida até abrir.
  expect((await pedir('GET', '/suporte/nao-lidas', { token: t })).j.quantidade).toBe(1);
  expect((await pedir('GET', '/entregador/eu', { token: ent.token })).j.suporteNaoLidas).toBe(1);
  expect((await pedir('GET', `/entregador/suporte/${id}`, { token: ent.token })).status).toBe(404);
  const outra = await preparar();
  expect((await pedir('GET', `/suporte/${id}`, { token: outra.t })).status).toBe(404);
  const lido = (await pedir('GET', `/suporte/${id}`, { token: t })).j;
  expect(lido.mensagens.map((m: { autor: string }) => m.autor)[1]).toMatch(/^Suporte Flow/);
  expect(lido.contato).toBeUndefined();
  expect((await pedir('GET', '/suporte/nao-lidas', { token: t })).j.quantidade).toBe(0);
  await pedir('GET', `/entregador/suporte/${doEnt.id}`, { token: ent.token });
  expect((await pedir('GET', '/entregador/eu', { token: ent.token })).j.suporteNaoLidas).toBe(0);

  // Resolver; escrever de novo reabre.
  expect((await pedir('POST', `/suporte/${id}/resolver`, { token: t })).j.situacao).toBe('RESOLVIDO');
  expect((await pedir('POST', `/suporte/${id}/resolver`, { token: t })).status).toBe(409);
  expect((await pedir('POST', `/suporte/${id}/mensagens`, { token: t, corpo: { texto: 'Voltou a acontecer hoje.' } })).j.situacao).toBe('ABERTO');
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('Site: metas, roteirizar, integração e suporte', async ({ page }) => {
  test.setTimeout(90_000);
  const { emp, C } = await preparar();
  for (const [i, k] of [1, 2, -1, -2].entries()) {
    const p = deslocar(C, k * 800);
    await sql(`INSERT INTO pedidos_erp_entrega (id, empresa_id, codigo, dados, situacao, atualizado_em) VALUES ($1, $2, $3, $4, 'PENDENTE', now())`, [randomUUID(), emp.id, `S-${i}`, JSON.stringify({ codigo: `S-${i}`, tipo: 'ENTREGA', cliente: `Cliente ${i}`, telefone: '', endereco: `Rua ${i}, ${i}`, ponto: p, observacao: '', serie: null })]);
  }
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();

  // Roteirizar: 4 pedidos, 2 por chamada.
  await page.getByRole('button', { name: 'Roteirizar pedidos' }).click();
  await expect(page.getByTestId('pedido-para-roteirizar')).toHaveCount(4);
  await page.getByLabel('Pedidos por chamada').fill('2');
  await page.getByRole('button', { name: 'Montar as rotas' }).click();
  await expect(page.getByTestId('grupo-roteiro')).toHaveCount(2);
  await page.getByRole('button', { name: 'Abrir 2 chamadas' }).click();
  await expect(page.getByTestId('resultado-roteiro')).toContainText('2 chamadas abertas');
  await expect(page.getByTestId('linha-chamada')).toHaveCount(2);

  // Metas.
  await page.getByRole('tab', { name: 'Metas' }).click();
  const hoje = new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const semana = new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 6 * 86_400_000));
  await page.getByLabel('Nome').fill('Semana do almoço');
  await page.getByLabel('Do dia').fill(hoje);
  await page.getByLabel('Até o dia').fill(semana);
  await page.getByLabel('Chamadas concluídas').fill('15');
  await page.getByLabel('Bônus (R$)').fill('60,00');
  await page.getByLabel('Só contam as chamadas no horário de pico').check();
  await page.getByRole('button', { name: 'Criar meta' }).click();
  await expect(page.getByTestId('meta').first()).toContainText('Semana do almoço');
  await expect(page.getByTestId('meta').first()).toContainText('15 chamadas = R$ 60,00');
  await expect(page.getByTestId('meta').first()).toContainText('seg a sex, 11:00 às 14:00');

  // Integração: a chave aparece uma vez só.
  await page.getByRole('tab', { name: 'Integração' }).click();
  await page.getByLabel('Nome (o sistema que vai usar)').fill('Loja virtual');
  await page.getByLabel('Endereço que recebe os avisos (opcional)').fill('http://errado.com');
  await expect(page.getByText('precisa começar com https://')).toBeVisible();
  await page.getByLabel('Endereço que recebe os avisos (opcional)').fill('https://loja.exemplo.com.br/flow');
  await page.getByRole('button', { name: 'Criar chave' }).click();
  await expect(page.getByTestId('token-api')).toContainText('flw_');
  await expect(page.getByTestId('segredo-webhook')).toContainText('whsec_');
  await page.getByRole('button', { name: 'Já copiei' }).click();
  await expect(page.getByTestId('chave-api')).toContainText('Loja virtual');
  await expect(page.getByTestId('chave-api')).toContainText('https://loja.exemplo.com.br/flow');

  // Suporte.
  await page.getByRole('link', { name: 'Suporte' }).click();
  await page.getByRole('button', { name: 'Novo chamado' }).click();
  await page.getByLabel('Título').fill('Mapa não carrega');
  await page.getByLabel('O que aconteceu').fill('A aba Mapa fica em branco desde ontem.');
  await page.getByRole('button', { name: 'Enviar ao suporte' }).click();
  await expect(page.getByTestId('mensagens-suporte')).toContainText('A aba Mapa fica em branco');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chamado-suporte')).toContainText('Esperando o suporte');
  expect(erros).toEqual([]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.94.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}
