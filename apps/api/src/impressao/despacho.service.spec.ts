import type { AgentesGateway } from '../agentes/agentes.gateway';
import { AgenteDesconectado, ErroDoAgente, TempoEsgotadoAgente } from '../agentes/sessao-agente';
import type { PrismaService } from '../prisma/prisma.service';
import { DespachoService } from './despacho.service';

function trabalho(extra: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'PENDENTE',
    conteudo: Buffer.from('^XA^XZ'),
    modeloNome: 'Gôndola',
    tentativas: 0,
    impressora: { ativo: true, agenteId: 'a1', metodo: 'REDE', endereco: '10.0.0.5:9100' },
    ...extra,
  };
}

function montar() {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const prisma = {
    trabalhoImpressao: {
      findUnique: jest.fn(async () => trabalho() as unknown),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn((args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return args;
      }),
    },
    itemLista: { updateMany: jest.fn((args: unknown) => args) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const requisitar = jest.fn(async (..._: unknown[]) => ({}));
  const gateway = { estaOnline: jest.fn(() => true), sessao: jest.fn(() => ({ requisitar })), quandoConectar: jest.fn() };
  const servico = new DespachoService(prisma as unknown as PrismaService, gateway as unknown as AgentesGateway);
  return { servico, prisma, gateway, requisitar, updates };
}

describe('DespachoService.enviar', () => {
  it('envia ao agente da impressora e marca concluído + itens impressos', async () => {
    const { servico, prisma, requisitar, updates } = montar();
    await servico.enviar('t1');
    expect(prisma.trabalhoImpressao.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1', status: 'PENDENTE' } }));
    expect(requisitar).toHaveBeenCalledWith(
      'imprimir',
      expect.objectContaining({ metodo: 'REDE', endereco: '10.0.0.5:9100', dados: Buffer.from('^XA^XZ').toString('base64') }),
      expect.any(Number),
    );
    expect(updates.at(-1)!.data).toMatchObject({ status: 'CONCLUIDO' });
    expect(prisma.itemLista.updateMany).toHaveBeenCalledWith({ where: { trabalhoId: 't1', status: 'NA_FILA' }, data: expect.objectContaining({ status: 'IMPRESSO' }) });
  });

  it('agente offline: continua pendente, sem gastar tentativa', async () => {
    const { servico, prisma, gateway, requisitar } = montar();
    gateway.estaOnline.mockReturnValue(false);
    await servico.enviar('t1');
    expect(prisma.trabalhoImpressao.updateMany).not.toHaveBeenCalled();
    expect(requisitar).not.toHaveBeenCalled();
  });

  it('outro processo já reivindicou: não envia de novo', async () => {
    const { servico, prisma, requisitar } = montar();
    prisma.trabalhoImpressao.updateMany.mockResolvedValue({ count: 0 });
    await servico.enviar('t1');
    expect(requisitar).not.toHaveBeenCalled();
  });

  it('desconexão antes de enviar volta para a fila; durante a impressão vira erro (não duplica)', async () => {
    const antes = montar();
    antes.requisitar.mockRejectedValueOnce(new AgenteDesconectado('offline'));
    await antes.servico.enviar('t1');
    expect(antes.updates.at(-1)!.data).toMatchObject({ status: 'PENDENTE' });

    const durante = montar();
    durante.requisitar.mockRejectedValueOnce(new AgenteDesconectado('caiu', true));
    await durante.servico.enviar('t1');
    expect(durante.updates.at(-1)!.data).toMatchObject({ status: 'ERRO' });
    expect(durante.prisma.itemLista.updateMany).toHaveBeenCalledWith({ where: { trabalhoId: 't1', status: 'NA_FILA' }, data: { status: 'PENDENTE' } });
  });

  it('erro da impressora e falta de confirmação viram erro com a mensagem', async () => {
    const a = montar();
    a.requisitar.mockRejectedValueOnce(new ErroDoAgente('erro', 'não foi possível conectar à impressora 10.0.0.5:9100'));
    await a.servico.enviar('t1');
    expect(a.updates.at(-1)!.data).toMatchObject({ status: 'ERRO', erro: expect.stringContaining('10.0.0.5') });

    const b = montar();
    b.requisitar.mockRejectedValueOnce(new TempoEsgotadoAgente('lento'));
    await b.servico.enviar('t1');
    expect(b.updates.at(-1)!.data.erro).toMatch(/Confira a impressora/);
  });

  it('impressora sem agente ou desativada: erro sem tentar enviar', async () => {
    const { servico, prisma, requisitar, updates } = montar();
    prisma.trabalhoImpressao.findUnique.mockResolvedValueOnce(trabalho({ impressora: { ativo: true, agenteId: null, metodo: 'REDE', endereco: 'x:1' } }));
    await servico.enviar('t1');
    expect(updates.at(-1)!.data.erro).toMatch(/sem agente|não tem agente/);
    prisma.trabalhoImpressao.findUnique.mockResolvedValueOnce(trabalho({ impressora: { ativo: false, agenteId: 'a1', metodo: 'REDE', endereco: 'x:1' } }));
    await servico.enviar('t1');
    expect(updates.at(-1)!.data.erro).toMatch(/desativada/);
    expect(requisitar).not.toHaveBeenCalled();
  });

  it('trabalho que não está pendente é ignorado', async () => {
    const { servico, prisma, requisitar } = montar();
    prisma.trabalhoImpressao.findUnique.mockResolvedValueOnce(trabalho({ status: 'CONCLUIDO' }));
    await servico.enviar('t1');
    expect(requisitar).not.toHaveBeenCalled();
  });
});
