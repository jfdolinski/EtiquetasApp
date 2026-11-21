import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { hashDoToken } from '../auth/conta.service';
import { PrismaService } from '../prisma/prisma.service';

export const PREFIXO_TOKEN = 'ent_';
const INTERVALO_ULTIMO_USO_MS = 5 * 60_000;
/** Sem usar o app por esse tempo, a sessão acaba e o entregador entra de novo. */
export const SESSAO_ENTREGADOR_INATIVA_MS = 60 * 86_400_000;

// Guard ------------------------------------------------------------------------------------

export interface RequisicaoEntregador extends Request {
  entregador?: { id: string; sessaoId: string };
}

/** Token `ent_` do app do entregador. Não é usuário de empresa: as rotas são `@Publico` para o AuthGuard. */
@Injectable()
export class EntregadorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequisicaoEntregador>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token?.startsWith(PREFIXO_TOKEN)) throw new UnauthorizedException('Entre com seu e-mail ou CPF e senha.');
    const sessao = await this.prisma.sessaoEntregador.findUnique({ where: { tokenHash: hashDoToken(token) }, select: { id: true, entregadorId: true, encerradaEm: true, ultimoUsoEm: true } });
    if (!sessao || sessao.encerradaEm) throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
    if (Date.now() - sessao.ultimoUsoEm.getTime() > SESSAO_ENTREGADOR_INATIVA_MS) {
      await this.prisma.sessaoEntregador.update({ where: { id: sessao.id }, data: { encerradaEm: new Date() } }).catch(() => undefined);
      throw new UnauthorizedException('Sessão encerrada por falta de uso. Entre novamente.');
    }
    if (Date.now() - sessao.ultimoUsoEm.getTime() > INTERVALO_ULTIMO_USO_MS) {
      void this.prisma.sessaoEntregador.update({ where: { id: sessao.id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined);
    }
    req.entregador = { id: sessao.entregadorId, sessaoId: sessao.id };
    return true;
  }
}

export const EntregadorAtual = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequisicaoEntregador>().entregador!);

