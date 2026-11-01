import { expect, test } from '@playwright/test';
import { codigoTotp, criarEmpresa, login, montarListaDeHoje, pedir, sql, superToken, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let e: EmpresaTeste;

test.beforeAll(async () => {
  tokenSuper = await superToken();
  e = await criarEmpresa(tokenSuper);
});

test('duas etapas: ativar, entrar com código, recuperar e desativar', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const { adminEmail: email, adminSenha: senha, adminToken: token } = outra;

  expect((await pedir('POST', '/auth/2fa/iniciar', { token, corpo: { senha: 'errada' } })).status).toBe(400);
  const inicio = await pedir('POST', '/auth/2fa/iniciar', { token, corpo: { senha } });
  expect(inicio.j.uri).toContain('otpauth://totp/');
  // Antes de confirmar o código, o login segue só com a senha.
  await login(email, senha);

  expect((await pedir('POST', '/auth/2fa/ativar', { token, corpo: { codigo: '000000' } })).status).toBe(400);
  const ativado = await pedir('POST', '/auth/2fa/ativar', { token, corpo: { codigo: codigoTotp(inicio.j.segredo) } });
  expect(ativado.status).toBe(200);
  expect(ativado.j.codigosRecuperacao).toHaveLength(8);

  expect((await pedir('POST', '/auth/login', { corpo: { email, senha } })).j).toEqual({ precisaCodigo: true });
  expect((await pedir('POST', '/auth/login', { corpo: { email, senha: 'errada', codigo: '123456' } })).status).toBe(401);
  // O código usado para ativar não entra de novo; o do próximo passo, sim.
  expect((await pedir('POST', '/auth/login', { corpo: { email, senha, codigo: codigoTotp(inicio.j.segredo) } })).status).toBe(401);
  const entrou = await pedir('POST', '/auth/login', { corpo: { email, senha, codigo: codigoTotp(inicio.j.segredo, 1) } });
  expect(entrou.status).toBe(200);
  expect(entrou.j.usuario.doisFatores).toBe(true);

  const recuperacao = ativado.j.codigosRecuperacao[0] as string;
  expect((await pedir('POST', '/auth/login', { corpo: { email, senha, codigo: recuperacao } })).status).toBe(200);
  expect((await pedir('POST', '/auth/login', { corpo: { email, senha, codigo: recuperacao } })).status).toBe(401);

  // Segredo cifrado e códigos só em hash.
  const [u] = await sql(`SELECT totp_segredo_cifrado, totp_codigos_recuperacao FROM usuarios WHERE email = $1`, [email]);
  expect(u.totp_segredo_cifrado).not.toContain(inicio.j.segredo);
  expect(JSON.stringify(u.totp_codigos_recuperacao)).not.toContain(ativado.j.codigosRecuperacao[1]);

  expect((await pedir('POST', '/auth/2fa/desativar', { token, corpo: { senha, codigo: '000000' } })).status).toBe(400);
  expect((await pedir('POST', '/auth/2fa/desativar', { token, corpo: { senha, codigo: ativado.j.codigosRecuperacao[1] } })).status).toBe(204);
  await login(email, senha);
});

test('cinco códigos errados bloqueiam a conta por alguns minutos', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const { adminEmail: email, adminSenha: senha, adminToken: token } = outra;
  const inicio = await pedir('POST', '/auth/2fa/iniciar', { token, corpo: { senha } });
  await pedir('POST', '/auth/2fa/ativar', { token, corpo: { codigo: codigoTotp(inicio.j.segredo) } });
  for (let i = 0; i < 5; i++) expect((await pedir('POST', '/auth/login', { corpo: { email, senha, codigo: '111111' } })).status).toBe(401);
  const r = await pedir('POST', '/auth/login', { corpo: { email, senha, codigo: codigoTotp(inicio.j.segredo, 1) } });
  expect(r.status).toBe(401);
  expect(r.j.message).toContain('Aguarde');
});

test('sessões: listar, encerrar uma e encerrar as outras', async () => {
  const t1 = await login(e.adminEmail, e.adminSenha);
  const t2 = await login(e.adminEmail, e.adminSenha);
  const lista = await pedir('GET', '/auth/sessoes', { token: t1 });
  expect(lista.j.filter((s: any) => s.atual)).toHaveLength(1);
  const outraSessao = (await pedir('GET', '/auth/sessoes', { token: t2 })).j.find((s: any) => s.atual);
  expect((await pedir('DELETE', `/auth/sessoes/${outraSessao.id}`, { token: t1 })).status).toBe(204);
  expect((await pedir('GET', '/auth/me', { token: t2 })).status).toBe(401);
  // Sessão de outra pessoa não existe para mim.
  const alheia = (await pedir('GET', '/auth/sessoes', { token: tokenSuper })).j[0];
  expect((await pedir('DELETE', `/auth/sessoes/${alheia.id}`, { token: t1 })).status).toBe(404);

  const t3 = await login(e.adminEmail, e.adminSenha);
  expect((await pedir('POST', '/auth/sessoes/encerrar-outras', { token: t1 })).status).toBe(200);
  expect((await pedir('GET', '/auth/me', { token: t3 })).status).toBe(401);
  expect((await pedir('GET', '/auth/me', { token: t1 })).status).toBe(200);
});

test('trocar a senha encerra as outras sessões e mantém a atual', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const t2 = await login(outra.adminEmail, outra.adminSenha);
  expect((await pedir('POST', '/auth/trocar-senha', { token: outra.adminToken, corpo: { senhaAtual: outra.adminSenha, novaSenha: 'NovaSenha12345' } })).status).toBe(204);
  expect((await pedir('GET', '/auth/me', { token: t2 })).status).toBe(401);
  expect((await pedir('GET', '/auth/me', { token: outra.adminToken })).status).toBe(200);
});

test('senha esquecida: sem SMTP, responde igual e não cria pedido', async () => {
  expect((await pedir('POST', '/auth/esqueci-senha', { corpo: { email: e.adminEmail } })).status).toBe(204);
  expect((await pedir('POST', '/auth/esqueci-senha', { corpo: { email: 'ninguem@e2e.local' } })).status).toBe(204);
  expect((await pedir('GET', '/auth/opcoes')).j).toEqual({ esqueciSenha: false });
  expect((await pedir('POST', '/auth/redefinir-senha', { corpo: { token: 'x'.repeat(43), novaSenha: 'NovaSenha12345' } })).status).toBe(400);
});

test('senha esquecida: link de verdade troca a senha, derruba sessões e celulares e não serve duas vezes', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const { createHash, randomUUID } = await import('node:crypto');
  const token = `token-de-teste-${randomUUID()}`;
  const [{ id }] = await sql(`SELECT id FROM usuarios WHERE email = $1`, [outra.adminEmail]);
  await sql(`INSERT INTO redefinicoes_senha (id, usuario_id, token_hash, expira_em) VALUES ($1, $2, $3, $4::timestamp)`, [randomUUID(), id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3_600_000).toISOString()]);
  const v = await pedir('POST', '/app/vinculos', { token: outra.adminToken });
  const celular = await pedir('POST', '/app/vincular', { corpo: { codigo: v.j.codigo, nome: 'c', plataforma: 'ANDROID' } });

  expect((await pedir('POST', '/auth/redefinir-senha', { corpo: { token, novaSenha: 'curta' } })).status).toBe(400);
  expect((await pedir('POST', '/auth/redefinir-senha', { corpo: { token, novaSenha: 'SenhaNova12345' } })).status).toBe(204);
  expect((await pedir('POST', '/auth/redefinir-senha', { corpo: { token, novaSenha: 'SenhaNova67890' } })).status).toBe(400);
  expect((await pedir('GET', '/auth/me', { token: outra.adminToken })).status).toBe(401);
  expect((await pedir('GET', '/auth/me', { token: celular.j.token })).status).toBe(401);
  await login(outra.adminEmail, 'SenhaNova12345');
});

test('reenviar reconfere o banimento; conteúdo apagado não é reenviado nem baixado', async () => {
  const outra = await criarEmpresa(tokenSuper);
  const { listaId, itemIds } = await montarListaDeHoje(outra);
  const r = await pedir('POST', `/listas/${listaId}/imprimir`, { token: outra.adminToken, corpo: { itens: [{ id: itemIds[0], quantidade: 1 }] } });
  const trabalho = r.j.trabalhos[0].id as string;
  await sql(`UPDATE trabalhos_impressao SET status = 'ERRO' WHERE id = $1`, [trabalho]);

  await pedir('POST', '/banidos', { token: outra.adminToken, corpo: { codigos: ['7891000100103'] } });
  const barrado = await pedir('POST', `/trabalhos/${trabalho}/reenviar`, { token: outra.adminToken });
  expect(barrado.status).toBe(400);
  expect(barrado.j.message).toContain('banido');

  const liberado = await pedir('POST', '/banidos/liberar', { token: outra.adminToken, corpo: { codigos: ['0007891000100103'] } });
  expect(liberado.j.liberados).toBe(1);
  await sql(`UPDATE trabalhos_impressao SET conteudo_apagado_em = now() WHERE id = $1`, [trabalho]);
  expect((await pedir('POST', `/trabalhos/${trabalho}/reenviar`, { token: outra.adminToken })).j.message).toContain('apagado');
  expect((await pedir('GET', `/trabalhos/${trabalho}/conteudo`, { token: outra.adminToken })).status).toBe(410);

  await sql(`UPDATE trabalhos_impressao SET conteudo_apagado_em = NULL WHERE id = $1`, [trabalho]);
  expect((await pedir('POST', `/trabalhos/${trabalho}/reenviar`, { token: outra.adminToken })).status).toBe(200);
});

test('criar empresa sem administrador é erro de validação, não erro interno', async () => {
  const r = await pedir('POST', '/empresas', { token: tokenSuper, corpo: { razaoSocial: 'Sem admin', cnpj: '11444777000161' } });
  expect(r.status).toBe(400);
  expect(JSON.stringify(r.j.message)).toContain('administrador');
});

test('saúde do sistema: só o super-admin, com erros inesperados registrados', async () => {
  expect((await pedir('GET', '/sistema/saude', { token: await login(e.adminEmail, e.adminSenha) })).status).toBe(403);
  const s = await pedir('GET', '/sistema/saude', { token: tokenSuper });
  expect(s.status).toBe(200);
  expect(s.j.bancoBytes).toBeGreaterThan(0);
  expect(s.j.tabelas.length).toBeGreaterThan(0);
  expect(JSON.stringify(s.j)).not.toContain('senha_hash');
});
