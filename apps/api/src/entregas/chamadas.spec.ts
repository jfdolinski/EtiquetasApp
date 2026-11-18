import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ChamadasService } from './chamadas';
import type { DirecionamentoService } from './direcionamento';
import type { EntregasEmpresaService } from './empresa';
import type { MapasService } from './mapas';

const SE = { lat: -23.5505, lon: -46.6333 };
const PAULISTA = { lat: -23.5614, lon: -46.6559 };
const parada = (p: { lat: number; lon: number }) => ({ ...p, endereco: 'Rua A, 1', contato: '', telefone: '', instrucoes: '' });

function montar(chamada: Record<string, unknown>) {
  const c = { id: 'c1', entregadorId: 'e1', tipo: 'ENTREGA', situacao: 'ACEITA', origem: parada(SE), destino: parada(PAULISTA), serieEsperada: null, codigoConfirmacao: '1234', tentativasCodigo: 0, ...chamada };
  const tx = {
    chamadaEntrega: { updateMany: jest.fn(async () => ({ count: 1 })) },
    fotoChamada: { create: jest.fn(async () => ({})) },
    entregador: { update: jest.fn(async () => ({})) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)),
    chamadaEntrega: { findFirst: jest.fn(async () => ({ ...c, empresa: { nomeFantasia: 'Loja', razaoSocial: 'Loja' }, ocorrencia: null, aceitaEm: null, concluidaEm: null, serieColetada: null, observacao: '', numero: 1, metros: 3000, estimada: true, valorCentavos: 800 })), update: jest.fn(async () => ({})), findUnique: jest.fn(async () => ({ pedidoId: null })) },
  };
  const s = new ChamadasService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, {} as MapasService, {} as EntregasEmpresaService, {} as DirecionamentoService, {} as never);
  return { s, prisma, tx };
}

describe('etapas da chamada', () => {
  it('chegada na coleta só perto do ponto', async () => {
    await expect(montar({}).s.avancar('e1', 'c1', { para: 'NA_COLETA', ...PAULISTA, precisao: 10 })).rejects.toBeInstanceOf(BadRequestException);
    const { s, tx } = montar({});
    await s.avancar('e1', 'c1', { para: 'NA_COLETA', lat: SE.lat + 0.0005, lon: SE.lon, precisao: 10 });
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', situacao: 'ACEITA', entregadorId: 'e1' }, data: { situacao: 'NA_COLETA' } });
  });

  it('não pula etapa nem aceita GPS falso', async () => {
    await expect(montar({}).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE })).rejects.toBeInstanceOf(ConflictException);
    await expect(montar({}).s.avancar('e1', 'c1', { para: 'NA_COLETA', ...SE, simulada: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('máquina pede a série, e a esperada precisa conferir', async () => {
    const na = { situacao: 'NA_COLETA', tipo: 'DEVOLUCAO_MAQUINA' };
    await expect(montar(na).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE })).rejects.toThrow(/série/);
    await expect(montar({ ...na, serieEsperada: 'ABC123' }).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE, serie: 'abc-124' })).rejects.toThrow(/não confere/);
    const { s, tx } = montar({ ...na, serieEsperada: 'ABC123' });
    await s.avancar('e1', 'c1', { para: 'COLETADA', ...SE, serie: 'abc-123' });
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { situacao: 'COLETADA', serieColetada: 'ABC123' } }));
  });

  it('entrega exige o código e conta as tentativas', async () => {
    const { s, prisma } = montar({ situacao: 'NO_DESTINO' });
    await expect(s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '0000' })).rejects.toThrow(/Restam 4/);
    expect(prisma.chamadaEntrega.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { tentativasCodigo: { increment: 1 } } });
    await expect(montar({ situacao: 'NO_DESTINO', tentativasCodigo: 5 }).s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' })).rejects.toBeInstanceOf(ForbiddenException);
    const ok = montar({ situacao: 'NO_DESTINO' });
    await ok.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' });
    expect(ok.tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { situacao: 'CONCLUIDA', concluidaEm: expect.any(Date) } }));
  });

  it('mudou no meio do caminho: recusa', async () => {
    const { s, tx } = montar({});
    tx.chamadaEntrega.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(s.avancar('e1', 'c1', { para: 'NA_COLETA', ...SE })).rejects.toBeInstanceOf(ConflictException);
  });
});
