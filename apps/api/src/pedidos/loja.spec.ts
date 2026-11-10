import { Prisma } from '@prisma/client';
import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CONFIG_PEDIDOS_PADRAO, horarioVazio, type ConfigPedidos, type NovoPedido } from '@etiquetas/shared';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { sha256 } from '../cripto';
import type { PrismaService } from '../prisma/prisma.service';
import { CepService, type ProvedorCep } from './cep';
import { LojaService, MAX_PEDIDOS_POR_ORIGEM_HORA } from './loja';

process.env.JWT_SECRET = 'x'.repeat(32);
process.env.DATABASE_URL = 'postgresql://teste';
process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
process.env.FUSO_HORARIO = 'America/Sao_Paulo';

const CONFIG: ConfigPedidos = {
  ...CONFIG_PEDIDOS_PADRAO,
  colunaCodigo: 'codigo',
  colunaNome: 'descricao',
  colunaPreco: 'preco',
  enderecoRetirada: 'Rua A, 10',
  pedidoMinimoCentavos: 2000,
  modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: true, precoCentavos: 300 }, EXPRESSA: { ativa: true, precoCentavos: 1500 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
};
const ITENS = [
  { codigo: '1', nome: 'Arroz', precoCentavos: 2490, estoque: 5, codigoBarras: '789' },
  { codigo: '2', nome: 'Feijão', precoCentavos: 849 },
];
// Segunda-feira, 10h em São Paulo (13h UTC).
const AGORA = new Date('2026-11-09T13:00:00Z');
const HORARIO = horarioVazio();
HORARIO[1] = [{ inicio: '08:00', fim: '18:00' }];
HORARIO[2] = [{ inicio: '08:00', fim: '18:00' }];

function montar(extra: Record<string, unknown> = {}, empresa: Record<string, unknown> = {}, reservados: { itens: unknown }[] = [], reservadosNaTransacao = reservados) {
  const loja = {
    empresaId: 'e1',
    ativo: true,
    config: CONFIG,
    itens: ITENS,
    dadosEm: new Date(AGORA.getTime() - 60_000),
    validadeMinutos: 120,
    quantidadeItens: 2,
    codigoLink: 'abcdefghijkl',
    logoEm: null,
    empresa: { razaoSocial: 'Mercado LTDA', nomeFantasia: 'Mercadinho', ativa: true, statusAssinatura: 'ATIVA', horarioFuncionamento: HORARIO, ...empresa },
    ...extra,
  };
  const tx = {
    configuracaoPedidos: { update: jest.fn(async () => ({ proximoNumero: 8 })) },
    pedido: { create: jest.fn(async (_a: unknown) => ({ id: 'p1' })), findMany: jest.fn(async () => reservadosNaTransacao) },
  };
  const prisma = {
    configuracaoPedidos: { findUnique: jest.fn(async () => loja as unknown) },
    pedido: { count: jest.fn(async () => 0), findUnique: jest.fn(async () => null as unknown), findMany: jest.fn(async () => reservados) },
    $transaction: jest.fn(async (f: (t: typeof tx) => Promise<unknown>) => f(tx)),
  };
  const auditoria = { registrar: jest.fn() };
  const ceps = { consultar: jest.fn(async () => ({ cep: '01001000', rua: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' })) };
  const s = new LojaService(prisma as unknown as PrismaService, auditoria as unknown as AuditoriaService, ceps as unknown as CepService);
  return { s, prisma, tx, auditoria, ceps };
}

const ENDERECO = { cep: '01001-000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'sp', extra: 'x' };
const PEDIDO: NovoPedido = { itens: [{ codigo: '1', quantidade: 2, precoCentavos: 2490 }], nome: ' Maria ', telefone: '+55 (11) 98765-4321', modalidade: 'ENTREGA', endereco: ENDERECO, agendamento: null, pagamento: 'DINHEIRO', trocoParaCentavos: 10000, observacao: '' };
const CODIGO = 'abcdefghijkl';

describe('catálogo público', () => {
  it('mostra a loja aberta, as modalidades com preço e os produtos sem o código de barras', async () => {
    const { s } = montar();
    const c = await s.catalogo(CODIGO, AGORA);
    expect(c.empresa).toBe('Mercadinho');
    expect(c.aberta).toBe(true);
    expect(c.hoje).toBe('2026-11-09');
    expect(c.modalidades.map((m) => m.modalidade)).toEqual(['ENTREGA', 'AGENDADA', 'EXPRESSA', 'RETIRADA']);
    expect(c.itens[0]).toEqual({ codigo: '1', nome: 'Arroz', precoCentavos: 2490, estoque: 5 });
    expect(c.faixas[0]).toEqual({ data: '2026-11-09', inicio: '12:00', fim: '14:00' });
    expect(c.enderecoRetirada).toBe('Rua A, 10');
  });

  it('fechada: só a agendada, e diz quando abre', async () => {
    const { s } = montar({ dadosEm: new Date('2026-11-09T22:59:00Z') });
    const c = await s.catalogo(CODIGO, new Date('2026-11-09T23:00:00Z'));
    expect(c.aberta).toBe(false);
    expect(c.abreEm).toBe('amanhã às 8h');
    expect(c.modalidades.map((m) => m.modalidade)).toEqual(['AGENDADA']);
    expect(c.enderecoRetirada).toBeNull();
  });

  it('link inexistente, catálogo desligado, vencido e empresa bloqueada não mostram nada', async () => {
    const inexistente = montar();
    inexistente.prisma.configuracaoPedidos.findUnique.mockResolvedValueOnce(null);
    await expect(inexistente.s.catalogo(CODIGO, AGORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(montar().s.catalogo('../x', AGORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(montar({ ativo: false }).s.catalogo(CODIGO, AGORA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(montar({ dadosEm: new Date(AGORA.getTime() - 121 * 60_000) }).s.catalogo(CODIGO, AGORA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(montar({}, { statusAssinatura: 'BLOQUEADA' }).s.catalogo(CODIGO, AGORA)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('enviar o pedido', () => {
  it('grava com o preço do catálogo, número da empresa, código só em hash e dados aparados', async () => {
    const { s, tx, auditoria } = montar();
    const r = await s.criar(CODIGO, PEDIDO as never, '10.0.0.1', AGORA);
    expect(r.numero).toBe(7);
    expect(r.codigo).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const data = (tx.pedido.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({
      empresaId: 'e1',
      numero: 7,
      codigoHash: sha256(r.codigo),
      clienteNome: 'Maria',
      clienteTelefone: '11987654321',
      endereco: { cep: '01001000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' },
      subtotalCentavos: 4980,
      taxaCentavos: 500,
      totalCentavos: 5480,
      trocoParaCentavos: 10000,
      origemHash: sha256('e1:10.0.0.1'),
    });
    expect(data.endereco).not.toHaveProperty('extra');
    expect(data.codigoCifrado).not.toContain(r.codigo);
    expect(data.itens).toEqual([{ codigo: '1', nome: 'Arroz', quantidade: 2, precoCentavos: 2490, codigoBarras: '789' }]);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'e1', usuarioId: null, acao: 'pedido.criar' }), tx);
  });

  it('preço diferente do catálogo ou estoque menor: recusa e devolve o que mudou, sem gravar', async () => {
    const { s, tx } = montar();
    const e = await s.criar(CODIGO, { ...PEDIDO, itens: [{ codigo: '1', quantidade: 9, precoCentavos: 1 }] } as never, '10.0.0.1', AGORA).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ mudancas: [{ tipo: 'ESTOQUE', depois: 5 }, { tipo: 'PRECO', antes: 1, depois: 2490 }] });
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('confere as regras: mínimo, loja fechada, troco', async () => {
    const { s } = montar();
    await expect(s.criar(CODIGO, { ...PEDIDO, itens: [{ codigo: '2', quantidade: 1, precoCentavos: 849 }] } as never, 'ip', AGORA)).rejects.toThrow(/pedido mínimo/);
    await expect(montar({ dadosEm: new Date('2026-11-09T22:59:00Z') }).s.criar(CODIGO, PEDIDO as never, 'ip', new Date('2026-11-09T23:00:00Z'))).rejects.toThrow(/fechada/);
    await expect(s.criar(CODIGO, { ...PEDIDO, trocoParaCentavos: 1000 } as never, 'ip', AGORA)).rejects.toThrow(/troco/);
  });

  it('retirada não guarda endereço; Pix não guarda troco', async () => {
    const { s, tx } = montar();
    await s.criar(CODIGO, { ...PEDIDO, modalidade: 'RETIRADA', endereco: null, pagamento: 'PIX' } as never, 'ip', AGORA);
    const data = (tx.pedido.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.taxaCentavos).toBe(0);
    expect(data.trocoParaCentavos).toBeNull();
    expect(data.endereco).toBe(Prisma.DbNull);
  });

  it('muitos pedidos do mesmo aparelho na mesma loja: recusa', async () => {
    const { s, prisma } = montar();
    prisma.pedido.count.mockResolvedValueOnce(MAX_PEDIDOS_POR_ORIGEM_HORA);
    const e = await s.criar(CODIGO, PEDIDO as never, 'ip', AGORA).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(429);
  });
});

describe('reserva de estoque', () => {
  it('o catálogo desconta o que está em pedidos abertos', async () => {
    const { s, prisma } = montar({}, {}, [{ itens: [{ codigo: '1', quantidade: 4 }] }]);
    const c = await s.catalogo(CODIGO, AGORA);
    expect(c.itens[0]).toMatchObject({ codigo: '1', estoque: 1 });
    expect(prisma.pedido.findMany).toHaveBeenCalledWith({ where: { empresaId: 'e1', situacao: { in: ['NOVO', 'EM_SEPARACAO'] } }, select: { itens: true } });
  });

  it('outro pedido levou a última unidade enquanto este entrava: recusa dentro da transação, sem gravar', async () => {
    const { s, tx } = montar({}, {}, [], [{ itens: [{ codigo: '1', quantidade: 4 }] }]);
    const e = await s.criar(CODIGO, PEDIDO as never, 'ip', AGORA).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ mudancas: [{ tipo: 'ESTOQUE', antes: 2, depois: 1 }] });
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });
});

describe('acompanhamento', () => {
  it('acha pelo hash do código, nunca pelo código guardado', async () => {
    const { s, prisma } = montar();
    await expect(s.acompanhar('codigo-que-nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.pedido.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { codigoHash: sha256('codigo-que-nao-existe') } }));
  });
});

describe('busca de CEP', () => {
  const provedor = (resposta: () => Promise<Response>): ProvedorCep & { chamadas: number } => {
    const p = { nome: 'x', chamadas: 0, url: () => 'http://cep', converter: (cep: string, j: Record<string, unknown>) => (j.erro ? null : { cep, rua: String(j.rua), bairro: '', cidade: 'X', uf: 'SP' }) };
    return p;
  };

  afterEach(() => jest.restoreAllMocks());

  it('primeiro fora do ar: usa o segundo, e guarda para a próxima', async () => {
    const s = new CepService();
    s.provedores = [provedor(async () => new Response()), provedor(async () => new Response())];
    const f = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(new Response(JSON.stringify({ rua: 'Rua B' }), { status: 200 }));
    expect((await s.consultar('01001000')).rua).toBe('Rua B');
    expect((await s.consultar('01001000')).rua).toBe('Rua B');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('não existe: 404; todos fora do ar: 503', async () => {
    const s = new CepService();
    s.provedores = [provedor(async () => new Response())];
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ erro: true }), { status: 200 }));
    await expect(s.consultar('99999999')).rejects.toBeInstanceOf(NotFoundException);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('rede'));
    await expect(s.consultar('88888888')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
