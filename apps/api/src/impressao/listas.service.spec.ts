import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ListasService } from './listas.service';
import type { TrabalhosService } from './trabalhos.service';

const EMPRESA = 'e1';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
});

function montar() {
  const criados: Record<string, unknown>[] = [];
  const tx = {
    itemLista: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        criados.push(...data);
        return { count: data.length };
      }),
    },
    listaDiaria: { update: jest.fn(async () => ({})) },
  };
  const prisma = {
    listaDiaria: { upsert: jest.fn(async () => ({ id: 'l1' })), findUnique: jest.fn(async () => ({ id: 'l1', atualizadoEm: new Date(), erros: [], itens: [] })) },
    modeloEtiqueta: {
      findMany: jest.fn(async (_: unknown) => [
        { id: 'm1', nome: 'Gôndola', consultaId: 'q1', impressoraId: 'i1' },
        { id: 'm2', nome: 'Prateleira', consultaId: 'q1', impressoraId: null },
        { id: 'm3', nome: 'Açougue', consultaId: 'q2', impressoraId: 'i2' },
      ]),
      findFirst: jest.fn(async (_: unknown) => null as unknown),
    },
    itemLista: {
      findMany: jest.fn(async (_: unknown) => [{ modeloId: 'm1', chave: '1' }] as unknown[]),
      findFirst: jest.fn(async (_: unknown) => null as unknown),
    },
    impressora: { findMany: jest.fn(async () => []), findFirst: jest.fn(async (_: unknown) => null as unknown) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const consultas = {
    executar: jest.fn(async (_e: string, consultaId: string) => {
      if (consultaId === 'q2') throw new ServiceUnavailableException('O agente desta conexão está offline.');
      return {
        colunas: [{ nome: 'codigo' }, { nome: 'descricao' }, { nome: 'qtd' }],
        linhas: [
          [1, 'Arroz', 2],
          [2, 'Feijão', null],
          [2, 'Feijão (repetido)', null],
        ],
        truncado: false,
        duracaoMs: 1,
      };
    }),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  const trabalhos = { criar: jest.fn() } as unknown as TrabalhosService;
  const servico = new ListasService(prisma as unknown as PrismaService, auditoria, consultas as unknown as ConsultasService, trabalhos);
  return { servico, prisma, consultas, criados, tx };
}

describe('ListasService.gerar', () => {
  it('lê só modelos da empresa marcados para a lista e executa cada consulta uma vez', async () => {
    const { servico, prisma, consultas } = montar();
    await servico.gerar(EMPRESA, 'u1');
    expect(prisma.modeloEtiqueta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: EMPRESA, ativo: true, naListaDiaria: true, consultaId: { not: null } } }),
    );
    expect(consultas.executar).toHaveBeenCalledTimes(2); // q1 (dois modelos) e q2
    expect(consultas.executar).toHaveBeenCalledWith(EMPRESA, 'q1', 'u1', {}, expect.any(Number));
  });

  it('não repete o que já foi impresso/descartado, remove duplicados e usa a quantidade da consulta', async () => {
    const { servico, criados } = montar();
    await servico.gerar(EMPRESA, 'u1');
    const m1 = criados.filter((c) => c.modeloId === 'm1');
    expect(m1.map((c) => c.chave)).toEqual(['2']); // "1" já tratado hoje; "2" uma vez só
    const m2 = criados.filter((c) => c.modeloId === 'm2');
    expect(m2).toEqual([
      expect.objectContaining({ chave: '1', descricao: 'Arroz', quantidade: 2, impressoraId: null, empresaId: EMPRESA }),
      expect.objectContaining({ chave: '2', quantidade: 1 }),
    ]);
  });

  it('erro numa consulta não derruba a lista: vira erro do modelo', async () => {
    const { servico, tx } = montar();
    await servico.gerar(EMPRESA, 'u1');
    const { data } = (tx.listaDiaria.update.mock.calls[0] as unknown as [{ data: { erros: { modeloNome: string; mensagem: string }[] } }])[0];
    expect(data.erros).toEqual([{ modeloId: 'm3', modeloNome: 'Açougue', mensagem: 'O agente desta conexão está offline.' }]);
  });
});

describe('ListasService (isolamento e validação)', () => {
  it('item de outra empresa → 404', async () => {
    const { servico, prisma } = montar();
    await expect(servico.atualizarItem(EMPRESA, 'x', { status: 'DESCARTADO' }, 'u1')).rejects.toThrow(NotFoundException);
    expect(prisma.itemLista.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'x', empresaId: EMPRESA } }));
  });

  it('imprimir só itens pendentes da lista e da empresa', async () => {
    const { servico, prisma } = montar();
    prisma.itemLista.findMany.mockResolvedValueOnce([]);
    await expect(servico.imprimirLista(EMPRESA, 'l1', { itens: [{ id: 'i9', quantidade: 1 }] }, 'u1')).rejects.toThrow(BadRequestException);
    expect(prisma.itemLista.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: { in: ['i9'] }, listaId: 'l1', empresaId: EMPRESA, status: 'PENDENTE' } }),
    );
  });

  it('avulsa: impressora de outra empresa é recusada', async () => {
    const { servico, prisma } = montar();
    prisma.modeloEtiqueta.findFirst.mockResolvedValueOnce({ id: 'm1', nome: 'X', layout: {}, impressoraId: null });
    await expect(
      servico.imprimirAvulsa(EMPRESA, { modeloId: 'm1', impressoraId: 'i-alheia', itens: [{ registro: { codigo: 1 }, quantidade: 1 }] }, 'u1'),
    ).rejects.toThrow(/Impressora inválida/);
    expect(prisma.impressora.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i-alheia', empresaId: EMPRESA } }));
  });
});
