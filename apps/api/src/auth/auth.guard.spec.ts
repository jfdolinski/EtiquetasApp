import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from './auth.guard';
import { Publico } from './decorators';
import { contextoHttp } from '../testes/contexto-http';
import type { RequisicaoAutenticada } from './usuario-requisicao';

class Rotas {
  @Publico() publica() {}
  privada() {}
}

function montar(usuario: unknown, tokenValido = true) {
  const jwt = {
    verifyAsync: jest.fn(async () => {
      if (!tokenValido) throw new Error('expirado');
      return { sub: 'u1' };
    }),
  } as unknown as JwtService;
  const prisma = { usuario: { findUnique: jest.fn(async () => usuario) } } as unknown as PrismaService;
  return new AuthGuard(new Reflector(), jwt, prisma);
}

const usuarioBase = {
  id: 'u1',
  empresaId: 'e1',
  superAdmin: false,
  ativo: true,
  empresa: { ativa: true, statusAssinatura: 'ATIVA' },
  perfil: { permissoes: [{ permissaoCodigo: 'usuario.ver' }] },
};

const comToken = { headers: { authorization: 'Bearer abc' } } as Partial<RequisicaoAutenticada>;

describe('AuthGuard', () => {
  it('libera rota pública sem token', async () => {
    await expect(montar(null).canActivate(contextoHttp({}, Rotas, 'publica'))).resolves.toBe(true);
  });

  it('rejeita sem token ou com token inválido', async () => {
    await expect(montar(usuarioBase).canActivate(contextoHttp({}, Rotas, 'privada'))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(montar(usuarioBase, false).canActivate(contextoHttp(comToken, Rotas, 'privada'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejeita usuário desativado', async () => {
    const guard = montar({ ...usuarioBase, ativo: false });
    await expect(guard.canActivate(contextoHttp(comToken, Rotas, 'privada'))).rejects.toThrow(UnauthorizedException);
  });

  it.each(['BLOQUEADA', 'CANCELADA'])('bloqueia empresa com assinatura %s', async (status) => {
    const guard = montar({ ...usuarioBase, empresa: { ativa: true, statusAssinatura: status } });
    await expect(guard.canActivate(contextoHttp(comToken, Rotas, 'privada'))).rejects.toThrow(ForbiddenException);
  });

  it('bloqueia empresa desativada', async () => {
    const guard = montar({ ...usuarioBase, empresa: { ativa: false, statusAssinatura: 'ATIVA' } });
    await expect(guard.canActivate(contextoHttp(comToken, Rotas, 'privada'))).rejects.toThrow(ForbiddenException);
  });

  it('carrega usuário e permissões na requisição', async () => {
    const req = { ...comToken } as RequisicaoAutenticada;
    const ctx = contextoHttp(req, Rotas, 'privada');
    await expect(montar(usuarioBase).canActivate(ctx)).resolves.toBe(true);
    const carregado = ctx.switchToHttp().getRequest<RequisicaoAutenticada>().usuario;
    expect(carregado).toEqual({ id: 'u1', empresaId: 'e1', superAdmin: false, permissoes: ['usuario.ver'] });
  });
});
