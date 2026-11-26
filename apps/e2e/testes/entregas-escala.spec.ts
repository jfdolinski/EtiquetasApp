import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline, PNG } from './apoio-entregas';

/** Entregas, etapa 13: várias coletas, escala de turnos, avaliação da empresa, valor declarado e avaria com desconto. */

const longeDeTudo = () => ({ lat: -10 - Math.random() * 2, lon: -48 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });

async function preparar() {
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const C = longeDeTudo();
  await pedir('PUT', '/entregas/config', { token: emp.adminToken, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10, chamadasSimultaneas: 2 } });
  const nova = async (extra: Record<string, unknown> = {}) => {
    const r = await pedir('POST', '/entregas/chamadas', { token: emp.adminToken, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(deslocar(C, 1500), 'Rua Cliente, 9'), serieEsperada: null, observacao: '', ...extra } });
    expect(r.status, JSON.stringify(r.j)).toBe(201);
    return r.j;
  };
  return { tokenSuper, emp, t: emp.adminToken, C, D: deslocar(C, 1500), nova };
}

/** Oferece, aceita e faz a chamada inteira (uma coleta só). */
async function fazer(t: string, ent: { id: string; token: string }, c: { id: string }, C: { lat: number; lon: number }, D: { lat: number; lon: number }) {
  await pedir('POST', `/entregas/chamadas/${c.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${c.id}/avancar`, { token: ent.token, corpo });
  await av({ para: 'NA_COLETA', ...C, precisao: 5 });
  await av({ para: 'COLETADA', ...C, volumes: 1 });
  await av({ para: 'NO_DESTINO', ...D, precisao: 5 });
  const codigo = (await pedir('GET', `/entregas/chamadas/${c.id}`, { token: t })).j.codigoConfirmacao;
  const fim = await av({ para: 'CONCLUIDA', ...D, codigo, volumesEntregues: 1 });
  expect(fim.j.situacao, JSON.stringify(fim.j)).toBe('CONCLUIDA');
}

test('API: várias coletas na mesma chamada, uma de cada vez, com os volumes somados', async () => {
  test.setTimeout(90_000);
  const { tokenSuper, t, C, D, nova } = await preparar();
  const B = deslocar(C, 0, 700);
  const semColeta = (await pedir('POST', '/entregas/chamadas/previa', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(D, 'Rua Cliente, 9'), serieEsperada: null, observacao: '' } })).j;
  const comColeta = (await pedir('POST', '/entregas/chamadas/previa', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(D, 'Rua Cliente, 9'), serieEsperada: null, observacao: '', coletasExtras: [parada(B, 'Loja Dois, 2')] } })).j;
  expect(comColeta.valorTabelaCentavos).toBeGreaterThan(semColeta.valorTabelaCentavos);
  expect((await pedir('POST', '/entregas/chamadas/previa', { token: t, corpo: { tipo: 'COLETA', origem: parada(D, 'Rua Cliente, 9'), destino: parada(C, 'Rua da Loja, 1'), serieEsperada: null, observacao: '', coletasExtras: [parada(B, 'Loja Dois, 2')] } })).j.message).toMatch(/só na entrega/);

  const c = await nova({ coletasExtras: [parada(B, 'Loja Dois, 2')] });
  expect(c.coletasExtras).toHaveLength(1);
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 40), `Rui${randomUUID().slice(0, 4)} Teste`);
  await pedir('POST', `/entregas/chamadas/${c.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  expect(of.j.coletas).toBe(2);
  const aceita = await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  expect(aceita.j.coletas.map((x: { coletada: boolean }) => x.coletada)).toEqual([false, false]);
  expect(aceita.j.origem.endereco).toBe('Rua da Loja, 1');
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${c.id}/avancar`, { token: ent.token, corpo });
  await av({ para: 'NA_COLETA', ...C, precisao: 5 });
  // Primeira coleta: volta a "a caminho da coleta", com o próximo lugar.
  const depois = await av({ para: 'COLETADA', ...C, volumes: 2 });
  expect(depois.j).toMatchObject({ situacao: 'ACEITA', coletaAtual: 1, volumes: 2 });
  expect(depois.j.origem.endereco).toBe('Loja Dois, 2');
  expect((await av({ para: 'NA_COLETA', ...C, precisao: 5 })).j.message).toMatch(/ainda não está no local da coleta/);
  // Depois de pegar no primeiro lugar, não dá mais para desistir.
  expect((await pedir('POST', `/entregador/chamadas/${c.id}/desistir`, { token: ent.token, corpo: { motivo: '' } })).status).toBe(409);
  await av({ para: 'NA_COLETA', ...B, precisao: 5 });
  const coletada = await av({ para: 'COLETADA', ...B, volumes: 1 });
  expect(coletada.j).toMatchObject({ situacao: 'COLETADA', volumes: 3 });
  await av({ para: 'NO_DESTINO', ...D, precisao: 5 });
  const codigo = (await pedir('GET', `/entregas/chamadas/${c.id}`, { token: t })).j.codigoConfirmacao;
  expect((await av({ para: 'CONCLUIDA', ...D, codigo, volumesEntregues: 3 })).j.situacao).toBe('CONCLUIDA');
  const fim = (await pedir('GET', `/entregas/chamadas/${c.id}`, { token: t })).j;
  expect(fim.coletasExtras[0].coletadaEm).toBeTruthy();
  expect(fim.historico.map((h: { texto: string }) => h.texto)).toEqual(expect.arrayContaining([expect.stringMatching(/Coleta 1 de 2: a caminho da próxima/)]));
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('API: turno com prioridade e presença paga, avaria com desconto aceito e avaliação da empresa', async () => {
  test.setTimeout(120_000);
  const { tokenSuper, emp, t, C, D, nova } = await preparar();
  const noTurno = await entregadorOnline(tokenSuper, deslocar(C, 3000), `Tito${randomUUID().slice(0, 4)} Teste`);
  const perto = await entregadorOnline(tokenSuper, deslocar(C, 80), `Pepe${randomUUID().slice(0, 4)} Teste`);

  // Turno: uma vaga, R$ 25 por presente.
  const agora = Date.now();
  const criar = await pedir('POST', '/entregas/turnos', { token: t, corpo: { inicio: new Date(agora + 3 * 3600_000).toISOString(), fim: new Date(agora + 5 * 3600_000).toISOString(), vagas: 1, valorCentavos: 2500, observacao: 'Almoço' } });
  expect(criar.status, JSON.stringify(criar.j)).toBe(200);
  const turno = criar.j.find((x: { observacao: string }) => x.observacao === 'Almoço');
  const lista = (await pedir('GET', '/entregador/turnos', { token: noTurno.token })).j;
  expect(lista.find((x: { id: string }) => x.id === turno.id)).toMatchObject({ livres: 1, minha: null, valorCentavos: 2500 });
  expect((await pedir('POST', `/entregador/turnos/${turno.id}/inscrever`, { token: noTurno.token })).j.find((x: { id: string }) => x.id === turno.id)).toMatchObject({ minha: 'INSCRITO', podeSair: true });
  expect((await pedir('POST', `/entregador/turnos/${turno.id}/inscrever`, { token: perto.token })).j.message).toMatch(/vagas deste turno acabaram/);

  // Valendo agora: quem está no turno vem antes de quem está mais perto.
  await sql(`UPDATE turnos_entrega SET inicio = (now() at time zone 'utc') - interval '1 hour', fim = (now() at time zone 'utc') + interval '1 hour' WHERE id = $1`, [turno.id]);
  expect((await pedir('POST', `/entregador/turnos/${turno.id}/sair`, { token: noTurno.token })).status).toBe(409);
  const c1 = await nova({ valorDeclaradoCentavos: 3000 });
  const elegiveis = (await pedir('GET', `/entregas/chamadas/${c1.id}/elegiveis`, { token: t })).j.map((e: { id: string }) => e.id);
  expect(elegiveis.indexOf(noTurno.id)).toBe(0);
  expect(elegiveis).toContain(perto.id);
  // Presença só depois do fim.
  const inscricao = (await pedir('GET', '/entregas/turnos', { token: t })).j.find((x: { id: string }) => x.id === turno.id).inscritos[0];
  expect((await pedir('POST', `/entregas/turnos/inscricoes/${inscricao.id}/presenca`, { token: t, corpo: { situacao: 'PRESENTE' } })).status).toBe(409);

  // A chamada com valor declarado: o entregador do turno faz.
  await fazer(t, noTurno, c1, C, D);
  await sql(`UPDATE turnos_entrega SET inicio = (now() at time zone 'utc') - interval '3 hours', fim = (now() at time zone 'utc') WHERE id = $1`, [turno.id]);
  const marcado = await pedir('POST', `/entregas/turnos/inscricoes/${inscricao.id}/presenca`, { token: t, corpo: { situacao: 'PRESENTE' } });
  expect(marcado.j.find((x: { id: string }) => x.id === turno.id).inscritos[0]).toMatchObject({ situacao: 'PRESENTE', chamadas: 1 });

  // Avaria: desconto até o valor declarado; o entregador aceita.
  const avaria = (corpo: Record<string, unknown>) => pedir('POST', `/entregas/chamadas/${c1.id}/avarias`, { token: t, corpo: { tipo: 'AVARIA', descricao: 'Caixa amassada na entrega', prejuizoCentavos: 5000, responsavel: 'ENTREGADOR', fotos: [PNG], ...corpo } });
  expect((await avaria({ descontoCentavos: 4000 })).j.message).toMatch(/valor declarado/);
  const av = await avaria({ descontoCentavos: 1000 });
  expect(av.j).toMatchObject({ situacao: 'AGUARDANDO', descontoCentavos: 1000, fotos: 1, valorDeclaradoCentavos: 3000 });
  expect((await pedir('GET', '/entregador/eu', { token: noTurno.token })).j.avariasPendentes).toBe(1);
  expect((await pedir('GET', `/entregador/avarias/${av.j.id}/fotos/0`, { token: noTurno.token })).j.dados).toMatch(/^data:image\/png;base64,/);
  expect((await pedir('GET', `/entregador/avarias/${av.j.id}/fotos/0`, { token: perto.token })).status).toBe(404);
  expect((await pedir('POST', `/entregador/avarias/${av.j.id}/responder`, { token: noTurno.token, corpo: { aceitar: false, texto: '' } })).status).toBe(400);
  expect((await pedir('POST', `/entregador/avarias/${av.j.id}/responder`, { token: noTurno.token, corpo: { aceitar: true, texto: '' } })).j.situacao).toBe('ACEITA');
  expect((await pedir('POST', `/entregador/avarias/${av.j.id}/responder`, { token: noTurno.token, corpo: { aceitar: true, texto: '' } })).status).toBe(409);

  // Fechamento: chamada + turno − desconto; o desconto não fica de fora.
  const aPagar = (await pedir('GET', '/entregas/financeiro/a-pagar', { token: t })).j.find((a: { entregador: { id: string } }) => a.entregador.id === noTurno.id);
  expect(aPagar).toMatchObject({ quantidade: 1, lancamentos: 2, totalCentavos: c1.valorCentavos + 2500 - 1000 });
  const lancamentos = (await pedir('GET', `/entregas/financeiro/a-pagar/${noTurno.id}/lancamentos`, { token: t })).j;
  expect(lancamentos.map((l: { tipo: string; valorCentavos: number }) => [l.tipo, l.valorCentavos]).sort()).toEqual([['DESCONTO', -1000], ['TURNO', 2500]]);
  const hoje = new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const turnoId = lancamentos.find((l: { tipo: string }) => l.tipo === 'TURNO').id;
  expect((await pedir('POST', '/entregas/financeiro/fechamentos', { token: t, corpo: { entregadorId: noTurno.id, chamadaIds: [c1.id], lancamentoIds: [turnoId], pagoEm: hoje, observacao: '' } })).j.message).toMatch(/descontos aceitos/);
  const pago = await pedir('POST', '/entregas/financeiro/fechamentos', { token: t, corpo: { entregadorId: noTurno.id, chamadaIds: [c1.id], lancamentoIds: lancamentos.map((l: { id: string }) => l.id), pagoEm: hoje, observacao: '' } });
  expect(pago.status, JSON.stringify(pago.j)).toBe(201);
  expect(pago.j).toMatchObject({ totalCentavos: c1.valorCentavos + 1500 });
  expect(pago.j.lancamentos).toHaveLength(2);
  expect((await pedir('POST', `/entregas/avarias/${av.j.id}/retirar`, { token: t })).j.message).toMatch(/já saiu num pagamento/);
  const pdf = await fetch(`http://localhost:3000/api/entregas/financeiro/fechamentos/${pago.j.id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
  expect(pdf.status).toBe(200);

  // Extrato do entregador: o turno e o desconto aparecem.
  const extrato = (await pedir('GET', '/entregador/extrato?periodo=HOJE', { token: noTurno.token })).j;
  expect(extrato.lancamentos.map((l: { valorCentavos: number }) => l.valorCentavos).sort()).toEqual([-1000, 2500]);

  // Avaliação da empresa: uma vez por chamada; a média aparece com 3.
  const linha = extrato.linhas.find((l: { chamadaId: string }) => l.chamadaId === c1.id);
  expect(linha.podeAvaliarEmpresa).toBe(true);
  expect((await pedir('POST', `/entregador/chamadas/${c1.id}/avaliar-empresa`, { token: noTurno.token, corpo: { nota: 2, comentario: 'Demorou para liberar o pacote' } })).status).toBe(200);
  expect((await pedir('POST', `/entregador/chamadas/${c1.id}/avaliar-empresa`, { token: noTurno.token, corpo: { nota: 5, comentario: '' } })).status).toBe(409);
  expect((await pedir('GET', '/entregas/reputacao', { token: t })).j).toMatchObject({ media: null, avaliacoes: 1, comentarios: [] });
  const outras = [await nova(), await nova()];
  await sql(`UPDATE chamadas_entrega SET avaliacao_empresa_nota = 4, avaliacao_empresa_em = (now() at time zone 'utc') WHERE id = ANY($1::uuid[])`, [outras.map((x) => x.id)]);
  const rep = (await pedir('GET', '/entregas/reputacao', { token: t })).j;
  expect(rep).toMatchObject({ media: 3.3, avaliacoes: 3 });
  expect(rep.comentarios[0].comentario).toBe('Demorou para liberar o pacote');
  await pedir('POST', `/entregas/chamadas/${outras[0].id}/oferecer`, { token: t, corpo: { entregadorId: perto.id } });
  expect((await pedir('GET', '/entregador/oferta', { token: perto.token })).j).toMatchObject({ notaEmpresa: 3.3, avaliacoesEmpresa: 3 });
  const avaliadas = (await pedir('GET', '/plataforma-entregas/empresas-avaliadas', { token: tokenSuper })).j;
  expect(avaliadas.find((e: { empresaId: string }) => e.empresaId === emp.id)).toMatchObject({ media: 3.3, avaliacoes: 3, ruins: 1 });
  expect((await pedir('GET', '/plataforma-entregas/empresas-avaliadas', { token: t })).status).toBe(403);
  await sql(`UPDATE entregadores SET online = false WHERE id = ANY($1)`, [[noTurno.id, perto.id]]);
});

test('Site: abrir turno, coleta extra na nova chamada e avaria na chamada', async ({ page }) => {
  test.setTimeout(90_000);
  const { tokenSuper, emp, t, C, D, nova } = await preparar();
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 40), `Zeca${randomUUID().slice(0, 4)} Teste`);
  const c = await nova();
  await fazer(t, ent, c, C, D);
  const erros: string[] = [];
  page.on('pageerror', (x) => erros.push(x.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(`${m.text()} @ ${m.location().url}`));
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await entrar(page, emp.adminEmail, emp.adminSenha);
  await page.getByRole('link', { name: 'Entregas' }).click();

  // Avaria na chamada concluída.
  await page.getByTestId('linha-chamada').first().click();
  await page.getByRole('button', { name: 'Registrar avaria ou extravio' }).click();
  await page.getByLabel('Descrição').fill('Pacote molhado');
  await page.getByLabel('Prejuízo (R$)').fill('40,00');
  await page.getByLabel('Descontar do entregador (R$, opcional)').fill('10,00');
  await page.locator('input[type=file]').setInputFiles({ name: 'avaria.png', mimeType: 'image/png', buffer: Buffer.from(PNG.split(',')[1], 'base64') });
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByTestId('avaria')).toContainText('Aguardando o entregador');
  await expect(page.getByTestId('avaria')).toContainText('R$ 10,00');
  await page.keyboard.press('Escape');

  // Nova chamada com uma coleta a mais.
  await page.getByRole('button', { name: 'Nova chamada' }).click();
  await page.getByRole('button', { name: '+ Adicionar outra coleta' }).click();
  await expect(page.getByTestId('coleta-extra')).toHaveCount(1);
  await expect(page.getByText('Clique no mapa para marcar')).toContainText('a coleta 2');
  await page.keyboard.press('Escape');

  // Turno.
  await page.getByRole('tab', { name: 'Turnos' }).click();
  const amanha = new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 86_400_000));
  await page.getByLabel('Dia').fill(amanha);
  await page.getByLabel('Vagas').fill('4');
  await page.getByLabel('Valor por presente (R$)').fill('30,00');
  await page.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(page.getByTestId('turno').first()).toContainText('0 de 4 vagas');
  await expect(page.getByTestId('turno').first()).toContainText('R$ 30,00 por presente');
  expect(erros).toEqual([]);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

async function entrar(page: Page, email: string, senha: string) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.93.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Minha conta' }).first()).toBeVisible();
}
