import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { empresaBloqueada, MENSAGEM_BLOQUEIO } from './acesso-empresa';
import { CHAVE_PUBLICO } from './decorators';
import type { RequisicaoAutenticada } from './usuario-requisicao';

export interface PayloadToken {
  sub: string;
}

/**
 * Valida o JWT e recarrega o usuário do banco a cada requisição, para que desativação,
 * bloqueio da empresa e mudança de permissões valham imediatamente.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest<RequisicaoAutenticada>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Token ausente.');

    let payload: PayloadToken;
    try {
      payload = await this.jwt.verifyAsync<PayloadToken>(token);
    } catch {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        empresaId: true,
        superAdmin: true,
        ativo: true,
        empresa: { select: { ativa: true, statusAssinatura: true } },
        perfil: { select: { permissoes: { select: { permissaoCodigo: true } } } },
      },
    });
    if (!usuario || !usuario.ativo) throw new UnauthorizedException('Usuário inexistente ou desativado.');

    if (!usuario.superAdmin) {
      if (!usuario.empresa) throw new ForbiddenException('Usuário sem empresa vinculada.');
      if (empresaBloqueada(usuario.empresa)) throw new ForbiddenException(MENSAGEM_BLOQUEIO);
    }

    req.usuario = {
      id: usuario.id,
      empresaId: usuario.empresaId,
      superAdmin: usuario.superAdmin,
      permissoes: usuario.perfil?.permissoes.map((p) => p.permissaoCodigo) ?? [],
    };
    return true;
  }
}
