// Entregas, etapa 10: tempo de espera pago, devolução à origem, checklist da maquininha e valor mínimo
// da plataforma. Regras puras, em centavos e minutos. O app do entregador tem cópias conferidas em
// entregas-app.test.ts.

import type { PrecoTipo, SituacaoChamada, TabelaPrecos } from './entregas-chamadas';
import { problemaNaTabelaPrecos } from './entregas-chamadas';

// Espera -------------------------------------------------------------------------------------

/** A espera é cobrada em blocos inteiros desse tamanho, depois da tolerância. */
export const ESPERA_BLOCO_MINUTOS = 10;
export const ESPERA_TOLERANCIA_PADRAO_MINUTOS = 10;

/** O que vale para a espera de uma chamada (copiado da tabela ao abrir: a regra não muda no meio). */
export interface RegraEspera {
  toleranciaMinutos: number;
  porBlocoCentavos: number;
}

export function regraDeEspera(p: Pick<PrecoTipo, 'esperaToleranciaMinutos' | 'esperaPorBlocoCentavos'>): RegraEspera {
  return { toleranciaMinutos: p.esperaToleranciaMinutos ?? ESPERA_TOLERANCIA_PADRAO_MINUTOS, porBlocoCentavos: p.esperaPorBlocoCentavos ?? 0 };
}

/** Minutos inteiros entre a chegada no ponto e a saída (coletou ou entregou). */
export function minutosNoPonto(chegada: Date | string | null, saida: Date): number {
  if (!chegada) return 0;
  return Math.max(0, Math.floor((saida.getTime() - new Date(chegada).getTime()) / 60_000));
}

/** Cada bloco completo de 10 min além da tolerância paga o valor do bloco. */
export function valorDaEspera(minutos: number, r: RegraEspera): { blocos: number; centavos: number } {
  if (r.porBlocoCentavos <= 0) return { blocos: 0, centavos: 0 };
  const blocos = Math.floor(Math.max(0, minutos - r.toleranciaMinutos) / ESPERA_BLOCO_MINUTOS);
  return { blocos, centavos: blocos * r.porBlocoCentavos };
}

// Devolução à origem -------------------------------------------------------------------------

/**
 * Trecho de volta à origem quando a entrega não deu certo: metade da base mais o km rodado na volta
 * (todo ele, sem km incluso).
 */
export function valorDaDevolucao(p: PrecoTipo, metros: number): number {
  return Math.round(p.baseCentavos / 2 + (Math.max(0, metros) / 1000) * p.porKmCentavos);
}

/** Só dá para devolver o que já foi coletado. */
export const podeDevolver = (situacaoAnterior: SituacaoChamada) => situacaoAnterior === 'COLETADA' || situacaoAnterior === 'NO_DESTINO';

export interface DevolucaoChamada {
  em: string;
  metros: number;
  valorCentavos: number;
  motivo: string;
}

// Checklist da maquininha --------------------------------------------------------------------

export const ESTADOS_MAQUINA = ['BOA', 'AVARIADA'] as const;
export type EstadoMaquina = (typeof ESTADOS_MAQUINA)[number];

export const ROTULO_ESTADO_MAQUINA: Record<EstadoMaquina, string> = { BOA: 'Em bom estado', AVARIADA: 'Com avaria' };

export interface ChecklistMaquina {
  carregador: boolean;
  bobina: boolean;
  chip: boolean;
  estado: EstadoMaquina;
  observacao: string;
}

export const ITENS_CHECKLIST: { chave: 'carregador' | 'bobina' | 'chip'; rotulo: string }[] = [
  { chave: 'carregador', rotulo: 'Carregador' },
  { chave: 'bobina', rotulo: 'Bobina' },
  { chave: 'chip', rotulo: 'Chip' },
];

export const LIMITE_OBSERVACAO_CHECKLIST = 300;

export function problemaNoChecklist(c: Partial<ChecklistMaquina> | null | undefined): string | null {
  if (!c) return 'Preencha o checklist da máquina.';
  for (const i of ITENS_CHECKLIST) if (typeof c[i.chave] !== 'boolean') return `Marque se veio ${i.rotulo.toLowerCase()}.`;
  if (!ESTADOS_MAQUINA.includes(c.estado as EstadoMaquina)) return 'Informe o estado da máquina.';
  if (c.estado === 'AVARIADA' && !(c.observacao ?? '').trim()) return 'Descreva a avaria.';
  if ((c.observacao ?? '').length > LIMITE_OBSERVACAO_CHECKLIST) return 'Observação longa demais.';
  return null;
}

export function checklistLimpo(c: ChecklistMaquina): ChecklistMaquina {
  return { carregador: c.carregador, bobina: c.bobina, chip: c.chip, estado: c.estado, observacao: (c.observacao ?? '').trim() };
}

/** Uma linha para o histórico: "carregador, chip; sem bobina; em bom estado". */
export function textoDoChecklist(c: ChecklistMaquina): string {
  const com = ITENS_CHECKLIST.filter((i) => c[i.chave]).map((i) => i.rotulo.toLowerCase());
  const sem = ITENS_CHECKLIST.filter((i) => !c[i.chave]).map((i) => i.rotulo.toLowerCase());
  return [com.length ? `com ${com.join(', ')}` : '', sem.length ? `sem ${sem.join(', ')}` : '', ROTULO_ESTADO_MAQUINA[c.estado].toLowerCase() + (c.observacao ? ` (${c.observacao})` : '')].filter(Boolean).join('; ');
}

/** Checklists guardados na chamada: na coleta e na entrega. */
export interface ChecklistsDaChamada {
  COLETA?: ChecklistMaquina;
  ENTREGA?: ChecklistMaquina;
}

// Padrões da plataforma ----------------------------------------------------------------------

export const VALOR_MINIMO_MAXIMO_CENTAVOS = 100_00;

/** Valor da chamada nunca abaixo do mínimo da plataforma (0 = sem mínimo). */
export function comMinimo(valorCentavos: number, minimoCentavos: number): number {
  return Math.max(valorCentavos, Math.max(0, minimoCentavos));
}

export function problemaNoPadraoDaPlataforma(tabela: TabelaPrecos | null, minimoCentavos: number): string | null {
  if (tabela) {
    const p = problemaNaTabelaPrecos(tabela);
    if (p) return p;
  }
  if (!Number.isInteger(minimoCentavos) || minimoCentavos < 0 || minimoCentavos > VALOR_MINIMO_MAXIMO_CENTAVOS) return 'Valor mínimo de R$ 0 a R$ 100.';
  return null;
}
