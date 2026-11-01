import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MensagensCobrancaService } from '../cobranca/mensagens-cobranca.service';
import { empresaBloqueada } from './acesso-empresa';
import { CHAVE_APP, CHAVE_PUBLICO } from './decorators';
import type { RequisicaoAutenticada } from './usuario-requisicao';

export interface PayloadToken {
  sub: string;
  /** Sessão: encerrada ela, o token deixa de valer. */
  sid?: string;
}

const INTERVALO_ULTIMO_USO_MS = 5 * 60_000;
const PREFIXO_TOKEN_APP = 'app_';

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
    private readonly cobranca: MensagensCobrancaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest<RequisicaoAutenticada>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Token ausente.');

    let payload: PayloadToken;
    let dispositivoId: string | undefined;
    if (token.startsWith(PREFIXO_TOKEN_APP)) {
      if (!this.reflector.getAllAndOverride<boolean>(CHAVE_APP, [ctx.getHandler(), ctx.getClass()])) {
        throw new ForbiddenException('Esta função não está disponível no aplicativo.');
      }
      const dispositivo = await this.conferirDispositivo(token);
      payload = { sub: dispositivo.usuarioId };
      dispositivoId = dispositivo.id;
    } else {
      try {
        payload = await this.jwt.verifyAsync<PayloadToken>(token);
      } catch {
        throw new UnauthorizedException('Sessão expirada ou inválida.');
      }
      if (payload.sid) await this.conferirSessao(payload.sid, payload.sub);
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
      if (empresaBloqueada(usuario.empresa)) throw new ForbiddenException(await this.cobranca.mensagemBloqueio(usuario.empresaId));
    }

    req.usuario = {
      id: usuario.id,
      empresaId: usuario.empresaId,
      superAdmin: usuario.superAdmin,
      permissoes: usuario.perfil?.permissoes.map((p) => p.permissaoCodigo) ?? [],
      sessaoId: payload.sid,
      dispositivoId,
    };
    return true;
  }

  private async conferirDispositivo(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const d = await this.prisma.dispositivoMovel.findUnique({ where: { tokenHash }, select: { id: true, usuarioId: true, revogadoEm: true, ultimoUsoEm: true } });
    if (!d || d.revogadoEm) throw new UnauthorizedException('Este celular foi desvinculado. Vincule de novo em Minha conta.');
    if (Date.now() - d.ultimoUsoEm.getTime() > INTERVALO_ULTIMO_USO_MS) {
      void this.prisma.dispositivoMovel.update({ where: { id: d.id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined);
    }
    return d;
  }

  private async conferirSessao(id: string, usuarioId: string) {
    const sessao = await this.prisma.sessaoUsuario.findUnique({ where: { id }, select: { usuarioId: true, encerradaEm: true, ultimoUsoEm: true } });
    if (!sessao || sessao.encerradaEm || sessao.usuarioId !== usuarioId) throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
    if (Date.now() - sessao.ultimoUsoEm.getTime() > INTERVALO_ULTIMO_USO_MS) {
      void this.prisma.sessaoUsuario.update({ where: { id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined);
    }
  }
}
