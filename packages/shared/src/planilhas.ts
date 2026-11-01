/**
 * Planilhas como fonte de dados: uma conexão PASTA (agente lê csv/xls/xlsx de uma pasta) ou
 * GOOGLE_DRIVE (API lê uma pasta do Drive). A consulta aponta para um arquivo e uma aba; o
 * resto do sistema (modelos, lista do dia, avulsa, agendamentos) a usa como qualquer outra.
 */
import type { ResultadoConsulta } from './agente';
import type { CampoDinamico } from './consultas';
import { mesmoCodigo, normalizarEntrada } from './avulsa';

export const MAXIMO_LINHAS_PLANILHA = 100_000;
export const MAXIMO_COLUNAS_PLANILHA = 200;
export const MAXIMO_TAMANHO_CELULA = 2_000;

/** Parâmetro de busca das consultas de planilha (como `{param.busca}` no SQL). */
export const PARAMETRO_PLANILHA = 'busca';

export type CelulaPlanilha = string | number | boolean | null;

export interface TabelaPlanilha {
  colunas: string[];
  linhas: CelulaPlanilha[][];
}

/** Arquivo disponível numa conexão de planilhas. `id`: caminho na pasta ou id no Drive. */
export interface ArquivoPlanilha {
  id: string;
  nome: string;
  tamanho: number | null;
  modificadoEm: string | null;
}

/** Leitura de um arquivo: as abas que ele tem, a aba lida e as linhas. */
export interface LeituraPlanilha {
  abas: string[];
  aba: string;
  resultado: ResultadoConsulta;
}

export interface PreviaPlanilha extends LeituraPlanilha {
  campos: CampoDinamico[];
  avisos: string[];
}

export class ErroPlanilha extends Error {}

/** Cabeçalho vira nome de campo, como nas colunas SQL: "Código de Barras" → codigo_de_barras. */
export function nomeDeCampo(cabecalho: string): string {
  return cabecalho
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function celula(v: unknown): CelulaPlanilha {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length > MAXIMO_TAMANHO_CELULA) throw new ErroPlanilha(`Há uma célula com mais de ${MAXIMO_TAMANHO_CELULA} caracteres.`);
    // "4,99" digitado como texto vale como 4.99 nos formatos de moeda; códigos não mudam.
    return t === '' ? null : normalizarEntrada(t);
  }
  throw new ErroPlanilha('As células devem ser texto, número, data ou sim/não.');
}

/** Valida e limpa cabeçalho e linhas. Tudo que vem de um arquivo passa por aqui. */
export function montarTabela(cabecalho: unknown[], linhas: unknown[][]): TabelaPlanilha {
  if (cabecalho.length > MAXIMO_COLUNAS_PLANILHA) throw new ErroPlanilha(`No máximo ${MAXIMO_COLUNAS_PLANILHA} colunas.`);
  const usados = new Map<string, number>();
  const colunas = cabecalho.map((c, i) => {
    const base = nomeDeCampo(String(c ?? '')) || `coluna_${i + 1}`;
    const vezes = (usados.get(base) ?? 0) + 1;
    usados.set(base, vezes);
    return vezes === 1 ? base : `${base}_${vezes}`;
  });
  const limpas: CelulaPlanilha[][] = [];
  for (const l of linhas) {
    if (!Array.isArray(l)) throw new ErroPlanilha('Cada linha deve ser uma lista de valores.');
    const linha = colunas.map((_, i) => celula(l[i]));
    if (linha.some((v) => v !== null)) limpas.push(linha);
    if (limpas.length > MAXIMO_LINHAS_PLANILHA) throw new ErroPlanilha(`No máximo ${MAXIMO_LINHAS_PLANILHA.toLocaleString('pt-BR')} linhas.`);
  }
  // Colunas sem título (sobras à direita no Excel) não viram campo, nem mudam de nome conforme a busca.
  const manter = colunas.map((_, i) => String(cabecalho[i] ?? '').trim() !== '');
  const tabela = { colunas: colunas.filter((_, i) => manter[i]), linhas: limpas.map((l) => l.filter((_, i) => manter[i])) };
  if (tabela.colunas.length === 0) throw new ErroPlanilha('A planilha não tem colunas: a primeira linha deve ter os títulos.');
  return tabela;
}

/** Tabela a partir de linhas brutas: a primeira preenchida é o cabeçalho. */
export function tabelaDeLinhas(linhas: unknown[][]): TabelaPlanilha {
  const inicio = linhas.findIndex((l) => l.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  if (inicio < 0) throw new ErroPlanilha('A planilha está vazia.');
  return montarTabela(linhas[inicio], linhas.slice(inicio + 1));
}

/** Lê CSV (RFC 4180) com separador `,`, `;` ou tabulação. */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const fim = t.search(/\r?\n/);
  const primeira = fim < 0 ? t : t.slice(0, fim);
  const separador = [';', '\t', ','].reduce((a, b) => (primeira.split(b).length > primeira.split(a).length ? b : a), ',');
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"' && campo === '') aspas = true;
    else if (c === separador) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** Colunas no formato de resultado de consulta; só é número o que é número em toda a coluna. */
export function colunasDaTabela(tabela: TabelaPlanilha): ResultadoConsulta['colunas'] {
  return tabela.colunas.map((nome, i) => {
    const valores = tabela.linhas.slice(0, 500).map((l) => l[i]).filter((v) => v !== null);
    const numero = valores.length > 0 && valores.every((v) => typeof v === 'number');
    return { nome, tipo: numero ? 'NUMERIC' : 'TEXT' };
  });
}

/**
 * Busca na planilha: o código exato em alguma coluna (código de barras); senão, quem contém o
 * texto (parte do nome). Sem termo, todas as linhas. O agente faz o mesmo em `arquivos.filtrar`.
 */
export function filtrarTabela(tabela: TabelaPlanilha, termo: string | null | undefined): CelulaPlanilha[][] {
  const t = (termo ?? '').trim();
  if (!t) return tabela.linhas;
  // Só para códigos: buscar "arroz" não pode esconder "arroz integral".
  if (/\d/.test(t) && !/\s/.test(t)) {
    const exatas = tabela.linhas.filter((l) => l.some((v) => mesmoCodigo(v, t)));
    if (exatas.length) return exatas;
  }
  const minusculo = t.toLowerCase();
  return tabela.linhas.filter((l) => l.some((v) => v !== null && String(v).toLowerCase().includes(minusculo)));
}

/** Id da pasta a partir do link do Google Drive (ou do próprio id colado). */
export function pastaDriveDoLink(link: string): string {
  const t = link.trim();
  if (/^[\w-]{10,}$/.test(t)) return t;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new ErroPlanilha('Cole o link da pasta do Google Drive.');
  }
  const id = url.protocol === 'https:' && url.hostname === 'drive.google.com' ? url.pathname.match(/\/folders\/([\w-]+)/)?.[1] : undefined;
  if (!id) throw new ErroPlanilha('O link precisa ser de uma pasta: https://drive.google.com/drive/folders/…');
  return id;
}

/** Chave de conta de serviço do Google: confere o JSON e devolve o que importa. */
export function lerChaveDrive(json: string): { email: string; chavePrivada: string } {
  let k: { type?: unknown; client_email?: unknown; private_key?: unknown };
  try {
    k = JSON.parse(json);
  } catch {
    throw new ErroPlanilha('A chave do Google deve ser o arquivo JSON da conta de serviço.');
  }
  if (k?.type !== 'service_account' || typeof k.client_email !== 'string' || typeof k.private_key !== 'string') {
    throw new ErroPlanilha('Este JSON não é uma chave de conta de serviço do Google.');
  }
  return { email: k.client_email, chavePrivada: k.private_key };
}
