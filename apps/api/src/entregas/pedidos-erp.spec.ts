import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ChamadasService } from './chamadas';
import type { EntregasEmpresaService } from './empresa';
import type { MapasService } from './mapas';
import { PedidosErpService } from './pedidos-erp';

const BASE = { lat: -23.5505, lon: -46.6333, endereco: 'Loja' };

function montar(opcoes: { primeiraLeitura?: boolean; importarExistentes?: boolean; chamarAutomatico?: boolean; existentes?: string[]; base?: typeof BASE | null; achados?: { lat: number; lon: number; endereco: string }[]; linhas?: unknown[][] } = {}) {
  const criadas: Record<string, unknown>[] = [];
  const prisma = {
    configuracaoPedidosErp: {
      findUnique: jest.fn(async () => ({ empresaId: 'emp', ativo: true, consultaId: 'q1', responsavelId: 'u1', responsavel: { ativo: true }, primeiraLeitura: opcoes.primeiraLeitura ?? false, importarExistentes: opcoes.importarExistentes ?? false, chamarAutomatico: opcoes.chamarAutomatico ?? true })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    pedidoErpEntrega: {
      findMany: jest.fn(async () => (opcoes.existentes ?? []).map((codigo) => ({ codigo }))),
      createMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criadas.push(data);
        return { id: `id-${data.codigo}` };
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
        const d = criadas.find((x) => `id-${x.codigo}` === where.id);
        return d ? { id: where.id, dados: d.dados } : null;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const consultas = {
    executar: jest.fn(async () => ({
      colunas: [{ nome: 'pedido' }, { nome: 'cliente' }, { nome: 'endereco' }, { nome: 'lat' }, { nome: 'lon' }],
      linhas: opcoes.linhas ?? [
        ['10', 'Ana', 'Rua A, 1, Santos', -23.96, -46.33],
        ['11', 'Bia', 'Rua B, 2, Santos', null, null],
        ['10', 'Repetido', 'Rua C', null, null],
      ],
    })),
  };
  const chamadas = { criar: jest.fn(async () => ({ id: 'ch', numero: 1 })) };
  const empresas = { config: jest.fn(async () => ({ base: opcoes.base === undefined ? BASE : opcoes.base })) };
  const mapas = { geocodificar: jest.fn(async () => opcoes.achados ?? []) };
  const s = new PedidosErpService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, consultas as unknown as ConsultasService, chamadas as unknown as ChamadasService, empresas as unknown as EntregasEmpresaService, mapas as unknown as MapasService);
  return { s, prisma, consultas, chamadas, mapas };
}

describe('pedidos do ERP', () => {
  it('na primeira leitura, sem "importar existentes", o que já estava fica ignorado', async () => {
    const { s, prisma, chamadas } = montar({ primeiraLeitura: true });
    await s.ler('emp');
    expect(prisma.pedidoErpEntrega.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ codigo: '10', situacao: 'IGNORADO' }), expect.objectContaining({ codigo: '11', situacao: 'IGNORADO' })], skipDuplicates: true });
    expect(chamadas.criar).not.toHaveBeenCalled();
    expect(prisma.configuracaoPedidosErp.update).toHaveBeenCalledWith({ where: { empresaId: 'emp' }, data: expect.objectContaining({ primeiraLeitura: false, erro: null }) });
  });

  it('pedido novo abre a chamada da base ao cliente, com o número do ERP; o já lido não volta', async () => {
    const { s, chamadas, mapas } = montar({ existentes: ['11'] });
    await s.ler('emp');
    expect(chamadas.criar).toHaveBeenCalledTimes(1);
    expect(chamadas.criar).toHaveBeenCalledWith('emp', expect.objectContaining({ tipo: 'ENTREGA', distribuir: true, pedidoErpId: 'id-10', origem: expect.objectContaining({ lat: BASE.lat }), destino: expect.objectContaining({ lat: -23.96, contato: 'Ana' }) }), 'u1');
    expect(mapas.geocodificar).not.toHaveBeenCalled();
  });

  it('sem ponto, procura o endereço; sem achar, fica esperando a empresa', async () => {
    const { s, chamadas, prisma, mapas } = montar({ existentes: ['10'] });
    await s.ler('emp');
    expect(mapas.geocodificar).toHaveBeenCalledWith('Rua B, 2, Santos');
    expect(chamadas.criar).not.toHaveBeenCalled();
    expect(prisma.pedidoErpEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'id-11', situacao: 'PENDENTE' }, data: { mensagem: expect.stringMatching(/não achado no mapa/) } });
  });

  it('sem ponto de partida da empresa, não chama e explica', async () => {
    const { s, chamadas, prisma } = montar({ base: null, existentes: ['11'] });
    await s.ler('emp');
    expect(chamadas.criar).not.toHaveBeenCalled();
    expect(prisma.pedidoErpEntrega.updateMany).toHaveBeenCalledWith({ where: { id: 'id-10', situacao: 'PENDENTE' }, data: { mensagem: expect.stringMatching(/ponto de partida/) } });
  });

  it('com a chamada automática desligada, só grava e espera a empresa', async () => {
    const { s, chamadas, prisma } = montar({ chamarAutomatico: false });
    await s.ler('emp');
    expect(prisma.pedidoErpEntrega.create).toHaveBeenCalledTimes(2);
    expect(chamadas.criar).not.toHaveBeenCalled();
  });

  it('coluna do número faltando: guarda o erro e não grava nada', async () => {
    const { s, prisma, consultas } = montar();
    consultas.executar.mockResolvedValueOnce({ colunas: [{ nome: 'cliente' }, { nome: 'endereco' }], linhas: [['Ana', 'Rua A']] });
    await s.ler('emp');
    expect(prisma.pedidoErpEntrega.create).not.toHaveBeenCalled();
    expect(prisma.configuracaoPedidosErp.updateMany).toHaveBeenCalledWith({ where: { empresaId: 'emp' }, data: { erro: expect.stringMatching(/número do pedido/) } });
  });
});
