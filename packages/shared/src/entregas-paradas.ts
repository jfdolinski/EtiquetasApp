// Entregas, etapa 6: várias paradas na mesma chamada, adicionais por horário e por região e a
// grade da demanda (mapa de calor). Regras puras; valores em centavos e metros.

import { distanciaMetros, type Ponto } from './entregas';
import type { ParadaChamada, SituacaoChamada } from './entregas-chamadas';

// Várias paradas ----------------------------------------------------------------------------

/** Além do destino principal, até 9 entregas na mesma saída (só no tipo Entrega). */
export const MAX_PARADAS_EXTRAS = 9;
export const PRECO_POR_PARADA_PADRAO_CENTAVOS = 300;

/** Uma parada além da primeira, como a empresa e o entregador a veem. */
export interface ParadaExtraResumo {
  /** 1, 2, 3… (o destino principal é a 0). */
  ordem: number;
  parada: ParadaChamada;
  /** Só para a empresa, até entregar. */
  codigoConfirmacao: string | null;
  entregueEm: string | null;
  linkRastreio: string | null;
}

/** Todas as entregas da chamada, na ordem, para o app do entregador. */
export interface DestinoDoEntregador {
  ordem: number;
  parada: ParadaChamada;
  entregue: boolean;
}

export function problemaNasParadas(tipo: string, extras: ParadaChamada[] | null | undefined): string | null {
  const lista = extras ?? [];
  if (!lista.length) return null;
  if (tipo !== 'ENTREGA') return 'Várias paradas só na entrega.';
  if (lista.length > MAX_PARADAS_EXTRAS) return `No máximo ${MAX_PARADAS_EXTRAS} paradas além do destino.`;
  for (const [i, p] of lista.entries()) {
    if (!p || !(p.endereco ?? '').trim()) return `Informe o endereço da parada ${i + 2}.`;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.lat === 0 && p.lon === 0) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return `Marque a parada ${i + 2} no mapa.`;
  }
  return null;
}

/** Pontos na ordem do percurso: coleta, destino e as paradas extras. */
export function percurso(origem: Ponto, destino: Ponto, extras: Ponto[]): Ponto[] {
  return [origem, destino, ...extras];
}

/** Parada atual: entrega intermediária volta a "a caminho do destino" e passa para a próxima. */
export function aposEntregarParada(paradaAtual: number, totalDeDestinos: number): { ultima: boolean; proxima: number } {
  const ultima = paradaAtual >= totalDeDestinos - 1;
  return { ultima, proxima: ultima ? paradaAtual : paradaAtual + 1 };
}

/** Texto do destinatário de uma parada quando há várias. */
export function textoDaParada(ordem: number, paradaAtual: number, situacao: SituacaoChamada, entregue: boolean): string | null {
  if (entregue) return 'Entregue';
  if (situacao !== 'COLETADA' && situacao !== 'NO_DESTINO') return null;
  if (ordem > paradaAtual) {
    const antes = ordem - paradaAtual;
    return `Saiu para entrega: ${antes === 1 ? 'uma entrega' : `${antes} entregas`} antes da sua`;
  }
  return null;
}

// Adicionais --------------------------------------------------------------------------------

export interface AdicionalHorario {
  nome: string;
  /** 0 = domingo … 6 = sábado. */
  dias: number[];
  /** HH:MM; fim menor que o início passa da meia-noite (22:00–06:00). */
  inicio: string;
  fim: string;
  /** Sobre o valor da tabela (base + km + paradas). */
  percentual: number;
  fixoCentavos: number;
}

export interface AdicionalRegiao {
  nome: string;
  centro: Ponto;
  raioKm: number;
  percentual: number;
  fixoCentavos: number;
}

export interface Adicionais {
  horarios: AdicionalHorario[];
  regioes: AdicionalRegiao[];
}

export const ADICIONAIS_VAZIOS: Adicionais = { horarios: [], regioes: [] };
export const MAX_ADICIONAIS = 20;

export interface AdicionalAplicado {
  nome: string;
  centavos: number;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function adicionaisVigentes(g: unknown): Adicionais {
  const a = g && typeof g === 'object' ? (g as Partial<Adicionais>) : {};
  return { horarios: Array.isArray(a.horarios) ? a.horarios : [], regioes: Array.isArray(a.regioes) ? a.regioes : [] };
}

export function problemaNosAdicionais(a: Adicionais): string | null {
  if (a.horarios.length + a.regioes.length > MAX_ADICIONAIS) return `No máximo ${MAX_ADICIONAIS} adicionais.`;
  const valores = (x: { nome: string; percentual: number; fixoCentavos: number }) => {
    if (!(x.nome ?? '').trim()) return 'Dê um nome a cada adicional.';
    if (!Number.isFinite(x.percentual) || x.percentual < 0 || x.percentual > 200) return `O percentual de "${x.nome}" vai de 0 a 200.`;
    if (!Number.isInteger(x.fixoCentavos) || x.fixoCentavos < 0 || x.fixoCentavos > 100_000) return `O valor fixo de "${x.nome}" vai até R$ 1.000,00.`;
    if (!x.percentual && !x.fixoCentavos) return `"${x.nome}" não soma nada: informe percentual ou valor fixo.`;
    return null;
  };
  for (const h of a.horarios) {
    const p = valores(h);
    if (p) return p;
    if (!Array.isArray(h.dias) || !h.dias.length || h.dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return `Escolha os dias de "${h.nome}".`;
    if (!HORA.test(h.inicio) || !HORA.test(h.fim) || h.inicio === h.fim) return `Horário inválido em "${h.nome}".`;
  }
  for (const r of a.regioes) {
    const p = valores(r);
    if (p) return p;
    if (!r.centro || !Number.isFinite(r.centro.lat) || !Number.isFinite(r.centro.lon)) return `Marque o centro de "${r.nome}" no mapa.`;
    if (!Number.isFinite(r.raioKm) || r.raioKm <= 0 || r.raioKm > 50) return `O raio de "${r.nome}" vai até 50 km.`;
  }
  return null;
}

/** Dia da semana e HH:MM no fuso do sistema. */
export function momentoNoFuso(agora: Date, fuso: string): { dia: number; hhmm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(agora).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dia, hhmm: `${p.hour}:${p.minute}` };
}

/** Vale no horário? Faixa que passa da meia-noite conta o dia em que começou. */
export function horarioVale(h: AdicionalHorario, m: { dia: number; hhmm: string }): boolean {
  if (h.inicio < h.fim) return h.dias.includes(m.dia) && m.hhmm >= h.inicio && m.hhmm < h.fim;
  if (m.hhmm >= h.inicio) return h.dias.includes(m.dia);
  return m.hhmm < h.fim && h.dias.includes((m.dia + 6) % 7);
}

/**
 * O que soma ao valor da tabela, com o nome de cada um (o entregador vê o total; a empresa, o detalhe).
 * Região vale se algum ponto de entrega cair dentro dela; cada adicional conta uma vez.
 */
export function adicionaisQueValem(a: Adicionais, valorTabela: number, m: { dia: number; hhmm: string }, pontosCliente: Ponto[]): AdicionalAplicado[] {
  const soma = (x: { nome: string; percentual: number; fixoCentavos: number }) => ({ nome: x.nome, centavos: Math.round((valorTabela * x.percentual) / 100) + x.fixoCentavos });
  return [
    ...a.horarios.filter((h) => horarioVale(h, m)).map(soma),
    ...a.regioes.filter((r) => pontosCliente.some((p) => distanciaMetros(p, r.centro) <= r.raioKm * 1000)).map(soma),
  ].filter((x) => x.centavos > 0);
}

export const totalDosAdicionais = (l: AdicionalAplicado[]) => l.reduce((s, x) => s + x.centavos, 0);

// Demanda (mapa de calor) -------------------------------------------------------------------

/** Lado da célula em graus (~550 m no Brasil): fino para ver bairros, grosso para não expor endereço. */
export const CELULA_DEMANDA_GRAUS = 0.005;

export interface CelulaDemanda {
  lat: number;
  lon: number;
  quantidade: number;
}

export interface DemandaEntregas {
  dias: number;
  total: number;
  celulas: CelulaDemanda[];
  /** Chamadas por hora do dia (0–23) e por dia da semana (0 = domingo), no fuso do sistema. */
  porHora: number[];
  porDia: number[];
}

/** Junta os pontos em células e devolve o centro de cada uma, da mais cheia para a menos. */
export function gradeDeDemanda(pontos: Ponto[], lado = CELULA_DEMANDA_GRAUS): CelulaDemanda[] {
  const mapa = new Map<string, CelulaDemanda>();
  for (const p of pontos) {
    const i = Math.floor(p.lat / lado);
    const j = Math.floor(p.lon / lado);
    const k = `${i}:${j}`;
    const c = mapa.get(k);
    if (c) c.quantidade++;
    else mapa.set(k, { lat: Number(((i + 0.5) * lado).toFixed(6)), lon: Number(((j + 0.5) * lado).toFixed(6)), quantidade: 1 });
  }
  return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
}
