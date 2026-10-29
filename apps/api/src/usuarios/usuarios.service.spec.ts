import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from './usuarios.service';

const EMPRESA = 'e1';

function montar() {
  const prisma = {
    usuario: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null as unknown),
      findUnique: jest.fn(async () => null as unknown),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'novo', ...data })),
      update: jest.fn(async () => ({ id: 'u2' })),
    },
    perfil: { findFirst: jest.fn(async () => null as unknown) },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  return { servico: new UsuariosService(prisma as unknown as PrismaService, auditoria), prisma };
}

describe('UsuariosService (isolamento por empresa)', () => {
  it('lista apenas usuários da empresa, sem super-admins', async () => {
    const { servico, prisma } = montar();
    await servico.listar(EMPRESA);
    expect(prisma.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: EMPRESA, superAdmin: false } }),
    );
  });

  it('não encontra usuário de outra empresa', async () => {
    const { servico, prisma } = montar();
    await expect(servico.obter(EMPRESA, 'u-de-outra-empresa')).rejects.toThrow(NotFoundException);
    expect(prisma.usuario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-de-outra-empresa', empresaId: EMPRESA, superAdmin: false } }),
    );
  });

  it('recusa perfil que não pertence à empresa', async () => {
    const { servico, prisma } = montar();
    await expect(
      servico.criar(EMPRESA, { nome: 'Bia', email: 'bia@x.com', senha: '12345678', perfilId: 'p-alheio' }, 'autor'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.perfil.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-alheio', empresaId: EMPRESA } }),
    );
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  it('cria na empresa atual com e-mail normalizado e senha com hash', async () => {
    const { servico, prisma } = montar();
    prisma.perfil.findFirst.mockResolvedValue({ id: 'p1' });
    await servico.criar(EMPRESA, { nome: ' Bia ', email: 'BIA@x.com', senha: '12345678', perfilId: 'p1' }, 'autor');
    const { data } = prisma.usuario.create.mock.calls[0][0] as { data: Record<string, string> };
    expect(data).toMatchObject({ empresaId: EMPRESA, perfilId: 'p1', nome: 'Bia', email: 'bia@x.com' });
    expect(data.senhaHash).toMatch(/^\$2[aby]\$/);
    expect(data).not.toHaveProperty('senha');
  });

  it('impede o usuário de desativar a si mesmo', async () => {
    const { servico, prisma } = montar();
    prisma.usuario.findFirst.mockResolvedValue({ id: 'autor', email: 'a@x.com' });
    await expect(servico.atualizar(EMPRESA, 'autor', { ativo: false }, 'autor')).rejects.toThrow(BadRequestException);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
});
