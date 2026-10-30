import { BadRequestException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AgendamentosService } from './agendamentos.service';
import type { ListasService } from './listas.service';

const EMPRESA = 'e1';

function agendamento(extra: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    empresaId: EMPRESA,
    modeloId: 'm1',
    impressoraId: null,
    responsavelId: 'u1',
    intervaloSegundos: 60,
    inicioEm: new Date('2026-10-30T09:00:00Z'),
    imprimirAutomatico: true,
    ativo: true,
    proximaExecucaoEm: new Date('2026-10-30T09:01:00Z'),
    ultimaExecucaoEm: null,
    historico: [],
    modelo: { id: 'm1', nome: 'Gôndola', consultaId: 'q1', impressoraId: 'i1', ativo: true, impressora: { nome: 'Zebra' } },
    impressora: null,
    responsavel: { nome: 'Ana', ativo: true },
    empresa: { ativa: true, statusAssinatura: 'ATIVA' },
    ...extra,
  };
}

function montar(impressora: { ativo: boolean; linguagem: string; nome: string } | null = { ativo: true, linguagem: 'ZPL', nome: 'Zebra' }) {
  let atual = agendamento();
  const prisma = {
    modeloEtiqueta: { findFirst: jest.fn(async () => ({ consultaId: 'q1', consulta: { sql: 'select * from produtos', conexao: { tipo: 'POSTGRES' } }, impressora })) },
    impressora: { findFirst: jest.fn(async () => null) },
    agendamentoModelo: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...agendamento(), ...data })),
      findUnique: jest.fn(async () => atual),
      findFirst: jest.fn(async () => atual),
      findMany: jest.fn(async () => [{ id: 'a1', proximaExecucaoEm: atual.proximaExecucaoEm, inicioEm: atual.inicioEm, intervaloSegundos: 60 }]),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (atual = { ...atual, ...data })),
    },
  };
  const listas = {
    atualizarModeloNaLista: jest.fn(async () => ({ pendentes: 2 }) as { pendentes: number; erro?: string }),
    imprimirPendentesDoModelo: jest.fn(async () => ({ trabalhos: [{ quantidadeEtiquetas: 3 }], avisos: [] })),
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const servico = new AgendamentosService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService, listas as unknown as ListasService);
  return { servico, prisma, listas, auditoria, mudar: (extra: Record<string, unknown>) => (atual = agendamento(extra)) };
}

const DTO = { modeloId: 'm1', intervaloSegundos: 3600, inicioEm: '2026-10-30T09:00:00Z', imprimirAutomatico: true };

describe('AgendamentosService', () => {
  it('cria com o autor como responsável e o próximo horário alinhado ao início', async () => {
    const { servico, prisma } = montar();
    await servico.criar(EMPRESA, DTO, 'u9');
    const data = prisma.agendamentoModelo.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ empresaId: EMPRESA, responsavelId: 'u9', intervaloSegundos: 3600, ativo: true });
    const proxima = (data.proximaExecucaoEm as Date).getTime();
    expect((proxima - new Date(DTO.inicioEm).getTime()) % 3_600_000).toBe(0);
    expect(proxima).toBeGreaterThan(Date.now());
  });

  it('impressão automática exige impressora térmica ativa', async () => {
    await expect(montar(null).servico.criar(EMPRESA, DTO, 'u1')).rejects.toThrow(BadRequestException);
    await expect(montar({ ativo: true, linguagem: 'PDF', nome: 'Jato' }).servico.criar(EMPRESA, DTO, 'u1')).rejects.toThrow(/PDF/);
    await expect(montar({ ativo: false, linguagem: 'ZPL', nome: 'Zebra' }).servico.criar(EMPRESA, DTO, 'u1')).rejects.toThrow(/desativada/);
    // Sem impressão automática, a impressora comum serve (só atualiza a lista).
    await expect(montar({ ativo: true, linguagem: 'PDF', nome: 'Jato' }).servico.criar(EMPRESA, { ...DTO, imprimirAutomatico: false }, 'u1')).resolves.toBeTruthy();
  });

  it('recusa modelo com consulta de busca ({param.*})', async () => {
    const { servico, prisma } = montar();
    prisma.modeloEtiqueta.findFirst.mockResolvedValueOnce({
      consultaId: 'q1',
      consulta: { sql: 'select * from produtos where codigo = {param.busca}', conexao: { tipo: 'POSTGRES' } },
      impressora: { ativo: true, linguagem: 'ZPL', nome: 'Zebra' },
    });
    await expect(servico.criar(EMPRESA, DTO, 'u1')).rejects.toThrow(/param/);
  });

  it('o relógio reivindica o vencido, atualiza a lista, imprime e grava o histórico', async () => {
    const { servico, prisma, listas } = montar();
    await servico.verificar();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(prisma.agendamentoModelo.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', proximaExecucaoEm: new Date('2026-10-30T09:01:00Z') } }));
    expect(listas.atualizarModeloNaLista).toHaveBeenCalledWith(EMPRESA, 'u1', expect.objectContaining({ id: 'm1' }), null);
    expect(listas.imprimirPendentesDoModelo).toHaveBeenCalledWith(EMPRESA, 'u1', 'm1');
  });

  it('execução registra itens e etiquetas; sem impressão automática só atualiza a lista', async () => {
    const { servico, listas, mudar } = montar();
    const r = await servico.executar('a1', 'agendada');
    expect(r).toMatchObject({ itensNovos: 2, etiquetas: 3, trabalhos: 1, origem: 'agendada' });
    mudar({ imprimirAutomatico: false });
    listas.imprimirPendentesDoModelo.mockClear();
    const s = await servico.executar('a1', 'agendada');
    expect(s).toMatchObject({ itensNovos: 2, etiquetas: 0 });
    expect(listas.imprimirPendentesDoModelo).not.toHaveBeenCalled();
  });

  it('não roda sem responsável ativo nem com a empresa bloqueada, e não imprime se a consulta falhar', async () => {
    const { servico, listas, mudar } = montar();
    mudar({ responsavel: { nome: 'Ana', ativo: false } });
    expect((await servico.executar('a1', 'agendada'))?.erro).toMatch(/responsável/);
    mudar({ empresa: { ativa: true, statusAssinatura: 'BLOQUEADA' } });
    expect((await servico.executar('a1', 'agendada'))?.erro).toMatch(/bloqueada/);
    expect(listas.atualizarModeloNaLista).not.toHaveBeenCalled();
    mudar({});
    listas.atualizarModeloNaLista.mockResolvedValueOnce({ pendentes: 0, erro: 'O agente desta conexão está offline.' });
    expect((await servico.executar('a1', 'agendada'))?.erro).toMatch(/offline/);
    expect(listas.imprimirPendentesDoModelo).not.toHaveBeenCalled();
  });

  it('execução manual roda com quem clicou e entra na auditoria', async () => {
    const { servico, listas, auditoria } = montar();
    await servico.executarAgora(EMPRESA, 'a1', 'u7');
    expect(listas.atualizarModeloNaLista).toHaveBeenCalledWith(EMPRESA, 'u7', expect.anything(), null);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'agendamento.executar', usuarioId: 'u7' }));
  });
});
