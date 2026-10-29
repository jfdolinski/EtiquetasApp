import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { RequisicaoAutenticada } from './usuario-requisicao';

export const CABECALHO_EMPRESA = 'x-empresa-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Usuário comum: sempre a própria empresa (o cabeçalho é ignorado).
 * Super-admin: a empresa indicada no cabeçalho X-Empresa-Id.
 */
export function resolverEmpresaId(req: RequisicaoAutenticada): string {
  const usuario = req.usuario;
  if (!usuario) throw new UnauthorizedException();

  if (!usuario.superAdmin) {
    if (!usuario.empresaId) throw new ForbiddenException('Usuário sem empresa vinculada.');
    return usuario.empresaId;
  }

  const valor = req.headers[CABECALHO_EMPRESA];
  const empresaId = Array.isArray(valor) ? valor[0] : valor;
  if (!empresaId || !UUID.test(empresaId)) {
    throw new BadRequestException('Selecione uma empresa (cabeçalho X-Empresa-Id) para esta operação.');
  }
  return empresaId;
}
