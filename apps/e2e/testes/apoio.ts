import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';

export const API = 'http://localhost:3000/api';
export const SUPER = { email: 'super@e2e.local', senha: 'SenhaSuperE2E123' };

export interface Resposta<T = any> {
  status: number;
  j: T;
}

/** Cada chamada vem de um IP diferente: o limite de login por minuto não atrapalha os testes. */
export async function pedir<T = any>(metodo: string, caminho: string, opcoes: { token?: string; empresa?: string; corpo?: unknown; ip?: string } = {}): Promise<Resposta<T>> {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': opcoes.ip ?? `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
      ...(opcoes.empresa ? { 'x-empresa-id': opcoes.empresa } : {}),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as T };
}

export async function login(email: string, senha: string, codigo?: string): Promise<string> {
  const r = await pedir('POST', '/auth/login', { corpo: { email, senha, codigo } });
  if (r.status !== 200 || !r.j.token) throw new Error(`login de ${email}: ${r.status} ${JSON.stringify(r.j)}`);
  return r.j.token as string;
}

export const superToken = () => login(SUPER.email, SUPER.senha);

function cnpjValido(): string {
  const base = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (d: number[]) => {
    const pesos = d.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = d.reduce((s, n, i) => s + n * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

export interface EmpresaTeste {
  id: string;
  adminEmail: string;
  adminSenha: string;
  adminToken: string;
}

export async function criarEmpresa(tokenSuper: string): Promise<EmpresaTeste> {
  const sufixo = randomUUID().slice(0, 8);
  const adminEmail = `admin-${sufixo}@e2e.local`;
  const adminSenha = 'SenhaAdmin123';
  const r = await pedir('POST', '/empresas', { token: tokenSuper, corpo: { razaoSocial: `Empresa ${sufixo}`, cnpj: cnpjValido(), admin: { nome: `Admin ${sufixo}`, email: adminEmail, senha: adminSenha } } });
  if (r.status !== 201) throw new Error(`criar empresa: ${r.status} ${JSON.stringify(r.j)}`);
  const empresa = r.j.empresa ?? r.j;
  return { id: empresa.id, adminEmail, adminSenha, adminToken: await login(adminEmail, adminSenha) };
}

/** Código do autenticador, calculado por fora da API para conferir o formato de verdade. */
export function codigoTotp(segredoBase32: string, passoExtra = 0): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredoBase32) bits += alfabeto.indexOf(c).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + passoExtra));
  const h = createHmac('sha1', bytes).update(contador).digest();
  return String((h.readUInt32BE(h[h.length - 1] & 0xf) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function sql<T extends Record<string, any> = any>(texto: string, parametros: unknown[] = []): Promise<T[]> {
  const url = new URL(process.env.E2E_DATABASE_URL ?? 'postgresql://etiquetas:etiquetas@localhost:5432/etiquetas_e2e');
  const schema = url.searchParams.get('schema');
  url.searchParams.delete('schema');
  const cliente = new Client({ connectionString: url.toString() });
  await cliente.connect();
  try {
    if (schema) await cliente.query(`SET search_path TO "${schema}"`);
    return (await cliente.query(texto, parametros as never[])).rows as T[];
  } finally {
    await cliente.end();
  }
}

const LAYOUT = {
  larguraMm: 60,
  alturaMm: 30,
  colunas: 1,
  espacamentoHorizontalMm: 0,
  espacamentoVerticalMm: 0,
  margens: { superior: 0, inferior: 0, esquerda: 0, direita: 0 },
  papel: { tipo: 'rolo' },
  elementos: [],
};

/** Impressora + modelo + lista de hoje com produtos pendentes, direto no banco (sem depender de agente). */
export async function montarListaDeHoje(e: EmpresaTeste, opcoes: { linguagem?: 'ZPL' | 'PDF'; produtos?: string[] } = {}) {
  const linguagem = opcoes.linguagem ?? 'ZPL';
  const ag = await pedir('POST', '/agentes', { token: e.adminToken, corpo: { nome: `Agente ${randomUUID().slice(0, 6)}` } });
  const agenteId = ag.j.agente?.id ?? ag.j.id;
  const imp = await pedir('POST', '/impressoras', { token: e.adminToken, corpo: { nome: `Imp ${randomUUID().slice(0, 6)}`, agenteId, linguagem, dpi: 203, metodo: 'REDE', endereco: '127.0.0.1:9100' } });
  if (imp.status !== 201) throw new Error(`impressora: ${JSON.stringify(imp.j)}`);
  const mod = await pedir('POST', '/modelos', { token: e.adminToken, corpo: { nome: `Modelo ${randomUUID().slice(0, 6)}`, layout: LAYOUT, impressoraId: imp.j.id } });
  if (mod.status !== 201) throw new Error(`modelo: ${JSON.stringify(mod.j)}`);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const lista = randomUUID();
  await sql(`INSERT INTO listas_diarias (id, empresa_id, data, erros, atualizado_em) VALUES ($1, $2, $3::date, '[]', now()) ON CONFLICT (empresa_id, data) DO UPDATE SET atualizado_em = now()`, [lista, e.id, hoje]);
  const [{ id: listaId }] = await sql<{ id: string }>(`SELECT id FROM listas_diarias WHERE empresa_id = $1 AND data = $2::date`, [e.id, hoje]);
  const ids: string[] = [];
  for (const codigo of opcoes.produtos ?? ['7891000100103', '7891000100110']) {
    const id = randomUUID();
    ids.push(id);
    await sql(`INSERT INTO itens_lista (id, empresa_id, lista_id, modelo_id, impressora_id, chave, descricao, registro, quantidade, status, atualizado_em) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 2, 'PENDENTE', now())`, [id, e.id, listaId, mod.j.id, imp.j.id, codigo, `Produto ${codigo}`, JSON.stringify({ ean: codigo, descricao: `Produto ${codigo}`, preco: '4.99' })]);
  }
  return { listaId, itemIds: ids, modeloId: mod.j.id as string, impressoraId: imp.j.id as string };
}

/** Vincula um "celular" como o aplicativo faz. */
export async function vincularCelular(token: string, empresa?: string) {
  const v = await pedir('POST', '/app/vinculos', { token, empresa });
  if (v.status !== 200) throw new Error(`vínculo: ${JSON.stringify(v.j)}`);
  const r = await pedir('POST', '/app/vincular', { corpo: { codigo: v.j.codigo, nome: 'Celular de teste', plataforma: 'ANDROID', versao: '1.0.0' } });
  if (r.status !== 200) throw new Error(`vincular: ${JSON.stringify(r.j)}`);
  return r.j as { token: string; empresaId: string; usuario: any };
}
