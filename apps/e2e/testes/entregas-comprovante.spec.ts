import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, pedir, sql, superToken } from './apoio';
import { deslocar, empresaComBase, entregadorOnline } from './apoio-entregas';

/** Entregas, etapa 9: comprovante em PDF de cada pagamento e etapa enviada depois (feita sem internet). */

const longeDeTudo = () => ({ lat: -10 - Math.random() * 2, lon: -48 - Math.random() * 2 });
const parada = (p: { lat: number; lon: number }, endereco: string) => ({ ...p, endereco, contato: '', telefone: '', instrucoes: '' });

test('API: PDF do pagamento para a empresa e para o entregador; etapa com a hora em que foi feita', async () => {
  test.setTimeout(90_000);
  const tokenSuper = await superToken();
  const emp = await empresaComBase(tokenSuper);
  const t = emp.adminToken;
  const C = longeDeTudo();
  const D = deslocar(C, 1500);
  await pedir('PUT', '/entregas/config', { token: t, corpo: { base: { ...C, endereco: 'Rua da Loja, 1' }, raioAtendimentoKm: 10 } });
  const ent = await entregadorOnline(tokenSuper, deslocar(C, 300), `Ivo${randomUUID().slice(0, 4)} Teste`);
  const ch = (await pedir('POST', '/entregas/chamadas', { token: t, corpo: { tipo: 'ENTREGA', origem: parada(C, 'Rua da Loja, 1'), destino: parada(D, 'Rua Cliente, 9'), serieEsperada: null, observacao: '' } })).j;
  await pedir('POST', `/entregas/chamadas/${ch.id}/oferecer`, { token: t, corpo: { entregadorId: ent.id } });
  const of = await pedir('GET', '/entregador/oferta', { token: ent.token });
  await pedir('POST', `/entregador/ofertas/${of.j.id}/aceitar`, { token: ent.token });
  const av = (corpo: Record<string, unknown>) => pedir('POST', `/entregador/chamadas/${ch.id}/avancar`, { token: ent.token, corpo });

  // Etapa feita há 30 min sem internet: a hora real entra no histórico e na coleta, e a posição velha não vira a atual.
  const antes = (await sql<{ lat: number }>(`SELECT lat FROM entregadores WHERE id = $1`, [ent.id]))[0].lat;
  const meiaHora = new Date(Date.now() - 30 * 60_000).toISOString();
  expect((await av({ para: 'NA_COLETA', ...C, precisao: 5, em: meiaHora })).status).toBe(200);
  expect((await av({ para: 'COLETADA', ...C, em: meiaHora })).status).toBe(200);
  const [linha] = await sql<{ coletada_em: Date; historico: { texto: string }[] }>(`SELECT coletada_em, historico FROM chamadas_entrega WHERE id = $1`, [ch.id]);
  expect(Math.abs(new Date(linha.coletada_em).getTime() - Date.parse(meiaHora))).toBeLessThan(1000);
  expect(linha.historico.map((h) => h.texto).some((x) => /^No local da coleta \(feito às \d{2}:\d{2}, enviado depois por falta de internet\)\.$/.test(x))).toBe(true);
  expect((await sql<{ lat: number }>(`SELECT lat FROM entregadores WHERE id = $1`, [ent.id]))[0].lat).toBe(antes);
  // Hora absurda (três dias atrás) vale como agora.
  await av({ para: 'NO_DESTINO', ...D, precisao: 5, em: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  const hist = (await pedir('GET', `/entregas/chamadas/${ch.id}`, { token: t })).j.historico.map((h: { texto: string }) => h.texto);
  expect(hist).toContain('No destino');
  expect((await av({ para: 'CONCLUIDA', ...D, codigo: ch.codigoConfirmacao })).j.situacao).toBe('CONCLUIDA');

  // Pagamento e o PDF dele.
  const hoje = new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const pago = (await pedir('POST', '/entregas/financeiro/fechamentos', { token: t, corpo: { entregadorId: ent.id, chamadaIds: [ch.id], pagoEm: hoje, observacao: 'Pix da semana' } })).j;
  const pdfEmpresa = await fetch(`${API}/entregas/financeiro/fechamentos/${pago.id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
  expect(pdfEmpresa.status).toBe(200);
  expect(pdfEmpresa.headers.get('content-type')).toBe('application/pdf');
  expect(Buffer.from(await pdfEmpresa.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  const outra = await empresaComBase(tokenSuper);
  expect((await fetch(`${API}/entregas/financeiro/fechamentos/${pago.id}/pdf`, { headers: { Authorization: `Bearer ${outra.adminToken}` } })).status).toBe(404);

  // O entregador: o extrato aponta o pagamento e o link do PDF vale uma vez.
  const extrato = (await pedir('GET', '/entregador/extrato?periodo=TUDO', { token: ent.token })).j;
  expect(extrato.linhas[0]).toMatchObject({ situacao: 'PAGO', fechamentoId: pago.id });
  const link = (await pedir('POST', `/entregador/pagamentos/${pago.id}/link`, { token: ent.token })).j;
  const pdf = await fetch(`${API}${link.caminho}`);
  expect(pdf.status).toBe(200);
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await fetch(`${API}${link.caminho}`)).status).toBe(404);
  const outro = await entregadorOnline(tokenSuper, deslocar(C, 400), `Ana${randomUUID().slice(0, 4)} Teste`);
  expect((await pedir('POST', `/entregador/pagamentos/${pago.id}/link`, { token: outro.token })).status).toBe(404);

  await sql(`UPDATE entregadores SET online = false WHERE id = ANY($1)`, [[ent.id, outro.id]]);
});
