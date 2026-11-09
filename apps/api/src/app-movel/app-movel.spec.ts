import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthGuard } from '../auth/auth.guard';
import { hashDoToken } from '../auth/conta.service';
import { PermitidoNoApp } from '../auth/decorators';
import type { RequisicaoAutenticada } from '../auth/usuario-requisicao';
import type { MensagensCobrancaService } from '../cobranca/mensagens-cobranca.service';
import type { PrismaService } from '../prisma/prisma.service';
import { contextoHttp } from '../testes/contexto-http';
import { ManutencaoService } from '../sistema/sistema.module';
import { DispositivosService, gerarCodigoVinculo } from './app-movel.module';
import type { FcmService } from './fcm.service';

class Rotas {
  @PermitidoNoApp() doApp() {}
  doNavegador() {}
}

function guarda(dispositivo: unknown) {
  const prisma = {
    dispositivoMovel: { findUnique: jest.fn(async () => dispositivo), update: jest.fn(async () => ({})) },
    usuario: { findUnique: jest.fn(async () => ({ id: 'u1', empresaId: 'e1', superAdmin: false, ativo: true, empresa: { ativa: true, statusAssinatura: 'ATIVA' }, perfil: { permissoes: [{ permissaoCodigo: 'imprimir' }] } })) },
  };
  const jwt = { verifyAsync: jest.fn() };
  return { g: new AuthGuard(new Reflector(), jwt as unknown as JwtService, prisma as unknown as PrismaService, {} as MensagensCobrancaService), prisma, jwt };
}

const req = () => ({ headers: { authorization: 'Bearer app_token' } }) as Partial<RequisicaoAutenticada>;

describe('token do celular no AuthGuard', () => {
  const vivo = { id: 'd1', usuarioId: 'u1', revogadoEm: null, ultimoUsoEm: new Date() };

  it('entra em rota marcada e identifica o aparelho', async () => {
    const { g, jwt } = guarda(vivo);
    const ctx = contextoHttp(req(), Rotas, 'doApp');
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.switchToHttp().getRequest<RequisicaoAutenticada>().usuario).toMatchObject({ id: 'u1', dispositivoId: 'd1', empresaId: 'e1' });
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('não entra em rota sem marca, mesmo com token válido', async () => {
    const { g, prisma } = guarda(vivo);
    await expect(g.canActivate(contextoHttp(req(), Rotas, 'doNavegador'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dispositivoMovel.findUnique).not.toHaveBeenCalled();
  });

  it('aparelho desvinculado ou desconhecido cai fora', async () => {
    await expect(guarda({ ...vivo, revogadoEm: new Date() }).g.canActivate(contextoHttp(req(), Rotas, 'doApp'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guarda(null).g.canActivate(contextoHttp(req(), Rotas, 'doApp'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('DispositivosService', () => {
  function montar(codigo: unknown) {
    const tx = {
      codigoVinculoApp: { updateMany: jest.fn(async () => ({ count: 1 })) },
      dispositivoMovel: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'd1', ...data })) },
    };
    const prisma = {
      codigoVinculoApp: { findUnique: jest.fn(async () => codigo) },
      dispositivoMovel: { findMany: jest.fn(async () => [{ pushToken: 'bom' }, { pushToken: 'velho' }]), updateMany: jest.fn(async () => ({ count: 1 })) },
      $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)),
    };
    const fcm = { enviar: jest.fn(async () => ({ enviados: 1, invalidos: ['velho'] })) };
    const s = new DispositivosService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, fcm as unknown as FcmService);
    return { s, tx, prisma, fcm };
  }
  const dto = { codigo: 'ABCDEFGHJK', nome: 'Moto G', plataforma: 'ANDROID' as const };
  const valido = { id: 'c1', usuarioId: 'u1', empresaId: 'e1', usadoEm: null, expiraEm: new Date(Date.now() + 60_000), usuario: { id: 'u1', ativo: true, superAdmin: false, empresaId: 'e1', empresa: { ativa: true, statusAssinatura: 'ATIVA' } } };

  it('código vale uma vez e o banco guarda só o hash do token', async () => {
    const { s, tx } = montar(valido);
    const r = await s.vincular(dto);
    expect(r.token).toMatch(/^app_/);
    expect(tx.dispositivoMovel.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenHash: hashDoToken(r.token), empresaId: 'e1' }) });
    expect(JSON.stringify(tx.dispositivoMovel.create.mock.calls)).not.toContain(r.token);
  });

  it('recusa código vencido, usado, de usuário inativo e o clique duplo', async () => {
    await expect(montar(null).s.vincular(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(montar({ ...valido, usadoEm: new Date() }).s.vincular(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(montar({ ...valido, expiraEm: new Date(Date.now() - 1) }).s.vincular(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(montar({ ...valido, usuario: { ...valido.usuario, ativo: false } }).s.vincular(dto)).rejects.toBeInstanceOf(UnauthorizedException);
    const corrida = montar(valido);
    corrida.tx.codigoVinculoApp.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(corrida.s.vincular(dto)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('empresa bloqueada não vincula', async () => {
    await expect(montar({ ...valido, usuario: { ...valido.usuario, empresa: { ativa: true, statusAssinatura: 'BLOQUEADA' } } }).s.vincular(dto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('avisar filtra pela empresa e esquece os tokens que o Firebase recusou', async () => {
    const { s, prisma, fcm } = montar(valido);
    await expect(s.avisarEmpresa('e1', { titulo: 't', mensagem: 'm' })).resolves.toBe(1);
    expect(prisma.dispositivoMovel.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ empresaId: 'e1', revogadoEm: null }) }));
    expect(fcm.enviar).toHaveBeenCalledWith(['bom', 'velho'], expect.anything());
    expect(prisma.dispositivoMovel.updateMany).toHaveBeenCalledWith({ where: { pushToken: { in: ['velho'] } }, data: { pushToken: null } });
  });

  it('código de vínculo sem caracteres que se confundem', () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigoVinculo()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });
});

describe('faxina', () => {
  it('apaga bytes em lotes só de trabalho terminado e guarda o resultado', async () => {
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = 'postgresql://teste';
    process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
    const conta = () => ({ deleteMany: jest.fn(async () => ({ count: 2 })) });
    const prisma = {
      trabalhoImpressao: {
        findMany: jest.fn().mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]).mockResolvedValueOnce([]),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      logAuditoria: conta(),
      listaDiaria: conta(),
      erroSistema: conta(),
      sessaoUsuario: conta(),
      redefinicaoSenha: conta(),
      codigoVinculoApp: conta(),
      pedidoVinculoTela: conta(),
      quedaTela: conta(),
      fotoProdutoTela: conta(),
      pedido: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const s = new ManutencaoService(prisma as unknown as PrismaService);
    const r = await s.executar(new Date('2026-11-02T00:00:00Z'));
    expect(r).toMatchObject({ conteudos: 2, auditoria: 2, listas: 2 });
    expect(r.erro).toBeUndefined();
    expect(s.ultima).toBe(r);
    expect(prisma.trabalhoImpressao.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conteudoApagadoEm: null, status: { in: ['CONCLUIDO', 'CANCELADO', 'ERRO'] } }) }));
    expect(prisma.logAuditoria.deleteMany.mock.calls[0]).toBeDefined();
    // Pedido terminado há 180 dias perde os dados pessoais do cliente; o número e os valores ficam.
    expect(prisma.pedido.updateMany).toHaveBeenCalledWith({
      where: { situacao: { in: ['CONCLUIDO', 'CANCELADO'] }, atualizadoEm: { lt: new Date('2026-05-06T00:00:00Z') }, clienteTelefone: { not: '' } },
      data: expect.objectContaining({ clienteNome: 'Dados apagados', clienteTelefone: '', observacao: '' }),
    });
  });

  it('um erro no banco fica registrado, sem derrubar nada', async () => {
    const prisma = { trabalhoImpressao: { findMany: jest.fn(async () => { throw new Error('banco fora'); }) } };
    const r = await new ManutencaoService(prisma as unknown as PrismaService).executar();
    expect(r.erro).toBe('banco fora');
  });
});
