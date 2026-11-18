// Entregas, etapa 3: direcionamento automático (docs/ENTREGAS.md, "Direcionamento").
// Três passos, nesta ordem: quem pode receber (filtros), em que ordem (pontos) e como oferecer
// (um por vez ou em grupo). Regras puras; a API junta os dados e grava o motivo de cada oferta.

import { formatarKm, TIPOS_CHAMADA, type TipoChamada } from './entregas-chamadas';
import { ROTULO_VEICULO, TIPOS_VEICULO, type TipoVeiculo } from './entregas';

export const MODOS_OFERTA = ['SEQUENCIA', 'GRUPO'] as const;
export type ModoOferta = (typeof MODOS_OFERTA)[number];

export const ROTULO_MODO_OFERTA: Record<ModoOferta, string> = {
  SEQUENCIA: 'Um por vez, do melhor para o próximo',
  GRUPO: 'Para vários ao mesmo tempo, fica com quem aceitar primeiro',
};

export const CRITERIOS = ['proximidade', 'tempoLivre', 'aceite', 'avaliacao', 'preferido'] as const;
export type Criterio = (typeof CRITERIOS)[number];

export const ROTULO_CRITERIO: Record<Criterio, string> = {
  proximidade: 'Proximidade da coleta',
  tempoLivre: 'Tempo sem chamada',
  aceite: 'Taxa de aceite (30 dias)',
  avaliacao: 'Avaliação',
  preferido: 'Preferido da empresa',
};

export type Pesos = Record<Criterio, number>;

export interface RegrasDirecionamento {
  /** Chamada nova já vai para a distribuição (a tela pode desligar em cada chamada). */
  automatico: boolean;
  modo: ModoOferta;
  /** No modo em grupo: quantos recebem ao mesmo tempo. */
  tamanhoGrupo: number;
  /** Raio inicial até a coleta, em linha reta. */
  raioKm: number;
  /** Ofertas (ou grupos) por rodada antes de esperar. */
  maxTentativas: number;
  /** Esgotada a rodada sem aceite, espera isso e tenta de novo com o raio maior. */
  minutosNovaTentativa: number;
  ampliarRaioKm: number;
  raioLimiteKm: number;
  pesos: Pesos;
  /** Preferidos primeiro (entre eles pelos mesmos pesos), depois os demais. */
  preferidosPrimeiro: boolean;
  /** Só os preferidos recebem. */
  somentePreferidos: boolean;
  /** Veículos aceitos por tipo de serviço. */
  veiculos: Record<TipoChamada, TipoVeiculo[]>;
}

export const PESOS_PADRAO: Pesos = { proximidade: 50, tempoLivre: 25, aceite: 10, avaliacao: 10, preferido: 5 };

export const REGRAS_DIRECIONAMENTO_PADRAO: RegrasDirecionamento = {
  automatico: false,
  modo: 'SEQUENCIA',
  tamanhoGrupo: 3,
  raioKm: 8,
  maxTentativas: 5,
  minutosNovaTentativa: 2,
  ampliarRaioKm: 2,
  raioLimiteKm: 15,
  pesos: PESOS_PADRAO,
  preferidosPrimeiro: false,
  somentePreferidos: false,
  veiculos: { ENTREGA: [...TIPOS_VEICULO], COLETA: [...TIPOS_VEICULO], DEVOLUCAO_MAQUINA: [...TIPOS_VEICULO] },
};

export const LIMITES_DIRECIONAMENTO = {
  tamanhoGrupo: { minimo: 2, maximo: 10 },
  raioKm: { minimo: 1, maximo: 100 },
  maxTentativas: { minimo: 1, maximo: 20 },
  minutosNovaTentativa: { minimo: 1, maximo: 60 },
  ampliarRaioKm: { minimo: 0, maximo: 50 },
} as const;

/** Sem histórico ou sem avaliação, a nota é esta: quem é novo não começa no fim da fila. */
export const NOTA_SEM_HISTORICO = 0.8;
/** Livre há uma hora já tem a nota máxima em tempo sem chamada. */
export const MINUTOS_LIVRE_NOTA_MAXIMA = 60;

/** O que está gravado (pode ser parcial ou antigo) com o padrão por baixo. */
export function regrasVigentes(gravadas: unknown): RegrasDirecionamento {
  // Só as chaves conhecidas, cada uma do tipo certo: o resto fica com o padrão.
  const g = gravadas && typeof gravadas === 'object' ? (gravadas as Record<string, unknown>) : {};
  const p = REGRAS_DIRECIONAMENTO_PADRAO;
  const num = <K extends keyof RegrasDirecionamento>(k: K) => (typeof g[k] === 'number' && Number.isFinite(g[k]) ? (g[k] as number) : (p[k] as number));
  const bool = <K extends keyof RegrasDirecionamento>(k: K) => (typeof g[k] === 'boolean' ? (g[k] as boolean) : (p[k] as boolean));
  const pesosG = (g.pesos && typeof g.pesos === 'object' ? g.pesos : {}) as Record<string, unknown>;
  const pesos = Object.fromEntries(CRITERIOS.map((c) => [c, typeof pesosG[c] === 'number' ? pesosG[c] : p.pesos[c]])) as Pesos;
  const veiculosG = (g.veiculos && typeof g.veiculos === 'object' ? g.veiculos : {}) as Record<string, unknown>;
  const veiculos = { ...p.veiculos };
  for (const t of TIPOS_CHAMADA) {
    const lista = veiculosG[t];
    if (Array.isArray(lista)) veiculos[t] = TIPOS_VEICULO.filter((v) => lista.includes(v));
  }
  return {
    automatico: bool('automatico'),
    modo: MODOS_OFERTA.includes(g.modo as ModoOferta) ? (g.modo as ModoOferta) : p.modo,
    tamanhoGrupo: num('tamanhoGrupo'),
    raioKm: num('raioKm'),
    maxTentativas: num('maxTentativas'),
    minutosNovaTentativa: num('minutosNovaTentativa'),
    ampliarRaioKm: num('ampliarRaioKm'),
    raioLimiteKm: num('raioLimiteKm'),
    pesos,
    preferidosPrimeiro: bool('preferidosPrimeiro'),
    somentePreferidos: bool('somentePreferidos'),
    veiculos,
  };
}

const inteiroEntre = (n: number, l: { minimo: number; maximo: number }) => Number.isInteger(n) && n >= l.minimo && n <= l.maximo;

export function problemaNasRegras(r: RegrasDirecionamento): string | null {
  if (!MODOS_OFERTA.includes(r.modo)) return 'Escolha como oferecer.';
  if (r.modo === 'GRUPO' && !inteiroEntre(r.tamanhoGrupo, LIMITES_DIRECIONAMENTO.tamanhoGrupo)) return 'O grupo vai de 2 a 10 entregadores.';
  if (!inteiroEntre(r.raioKm, LIMITES_DIRECIONAMENTO.raioKm)) return 'O raio inicial vai de 1 a 100 km.';
  if (!inteiroEntre(r.raioLimiteKm, LIMITES_DIRECIONAMENTO.raioKm) || r.raioLimiteKm < r.raioKm) return 'O raio limite vai até 100 km e não pode ser menor que o inicial.';
  if (!inteiroEntre(r.ampliarRaioKm, LIMITES_DIRECIONAMENTO.ampliarRaioKm)) return 'Ampliar o raio vai de 0 a 50 km.';
  if (!inteiroEntre(r.maxTentativas, LIMITES_DIRECIONAMENTO.maxTentativas)) return 'As tentativas por rodada vão de 1 a 20.';
  if (!inteiroEntre(r.minutosNovaTentativa, LIMITES_DIRECIONAMENTO.minutosNovaTentativa)) return 'A nova tentativa vai de 1 a 60 minutos.';
  for (const c of CRITERIOS) {
    const peso = r.pesos?.[c];
    if (!Number.isInteger(peso) || peso < 0 || peso > 100) return `O peso de "${ROTULO_CRITERIO[c]}" vai de 0 a 100.`;
  }
  const soma = somaDosPesos(r.pesos);
  if (soma !== 100) return `Os pesos somam ${soma}; precisam somar 100.`;
  for (const t of TIPOS_CHAMADA) {
    const lista = r.veiculos?.[t] ?? [];
    if (!lista.length) return 'Cada serviço precisa aceitar ao menos um veículo.';
    if (lista.some((v) => !TIPOS_VEICULO.includes(v))) return 'Veículo inválido.';
  }
  return null;
}

export function somaDosPesos(p: Pesos): number {
  return CRITERIOS.reduce((s, c) => s + (Number(p?.[c]) || 0), 0);
}

/** Raio da rodada: começa no inicial e cresce a cada rodada sem aceite, até o limite. */
export function raioDaRodada(r: RegrasDirecionamento, rodada: number): number {
  return Math.min(r.raioKm + r.ampliarRaioKm * Math.max(0, rodada), r.raioLimiteKm);
}

// Candidatos ---------------------------------------------------------------------------------

/** O que a API junta de cada entregador que passou nos filtros do banco (aprovado, online, com sinal, livre). */
export interface CandidatoDirecionamento {
  id: string;
  nome: string;
  veiculo: TipoVeiculo;
  /** Linha reta até a coleta. */
  metrosAteColeta: number;
  /** Desde a última chamada terminada (ou desde que ficou online), em minutos. */
  minutosLivre: number;
  /** Ofertas respondidas ou expiradas nos últimos 30 dias (as canceladas não contam). */
  ofertadas30d: number;
  aceitas30d: number;
  /** Média de 1 a 5; null = sem avaliação. */
  avaliacao: number | null;
  preferido: boolean;
  bloqueado: boolean;
  /** Já recebeu esta chamada (recusou, deixou expirar ou estava no grupo). */
  jaOfertado: boolean;
}

export type Notas = Record<Criterio, number>;

export interface Classificado {
  id: string;
  nome: string;
  veiculo: TipoVeiculo;
  metrosAteColeta: number;
  minutosLivre: number;
  preferido: boolean;
  notas: Notas;
  /** De 0 a 100. */
  pontos: number;
  posicao: number;
  total: number;
}

export interface Descartado {
  id: string;
  nome: string;
  motivo: string;
}

export interface ResultadoClassificacao {
  raioKm: number;
  classificados: Classificado[];
  descartados: Descartado[];
}

const limitar = (n: number) => Math.min(1, Math.max(0, n));

export function notasDoCandidato(c: CandidatoDirecionamento, raioKm: number): Notas {
  return {
    proximidade: limitar(1 - c.metrosAteColeta / (raioKm * 1000)),
    tempoLivre: limitar(c.minutosLivre / MINUTOS_LIVRE_NOTA_MAXIMA),
    aceite: c.ofertadas30d > 0 ? limitar(c.aceitas30d / c.ofertadas30d) : NOTA_SEM_HISTORICO,
    avaliacao: c.avaliacao == null ? NOTA_SEM_HISTORICO : limitar((c.avaliacao - 1) / 4),
    preferido: c.preferido ? 1 : 0,
  };
}

export function pontosDasNotas(n: Notas, p: Pesos): number {
  return Math.round(CRITERIOS.reduce((s, c) => s + n[c] * p[c], 0) * 10) / 10;
}

/** Por que ficou de fora: a primeira regra que não cumpre. */
export function motivoDeFora(c: CandidatoDirecionamento, r: RegrasDirecionamento, tipo: TipoChamada, raioKm: number): string | null {
  if (c.bloqueado) return 'bloqueado pela empresa';
  if (r.somentePreferidos && !c.preferido) return 'não é preferido';
  if (!r.veiculos[tipo].includes(c.veiculo)) return `${ROTULO_VEICULO[c.veiculo].toLowerCase()} não atende este serviço`;
  if (c.metrosAteColeta > raioKm * 1000) return `a ${formatarKm(c.metrosAteColeta)}, fora do raio de ${raioKm} km`;
  if (c.jaOfertado) return 'já recebeu esta chamada';
  return null;
}

/** Filtra e ordena. Empate: quem está livre há mais tempo, depois o mais perto. */
export function classificar(candidatos: CandidatoDirecionamento[], r: RegrasDirecionamento, tipo: TipoChamada, raioKm: number): ResultadoClassificacao {
  const descartados: Descartado[] = [];
  const dentro: Omit<Classificado, 'posicao' | 'total'>[] = [];
  for (const c of candidatos) {
    const fora = motivoDeFora(c, r, tipo, raioKm);
    if (fora) {
      descartados.push({ id: c.id, nome: c.nome, motivo: fora });
      continue;
    }
    const notas = notasDoCandidato(c, raioKm);
    dentro.push({ id: c.id, nome: c.nome, veiculo: c.veiculo, metrosAteColeta: c.metrosAteColeta, minutosLivre: c.minutosLivre, preferido: c.preferido, notas, pontos: pontosDasNotas(notas, r.pesos) });
  }
  dentro.sort((a, b) => {
    if (r.preferidosPrimeiro && a.preferido !== b.preferido) return a.preferido ? -1 : 1;
    return b.pontos - a.pontos || b.minutosLivre - a.minutosLivre || a.metrosAteColeta - b.metrosAteColeta;
  });
  const total = dentro.length;
  return { raioKm, classificados: dentro.map((c, i) => ({ ...c, posicao: i + 1, total })), descartados };
}

/** Quantos recebem a próxima oferta. */
export function quantosOferecer(r: RegrasDirecionamento): number {
  return r.modo === 'GRUPO' ? r.tamanhoGrupo : 1;
}

/** O porquê gravado na oferta e mostrado à empresa ("1,2 km, 40 min livre… → 1º de 5"). */
export interface MotivoOferta {
  automatica: boolean;
  posicao: number;
  total: number;
  pontos: number;
  metrosAteColeta: number;
  minutosLivre: number;
  notas: Notas;
  pesos: Pesos;
  preferido: boolean;
  raioKm: number;
  rodada: number;
}

export function motivoDaOferta(c: Classificado, r: RegrasDirecionamento, rodada: number, raioKm: number): MotivoOferta {
  return { automatica: true, posicao: c.posicao, total: c.total, pontos: c.pontos, metrosAteColeta: c.metrosAteColeta, minutosLivre: c.minutosLivre, notas: c.notas, pesos: r.pesos, preferido: c.preferido, raioKm, rodada };
}

const minutos = (m: number) => (m >= 120 ? `${Math.floor(m / 60)} h livre` : `${Math.round(m)} min livre`);

export function textoDoMotivo(m: MotivoOferta): string {
  const partes = [formatarKm(m.metrosAteColeta), minutos(m.minutosLivre), `aceite ${Math.round(m.notas.aceite * 100)}%`];
  if (m.preferido) partes.push('preferido');
  return `${partes.join(', ')} → ${m.posicao}º de ${m.total} (${m.pontos.toLocaleString('pt-BR')} pontos)`;
}

/** O que o entregador vê: só a posição dele e o critério que mais pesou. */
export function motivoParaEntregador(m: MotivoOferta): string {
  const maior = CRITERIOS.filter((c) => c !== 'preferido' || m.preferido).reduce((a, c) => (m.notas[c] * m.pesos[c] > m.notas[a] * m.pesos[a] ? c : a), 'proximidade' as Criterio);
  const porque: Record<Criterio, string> = {
    proximidade: `você está a ${formatarKm(m.metrosAteColeta)} da coleta`,
    tempoLivre: 'você está há mais tempo sem chamada',
    aceite: 'sua taxa de aceite',
    avaliacao: 'sua avaliação',
    preferido: 'você é preferido desta empresa',
  };
  return `Você foi o ${m.posicao}º de ${m.total}: ${porque[maior]}.`;
}

// Contratos ------------------------------------------------------------------------------------

export interface DistribuicaoResumo {
  ativa: boolean;
  rodada: number;
  tentativas: number;
  raioKm: number;
  proximaTentativaEm: string | null;
  /** Desde quando ninguém aceitou ou não havia ninguém (para o aviso). */
  semEntregadorDesde: string | null;
}

export interface OfertaDaChamada {
  entregadorNome: string;
  resultado: 'PENDENTE' | 'ACEITA' | 'RECUSADA' | 'EXPIRADA' | 'CANCELADA' | 'DESISTIU';
  expiraEm: string;
  criadoEm: string;
  /** Texto do porquê, quando a distribuição escolheu. */
  motivo: string | null;
}

export interface EntregadorDaEmpresa {
  id: string;
  nome: string;
  veiculo: TipoVeiculo;
  preferido: boolean;
  bloqueado: boolean;
  concluidas: number;
  ultimaEm: string | null;
  /** Média de todas as empresas nos últimos 90 dias (a mesma da distribuição). */
  avaliacaoMedia: number | null;
}

export interface Simulacao extends ResultadoClassificacao {
  regras: RegrasDirecionamento;
}
