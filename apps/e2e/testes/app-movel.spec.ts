import { expect, test } from '@playwright/test';
import { criarEmpresa, login, montarListaDeHoje, pedir, sql, superToken, vincularCelular, type EmpresaTeste } from './apoio';

let tokenSuper: string;
let a: EmpresaTeste;
let b: EmpresaTeste;

test.beforeAll(async () => {
  tokenSuper = await superToken();
  a = await criarEmpresa(tokenSuper);
  b = await criarEmpresa(tokenSuper);
});

test.describe('vínculo do celular', () => {
  test('código funciona uma vez e o banco não guarda o token', async () => {
    const v = await pedir('POST', '/app/vinculos', { token: a.adminToken });
    expect(v.status).toBe(200);
    const corpo = { codigo: v.j.codigo, nome: 'Moto G', plataforma: 'ANDROID' };
    const r = await pedir('POST', '/app/vincular', { corpo });
    expect(r.status).toBe(200);
    expect(r.j.token).toMatch(/^app_/);
    expect(r.j.usuario.email).toBe(a.adminEmail);
    expect((await pedir('POST', '/app/vincular', { corpo })).status).toBe(401);
    const linhas = await sql(`SELECT token_hash FROM dispositivos_moveis WHERE empresa_id = $1`, [a.id]);
    expect(JSON.stringify(linhas)).not.toContain(r.j.token);
  });

  test('código vencido e pedir outro invalidam o anterior', async () => {
    const v1 = await pedir('POST', '/app/vinculos', { token: a.adminToken });
    const v2 = await pedir('POST', '/app/vinculos', { token: a.adminToken });
    expect((await pedir('POST', '/app/vincular', { corpo: { codigo: v1.j.codigo, nome: 'x', plataforma: 'ANDROID' } })).status).toBe(401);
    await sql(`UPDATE codigos_vinculo_app SET expira_em = $2::timestamp WHERE empresa_id = $1`, [a.id, new Date(Date.now() - 60_000).toISOString()]);
    expect((await pedir('POST', '/app/vincular', { corpo: { codigo: v2.j.codigo, nome: 'x', plataforma: 'ANDROID' } })).status).toBe(401);
  });

  test('token do celular só entra nas rotas do aplicativo', async () => {
    const c = await vincularCelular(a.adminToken);
    expect((await pedir('GET', '/auth/me', { token: c.token })).status).toBe(200);
    expect((await pedir('GET', '/painel', { token: c.token })).status).toBe(200);
    expect((await pedir('GET', '/listas/hoje', { token: c.token })).status).toBe(200);
    expect((await pedir('GET', '/notificacoes', { token: c.token })).status).toBe(200);
    // Nada de administração, nem gerar outro vínculo.
    for (const [m, r] of [['GET', '/usuarios'], ['GET', '/consultas'], ['GET', '/conexoes'], ['POST', '/app/vinculos'], ['GET', '/auth/sessoes'], ['GET', '/banidos']] as const) {
      expect((await pedir(m, r, { token: c.token })).status, r).toBe(403);
    }
  });

  test('desvincular derruba o celular na hora; só o dono consegue', async () => {
    const c = await vincularCelular(a.adminToken);
    const lista = await pedir('GET', '/app/dispositivos', { token: a.adminToken });
    const id = lista.j[0].id as string;
    expect((await pedir('DELETE', `/app/dispositivos/${id}`, { token: b.adminToken })).status).toBe(404);
    expect((await pedir('GET', '/auth/me', { token: c.token })).status).toBe(200);
    expect((await pedir('DELETE', `/app/dispositivos/${id}`, { token: a.adminToken })).status).toBe(204);
    expect((await pedir('GET', '/auth/me', { token: c.token })).status).toBe(401);
  });

  test('usuário desativado e empresa bloqueada perdem o acesso pelo celular', async () => {
    const e = await criarEmpresa(tokenSuper);
    const c = await vincularCelular(e.adminToken);
    await sql(`UPDATE empresas SET status_assinatura = 'BLOQUEADA' WHERE id = $1`, [e.id]);
    expect((await pedir('GET', '/auth/me', { token: c.token })).status).toBe(403);
    await sql(`UPDATE empresas SET status_assinatura = 'ATIVA' WHERE id = $1`, [e.id]);
    await sql(`UPDATE usuarios SET ativo = false WHERE email = $1`, [e.adminEmail]);
    expect((await pedir('GET', '/auth/me', { token: c.token })).status).toBe(401);
  });

  test('super-admin precisa escolher a empresa e o app opera nela', async () => {
    expect((await pedir('POST', '/app/vinculos', { token: tokenSuper })).status).toBe(400);
    const c = await vincularCelular(tokenSuper, a.id);
    expect(c.empresaId).toBe(a.id);
    expect((await pedir('GET', '/listas/hoje', { token: c.token, empresa: a.id })).status).toBe(200);
  });

  test('token de aviso só pelo aplicativo', async () => {
    const c = await vincularCelular(a.adminToken);
    expect((await pedir('PUT', '/app/push', { token: c.token, corpo: { token: 'fcm-1' } })).status).toBe(204);
    expect((await pedir('PUT', '/app/push', { token: a.adminToken, corpo: { token: 'fcm-2' } })).status).toBe(400);
    const d = (await pedir('GET', '/app/dispositivos', { token: c.token })).j.find((x: any) => x.atual);
    expect(d.recebeAvisos).toBe(true);
    expect((await pedir('PUT', '/app/push', { token: c.token, corpo: { token: null } })).status).toBe(204);
  });
});

test.describe('aprovar a lista do dia pelo celular', () => {
  test('aprovar manda para a fila com a quantidade escolhida', async () => {
    const e = await criarEmpresa(tokenSuper);
    const { itemIds } = await montarListaDeHoje(e);
    const c = await vincularCelular(e.adminToken);
    const lista = await pedir('GET', '/listas/hoje', { token: c.token });
    expect(lista.j.lista.itens).toHaveLength(2);

    const r = await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo: { itens: [{ id: itemIds[0], quantidade: 5 }] } });
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    expect(r.j.trabalhos).toHaveLength(1);
    expect(r.j.trabalhos[0].quantidadeEtiquetas).toBe(5);
    expect(r.j.trabalhos[0].origem).toBe('LISTA');

    const depois = await pedir('GET', '/listas/hoje', { token: c.token });
    const status = Object.fromEntries(depois.j.lista.itens.map((i: any) => [i.id, i.status]));
    expect(status[itemIds[0]]).toBe('NA_FILA');
    expect(status[itemIds[1]]).toBe('PENDENTE');
    const [log] = await sql(`SELECT detalhes FROM logs_auditoria WHERE empresa_id = $1 AND acao = 'app.aprovar'`, [e.id]);
    expect(log.detalhes.dispositivoId).toBeTruthy();
  });

  test('aprovar de novo não imprime duas vezes', async () => {
    const e = await criarEmpresa(tokenSuper);
    const { itemIds } = await montarListaDeHoje(e);
    const c = await vincularCelular(e.adminToken);
    const corpo = { itens: [{ id: itemIds[0], quantidade: 1 }] };
    expect((await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo })).status).toBe(200);
    expect((await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo })).status).toBe(400);
    const [{ total }] = await sql(`SELECT count(*)::int AS total FROM trabalhos_impressao WHERE empresa_id = $1`, [e.id]);
    expect(total).toBe(1);
  });

  test('PDF não é marcado como impresso pelo celular', async () => {
    const e = await criarEmpresa(tokenSuper);
    const { itemIds } = await montarListaDeHoje(e, { linguagem: 'PDF' });
    const c = await vincularCelular(e.adminToken);
    const r = await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo: { itens: [{ id: itemIds[0], quantidade: 1 }] } });
    expect(r.status).toBe(200);
    expect(r.j.trabalhos).toHaveLength(0);
    expect(r.j.avisos.join()).toContain('PDF');
    const [item] = await sql(`SELECT status FROM itens_lista WHERE id = $1`, [itemIds[0]]);
    expect(item.status).toBe('PENDENTE');
  });

  test('produto banido não sai e descartar tira da lista', async () => {
    const e = await criarEmpresa(tokenSuper);
    const { itemIds } = await montarListaDeHoje(e);
    const c = await vincularCelular(e.adminToken);
    await pedir('POST', '/banidos', { token: e.adminToken, corpo: { codigos: ['7891000100103'] } });
    const r = await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo: { itens: [{ id: itemIds[0], quantidade: 1 }] } });
    expect(r.j.trabalhos ?? []).toHaveLength(0);
    expect((await pedir('POST', '/app/lista/descartar', { token: c.token, corpo: { ids: [itemIds[1]] } })).j.descartados).toBe(1);
  });

  test('sem a permissão app.aprovar vê a lista, mas não aprova', async () => {
    const e = await criarEmpresa(tokenSuper);
    const { itemIds } = await montarListaDeHoje(e);
    const perfil = await pedir('POST', '/perfis', { token: e.adminToken, corpo: { nome: 'Só imprime', permissoes: ['imprimir'] } });
    expect(perfil.status, JSON.stringify(perfil.j)).toBe(201);
    const email = `op-${Date.now()}@e2e.local`;
    const u = await pedir('POST', '/usuarios', { token: e.adminToken, corpo: { nome: 'Operador', email, senha: 'SenhaOperador1', perfilId: perfil.j.id } });
    expect(u.status, JSON.stringify(u.j)).toBe(201);
    const c = await vincularCelular(await login(email, 'SenhaOperador1'));
    expect((await pedir('GET', '/listas/hoje', { token: c.token })).status).toBe(200);
    expect((await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo: { itens: [{ id: itemIds[0], quantidade: 1 }] } })).status).toBe(403);
    expect((await pedir('POST', '/app/lista/descartar', { token: c.token, corpo: { ids: [itemIds[0]] } })).status).toBe(403);
  });

  test('item de outra empresa não é aprovado nem descartado', async () => {
    const { itemIds } = await montarListaDeHoje(a);
    const outra = await criarEmpresa(tokenSuper);
    await montarListaDeHoje(outra);
    const c = await vincularCelular(outra.adminToken);
    expect((await pedir('POST', '/app/lista/aprovar', { token: c.token, corpo: { itens: [{ id: itemIds[0], quantidade: 1 }] } })).status).toBe(400);
    expect((await pedir('POST', '/app/lista/descartar', { token: c.token, corpo: { ids: [itemIds[0]] } })).j.descartados).toBe(0);
    const [item] = await sql(`SELECT status FROM itens_lista WHERE id = $1`, [itemIds[0]]);
    expect(item.status).toBe('PENDENTE');
  });
});
