import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ChamadasService } from './chamadas';
import type { DirecionamentoService } from './direcionamento';
import type { EntregasEmpresaService } from './empresa';
import type { MapasService } from './mapas';

const SE = { lat: -23.5505, lon: -46.6333 };
const PAULISTA = { lat: -23.5614, lon: -46.6559 };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const parada = (p: { lat: number; lon: number }) => ({ ...p, endereco: 'Rua A, 1', contato: '', telefone: '', instrucoes: '' });

function montar(chamada: Record<string, unknown>) {
  const c = { id: 'c1', entregadorId: 'e1', tipo: 'ENTREGA', situacao: 'ACEITA', origem: parada(SE), destino: parada(PAULISTA), serieEsperada: null, codigoConfirmacao: '1234', tentativasCodigo: 0, paradaAtual: 0, paradas: [], esperaToleranciaMinutos: 10, esperaPorBlocoCentavos: 0, chegouNoPontoEm: null, devolucao: null, checklists: {}, assinatura: 'NAO', ...chamada };
  const tx = {
    chamadaEntrega: { updateMany: jest.fn(async () => ({ count: 1 })) },
    fotoChamada: { create: jest.fn(async () => ({})) },
    paradaExtraChamada: { updateMany: jest.fn(async () => ({ count: 1 })) },
    rastroChamada: { create: jest.fn(async () => ({})) },
    entregador: { update: jest.fn(async () => ({})) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    mensagemChamadaEntrega: { count: jest.fn(async () => 0) },
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
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', situacao: 'ACEITA', entregadorId: 'e1' }, data: { situacao: 'NA_COLETA', chegouNoPontoEm: expect.any(Date) } });
  });

  it('não pula etapa nem aceita GPS falso', async () => {
    await expect(montar({}).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE })).rejects.toBeInstanceOf(ConflictException);
    await expect(montar({}).s.avancar('e1', 'c1', { para: 'NA_COLETA', ...SE, simulada: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('máquina pede a série e o checklist; série diferente com foto vira ocorrência', async () => {
    const na = { situacao: 'NA_COLETA', tipo: 'DEVOLUCAO_MAQUINA', checklists: {} };
    const lista = { carregador: true, bobina: false, chip: true, estado: 'BOA' as const, observacao: '' };
    await expect(montar(na).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE })).rejects.toThrow(/série/);
    await expect(montar(na).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE, serie: 'abc-123' })).rejects.toThrow(/checklist/);
    await expect(montar({ ...na, serieEsperada: 'ABC123' }).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE, serie: 'abc-124', checklist: lista })).rejects.toThrow(/não confere/);
    const dif = montar({ ...na, serieEsperada: 'ABC123' });
    await dif.s.avancar('e1', 'c1', { para: 'COLETADA', ...SE, serie: 'abc-124', checklist: lista, foto: PNG });
    expect(dif.tx.chamadaEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', situacao: 'NA_COLETA', entregadorId: 'e1' }, data: { situacao: 'OCORRENCIA', ocorrencia: expect.objectContaining({ motivo: 'SERIE_DIFERENTE', serieLida: 'ABC124', situacaoAnterior: 'NA_COLETA' }) } });
    expect(dif.tx.fotoChamada.create).toHaveBeenCalledWith({ data: expect.objectContaining({ etapa: 'OCORRENCIA' }) });
    const { s, tx } = montar({ ...na, serieEsperada: 'ABC123' });
    await s.avancar('e1', 'c1', { para: 'COLETADA', ...SE, serie: 'abc-123', checklist: lista, foto: PNG });
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { situacao: 'COLETADA', coletadaEm: expect.any(Date), serieColetada: 'ABC123', checklists: { COLETA: lista } } }));
  });

  it('espera além da tolerância soma ao valor em blocos de 10 min', async () => {
    const chegou = new Date(Date.now() - 34 * 60_000);
    const { s, tx } = montar({ situacao: 'NO_DESTINO', chegouNoPontoEm: chegou, esperaToleranciaMinutos: 10, esperaPorBlocoCentavos: 250 });
    await s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' });
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ situacao: 'CONCLUIDA', esperaMinutos: { increment: 20 }, esperaCentavos: { increment: 500 }, valorCentavos: { increment: 500 } }) }));
    expect(tx.$executeRaw).toHaveBeenCalled();
    const sem = montar({ situacao: 'NA_COLETA', chegouNoPontoEm: new Date(Date.now() - 15 * 60_000), esperaToleranciaMinutos: 10, esperaPorBlocoCentavos: 250 });
    await sem.s.avancar('e1', 'c1', { para: 'COLETADA', ...SE });
    expect(sem.tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { situacao: 'COLETADA', coletadaEm: expect.any(Date) } }));
  });

  it('devolvendo: o destino é a origem e o código é o da empresa; a chamada termina inteira', async () => {
    const dev = { situacao: 'NO_DESTINO', devolucao: { em: '', metros: 1000, valorCentavos: 550, motivo: 'Cliente ausente' }, codigoDevolucao: '4321' };
    await expect(montar({ ...dev, situacao: 'COLETADA' }).s.avancar('e1', 'c1', { para: 'NO_DESTINO', ...PAULISTA })).rejects.toThrow(/não está no destino/);
    await expect(montar(dev).s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...SE, codigo: '1234' })).rejects.toThrow(/Código errado/);
    const { s, tx } = montar(dev);
    await s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...SE, codigo: '4321' });
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', situacao: 'NO_DESTINO' }, data: expect.objectContaining({ situacao: 'CONCLUIDA', chegouNoPontoEm: null }) });
  });

  it('entrega exige o código e conta as tentativas', async () => {
    const { s, prisma } = montar({ situacao: 'NO_DESTINO' });
    await expect(s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '0000' })).rejects.toThrow(/Restam 4/);
    expect(prisma.chamadaEntrega.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { tentativasCodigo: { increment: 1 } } });
    await expect(montar({ situacao: 'NO_DESTINO', tentativasCodigo: 5 }).s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' })).rejects.toBeInstanceOf(ForbiddenException);
    const ok = montar({ situacao: 'NO_DESTINO' });
    await ok.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' });
    expect(ok.tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { chegouNoPontoEm: null, situacao: 'CONCLUIDA', concluidaEm: expect.any(Date) } }));
  });

  it('com várias paradas, entregar a primeira passa para a próxima, com o código dela', async () => {
    const extra = { ordem: 1, parada: parada(SE), codigoConfirmacao: '9999', entregueEm: null };
    const { s, tx } = montar({ situacao: 'NO_DESTINO', paradas: [extra] });
    await s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' });
    expect(tx.chamadaEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', situacao: 'NO_DESTINO', paradaAtual: 0 }, data: { chegouNoPontoEm: null, situacao: 'COLETADA', paradaAtual: 1, tentativasCodigo: 0 } });
    // Na segunda parada, o código é o dela e a chegada é no ponto dela.
    const segunda = montar({ situacao: 'NO_DESTINO', paradaAtual: 1, paradas: [extra] });
    await expect(segunda.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...SE, codigo: '1234' })).rejects.toThrow(/Código errado/);
    await segunda.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...SE, codigo: '9999' });
    expect(segunda.tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { chegouNoPontoEm: null, situacao: 'CONCLUIDA', concluidaEm: expect.any(Date) } }));
    expect(segunda.tx.paradaExtraChamada.updateMany).toHaveBeenCalledWith({ where: { chamadaId: 'c1', ordem: 1 }, data: { entregueEm: expect.any(Date) } });
    await expect(montar({ situacao: 'COLETADA', paradaAtual: 1, paradas: [extra] }).s.avancar('e1', 'c1', { para: 'NO_DESTINO', ...PAULISTA })).rejects.toThrow(/não está no destino/);
  });

  it('foto obrigatória na coleta e na entrega, e a da parada leva o número dela', async () => {
    await expect(montar({ situacao: 'NA_COLETA', fotoColeta: true }).s.avancar('e1', 'c1', { para: 'COLETADA', ...SE })).rejects.toThrow(/foto da coleta/);
    await expect(montar({ situacao: 'NO_DESTINO', fotoEntrega: true }).s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' })).rejects.toThrow(/foto da entrega/);
    const extra = { ordem: 1, parada: parada(SE), codigoConfirmacao: '9999', entregueEm: null };
    const { s, tx } = montar({ situacao: 'NO_DESTINO', fotoEntrega: true, paradaAtual: 1, paradas: [extra] });
    await s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...SE, codigo: '9999', foto: PNG });
    expect(tx.fotoChamada.create).toHaveBeenCalledWith({ data: expect.objectContaining({ etapa: 'ENTREGA_1' }) });
  });

  it('assinatura: no lugar do código dispensa o código; junto ao código pede os dois; vira imagem', async () => {
    const assinatura = { tracos: [[[0.1, 0.5], [0.4, 0.2], [0.8, 0.7]]] as [number, number][][], recebedor: 'Ana Souza' };
    const sem = montar({ situacao: 'NO_DESTINO', assinatura: 'NO_LUGAR_DO_CODIGO' });
    await expect(sem.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA })).rejects.toThrow(/assinar/);
    await sem.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, assinatura });
    expect(sem.tx.fotoChamada.create).toHaveBeenCalledWith({ data: expect.objectContaining({ etapa: 'ASSINATURA', mime: 'image/png' }) });
    expect(sem.tx.chamadaEntrega.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ situacao: 'CONCLUIDA' }) }));
    const junto = montar({ situacao: 'NO_DESTINO', assinatura: 'JUNTO_AO_CODIGO' });
    await expect(junto.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, assinatura })).rejects.toThrow(/Código errado/);
    await expect(junto.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234' })).rejects.toThrow(/assinar/);
    const ok = montar({ situacao: 'NO_DESTINO', assinatura: 'JUNTO_AO_CODIGO' });
    await ok.s.avancar('e1', 'c1', { para: 'CONCLUIDA', ...PAULISTA, codigo: '1234', assinatura });
    expect(ok.tx.$executeRaw).toHaveBeenCalled();
  });

  it('mudou no meio do caminho: recusa', async () => {
    const { s, tx } = montar({});
    tx.chamadaEntrega.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(s.avancar('e1', 'c1', { para: 'NA_COLETA', ...SE })).rejects.toBeInstanceOf(ConflictException);
  });
});
