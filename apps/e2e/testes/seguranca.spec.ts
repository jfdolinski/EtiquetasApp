import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, criarEmpresa, pedir, sql, superToken } from './apoio';
import { entregadorOnline } from './apoio-entregas';

/** Revisão de segurança (novembro/2026): bloqueio por conta, sessão do entregador e corpo sem login. */

const ip = () => `10.93.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test('senha errada 10 vezes bloqueia a conta por 15 min, mesmo vindo de vários endereços', async () => {
  const emp = await criarEmpresa(await superToken());
  const entrar = (senha: string) => pedir('POST', '/auth/login', { corpo: { email: emp.adminEmail, senha }, ip: ip() });
  for (let i = 0; i < 9; i++) expect((await entrar('senha-errada')).status).toBe(401);
  // Acertar antes do limite zera a contagem.
  expect((await entrar(emp.adminSenha)).status).toBe(200);
  for (let i = 0; i < 10; i++) expect((await entrar('senha-errada')).status).toBe(401);
  const bloqueada = await entrar(emp.adminSenha);
  expect(bloqueada.status).toBe(429);
  expect(bloqueada.j.message).toMatch(/Aguarde 15 minutos/);
  // Conta que não existe responde como sempre (não revela quem é cliente).
  expect((await pedir('POST', '/auth/login', { corpo: { email: `ninguem-${randomUUID().slice(0, 6)}@e2e.local`, senha: 'x' }, ip: ip() })).status).toBe(401);
  // Passado o bloqueio, a senha certa entra.
  await sql(`UPDATE usuarios SET senha_bloqueada_ate = now() - interval '1 minute' WHERE email = $1`, [emp.adminEmail]);
  expect((await entrar(emp.adminSenha)).status).toBe(200);
});

test('entregador: bloqueio por conta e sessão que expira depois de 60 dias sem uso', async () => {
  const ent = await entregadorOnline(await superToken());
  const entrar = (senha: string) => pedir('POST', '/entregador/login', { corpo: { login: ent.email, senha }, ip: ip() });
  for (let i = 0; i < 10; i++) expect((await entrar('senha-errada')).status).toBe(401);
  expect((await entrar('SenhaEntregador1')).status).toBe(429);
  await sql(`UPDATE entregadores SET senha_bloqueada_ate = NULL WHERE id = $1`, [ent.id]);
  expect((await entrar('SenhaEntregador1')).status).toBe(200);

  expect((await pedir('GET', '/entregador/eu', { token: ent.token })).status).toBe(200);
  await sql(`UPDATE sessoes_entregador SET ultimo_uso_em = now() - interval '61 days' WHERE entregador_id = $1`, [ent.id]);
  const velha = await pedir('GET', '/entregador/creditos', { token: ent.token });
  expect(velha.status).toBe(401);
  expect(velha.j.message).toMatch(/falta de uso/);
  await sql(`UPDATE entregadores SET online = false WHERE id = $1`, [ent.id]);
});

test('sem login, corpo acima de 1 MB é recusado antes de ser lido', async () => {
  const grande = JSON.stringify({ nome: 'x'.repeat(1_100_000) });
  const r = await fetch(`${API}/entregador/cadastro`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: grande });
  expect(r.status).toBe(413);
  // Com login, o limite continua o de antes (layouts e imagens grandes).
  const token = await superToken();
  const comLogin = await fetch(`${API}/empresas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: grande });
  expect(comLogin.status).not.toBe(413);
});
