import type { StatusAssinatura } from '@prisma/client';

export interface SituacaoEmpresa {
  ativa: boolean;
  statusAssinatura: StatusAssinatura;
}

// Usadas quando o status foi definido à mão (sem assinatura); com assinatura, as mensagens vêm
// dos parâmetros de cobrança (MensagensCobrancaService).
export const MENSAGEM_BLOQUEIO = 'Acesso bloqueado. Entre em contato com o suporte para regularizar a assinatura.';
export const MENSAGEM_CARENCIA =
  'Sua assinatura está em período de carência. Regularize o pagamento para evitar o bloqueio.';

export function empresaBloqueada(empresa: SituacaoEmpresa): boolean {
  return !empresa.ativa || empresa.statusAssinatura === 'BLOQUEADA' || empresa.statusAssinatura === 'CANCELADA';
}
