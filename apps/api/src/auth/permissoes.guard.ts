import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CHAVE_PERMISSOES, CHAVE_PUBLICO, CHAVE_SUPER_ADMIN } from './decorators';
import type { RequisicaoAutenticada } from './usuario-requisicao';

@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const alvos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, alvos)) return true;

    const usuario = ctx.switchToHttp().getRequest<RequisicaoAutenticada>().usuario;
    if (!usuario) throw new ForbiddenException();

    const apenasSuperAdmin = this.reflector.getAllAndOverride<boolean>(CHAVE_SUPER_ADMIN, alvos);
    if (apenasSuperAdmin && !usuario.superAdmin) {
      throw new ForbiddenException('Recurso exclusivo do administrador da plataforma.');
    }
    if (usuario.superAdmin) return true;

    const exigidas = this.reflector.getAllAndMerge<string[]>(CHAVE_PERMISSOES, alvos) ?? [];
    const faltando = exigidas.filter((c) => !usuario.permissoes.includes(c));
    if (faltando.length > 0) {
      throw new ForbiddenException(`Permissão necessária: ${faltando.join(', ')}.`);
    }
    return true;
  }
}
