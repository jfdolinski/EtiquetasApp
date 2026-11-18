import { REGRAS_DIRECIONAMENTO_PADRAO, type RegrasDirecionamento } from '@etiquetas/shared';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DirecionamentoService } from './direcionamento';
import type { EntregasEmpresaService } from './empresa';

const SE = { lat: -23.5505, lon: -46.6333 };
const agora = new Date('2026-11-18T15:00:00Z');

function montar(chamada: Record<string, unknown>, regras: Partial<RegrasDirecionamento>, entregadores: Record<string, unknown>[]) {
  const c = { empresa_id: 'emp', situacao: 'ABERTA', tipo: 'ENTREGA', origem: { ...SE, endereco: 'Sé' }, distribuicao_ativa: true, rodada: 0, tentativas: 0, sem_entregador_em: null, ...chamada };
  const tx = {
    $queryRaw: jest.fn(async () => [c]),
    $executeRaw: jest.fn(async () => 1),
    ofertaChamada: { count: jest.fn(async () => 0), create: jest.fn(async () => ({})), groupBy: jest.fn(async () => []) },
    chamadaEntrega: { update: jest.fn(async () => ({})), groupBy: jest.fn(async () => []) },
    entregador: { findMany: jest.fn(async () => entregadores) },
  };
  const prisma = { $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)) };
  const empresas = { config: jest.fn(async () => ({ segundosParaAceitar: 45, direcionamento: { ...REGRAS_DIRECIONAMENTO_PADRAO, ...regras } })) };
  const s = new DirecionamentoService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, empresas as unknown as EntregasEmpresaService);
  return { s, tx };
}

const ent = (id: string, metrosAoNorte: number, x: Record<string, unknown> = {}) => ({
  id,
  nome: `${id} Silva`,
  veiculo: 'MOTO',
  lat: SE.lat + metrosAoNorte / 111_320,
  lon: SE.lon,
  onlineDesde: new Date(agora.getTime() - 30 * 60_000),
  empresas: [],
  chamadas: [],
  ofertas: [],
  ...x,
});

describe('passo da distribuição', () => {
  it('oferece ao melhor e grava o porquê', async () => {
    const { s, tx } = montar({}, {}, [ent('longe', 6000), ent('perto', 500)]);
    await s.passo('c1', agora);
    expect(tx.ofertaChamada.create).toHaveBeenCalledTimes(1);
    expect(tx.ofertaChamada.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entregadorId: 'perto', expiraEm: new Date(agora.getTime() + 45_000), motivo: expect.objectContaining({ posicao: 1, total: 2, automatica: true }) }) });
    expect(tx.chamadaEntrega.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { tentativas: { increment: 1 }, proximaTentativaEm: new Date(agora.getTime() + 45_000) } });
    expect(String((tx.$executeRaw.mock.calls[0] as unknown[])[1])).toContain('Oferecida automaticamente a perto (0,5 km');
  });

  it('em grupo, oferece aos N melhores ao mesmo tempo', async () => {
    const { s, tx } = montar({}, { modo: 'GRUPO', tamanhoGrupo: 2 }, [ent('a', 500), ent('b', 900), ent('c', 1500)]);
    await s.passo('c1', agora);
    expect(tx.ofertaChamada.create.mock.calls.map((x) => (x as unknown as [{ data: { entregadorId: string } }])[0].data.entregadorId)).toEqual(['a', 'b']);
  });

  it('sem ninguém no raio: próxima rodada com o raio maior, depois do intervalo', async () => {
    const { s, tx } = montar({}, {}, [ent('longe', 9500)]);
    await s.passo('c1', agora);
    expect(tx.ofertaChamada.create).not.toHaveBeenCalled();
    expect(tx.chamadaEntrega.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { rodada: { increment: 1 }, tentativas: 0, proximaTentativaEm: new Date(agora.getTime() + 2 * 60_000), semEntregadorEm: agora } });
    expect(String((tx.$executeRaw.mock.calls[0] as unknown[])[1])).toContain('Ninguém disponível em até 8 km. Nova tentativa a cada 2 min com raio de 10 km.');
  });

  it('esgotou as tentativas da rodada: espera, mesmo com gente disponível', async () => {
    const { s, tx } = montar({ tentativas: 5, rodada: 4, sem_entregador_em: new Date(agora.getTime() - 60_000) }, {}, [ent('perto', 500)]);
    await s.passo('c1', agora);
    expect(tx.entregador.findMany).not.toHaveBeenCalled();
    expect(tx.ofertaChamada.create).not.toHaveBeenCalled();
    // Raio já no limite (15 km) e aviso já dado: nada novo no histórico.
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('não mexe em chamada aceita, parada ou com oferta esperando', async () => {
    for (const [c, pendente] of [[{ situacao: 'ACEITA' }, 0], [{ distribuicao_ativa: false }, 0], [{}, 1]] as const) {
      const { s, tx } = montar(c, {}, [ent('perto', 500)]);
      tx.ofertaChamada.count.mockResolvedValue(pendente);
      await s.passo('c1', agora);
      expect(tx.ofertaChamada.create).not.toHaveBeenCalled();
    }
  });

  it('bloqueado e veículo não aceito ficam de fora', async () => {
    const { s, tx } = montar({}, { veiculos: { ...REGRAS_DIRECIONAMENTO_PADRAO.veiculos, ENTREGA: ['CARRO'] } }, [ent('moto', 300), ent('carro', 2000, { veiculo: 'CARRO', empresas: [{ preferido: false, bloqueado: true }] })]);
    await s.passo('c1', agora);
    expect(tx.ofertaChamada.create).not.toHaveBeenCalled();
  });
});
