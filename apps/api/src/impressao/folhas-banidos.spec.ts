import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { BanidosService } from '../banidos/banidos.service';
import type { ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DespachoService } from './despacho.service';
import { ListasService } from './listas.service';
import { TrabalhosService } from './trabalhos.service';

const EMPRESA = 'e1';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
});

const LAYOUT = {
  larguraMm: 60,
  alturaMm: 30,
  colunas: 3,
  espacamentoHorizontalMm: 0,
  espacamentoVerticalMm: 0,
  margens: { superior: 0, inferior: 0, esquerda: 0, direita: 0 },
  papel: { tipo: 'folha', larguraMm: 210, alturaMm: 297 },
  minimoPorFolha: 4,
  maximoPorFolha: 6,
  elementos: [],
};
const IMPRESSORA = { id: 'i1', nome: 'Zebra', linguagem: 'ZPL' as const, dpi: 203, ativo: true };

function montarTrabalhos(banidos: string[] = []) {
  const criados: { quantidadeEtiquetas: number }[] = [];
  const tx = {
    trabalhoImpressao: { create: jest.fn(async ({ data }: { data: { quantidadeEtiquetas: number } }) => (criados.push(data), { id: `t${criados.length}`, criadoEm: new Date(), concluidoEm: null, criadoPor: null, ...data })) },
    itemLista: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const prisma = { $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)) };
  const servico = new TrabalhosService(
    prisma as unknown as PrismaService,
    { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService,
    { despachar: jest.fn() } as unknown as DespachoService,
    { conjunto: async () => new Set(banidos) } as unknown as BanidosService,
  );
  const grupo = (registros: Record<string, unknown>[]) => ({
    modelo: { id: 'm1', nome: 'Gôndola', layout: LAYOUT as never },
    impressora: IMPRESSORA,
    registros,
    itemIds: [],
    origem: 'AVULSA' as const,
  });
  return { servico, criados, grupo };
}

const repetir = (n: number, ean = '789') => Array.from({ length: n }, () => ({ ean }));

describe('TrabalhosService: toda impressão passa por aqui', () => {
  it('recusa quantidade que não fecha folha e não cria trabalho', async () => {
    const { servico, grupo, criados } = montarTrabalhos();
    await expect(servico.criar(EMPRESA, 'u1', grupo(repetir(3)))).rejects.toThrow(/Gôndola: 3 etiqueta\(s\).*faltam 1/);
    expect(criados).toHaveLength(0);
  });

  it('aceita o que fecha', async () => {
    const { servico, grupo, criados } = montarTrabalhos();
    const r = await servico.criar(EMPRESA, 'u1', grupo(repetir(10)));
    expect(r.trabalhos).toHaveLength(1);
    expect(criados[0].quantidadeEtiquetas).toBe(10);
  });

  it('tira o banido antes de conferir a folha, e avisa', async () => {
    const { servico, grupo, criados } = montarTrabalhos(['111']);
    const r = await servico.criar(EMPRESA, 'u1', grupo([...repetir(5), ...repetir(3, '000111')]));
    expect(criados[0].quantidadeEtiquetas).toBe(5);
    expect(r.avisos.join()).toMatch(/3 etiqueta\(s\) de produto banido/);
    // Sem o banido não fecha a folha: recusa mesmo com 8 pedidas.
    await expect(servico.criar(EMPRESA, 'u1', grupo([...repetir(3), ...repetir(5, '111')]))).rejects.toThrow(/faltam 1/);
  });

  it('só banidos: nada é criado, só o aviso', async () => {
    const { servico, grupo, criados } = montarTrabalhos(['789']);
    const r = await servico.criar(EMPRESA, 'u1', grupo(repetir(5)));
    expect(r.trabalhos).toHaveLength(0);
    expect(r.avisos).toHaveLength(1);
    expect(criados).toHaveLength(0);
  });
});

function montarListas(itens: Record<string, unknown>[], banidos: string[] = []) {
  const prisma = {
    listaDiaria: { upsert: jest.fn(async () => ({ id: 'l1' })) },
    itemLista: {
      findMany: jest.fn(async () => itens),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async (_: unknown) => ({ count: 1 })),
    },
  };
  const trabalhos = { criar: jest.fn(async (_e: string, _u: string, g: { registros: unknown[] }) => ({ trabalhos: [{ id: 't', quantidadeEtiquetas: g.registros.length }], avisos: [] })) };
  const servico = new ListasService(
    prisma as unknown as PrismaService,
    { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService,
    {} as ConsultasService,
    trabalhos as unknown as TrabalhosService,
    { conjunto: async () => new Set(banidos) } as unknown as BanidosService,
  );
  return { servico, prisma, trabalhos };
}

const item = (id: string, quantidade: number, ean = id, modelo: Record<string, unknown> = { id: 'm1', nome: 'Gôndola', layout: LAYOUT, ativo: true }) => ({ id, quantidade, registro: { ean }, modelo, impressora: IMPRESSORA });

describe('Lista do dia', () => {
  it('modelo fora do limite fica pendente com aviso; o outro segue', async () => {
    const outro = { id: 'm2', nome: 'Livre', layout: { ...LAYOUT, minimoPorFolha: 1, maximoPorFolha: 6 }, ativo: true };
    const { servico, trabalhos, prisma } = montarListas([item('a', 3), item('b', 1, 'b', outro)]);
    const r = await servico.imprimirLista(EMPRESA, 'l1', { itens: [{ id: 'a', quantidade: 3 }, { id: 'b', quantidade: 1 }] }, 'u1');
    expect(trabalhos.criar).toHaveBeenCalledTimes(1);
    expect(trabalhos.criar.mock.calls[0][2]).toMatchObject({ modelo: { id: 'm2' } });
    expect(r.avisos.join()).toMatch(/Gôndola: 3 etiqueta.*Nada foi enviado/);
    expect(prisma.itemLista.update).toHaveBeenCalledTimes(1); // só a quantidade do que foi enviado
  });

  it('banido depois de a lista pronta é descartado, não impresso', async () => {
    const { servico, trabalhos, prisma } = montarListas([item('a', 5), item('b', 5, '999')], ['999']);
    const r = await servico.imprimirLista(EMPRESA, 'l1', { itens: [{ id: 'a', quantidade: 5 }, { id: 'b', quantidade: 5 }] }, 'u1');
    expect(prisma.itemLista.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b'] }, empresaId: EMPRESA }, data: { status: 'DESCARTADO' } });
    expect((trabalhos.criar.mock.calls[0][2] as unknown as { itemIds: string[] }).itemIds).toEqual(['a']);
    expect(r.avisos.join()).toMatch(/1 produto\(s\) banido/);
  });

  it('agendamento imprime o que fecha folha e deixa o resto para o próximo ciclo', async () => {
    const m = { nome: 'Gôndola', layout: LAYOUT };
    const pendentes = [
      { id: 'a', quantidade: 3, registro: { ean: 'a' }, modelo: m },
      { id: 'b', quantidade: 2, registro: { ean: 'b' }, modelo: m },
      { id: 'c', quantidade: 1, registro: { ean: 'c' }, modelo: m },
      { id: 'd', quantidade: 1, registro: { ean: 'd' }, modelo: m },
    ];
    const { servico, prisma, trabalhos } = montarListas(pendentes);
    // Total 7 não fecha (4 a 6 por folha); 6 fecha.
    prisma.itemLista.findMany
      .mockResolvedValueOnce(pendentes)
      .mockResolvedValueOnce([item('a', 3), item('b', 2), item('c', 1)]);
    const r = await servico.imprimirPendentesDoModelo(EMPRESA, 'u1', 'm1');
    expect(trabalhos.criar).toHaveBeenCalledTimes(1);
    expect((trabalhos.criar.mock.calls[0][2] as { registros: unknown[] }).registros).toHaveLength(6);
    expect(r.avisos.join()).toMatch(/1 produto\(s\) aguardando/);
  });

  it('agendamento sem o mínimo não imprime nada', async () => {
    const m = { nome: 'Gôndola', layout: LAYOUT };
    const { servico, trabalhos } = montarListas([{ id: 'a', quantidade: 2, registro: { ean: 'a' }, modelo: m }]);
    const r = await servico.imprimirPendentesDoModelo(EMPRESA, 'u1', 'm1');
    expect(trabalhos.criar).not.toHaveBeenCalled();
    expect(r.avisos.join()).toMatch(/aguardando completar o mínimo de 4/);
  });
});
