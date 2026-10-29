import { BadRequestException, ConflictException } from '@nestjs/common';
import { CODIGOS_PERMISSAO } from '@etiquetas/shared';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { EmpresasService, NOME_PERFIL_ADMIN } from './empresas.service';

const dto = {
  razaoSocial: 'Mercado Exemplo Ltda',
  cnpj: '11.222.333/0001-81',
  admin: { nome: 'Carlos', email: 'Carlos@Mercado.com', senha: 'senha-forte-123' },
};

function montar() {
  const tx = {
    empresa: { create: jest.fn(async () => ({ id: 'e1' })) },
    perfil: { create: jest.fn(async () => ({ id: 'p1' })) },
    usuario: { create: jest.fn(async () => ({ id: 'u1' })) },
    logAuditoria: { create: jest.fn() },
  };
  const prisma = {
    empresa: {
      findUnique: jest.fn(async (args: { where: { id?: string } }) =>
        args.where.id ? { id: 'e1', atualizadoEm: new Date(), _count: { usuarios: 1 } } : null,
      ),
    },
    usuario: { findUnique: jest.fn(async () => null as unknown) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  return { servico: new EmpresasService(prisma as unknown as PrismaService, auditoria), prisma, tx };
}

describe('EmpresasService.criar', () => {
  it('recusa CNPJ inválido', async () => {
    const { servico } = montar();
    await expect(servico.criar({ ...dto, cnpj: '11.222.333/0001-00' }, 'sa')).rejects.toThrow(BadRequestException);
  });

  it('recusa e-mail de administrador já usado', async () => {
    const { servico, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue({ id: 'outro' });
    await expect(servico.criar(dto, 'sa')).rejects.toThrow(ConflictException);
  });

  it('cria empresa, perfil Administrador com todas as permissões e o primeiro usuário', async () => {
    const { servico, tx } = montar();
    await servico.criar(dto, 'sa');

    expect(tx.empresa.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cnpj: '11222333000181' }) });

    const perfil = (tx.perfil.create.mock.calls[0] as unknown[])[0] as {
      data: { empresaId: string; nome: string; permissoes: { create: { permissaoCodigo: string }[] } };
    };
    expect(perfil.data.empresaId).toBe('e1');
    expect(perfil.data.nome).toBe(NOME_PERFIL_ADMIN);
    expect(perfil.data.permissoes.create.map((p) => p.permissaoCodigo)).toEqual([...CODIGOS_PERMISSAO]);

    expect(tx.usuario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ empresaId: 'e1', perfilId: 'p1', email: 'carlos@mercado.com' }),
    });
  });
});
