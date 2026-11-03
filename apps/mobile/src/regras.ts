/** Regras puras do aplicativo, sem nada de React Native: rodam nos testes com Node. */

export interface DadosVinculo {
  servidor: string;
  codigo: string;
}

/** Só HTTPS: o token do aparelho não viaja aberto. HTTP apenas no ambiente de desenvolvimento. */
export function servidorValido(endereco: string, aceitarHttp = false): string | null {
  let u: URL;
  try {
    u = new URL(endereco.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(aceitarHttp && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  return u.origin;
}

export function codigoValido(codigo: string): string | null {
  const limpo = codigo.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{10}$/.test(limpo) ? limpo : null;
}

/** Lê etiquetas://vincular?servidor=...&codigo=... do QR code. Qualquer outra coisa é null. */
export function lerQrDeVinculo(texto: string, aceitarHttp = false): DadosVinculo | null {
  const m = /^etiquetas:\/\/vincular\?(.+)$/.exec(texto.trim());
  if (!m) return null;
  const p = new URLSearchParams(m[1]);
  const servidor = servidorValido(p.get('servidor') ?? '', aceitarHttp);
  const codigo = codigoValido(p.get('codigo') ?? '');
  return servidor && codigo ? { servidor, codigo } : null;
}

/** "1.2.10" é mais nova que "1.2.9"; formato estranho nunca é mais nova. */
export function versaoMaisNova(candidata: string, atual: string): boolean {
  const partes = (v: string) => v.trim().split('.').map(Number);
  const a = partes(candidata);
  const b = partes(atual);
  if ([...a, ...b].some((n) => !Number.isInteger(n) || n < 0)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function tempoDesde(iso: string | null, agora = Date.now()): string {
  if (!iso) return 'nunca';
  const min = Math.floor((agora - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

export function quantidadeValida(texto: string): number | null {
  if (!/^\d{1,5}$/.test(texto.trim())) return null;
  const n = Number(texto);
  return n >= 1 ? n : null;
}

interface ItemSimples {
  id: string;
  modeloId: string;
  impressoraId: string | null;
  status: string;
}

/** Só os pendentes, agrupados por modelo, na ordem em que os modelos aparecem. */
export function pendentesPorModelo<T extends ItemSimples>(itens: readonly T[], nomes: readonly { id: string; nome: string }[]) {
  const grupos = new Map<string, { modeloId: string; nome: string; itens: T[] }>();
  for (const item of itens) {
    if (item.status !== 'PENDENTE') continue;
    let g = grupos.get(item.modeloId);
    if (!g) {
      g = { modeloId: item.modeloId, nome: nomes.find((m) => m.id === item.modeloId)?.nome ?? 'Modelo', itens: [] };
      grupos.set(item.modeloId, g);
    }
    g.itens.push(item);
  }
  return [...grupos.values()];
}

/** Notificações que apareceram desde a última olhada (ou repetiram). A primeira carga não avisa. */
export function avisosNovos<T extends { id: string; vezes: number; resolvidaEm: string | null }>(atuais: readonly T[], vistos: ReadonlySet<string> | null): T[] {
  if (vistos === null) return [];
  return atuais.filter((n) => !n.resolvidaEm && !vistos.has(`${n.id}:${n.vezes}`));
}

export function chavesDosAvisos(atuais: readonly { id: string; vezes: number }[]): Set<string> {
  return new Set(atuais.map((n) => `${n.id}:${n.vezes}`));
}

export type Registro = Record<string, unknown>;

export interface LinhaAvulsa {
  id: string;
  registro: Registro;
  quantidade: number;
}

export interface ImpressoraApp {
  id: string;
  nome: string;
  linguagem: string;
}

export function textoCelula(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Todas as colunas: primeiro as do modelo, na ordem dele, depois as que só os registros trazem. */
export function colunasVisiveis(doModelo: readonly string[], registros: readonly Registro[]): string[] {
  return [...new Set([...doModelo, ...registros.flatMap((r) => Object.keys(r))])];
}

/** O mesmo intervalo do site: trocar de guia ou voltar ao app não vira exibição nova para o anunciante. */
export const INTERVALO_EXIBICAO_MS = 10 * 60_000;

export function contaExibicao(ultima: number | undefined, agora: number): boolean {
  return ultima === undefined || agora - ultima >= INTERVALO_EXIBICAO_MS;
}

/** O servidor já recusa outros endereços; aqui é a segunda trava antes de abrir fora do app. */
export function linkDeBannerValido(link: string | null): link is string {
  return !!link && /^https?:\/\/\S+$/i.test(link);
}

/** Em qual {param.*} vai o valor buscado; os outros seguem nulos. Mesma regra do site (shared/avulsa.ts). */
export function parametrosDaBusca(parametros: readonly string[], valor: string): Record<string, string | null> {
  const alvo = parametros.find((p) => p === 'busca') ?? parametros.find((p) => /ean|gtin|barra|codbar/i.test(p)) ?? parametros.find((p) => /cod/i.test(p)) ?? parametros[0];
  return Object.fromEntries(parametros.map((p) => [p, p === alvo ? valor : null]));
}

function mesmoCodigo(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    const t = textoCelula(v).trim().toLowerCase();
    return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
  };
  return norm(a) !== '' && norm(a) === norm(b);
}

const simplificar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Código igual ganha de parecido, e nome vale pelas palavras. O que não tem relação com o termo
 * não é resultado: vazio significa "produto não encontrado". Um registro só é aceito mesmo sem o
 * termo: a consulta pode ter achado por uma coluna que não devolve. Mesma regra do site (shared/avulsa.ts).
 */
export function registrosDoCodigo<T extends Registro>(registros: readonly T[], valor: string): T[] {
  const iguais = registros.filter((r) => Object.values(r).some((v) => mesmoCodigo(v, valor)));
  if (iguais.length) return iguais;
  const palavras = simplificar(valor.trim()).split(/\s+/).filter(Boolean);
  const comPalavras = registros.filter((r) => {
    const texto = Object.values(r).map((v) => simplificar(textoCelula(v))).join(' ');
    return palavras.length > 0 && palavras.every((p) => texto.includes(p));
  });
  if (comPalavras.length) return comPalavras;
  return registros.length === 1 ? [...registros] : [];
}

/** Linha em branco para digitar o produto não encontrado: o que foi buscado já entra na coluna do código. */
export function registroParaDigitar(campos: readonly string[], termo: string): Registro {
  const colunas = campos.length ? campos : ['codigo', 'descricao'];
  const doCodigo = colunas.find((c) => /ean|gtin|barra|codbar/i.test(c)) ?? colunas.find((c) => /^cod|codigo|código|sku|^id$/i.test(c)) ?? colunas[0];
  return Object.fromEntries(colunas.map((c) => [c, c === doCodigo ? termo : '']));
}

/** O mesmo produto lido de novo soma uma etiqueta em vez de repetir a linha. */
export function adicionarProduto(linhas: readonly LinhaAvulsa[], registro: Registro, novoId: () => string): { linhas: LinhaAvulsa[]; repetida: LinhaAvulsa | null } {
  const igual = linhas.find((l) => JSON.stringify(l.registro) === JSON.stringify(registro));
  if (igual) return { linhas: linhas.map((l) => (l === igual ? { ...l, quantidade: l.quantidade + 1 } : l)), repetida: igual };
  return { linhas: [{ id: novoId(), registro, quantidade: 1 }, ...linhas], repetida: null };
}

/** Com parâmetro, a consulta filtra; sem, o servidor lê as linhas e procura o termo nelas. */
export function corpoDaBusca(modeloId: string, parametros: readonly string[], termo: string) {
  return parametros.length ? { modeloId, parametros: parametrosDaBusca(parametros, termo) } : { modeloId, parametros: {}, termo };
}

/** A escolhida à mão, se ainda existir; senão a padrão do modelo; senão, havendo só uma, ela. */
export function impressoraDoModelo(escolhida: string | null, padrao: string | null, disponiveis: readonly Pick<ImpressoraApp, 'id'>[]): string | null {
  for (const id of [escolhida, padrao]) if (id && disponiveis.some((i) => i.id === id)) return id;
  return disponiveis.length === 1 ? disponiveis[0].id : null;
}
