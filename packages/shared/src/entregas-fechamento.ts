// Entregas, etapa 4: fechamento (o que a empresa deve e pagou a cada entregador), contestação,
// avaliação e chamada a partir de um Pedido. O Flow só calcula e registra: o pagamento é feito
// pela empresa, fora do sistema (Pix para a chave do entregador).

import { textoEndereco, type EnderecoPedido, type ModalidadeEntrega, type SituacaoPedido } from './pedidos';
import type { ParadaChamada, TipoChamada } from './entregas-chamadas';
import type { TipoVeiculo } from './entregas';

/** O que a empresa deve pela chamada: o valor aceito mais o extra lançado depois (espera, volta). */
export function totalDaChamada(c: { valorCentavos: number; extraCentavos: number }): number {
  return c.valorCentavos + c.extraCentavos;
}

export const LIMITE_EXTRA_CENTAVOS = 100_000;
/** O entregador contesta uma chamada concluída até esse tempo depois. */
export const DIAS_PARA_CONTESTAR = 60;
export const LIMITE_TEXTO_CONTESTACAO = 500;
export const LIMITE_COMENTARIO_AVALIACAO = 300;

export function problemaNoExtra(centavos: number, motivo: string): string | null {
  if (!Number.isInteger(centavos) || centavos < 0 || centavos > LIMITE_EXTRA_CENTAVOS) return 'O extra vai de R$ 0,00 a R$ 1.000,00.';
  if (centavos > 0 && (motivo ?? '').trim().length < 3) return 'Diga o motivo do extra (espera, volta, pedágio…).';
  return null;
}

export function problemaNaAvaliacao(nota: number, comentario: string): string | null {
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return 'A nota vai de 1 a 5.';
  if ((comentario ?? '').length > LIMITE_COMENTARIO_AVALIACAO) return `O comentário vai até ${LIMITE_COMENTARIO_AVALIACAO} letras.`;
  return null;
}

export function podeContestar(concluidaEm: Date | string | null, agora: Date): boolean {
  if (!concluidaEm) return false;
  return agora.getTime() - new Date(concluidaEm).getTime() <= DIAS_PARA_CONTESTAR * 86_400_000;
}

// Extrato do entregador -----------------------------------------------------------------------

export const PERIODOS_EXTRATO = ['HOJE', 'SEMANA', 'MES', 'TUDO'] as const;
export type PeriodoExtrato = (typeof PERIODOS_EXTRATO)[number];

export const ROTULO_PERIODO_EXTRATO: Record<PeriodoExtrato, string> = { HOJE: 'Hoje', SEMANA: '7 dias', MES: '30 dias', TUDO: 'Tudo' };

/**
 * Desde quando conta o período. "Hoje" começa à meia-noite do fuso do sistema (`hoje` em AAAA-MM-DD
 * e o deslocamento do fuso em minutos, como `diaNoFuso` calcula); os outros contam para trás.
 */
export function inicioDoPeriodo(p: PeriodoExtrato, agora: Date, hoje: string, minutosDoFuso: number): Date | null {
  if (p === 'TUDO') return null;
  if (p === 'HOJE') return new Date(Date.parse(`${hoje}T00:00:00Z`) - minutosDoFuso * 60_000);
  return new Date(agora.getTime() - (p === 'SEMANA' ? 7 : 30) * 86_400_000);
}

export type SituacaoFinanceira = 'A_RECEBER' | 'PAGO';

export interface ContestacaoResumo {
  id: string;
  mensagem: string;
  criadoEm: string;
  resposta: string | null;
  respondidaEm: string | null;
}

export interface LinhaExtrato {
  chamadaId: string;
  numero: number;
  empresa: string;
  tipo: TipoChamada;
  concluidaEm: string;
  metros: number;
  valorCentavos: number;
  extraCentavos: number;
  extraMotivo: string;
  situacao: SituacaoFinanceira;
  pagoEm: string | null;
  /** Cancelada depois do aceite: o valor é a taxa de deslocamento. */
  cancelada: boolean;
  contestacao: ContestacaoResumo | null;
  podeContestar: boolean;
}

export interface ExtratoEntregador {
  periodo: PeriodoExtrato;
  /** Concluídas no período (valor + extras). */
  periodoCentavos: number;
  /** Tudo o que ainda não foi pago, de qualquer período. */
  aReceberCentavos: number;
  /** Pago no período. */
  pagoCentavos: number;
  empresas: string[];
  linhas: LinhaExtrato[];
}

export interface ReputacaoEntregador {
  /** Média das avaliações dos últimos 90 dias; nula sem nenhuma. */
  avaliacaoMedia: number | null;
  avaliacoes: number;
  /** Aceitas ÷ (aceitas + recusadas + expiradas) dos últimos 30 dias; nula sem ofertas. */
  taxaAceite: number | null;
  ofertas30d: number;
}

/** Janela da média que entra no direcionamento e no perfil. */
export const DIAS_MEDIA_AVALIACAO = 90;

// Fechamento na empresa -----------------------------------------------------------------------

export interface LinhaFechamento {
  chamadaId: string;
  numero: number;
  tipo: TipoChamada;
  concluidaEm: string;
  destino: string;
  valorCentavos: number;
  extraCentavos: number;
  extraMotivo: string;
  contestacaoAberta: boolean;
  cancelada: boolean;
}

export interface APagarEntregador {
  entregador: { id: string; nome: string; veiculo: TipoVeiculo; chavePix: string };
  quantidade: number;
  totalCentavos: number;
  maisAntiga: string;
  contestacoesAbertas: number;
}

export interface FechamentoResumo {
  id: string;
  entregadorNome: string;
  entregadorId: string;
  pagoEm: string;
  quantidade: number;
  totalCentavos: number;
  observacao: string;
  temComprovante: boolean;
  criadoPorNome: string | null;
  criadoEm: string;
  chamadas?: LinhaFechamento[];
}

export interface ContestacaoEmpresa extends ContestacaoResumo {
  chamadaId: string;
  numero: number;
  entregadorNome: string;
  totalCentavos: number;
  pago: boolean;
}

export interface NovoFechamento {
  entregadorId: string;
  chamadaIds: string[];
  /** AAAA-MM-DD */
  pagoEm: string;
  observacao: string;
  comprovante: string | null;
}

export function somaDasLinhas(linhas: Pick<LinhaFechamento, 'valorCentavos' | 'extraCentavos'>[]): number {
  return linhas.reduce((s, l) => s + totalDaChamada(l), 0);
}

// Pedido → chamada ----------------------------------------------------------------------------

/** Pedido com endereço (entrega, agendada, expressa) e ainda em andamento pode chamar entregador. */
export function pedidoPodeChamarEntregador(p: { modalidade: ModalidadeEntrega; situacao: SituacaoPedido; endereco: EnderecoPedido | null }): boolean {
  return p.modalidade !== 'RETIRADA' && !!p.endereco && (p.situacao === 'EM_SEPARACAO' || p.situacao === 'PRONTO');
}

export interface RascunhoDoPedido {
  pedidoId: string;
  numero: number;
  destino: ParadaChamada;
  /** O ponto veio do celular do cliente (preciso) ou da busca do endereço; sem nenhum, lat e lon são 0. */
  origemDoPonto: 'CLIENTE' | 'ENDERECO' | 'NENHUM';
  observacao: string;
  /** Chamada desse pedido ainda em andamento, se houver. */
  chamadaAtiva: { id: string; numero: number } | null;
}

/** Destino da chamada a partir do pedido (sem o ponto, que a API resolve). */
export function destinoDoPedido(p: { clienteNome: string; clienteTelefone: string; endereco: EnderecoPedido; observacao?: string | null }): ParadaChamada {
  const l = p.endereco.localizacao;
  return {
    lat: l?.latitude ?? 0,
    lon: l?.longitude ?? 0,
    endereco: textoEndereco(p.endereco).slice(0, 300),
    contato: p.clienteNome.slice(0, 80),
    telefone: p.clienteTelefone.replace(/\D/g, '').slice(0, 20),
    instrucoes: (p.observacao ?? '').trim().slice(0, 300),
  };
}

/** Quanto o relógio do fuso está à frente (positivo) ou atrás (negativo) do UTC, em minutos. */
export function minutosDoFuso(agora: Date, fuso: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute));
  return Math.round((local - Math.floor(agora.getTime() / 60_000) * 60_000) / 60_000);
}
