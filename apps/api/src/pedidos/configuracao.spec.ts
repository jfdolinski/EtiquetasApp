import { BadRequestException } from '@nestjs/common';
import { CONFIG_PEDIDOS_PADRAO, horarioVazio, type ConfigPedidos } from '@etiquetas/shared';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { BanidosService } from '../banidos/banidos.service';
import type { ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FotosProdutoTelaService } from '../telas/fotos';
import { ConfiguracaoPedidosService } from './configuracao';

process.env.JWT_SECRET = 'x'.repeat(32);
process.env.DATABASE_URL = 'postgresql://teste';
process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');

const CONFIG: ConfigPedidos = { ...CONFIG_PEDIDOS_PADRAO, colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaEstoque: 'estoque', enderecoRetirada: 'Rua A, 10' };
const RESULTADO = {
  colunas: [{ nome: 'codigo' }, { nome: 'ean' }, { nome: 'descricao' }, { nome: 'preco' }, { nome: 'estoque' }],
  linhas: [
    [1, '789', 'Arroz', '24,90', 3],
    [2, '790', 'Feijão', 8.49, 0],
    [3, '791', 'Banido', 5, 10],
  ],
};
const CAMPOS = RESULTADO.colunas;

let guardadasNoCatalogo: [string, { nome: string | null; categoria: string | null }][] = [];

function montar(registro: Record<string, unknown> = {}, consulta: Record<string, unknown> = {}) {
  guardadasNoCatalogo = [];
  const atual = { consultaId: 'c1', config: CONFIG, responsavelId: 'u1', responsavel: { ativo: true }, ...registro };
  const tx = {
    configuracaoPedidos: { upsert: jest.fn(async () => ({})) },
    empresa: { update: jest.fn(async () => ({})) },
  };
  const prisma = {
    configuracaoPedidos: {
      findUnique: jest.fn(async (_a?: unknown) => atual as unknown),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [] as unknown[]),
    },
    empresa: { findUnique: jest.fn(async () => ({ horarioFuncionamento: null })) },
    marcaPost: { findUnique: jest.fn(async () => null) },
    consultaSql: { findFirst: jest.fn(async () => ({ id: 'c1', sql: 'SELECT 1', campos: CAMPOS, conexao: { tipo: 'POSTGRES' }, ...consulta })) },
    $transaction: jest.fn(async (f: (t: typeof tx) => Promise<unknown>) => f(tx)),
  };
  const consultas = { executar: jest.fn(async () => RESULTADO) };
  const banidos = { conjunto: jest.fn(async () => new Set(['791'])) };
  const fotos = {
    aplicar: jest.fn(async (_e: string, itens: { codigo?: string }[], _agora?: Date, _rever?: boolean, _comDados?: boolean) => ({
      itens: itens.map((i) => (i.codigo === '789' ? { ...i, foto: '/api/tv/fotos/f1' } : i)),
      faltam: [] as string[],
      guardadas: new Map<string, { nome: string | null; categoria: string | null }>(guardadasNoCatalogo),
    })),
    buscar: jest.fn(async () => null),
  };
  const auditoria = { registrar: jest.fn() };
  const s = new ConfiguracaoPedidosService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService, consultas as unknown as ConsultasService, banidos as unknown as BanidosService, fotos as unknown as FotosProdutoTelaService);
  return { s, prisma, tx, consultas, fotos, auditoria };
}

const dados = (mock: jest.Mock) => (mock.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;

describe('cópia do catálogo', () => {
  it('guarda só quem tem estoque, sem os banidos, em centavos', async () => {
    const { s, prisma, consultas } = montar();
    await s.atualizarDados('e1');
    expect(consultas.executar).toHaveBeenCalledWith('e1', 'c1', 'u1', {}, expect.any(Number));
    const d = dados(prisma.configuracaoPedidos.update);
    expect(d.itens).toEqual([{ codigo: '1', nome: 'Arroz', precoCentavos: 2490, estoque: 3 }]);
    expect(d.quantidadeItens).toBe(1);
    expect(d.erro).toBeNull();
    expect(d.dadosEm).toBeInstanceOf(Date);
  });

  it('nome e categoria do catálogo: substituem os do ERP, e quem não tem fica de fora até o catálogo ter', async () => {
    const ARROZ = '7891000100103';
    const FEIJAO = '7891000100110';
    const { s, prisma, consultas, fotos } = montar({ config: { ...CONFIG, dadosDoCatalogo: true, colunaCodigoBarras: 'ean' } });
    consultas.executar.mockResolvedValueOnce({ colunas: RESULTADO.colunas, linhas: [[1, ARROZ, 'ARROZ T1', 10, 3], [2, FEIJAO, 'FEIJAO', 8, 5], [3, '123', 'SEM EAN', 5, 5]] });
    guardadasNoCatalogo = [[ARROZ, { nome: 'Arroz Tipo 1 5kg', categoria: 'Mercearia' }], [FEIJAO, { nome: 'Feijão Carioca 1kg', categoria: null }]];
    fotos.aplicar.mockImplementationOnce(async (_e: string, itens: { codigo?: string }[]) => ({ itens, faltam: [FEIJAO], guardadas: new Map(guardadasNoCatalogo) }));
    // Enquanto isso, o catálogo ganha a categoria do feijão.
    fotos.buscar.mockImplementationOnce(async () => {
      guardadasNoCatalogo = [[ARROZ, { nome: 'Arroz Tipo 1 5kg', categoria: 'Mercearia' }], [FEIJAO, { nome: 'Feijão Carioca 1kg', categoria: 'Mercearia' }]];
      prisma.configuracaoPedidos.findUnique.mockResolvedValueOnce({ itens: [], dadosEm: dados(prisma.configuracaoPedidos.update).dadosEm });
      return null;
    });
    await s.atualizarDados('e1');
    expect(fotos.aplicar).toHaveBeenCalledWith('e1', expect.any(Array), expect.any(Date), false, true);
    const d = dados(prisma.configuracaoPedidos.update);
    expect(d.itens).toEqual([{ codigo: '1', nome: 'Arroz Tipo 1 5kg', categoria: 'Mercearia', precoCentavos: 1000, estoque: 3, codigoBarras: ARROZ }]);
    expect(d.quantidadeItens).toBe(1);
    expect(fotos.buscar).toHaveBeenCalledWith('e1', [FEIJAO]);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const depois = (prisma.configuracaoPedidos.updateMany.mock.calls as unknown as [{ data: { itens: { nome: string }[]; quantidadeItens: number } }][]).at(-1)![0].data;
    expect(depois.itens.map((i) => i.nome)).toEqual(['Arroz Tipo 1 5kg', 'Feijão Carioca 1kg']);
    expect(depois.quantidadeItens).toBe(2);
  });

  it('Atualizar agora procura na hora os produtos que ainda estão sem foto', async () => {
    const { s, fotos } = montar({ ativo: true, config: { ...CONFIG, comFotos: true, colunaCodigoBarras: 'ean' } });
    fotos.aplicar.mockImplementationOnce(async (_e: string, itens: { codigo?: string }[]) => ({ itens, faltam: ['789'], guardadas: new Map() }));
    await s.atualizarAgora('e1').catch(() => undefined);
    expect(fotos.aplicar).toHaveBeenCalledWith('e1', [{ nome: '', preco: '', codigo: '789' }], expect.any(Date), true, false);
    await new Promise((r) => setImmediate(r));
    expect(fotos.buscar).toHaveBeenCalledWith('e1', ['789']);
  });

  it('com fotos: procura pelo código de barras e põe a foto no produto', async () => {
    const { s, prisma, fotos } = montar({ config: { ...CONFIG, comFotos: true, colunaCodigoBarras: 'ean' } });
    await s.atualizarDados('e1');
    // O relógio respeita o ritmo de conferência: quem está sem foto não é procurado a cada atualização.
    expect(fotos.aplicar).toHaveBeenCalledWith('e1', [{ nome: '', preco: '', codigo: '789' }], expect.any(Date), false, false);
    expect(dados(prisma.configuracaoPedidos.update).itens).toEqual([{ codigo: '1', nome: 'Arroz', precoCentavos: 2490, estoque: 3, codigoBarras: '789', foto: '/api/tv/fotos/f1' }]);
  });

  it('falha ou coluna errada: mantém a cópia anterior e guarda o motivo, sem renovar a validade', async () => {
    const offline = montar();
    offline.consultas.executar.mockRejectedValueOnce(new Error('Agente offline'));
    await offline.s.atualizarDados('e1');
    expect(offline.prisma.configuracaoPedidos.update).not.toHaveBeenCalled();
    expect(offline.prisma.configuracaoPedidos.updateMany).toHaveBeenCalledWith({ where: { empresaId: 'e1' }, data: { erro: 'Agente offline' } });

    const errada = montar({ config: { ...CONFIG, colunaPreco: 'nao_existe' } });
    await errada.s.atualizarDados('e1');
    expect(errada.prisma.configuracaoPedidos.update).not.toHaveBeenCalled();
    expect(errada.prisma.configuracaoPedidos.updateMany).toHaveBeenCalledWith({ where: { empresaId: 'e1' }, data: { erro: expect.stringContaining('nenhum produto') } });
  });

  it('não consulta sem responsável ativo nem sem consulta', async () => {
    for (const r of [{ responsavel: { ativo: false } }, { responsavelId: null, responsavel: null }, { consultaId: null }]) {
      const { s, consultas, prisma } = montar(r);
      await s.atualizarDados('e1');
      expect(consultas.executar).not.toHaveBeenCalled();
      expect(prisma.configuracaoPedidos.updateMany).toHaveBeenCalled();
    }
  });

  it('o relógio reivindica pelo horário antigo e não consulta empresa bloqueada', async () => {
    const { s, prisma, consultas } = montar();
    const antes = new Date('2026-11-10T10:00:00Z');
    prisma.configuracaoPedidos.findMany.mockResolvedValueOnce([
      { empresaId: 'e1', proximaAtualizacaoEm: antes, intervaloMinutos: 15, empresa: { ativa: true, statusAssinatura: 'ATIVA' } },
      { empresaId: 'e2', proximaAtualizacaoEm: antes, intervaloMinutos: 15, empresa: { ativa: true, statusAssinatura: 'BLOQUEADA' } },
    ]);
    await s.verificar(new Date('2026-11-10T10:01:00Z'));
    await new Promise((r) => setImmediate(r));
    expect(prisma.configuracaoPedidos.updateMany).toHaveBeenCalledWith({ where: { empresaId: 'e1', proximaAtualizacaoEm: antes }, data: { proximaAtualizacaoEm: new Date('2026-11-10T10:16:00Z') } });
    expect(prisma.configuracaoPedidos.updateMany).toHaveBeenCalledWith({ where: { empresaId: 'e2', proximaAtualizacaoEm: antes }, data: { proximaAtualizacaoEm: new Date('2026-11-10T10:11:00Z') } });
    expect(consultas.executar).toHaveBeenCalledTimes(1);
  });
});

describe('salvar a configuração', () => {
  const dto = (extra: Record<string, unknown> = {}) => ({ ativo: false, consultaId: 'c1', config: CONFIG, intervaloMinutos: 15, validadeMinutos: 120, horario: horarioVazio(), ...extra });

  it('cria com link aleatório, guarda o horário na empresa e audita; campo estranho do navegador não entra', async () => {
    const { s, tx, auditoria } = montar();
    const horario = horarioVazio();
    horario[1] = [{ inicio: '08:00', fim: '18:00', extra: 'x' } as never];
    await s.salvar('e1', dto({ horario, config: { ...CONFIG, invasor: true } }) as never, 'u1');
    const upsert = (tx.configuracaoPedidos.upsert.mock.calls[0] as unknown as [{ where: unknown; create: { codigoLink: string; config: Record<string, unknown>; responsavelId: string } }])[0];
    expect(upsert.where).toEqual({ empresaId: 'e1' });
    expect(upsert.create.codigoLink).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(upsert.create.config).not.toHaveProperty('invasor');
    expect(upsert.create.responsavelId).toBe('u1');
    expect(tx.empresa.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { horarioFuncionamento: [[], [{ inicio: '08:00', fim: '18:00' }], [], [], [], [], []] } });
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'e1', acao: 'pedido.configurar' }), tx);
  });

  it('recusa configuração incompleta, horário errado, coluna que a consulta não tem e consulta de busca', async () => {
    const { s } = montar();
    await expect(s.salvar('e1', dto({ config: { ...CONFIG, colunaCodigo: '' } }) as never, 'u1')).rejects.toThrow(/código/);
    await expect(s.salvar('e1', dto({ horario: [[]] }) as never, 'u1')).rejects.toThrow(/Horário/);
    await expect(s.salvar('e1', dto({ intervaloMinutos: 60, validadeMinutos: 60 }) as never, 'u1')).rejects.toThrow(/duas atualizações/);
    await expect(s.salvar('e1', dto({ config: { ...CONFIG, colunaUnidade: 'unidade' } }) as never, 'u1')).rejects.toThrow(/“unidade”/);
    const busca = montar({}, { sql: 'SELECT * FROM p WHERE x = {param.busca}' });
    await expect(busca.s.salvar('e1', dto() as never, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('coluna nova no SQL que as colunas guardadas ainda não têm: lê a consulta de novo antes de recusar', async () => {
    const { s, consultas } = montar();
    consultas.executar.mockResolvedValueOnce({ colunas: [...RESULTADO.colunas, { nome: 'marca' }], linhas: [] });
    await expect(s.salvar('e1', dto({ config: { ...CONFIG, camposDetalhe: [{ coluna: 'marca', rotulo: 'Marca' }] } }) as never, 'u1')).resolves.toBeDefined();
    expect(consultas.executar).toHaveBeenCalledWith('e1', 'c1', 'u1', {}, 1);
    // Saiu do SQL: diz onde foi escolhida.
    await expect(s.salvar('e1', dto({ config: { ...CONFIG, camposDetalhe: [{ coluna: 'sumiu', rotulo: 'Sumiu' }] } }) as never, 'u1')).rejects.toThrow('A consulta não traz mais a coluna “sumiu”, escolhida em Detalhe do produto.');
    // Agente desligado: vale o que estava guardado.
    consultas.executar.mockRejectedValueOnce(new Error('agente offline'));
    await expect(s.salvar('e1', dto({ config: { ...CONFIG, colunaUnidade: 'un' } }) as never, 'u1')).rejects.toThrow(/“un”, escolhida em Unidade/);
  });

  it('consulta de outra empresa não é encontrada', async () => {
    const { s, prisma } = montar();
    prisma.consultaSql.findFirst.mockResolvedValueOnce(null as never);
    await expect(s.salvar('e1', dto() as never, 'u1')).rejects.toThrow(/não encontrada/);
    expect(prisma.consultaSql.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', empresaId: 'e1', ativo: true } }));
  });

  it('ligado: atualiza os produtos na hora', async () => {
    const { s, prisma } = montar();
    await s.salvar('e1', dto({ ativo: true }) as never, 'u1');
    expect(prisma.configuracaoPedidos.update).toHaveBeenCalled();
  });

  it('link novo só depois de salvar', async () => {
    const { s, prisma } = montar();
    prisma.configuracaoPedidos.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(s.novoLink('e1', 'u1')).rejects.toThrow(/Salve/);
  });
});
