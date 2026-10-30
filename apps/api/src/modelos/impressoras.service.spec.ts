import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ImpressorasService } from './impressoras.service';

const EMPRESA = 'e1';
const AGENTE = 'a1';

function violacaoUnica() {
  return new Prisma.PrismaClientKnownRequestError('nome repetido', { code: 'P2002', clientVersion: 'teste' });
}

function montar() {
  const criadas: Record<string, unknown>[] = [];
  const prisma = {
    impressora: {
      findFirst: jest.fn(async (_: unknown) => null as unknown),
      findMany: jest.fn(async (_: unknown) => []),
      count: jest.fn(async (_: unknown) => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.nome === 'Zebra') throw violacaoUnica(); // já existe outra com este nome
        criadas.push(data);
        return { id: 'i-nova', ativo: true, larguraMaximaMm: null, criadoEm: new Date(), ...data };
      }),
    },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const servico = new ImpressorasService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService);
  return { servico, prisma, auditoria, criadas };
}

const DTO = { nome: 'Zebra', linguagem: 'ZPL' as const, dpi: 203, metodo: 'SISTEMA' as const, endereco: 'ZDesigner GC420t', modelo: 'ZDesigner GC420t (EPL)' };

describe('ImpressorasService.cadastrarPeloAgente', () => {
  it('cria ligada ao agente, na empresa dele, com sufixo se o nome estiver em uso, e audita sem usuário', async () => {
    const { servico, criadas, auditoria } = montar();
    const r = await servico.cadastrarPeloAgente(EMPRESA, AGENTE, DTO);
    expect(r).toMatchObject({ nome: 'Zebra (2)', jaExistia: false, agenteId: AGENTE });
    expect(criadas[0]).toMatchObject({ empresaId: EMPRESA, agenteId: AGENTE, metodo: 'SISTEMA', endereco: 'ZDesigner GC420t' });
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: EMPRESA, usuarioId: null, acao: 'impressora.criar' }));
  });

  it('a mesma impressora de novo devolve a existente (procura só na empresa e no agente)', async () => {
    const { servico, prisma } = montar();
    prisma.impressora.findFirst.mockResolvedValueOnce({ id: 'i1', nome: 'Zebra', agenteId: AGENTE, linguagem: 'ZPL', dpi: 203, metodo: 'REDE', endereco: '192.168.0.50:9100', ativo: true, criadoEm: new Date() });
    const r = await servico.cadastrarPeloAgente(EMPRESA, AGENTE, { ...DTO, metodo: 'REDE', endereco: '192.168.0.50' });
    expect(r).toMatchObject({ id: 'i1', jaExistia: true });
    expect(prisma.impressora.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: EMPRESA, agenteId: AGENTE, metodo: 'REDE', endereco: { equals: '192.168.0.50:9100', mode: 'insensitive' } }) }),
    );
    expect(prisma.impressora.create).not.toHaveBeenCalled();
  });

  it('recusa endereço de rede inválido e passa do limite por agente', async () => {
    const { servico, prisma } = montar();
    await expect(servico.cadastrarPeloAgente(EMPRESA, AGENTE, { ...DTO, metodo: 'REDE', endereco: 'http://x' })).rejects.toThrow(BadRequestException);
    prisma.impressora.count.mockResolvedValueOnce(50);
    await expect(servico.cadastrarPeloAgente(EMPRESA, AGENTE, { ...DTO, nome: 'Outra' })).rejects.toThrow(/50 impressoras/);
  });

  it('lista só as do agente na empresa', async () => {
    const { servico, prisma } = montar();
    await servico.listarDoAgente(EMPRESA, AGENTE);
    expect(prisma.impressora.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: EMPRESA, agenteId: AGENTE } }));
  });
});
