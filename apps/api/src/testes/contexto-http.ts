import type { ExecutionContext } from '@nestjs/common';
import type { RequisicaoAutenticada } from '../auth/usuario-requisicao';

/** ExecutionContext mínimo para testar guards sem subir o Nest. */
export function contextoHttp(
  parcial: Partial<RequisicaoAutenticada>,
  classe: { prototype: object },
  metodo: string,
): ExecutionContext {
  const req = { headers: {}, ...parcial };
  const handler = (classe.prototype as Record<string, () => void>)[metodo];
  return {
    getHandler: () => handler,
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
