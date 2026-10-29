import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MensagensCobrancaService } from '../cobranca/mensagens-cobranca.service';
import { AuthService } from './auth.service';
import { gerarHashSenha } from './senha';

async function montar(sobrescrever: Record<string, unknown> = {}) {
  const usuario = {
    id: 'u1',
    empresaId: 'e1',
    nome: 'Ana',
    email: 'ana@empresa.com',
    senhaHash: await gerarHashSenha('senha-correta'),
    superAdmin: false,
    ativo: true,
    empresa: { id: 'e1', ativa: true, statusAssinatura: 'ATIVA' },
    perfil: { id: 'p1', nome: 'Operador', permissoes: [{ permissaoCodigo: 'imprimir' }] },
    ...sobrescrever,
  };
  const prisma = {
    usuario: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
        where.email === undefined || where.email === usuario.email ? usuario : null,
      ),
      update: jest.fn(async () => usuario),
    },
  };
  const jwt = { signAsync: jest.fn(async () => 'token-assinado') } as unknown as JwtService;
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  const cobranca = {
    mensagemBloqueio: jest.fn(async () => 'Bloqueada: vencimento 10/11/2026'),
    avisoAtual: jest.fn(async () =>
      usuario.empresa?.statusAssinatura === 'CARENCIA' ? { id: 'a1', tipo: 'CARENCIA', mensagem: 'Venceu há 3 dias', criadoEm: '' } : null,
    ),
  };
  return { servico: new AuthService(prisma as unknown as PrismaService, jwt, auditoria, cobranca as unknown as MensagensCobrancaService), prisma, cobranca };
}

describe('AuthService.login', () => {
  it('retorna token e usuário com as permissões do perfil', async () => {
    const { servico, prisma } = await montar();
    const r = await servico.login('  ANA@empresa.com ', 'senha-correta');
    expect(r.token).toBe('token-assinado');
    expect(r.usuario.permissoes).toEqual(['imprimir']);
    expect(r.aviso).toBeNull();
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ana@empresa.com' } }),
    );
  });

  it('mesma mensagem para e-mail inexistente e senha errada', async () => {
    const { servico } = await montar();
    await expect(servico.login('ana@empresa.com', 'errada')).rejects.toThrow('E-mail ou senha inválidos.');
    await expect(servico.login('outro@empresa.com', 'senha-correta')).rejects.toThrow('E-mail ou senha inválidos.');
  });

  it('rejeita usuário desativado', async () => {
    const { servico } = await montar({ ativo: false });
    await expect(servico.login('ana@empresa.com', 'senha-correta')).rejects.toThrow(UnauthorizedException);
  });

  it('bloqueia empresa bloqueada com a mensagem dos parâmetros de cobrança', async () => {
    const { servico, cobranca } = await montar({ empresa: { id: 'e1', ativa: true, statusAssinatura: 'BLOQUEADA' } });
    await expect(servico.login('ana@empresa.com', 'senha-correta')).rejects.toThrow(ForbiddenException);
    await expect(servico.login('ana@empresa.com', 'senha-correta')).rejects.toThrow('Bloqueada: vencimento 10/11/2026');
    expect(cobranca.mensagemBloqueio).toHaveBeenCalledWith('e1');
  });

  it('devolve o aviso de cobrança vigente', async () => {
    const { servico } = await montar({ empresa: { id: 'e1', ativa: true, statusAssinatura: 'CARENCIA' } });
    const r = await servico.login('ana@empresa.com', 'senha-correta');
    expect(r.aviso).toBe('Venceu há 3 dias');
  });
});
