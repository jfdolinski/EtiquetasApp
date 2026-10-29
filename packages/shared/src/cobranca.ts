import type { StatusAssinatura } from './tipos';

/**
 * Assinatura, carência e bloqueio parametrizados.
 *
 * Linha do tempo de uma mensalidade (dias em relação ao vencimento em aberto mais antigo):
 *
 *   … −diasAvisoPrevio … 0 (vence) … +diasCarencia … +diasAteBloqueio …
 *   [ em dia | aviso prévio ][   carência   ][ pré-bloqueio ][ bloqueada ]
 *
 * - aviso prévio: acesso normal, lembrete de vencimento próximo;
 * - carência: vencida, acesso normal com aviso (status CARENCIA);
 * - pré-bloqueio: passou da carência, acesso normal com aviso de bloqueio iminente (status CARENCIA);
 * - bloqueada: a partir de `diasAteBloqueio` dias de atraso (status BLOQUEADA).
 *
 * Os avisos se repetem a cada `frequenciaAvisoDias` enquanto a etapa durar.
 */

export interface ParametrosCobranca {
  diasAvisoPrevio: number;
  diasCarencia: number;
  diasAteBloqueio: number;
  frequenciaAvisoDias: number;
  mensagemAvisoPrevio: string;
  mensagemCarencia: string;
  mensagemPreBloqueio: string;
  mensagemBloqueio: string;
}

/** Parâmetros globais: os de cobrança e a hora (0–23, fuso da plataforma) da avaliação diária. */
export interface ParametrosCobrancaGlobais extends ParametrosCobranca {
  horaAvaliacao: number;
}

/** Sobrescrita por empresa: null = herda o parâmetro global. */
export type ParametrosCobrancaEmpresa = { [K in 'diasAvisoPrevio' | 'diasCarencia' | 'diasAteBloqueio' | 'frequenciaAvisoDias']: number | null };

export const PARAMETROS_COBRANCA_PADRAO: ParametrosCobrancaGlobais = {
  diasAvisoPrevio: 5,
  diasCarencia: 5,
  diasAteBloqueio: 15,
  frequenciaAvisoDias: 2,
  horaAvaliacao: 6,
  mensagemAvisoPrevio: 'Sua mensalidade de {valor} vence em {dias_para_vencer} dia(s), em {vencimento}.',
  mensagemCarencia: 'Sua mensalidade venceu em {vencimento} ({dias_atraso} dia(s) de atraso). Regularize o pagamento para evitar o bloqueio.',
  mensagemPreBloqueio: 'Mensalidade vencida há {dias_atraso} dia(s). O acesso será bloqueado em {dias_para_bloqueio} dia(s).',
  mensagemBloqueio: 'Acesso bloqueado por falta de pagamento (vencimento em {vencimento}). Entre em contato com o suporte para regularizar.',
};

export const VARIAVEIS_MENSAGEM = ['{empresa}', '{valor}', '{vencimento}', '{dias_atraso}', '{dias_para_vencer}', '{dias_para_bloqueio}'] as const;

export type EtapaCobranca = 'EM_DIA' | 'AVISO_PREVIO' | 'CARENCIA' | 'PRE_BLOQUEIO' | 'BLOQUEADA';

export const ROTULO_ETAPA: Record<EtapaCobranca, string> = {
  EM_DIA: 'Em dia',
  AVISO_PREVIO: 'Vence em breve',
  CARENCIA: 'Em carência',
  PRE_BLOQUEIO: 'Bloqueio próximo',
  BLOQUEADA: 'Bloqueada',
};

export interface AvaliacaoAssinatura {
  etapa: EtapaCobranca;
  status: Exclude<StatusAssinatura, 'CANCELADA'>;
  /** Positivo = dias de atraso; negativo = dias para vencer. */
  diasAtraso: number;
  diasParaBloqueio: number;
}

/** Diferença em dias entre datas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function avaliarAssinatura(hoje: string, vencimento: string, p: Pick<ParametrosCobranca, 'diasAvisoPrevio' | 'diasCarencia' | 'diasAteBloqueio'>): AvaliacaoAssinatura {
  const diasAtraso = diasEntre(vencimento, hoje);
  const diasParaBloqueio = Math.max(0, p.diasAteBloqueio - diasAtraso);
  let etapa: EtapaCobranca;
  if (diasAtraso >= p.diasAteBloqueio) etapa = 'BLOQUEADA';
  else if (diasAtraso > p.diasCarencia) etapa = 'PRE_BLOQUEIO';
  else if (diasAtraso > 0) etapa = 'CARENCIA';
  else if (-diasAtraso <= p.diasAvisoPrevio) etapa = 'AVISO_PREVIO';
  else etapa = 'EM_DIA';
  const status = etapa === 'BLOQUEADA' ? 'BLOQUEADA' : etapa === 'CARENCIA' || etapa === 'PRE_BLOQUEIO' ? 'CARENCIA' : 'ATIVA';
  return { etapa, status, diasAtraso, diasParaBloqueio };
}

/** Avança `meses` meses mantendo o dia de vencimento (ajustado ao fim do mês: 31 → 30/28). */
export function somarMeses(data: string, meses: number, diaVencimento: number): string {
  const [a, m] = data.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(diaVencimento, ultimoDia)).padStart(2, '0')}`;
}

export function formatarDataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatarMoeda(valor: number): string {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function mensagemDaEtapa(etapa: EtapaCobranca, p: ParametrosCobranca): string | null {
  switch (etapa) {
    case 'AVISO_PREVIO':
      return p.mensagemAvisoPrevio;
    case 'CARENCIA':
      return p.mensagemCarencia;
    case 'PRE_BLOQUEIO':
      return p.mensagemPreBloqueio;
    case 'BLOQUEADA':
      return p.mensagemBloqueio;
    default:
      return null;
  }
}

/** Preenche as variáveis da mensagem; variável desconhecida fica como está. */
export function renderizarMensagem(
  modelo: string,
  v: { empresa: string; valor: number; vencimento: string; avaliacao: AvaliacaoAssinatura },
): string {
  const valores: Record<string, string> = {
    '{empresa}': v.empresa,
    '{valor}': formatarMoeda(v.valor),
    '{vencimento}': formatarDataBr(v.vencimento),
    '{dias_atraso}': String(Math.max(0, v.avaliacao.diasAtraso)),
    '{dias_para_vencer}': String(Math.max(0, -v.avaliacao.diasAtraso)),
    '{dias_para_bloqueio}': String(v.avaliacao.diasParaBloqueio),
  };
  return modelo.replace(/\{[a-z_]+\}/g, (m) => valores[m] ?? m);
}

export function mesclarParametros(globais: ParametrosCobranca, empresa: Partial<ParametrosCobrancaEmpresa> | null): ParametrosCobranca {
  const r = { ...globais };
  for (const k of ['diasAvisoPrevio', 'diasCarencia', 'diasAteBloqueio', 'frequenciaAvisoDias'] as const) {
    const v = empresa?.[k];
    if (v !== null && v !== undefined) r[k] = v;
  }
  return r;
}

/** Erros de consistência (ex.: bloqueio antes do fim da carência). */
export function validarParametros(p: Pick<ParametrosCobranca, 'diasCarencia' | 'diasAteBloqueio'>): string[] {
  return p.diasAteBloqueio < p.diasCarencia ? ['Os dias até o bloqueio não podem ser menores que os dias de carência.'] : [];
}

// Contratos da API

export interface AssinaturaResumo {
  empresaId: string;
  valorMensal: number;
  diaVencimento: number;
  /** Vencimento em aberto mais antigo (AAAA-MM-DD). */
  vencimentoAtual: string;
  /** O job não altera o status desta empresa (bloqueio/liberação manual). */
  controleManual: boolean;
  observacoes: string | null;
}

export interface SituacaoCobrancaEmpresa {
  empresa: { id: string; nome: string; statusAssinatura: StatusAssinatura; ativa: boolean };
  assinatura: AssinaturaResumo | null;
  avaliacao: AvaliacaoAssinatura | null;
  parametros: ParametrosCobrancaEmpresa;
}

export interface PagamentoResumo {
  id: string;
  valor: number;
  meses: number;
  vencimentoQuitado: string;
  novoVencimento: string;
  pagoEm: string;
  observacao: string | null;
  registradoPor: string | null;
  criadoEm: string;
}

export type TipoAvisoCobranca = 'AVISO_PREVIO' | 'CARENCIA' | 'PRE_BLOQUEIO' | 'BLOQUEADA';

export interface AvisoCobrancaResumo {
  id: string;
  tipo: TipoAvisoCobranca;
  mensagem: string;
  criadoEm: string;
}

export interface ExecucaoAvaliacaoResumo {
  id: string;
  data: string;
  origem: 'AGENDADA' | 'MANUAL';
  iniciadoEm: string;
  concluidoEm: string | null;
  resultado: { avaliadas: number; alteradas: number; avisos: number; bloqueadas: number; liberadas: number } | null;
  erro: string | null;
}

/** O que a própria empresa vê da assinatura. */
export interface MinhaAssinatura {
  assinatura: Pick<AssinaturaResumo, 'valorMensal' | 'diaVencimento' | 'vencimentoAtual'> | null;
  statusAssinatura: StatusAssinatura;
  avaliacao: AvaliacaoAssinatura | null;
  aviso: AvisoCobrancaResumo | null;
}
