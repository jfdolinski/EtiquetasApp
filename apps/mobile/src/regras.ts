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
