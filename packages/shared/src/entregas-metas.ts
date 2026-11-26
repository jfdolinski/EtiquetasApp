import { distanciaMetros, type Ponto } from './entregas';
import { MAX_PEDIDOS_JUNTOS } from './entregas-comprovacao';
import { ordemMaisCurta } from './entregas-operacao';
import { horarioVale, momentoNoFuso } from './entregas-paradas';

/**
 * Entregas, etapa 14 (docs/ENTREGAS.md): metas com bônus e roteirização de vários pedidos.
 */

// Metas e bônus ------------------------------------------------------------------------------

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA_MS = 86_400_000;
/** Uma meta dura até um mês (semana, quinzena, mês). */
export const DIAS_MAXIMOS_META = 31;
export const MAX_CHAMADAS_META = 500;
/** R$ 2.000,00 por entregador. */
export const BONUS_MAXIMO_CENTAVOS = 200_000;
/** O app mostra as metas encerradas há até 7 dias (para ver se ganhou). */
export const DIAS_META_ENCERRADA_NO_APP = 7;

/** Horário de pico: só contam as chamadas concluídas nesses dias e horas (no fuso do sistema). */
export interface FaixaMeta {
  /** 0 = domingo … 6 = sábado. */
  dias: number[];
  inicio: string;
  fim: string;
}

export interface NovaMeta {
  nome: string;
  inicio: string;
  fim: string;
  minimoChamadas: number;
  valorCentavos: number;
  faixa: FaixaMeta | null;
}

export function problemaNaFaixa(f: FaixaMeta | null): string | null {
  if (!f) return null;
  if (!Array.isArray(f.dias) || !f.dias.length || f.dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Escolha os dias do horário de pico.';
  if (!HORA.test(f.inicio) || !HORA.test(f.fim)) return 'Use horas no formato 11:00.';
  if (f.inicio === f.fim) return 'O horário de pico precisa ter início e fim diferentes.';
  return null;
}

export function problemaNaMeta(m: NovaMeta, agora: Date): string | null {
  const nome = (m.nome ?? '').trim();
  if (nome.length < 3 || nome.length > 80) return 'Dê um nome à meta (de 3 a 80 letras).';
  const inicio = new Date(m.inicio).getTime();
  const fim = new Date(m.fim).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 'Informe o início e o fim.';
  if (fim <= inicio) return 'O fim precisa ser depois do início.';
  if (fim - inicio > DIAS_MAXIMOS_META * DIA_MS) return `A meta vale por até ${DIAS_MAXIMOS_META} dias.`;
  if (fim <= agora.getTime()) return 'O fim já passou.';
  if (inicio < agora.getTime() - DIA_MS) return 'O início pode ser no máximo ontem: chamadas antigas não entram.';
  if (inicio > agora.getTime() + 60 * DIA_MS) return 'A meta começa em até 60 dias.';
  if (!Number.isInteger(m.minimoChamadas) || m.minimoChamadas < 1 || m.minimoChamadas > MAX_CHAMADAS_META) return `A meta é de 1 a ${MAX_CHAMADAS_META} chamadas.`;
  if (!Number.isInteger(m.valorCentavos) || m.valorCentavos < 100 || m.valorCentavos > BONUS_MAXIMO_CENTAVOS) return 'O bônus vai de R$ 1,00 a R$ 2.000,00.';
  return problemaNaFaixa(m.faixa);
}

/** A chamada concluída nesse momento conta para a meta? */
export function contaNaMeta(concluidaEm: Date, meta: { inicio: Date; fim: Date; faixa: FaixaMeta | null }, fuso: string): boolean {
  if (concluidaEm < meta.inicio || concluidaEm >= meta.fim) return false;
  if (!meta.faixa) return true;
  return horarioVale({ ...meta.faixa, nome: '', percentual: 0, fixoCentavos: 0 }, momentoNoFuso(concluidaEm, fuso));
}

export type SituacaoMeta = 'AGENDADA' | 'EM_ANDAMENTO' | 'ENCERRADA' | 'CANCELADA';

export const ROTULO_SITUACAO_META: Record<SituacaoMeta, string> = {
  AGENDADA: 'Ainda não começou',
  EM_ANDAMENTO: 'Valendo',
  ENCERRADA: 'Encerrada',
  CANCELADA: 'Cancelada',
};

export function situacaoDaMeta(m: { inicio: Date | string; fim: Date | string; canceladaEm: Date | string | null }, agora: Date): SituacaoMeta {
  if (m.canceladaEm) return 'CANCELADA';
  if (new Date(m.fim) <= agora) return 'ENCERRADA';
  if (new Date(m.inicio) > agora) return 'AGENDADA';
  return 'EM_ANDAMENTO';
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "seg a sex, 11:00 às 14:00" ou "sáb e dom, 18:00 às 23:00". */
export function textoDaFaixa(f: FaixaMeta | null): string {
  if (!f) return 'qualquer horário';
  const dias = [...new Set(f.dias)].sort((a, b) => a - b);
  let d: string;
  if (dias.length === 7) d = 'todos os dias';
  else if (dias.length > 2 && dias.every((x, i) => i === 0 || x === dias[i - 1] + 1)) d = `${DIAS_CURTOS[dias[0]]} a ${DIAS_CURTOS[dias[dias.length - 1]]}`;
  else if (dias.length === 2 && dias[0] === 0 && dias[1] === 6) d = 'sáb e dom';
  else d = dias.map((x) => DIAS_CURTOS[x]).join(', ').replace(/, ([^,]+)$/, ' e $1');
  return `${d}, ${f.inicio} às ${f.fim}`;
}

export interface ParticipanteMeta {
  entregadorId: string;
  nome: string;
  feitas: number;
  atingida: boolean;
  /** O bônus já saiu num pagamento. */
  pago: boolean;
}

export interface MetaResumo {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
  minimoChamadas: number;
  valorCentavos: number;
  faixa: FaixaMeta | null;
  situacao: SituacaoMeta;
  apuradaEm: string | null;
  participantes: ParticipanteMeta[];
}

export interface MetaParaEntregador {
  id: string;
  empresa: string;
  nome: string;
  inicio: string;
  fim: string;
  minimoChamadas: number;
  valorCentavos: number;
  faixa: string;
  situacao: SituacaoMeta;
  feitas: number;
  atingida: boolean;
  /** Encerrada e apurada: o bônus já está no a receber. */
  ganhou: boolean;
}

// Roteirização -------------------------------------------------------------------------------

export const MAX_PEDIDOS_ROTEIRIZAR = 100;
export const PARADAS_POR_CHAMADA_PADRAO = 5;

export function problemaNaRoteirizacao(quantidade: number, porChamada: number): string | null {
  if (quantidade < 1) return 'Escolha os pedidos que vão sair.';
  if (quantidade > MAX_PEDIDOS_ROTEIRIZAR) return `Roteirize até ${MAX_PEDIDOS_ROTEIRIZAR} pedidos de uma vez.`;
  if (!Number.isInteger(porChamada) || porChamada < 1 || porChamada > MAX_PEDIDOS_JUNTOS) return `Cada chamada leva de 1 a ${MAX_PEDIDOS_JUNTOS} pedidos.`;
  return null;
}

/**
 * Divide os pontos em chamadas por direção a partir da base (varredura: quem fica no mesmo lado sai
 * junto) e põe cada grupo na ordem do menor caminho. Os grupos têm tamanhos parecidos, até
 * `porChamada`. Devolve os índices de `pontos`, grupo a grupo, na ordem de entrega.
 */
export function roteirizar(base: Ponto, pontos: Ponto[], porChamada: number): number[][] {
  const n = pontos.length;
  if (!n) return [];
  const escala = Math.cos((base.lat * Math.PI) / 180);
  const angulo = (p: Ponto) => Math.atan2(p.lat - base.lat, (p.lon - base.lon) * escala);
  const ordem = pontos.map((p, i) => ({ i, a: angulo(p) })).sort((x, y) => x.a - y.a || x.i - y.i);
  // Começa depois do maior vão entre direções: não junta dois lados da cidade num grupo.
  let inicio = 0;
  let maior = -1;
  for (let k = 0; k < n; k++) {
    const atual = ordem[k].a;
    const anterior = ordem[(k - 1 + n) % n].a;
    const vao = k === 0 ? atual - anterior + 2 * Math.PI : atual - anterior;
    if (vao > maior) {
      maior = vao;
      inicio = k;
    }
  }
  const circular = [...ordem.slice(inicio), ...ordem.slice(0, inicio)].map((x) => x.i);
  const grupos = Math.ceil(n / porChamada);
  const resultado: number[][] = [];
  let pos = 0;
  for (let g = 0; g < grupos; g++) {
    const tamanho = Math.floor(n / grupos) + (g < n % grupos ? 1 : 0);
    const grupo = circular.slice(pos, pos + tamanho);
    pos += tamanho;
    const seq = ordemMaisCurta(base, grupo.map((i) => pontos[i]));
    resultado.push(seq.map((k) => grupo[k]));
  }
  return resultado;
}

/** Linha reta da base pelos pontos, × 1,4 (como a estimativa sem OSRM). */
export function metrosEstimados(base: Ponto, pontos: Ponto[]): number {
  let total = 0;
  let atual = base;
  for (const p of pontos) {
    total += distanciaMetros(atual, p);
    atual = p;
  }
  return Math.round(total * 1.4);
}

export interface PedidoDoRoteiro {
  origem: 'FLOW' | 'ERP';
  id: string;
  rotulo: string;
  cliente: string;
  endereco: string;
}

export interface GrupoRoteiro {
  pedidos: PedidoDoRoteiro[];
  metrosEstimados: number;
}

export interface RoteiroProposto {
  grupos: GrupoRoteiro[];
  /** Sem ponto no mapa: não dá para roteirizar; chame um por um ou junte à mão. */
  semPonto: PedidoDoRoteiro[];
}

export interface ResultadoRoteiro {
  abertas: { id: string; numero: number; pedidos: number }[];
  erros: { pedidos: string; erro: string }[];
}
