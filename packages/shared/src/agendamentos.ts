/**
 * Agendamento de modelo de etiqueta: a cada ciclo a API executa a consulta do modelo e põe
 * na lista do dia o que ainda não foi impresso hoje; com impressão automática, já imprime.
 * O ciclo é guardado em segundos e cadastrado em segundos, minutos, horas ou dias.
 */

export type UnidadeCiclo = 'segundos' | 'minutos' | 'horas' | 'dias';

export const SEGUNDOS_POR_UNIDADE: Record<UnidadeCiclo, number> = { segundos: 1, minutos: 60, horas: 3600, dias: 86_400 };

export const ROTULO_UNIDADE: Record<UnidadeCiclo, [singular: string, plural: string]> = {
  segundos: ['segundo', 'segundos'],
  minutos: ['minuto', 'minutos'],
  horas: ['hora', 'horas'],
  dias: ['dia', 'dias'],
};

/** Menos que isso sobrecarrega o banco do ERP (cada ciclo é uma consulta via agente). */
export const INTERVALO_MINIMO_SEGUNDOS = 30;
export const INTERVALO_MAXIMO_SEGUNDOS = 366 * 86_400;

/** Maior unidade que divide o intervalo exatamente (3600 → 1 hora; 90 → 90 segundos). */
export function decomporIntervalo(segundos: number): { valor: number; unidade: UnidadeCiclo } {
  for (const unidade of ['dias', 'horas', 'minutos'] as const) {
    const s = SEGUNDOS_POR_UNIDADE[unidade];
    if (segundos >= s && segundos % s === 0) return { valor: segundos / s, unidade };
  }
  return { valor: segundos, unidade: 'segundos' };
}

export function formatarIntervalo(segundos: number): string {
  const { valor, unidade } = decomporIntervalo(segundos);
  const [um, varios] = ROTULO_UNIDADE[unidade];
  return valor === 1 ? `a cada ${um}` : `a cada ${valor} ${varios}`;
}

/**
 * Próxima execução depois de `agora`, alinhada ao início: inicio + n × intervalo. Antes do
 * início, é o próprio início. Assim um ciclo diário com início às 06:00 roda sempre às 06:00,
 * mesmo que uma execução atrase.
 */
export function proximaExecucao(inicio: Date, intervaloSegundos: number, agora: Date): Date {
  const passo = intervaloSegundos * 1000;
  if (agora.getTime() < inicio.getTime()) return new Date(inicio.getTime());
  const n = Math.floor((agora.getTime() - inicio.getTime()) / passo) + 1;
  return new Date(inicio.getTime() + n * passo);
}

/** As próximas `quantas` execuções (para a tela mostrar antes de salvar). */
export function proximasExecucoes(inicio: Date, intervaloSegundos: number, agora: Date, quantas = 3): Date[] {
  const r: Date[] = [];
  let t = new Date(agora.getTime() - 1);
  for (let i = 0; i < quantas; i++) {
    t = proximaExecucao(inicio, intervaloSegundos, new Date(t.getTime()));
    r.push(t);
  }
  return r;
}

export interface ExecucaoAgendamento {
  em: string;
  duracaoMs: number;
  /** Itens novos na lista do dia (ainda não impressos hoje). */
  itensNovos: number;
  /** Etiquetas mandadas para impressão (impressão automática). */
  etiquetas: number;
  trabalhos: number;
  /** "agendada" ou "manual" (botão Executar agora). */
  origem: 'agendada' | 'manual';
  erro?: string;
  avisos?: string[];
}

export interface AgendamentoResumo {
  id: string;
  modeloId: string;
  modeloNome: string;
  impressoraId: string | null;
  /** Impressora usada: a escolhida ou a padrão do modelo. */
  impressoraNome: string | null;
  responsavelNome: string | null;
  intervaloSegundos: number;
  inicioEm: string;
  imprimirAutomatico: boolean;
  ativo: boolean;
  proximaExecucaoEm: string | null;
  ultimaExecucaoEm: string | null;
  historico: ExecucaoAgendamento[];
  emExecucao: boolean;
}

/** Modelos (com consulta) e impressoras para o formulário de agendamento. */
export interface OpcoesAgendamento {
  modelos: { id: string; nome: string; impressoraId: string | null; naListaDiaria: boolean }[];
  impressoras: { id: string; nome: string; linguagem: string; ativo: boolean }[];
}
