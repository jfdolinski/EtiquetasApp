// Prepara o fluxo real do aplicativo no CI: empresa, agente de verdade, "ERP" no Postgres,
// consultas, modelo, impressora de rede simulada e um código de vínculo. Grava em fluxo.json.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

const API = 'http://127.0.0.1:3000/api';
const pedir = async (metodo, caminho, { token, corpo } = {}) => {
  const r = await fetch(API + caminho, { method: metodo, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.1`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${JSON.stringify(j)}`);
  return j;
};

// Impressora de rede: guarda o que chegar, para o teste conferir que a etiqueta saiu.
let recebido = 0;
createServer((s) => s.on('data', (d) => { recebido += d.length; writeFileSync('saida-fluxo/impressora.txt', String(recebido)); s.on('error', () => undefined); })).listen(9100, '127.0.0.1');

const superL = await pedir('POST', '/auth/login', { corpo: { email: 'super@fluxo.local', senha: 'SenhaSuperFluxo123' } });
const sufixo = randomUUID().slice(0, 8);
const adminEmail = `admin-${sufixo}@fluxo.local`;
const cnpj = process.env.FLUXO_CNPJ ?? '11222333000181';
const criada = await pedir('POST', '/empresas', { token: superL.token, corpo: { razaoSocial: 'Mercado Fluxo', cnpj, admin: { nome: 'Admin Fluxo', email: adminEmail, senha: 'SenhaAdmin123' } } });
const empresaId = (criada.empresa ?? criada).id;
const { token } = await pedir('POST', '/auth/login', { corpo: { email: adminEmail, senha: 'SenhaAdmin123' } });

const ag = await pedir('POST', '/agentes', { token, corpo: { nome: 'Agente do fluxo' } });
const agenteId = ag.agente?.id ?? ag.id;
const codigoAtivacao = ag.codigoAtivacao ?? ag.codigo;

// Agente real: ativa e fica rodando em primeiro plano.
await new Promise((ok, erro) => execFile('./etiquetas-agente', ['ativar', '-servidor', 'http://127.0.0.1:3000', '-cnpj', cnpj, '-codigo', codigoAtivacao], { cwd: process.env.AGENTE_DIR }, (e, o, se) => (e ? erro(new Error(`${e.message}\n${o}\n${se}`)) : ok())));
spawn('./etiquetas-agente', ['executar'], { cwd: process.env.AGENTE_DIR, stdio: 'ignore', detached: false });
for (let i = 0; ; i++) {
  const lista = await pedir('GET', '/agentes', { token });
  if (lista.find((a) => a.id === agenteId)?.online) break;
  if (i > 40) throw new Error('agente não ficou online');
  await new Promise((r) => setTimeout(r, 1500));
}

const conexao = await pedir('POST', '/conexoes', { token, corpo: { nome: 'ERP', tipo: 'POSTGRES', agenteId, host: '127.0.0.1', porta: 5432, banco: 'erp', usuario: 'etiquetas', senha: 'etiquetas', opcoes: { ssl: 'disable' } } });
const impressora = await pedir('POST', '/impressoras', { token, corpo: { nome: 'Zebra do fluxo', agenteId, linguagem: 'ZPL', dpi: 203, metodo: 'REDE', endereco: '127.0.0.1:9100' } });

await pedir('POST', '/impressoras', { token, corpo: { nome: 'Cartazes', agenteId, linguagem: 'PDF', dpi: 300, metodo: 'REDE', endereco: '127.0.0.1:9100' } });

const PRODUTOS = `(VALUES ('7891000100103','Café torrado 500 g','19.90','UN','Mercearia','SEXTA-COLUNA'),('7891000100110','Arroz branco 5 kg','27.50','UN','Mercearia','SEXTA-COLUNA'),('7891000100127','Feijão preto 1 kg','8.99','UN','Mercearia','SEXTA-COLUNA')) AS p(codigo, descricao, preco, unidade, departamento, oculta)`;
const busca = await pedir('POST', '/consultas', { token, corpo: { nome: 'Busca', conexaoId: conexao.id, finalidade: 'BUSCA_PRODUTO', sql: `SELECT p.codigo, p.descricao, p.preco, p.unidade, p.departamento, p.oculta FROM ${PRODUTOS} WHERE p.codigo = {param.busca} OR p.descricao ILIKE '%' || {param.busca} || '%'` } });
const lista = await pedir('POST', '/consultas', { token, corpo: { nome: 'Lista', conexaoId: conexao.id, finalidade: 'LISTA_DIARIA', sql: `SELECT p.codigo, p.descricao, p.preco, p.unidade, p.departamento, p.oculta FROM ${PRODUTOS}` } });

const LAYOUT = { larguraMm: 60, alturaMm: 30, colunas: 1, espacamentoHorizontalMm: 0, espacamentoVerticalMm: 0, margens: { superior: 0, inferior: 0, esquerda: 0, direita: 0 }, papel: { tipo: 'rolo' }, elementos: [] };
await pedir('POST', '/modelos', { token, corpo: { nome: 'Gôndola avulsa', consultaId: busca.consulta.id, layout: LAYOUT, impressoraId: impressora.id } });
// Como o modelo de um cliente real: consulta sem {param.*}, a busca é feita pelo sistema.
const semParametro = await pedir('POST', '/consultas', { token, corpo: { nome: 'Tabela', conexaoId: conexao.id, finalidade: 'BUSCA_PRODUTO', sql: `SELECT p.codigo, p.descricao, p.preco, p.unidade, p.departamento, p.oculta FROM ${PRODUTOS}` } });
await pedir('POST', '/modelos', { token, corpo: { nome: 'Tabela sem parametro', consultaId: semParametro.consulta.id, layout: LAYOUT, impressoraId: impressora.id } });
await pedir('POST', '/modelos', { token, corpo: { nome: 'Gôndola lista', consultaId: lista.consulta.id, layout: LAYOUT, impressoraId: impressora.id, naListaDiaria: true } });
const gerada = await pedir('POST', '/listas/hoje/gerar', { token });

const vinculo = await pedir('POST', '/app/vinculos', { token });
writeFileSync('saida-fluxo/fluxo.json', JSON.stringify({ empresaId, codigo: vinculo.codigo, token, itensLista: gerada.itens.length }));
console.log(`pronto: ${gerada.itens.length} item(ns) na lista, modelos e agente no ar`);
// Fica rodando: o agente e a impressora simulada servem ao teste no emulador.
setInterval(() => undefined, 60_000);
