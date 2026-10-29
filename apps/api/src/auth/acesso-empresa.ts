import type { StatusAssinatura } from '@prisma/client';

export interface SituacaoEmpresa {
  ativa: boolean;
  statusAssinatura: StatusAssinatura;
}

// Mensagens fixas por enquanto; a Fase 7 passa a lê-las dos parâmetros de cobrança.
export const MENSAGEM_BLOQUEIO = 'Acesso bloqueado. Entre em contato com o suporte para regularizar a assinatura.';
export const MENSAGEM_CARENCIA =
  'Sua assinatura está em período de carência. Regularize o pagamento para evitar o bloqueio.';

export function empresaBloqueada(empresa: SituacaoEmpresa): boolean {
  return !empresa.ativa || empresa.statusAssinatura === 'BLOQUEADA' || empresa.statusAssinatura === 'CANCELADA';
}

export function avisoEmpresa(empresa: SituacaoEmpresa): string | null {
  return empresa.statusAssinatura === 'CARENCIA' ? MENSAGEM_CARENCIA : null;
}
