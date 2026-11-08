import { ConflictException, BadRequestException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import type { BanidosService } from '../banidos/banidos.service';
import type { ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ConteudosTelaService } from './conteudos';

process.env.JWT_SECRET = 'x'.repeat(32);
process.env.DATABASE_URL = 'postgresql://teste';
process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');

const CONFIG = { titulo: 'Ofertas', rodape: '', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: null, colunaDetalhe: null, segundosPorCena: 8, corFundo: '#000000', corDestaque: '#ffffff' };
const RESULTADO = { colunas: [{ nome: 'ean' }, { nome: 'descricao' }, { nome: 'preco' }], linhas: [['789', 'Arroz', 10], ['790', 'Feijão', 8], ['791', 'Banido', 5]] };

function montar(conteudo: Record<string, unknown> = {}) {
  const registro = { empresaId: 'e1', consultaId: 'c1', config: CONFIG, responsavelId: 'u1', responsavel: { ativo: true }, ...conteudo };
  const prisma = {
    conteudoTela: {
      findUnique: jest.fn(async () => registro),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [] as unknown[]),
      findFirst: jest.fn(async () => ({ id: 'x', consultaId: 'c1', intervaloMinutos: 15 })),
    },
    parametroTelas: { findFirst: jest.fn(async () => null as unknown) },
    tela: { count: jest.fn(async () => 1) },
    consultaSql: { findFirst: jest.fn(async () => ({ id: 'c1', sql: 'SELECT 1', campos: [], conexao: { tipo: 'POSTGRES' } })) },
  };
  const consultas = { executar: jest.fn(async () => RESULTADO) };
  const banidos = { conjunto: jest.fn(async () => new Set(['791'])) };
  const s = new ConteudosTelaService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, consultas as unknown as ConsultasService, banidos as unknown as BanidosService);
  return { s, prisma, consultas };
}

describe('cópia dos dados', () => {
  it('guarda os itens sem os banidos, e limpa o erro anterior', async () => {
    const { s, prisma, consultas } = montar();
    await s.atualizarDados('x');
    expect(consultas.executar).toHaveBeenCalledWith('e1', 'c1', 'u1', {}, expect.any(Number));
    const dados = (prisma.conteudoTela.update.mock.calls[0] as unknown as [{ data: { itens: { nome: string }[]; quantidadeItens: number; erro: null; dadosEm: Date } }])[0].data;
    expect(dados.itens.map((i) => i.nome)).toEqual(['Arroz', 'Feijão']);
    expect(dados.quantidadeItens).toBe(2);
    expect(dados.erro).toBeNull();
    expect(dados.dadosEm).toBeInstanceOf(Date);
  });

  it('agente fora do ar: mantém os dados e guarda o motivo, sem renovar a validade', async () => {
    const { s, prisma, consultas } = montar();
    consultas.executar.mockRejectedValueOnce(new Error('Agente offline'));
    await s.atualizarDados('x');
    expect(prisma.conteudoTela.update).not.toHaveBeenCalled();
    expect(prisma.conteudoTela.updateMany).toHaveBeenCalledWith({ where: { id: 'x' }, data: { erro: 'Agente offline' } });
  });

  it('coluna errada não apaga o que está no ar nem renova a validade', async () => {
    const { s, prisma } = montar({ config: { ...CONFIG, colunaPreco: 'nao_existe' } });
    await s.atualizarDados('x');
    expect(prisma.conteudoTela.update).not.toHaveBeenCalled();
    expect(prisma.conteudoTela.updateMany).toHaveBeenCalledWith({ where: { id: 'x' }, data: { erro: expect.stringContaining('nome e preço') } });
  });

  it('não consulta sem responsável ativo nem sem consulta', async () => {
    for (const c of [{ responsavel: { ativo: false } }, { responsavelId: null, responsavel: null }, { consultaId: null }]) {
      const { s, consultas, prisma } = montar(c);
      await s.atualizarDados('x');
      expect(consultas.executar).not.toHaveBeenCalled();
      expect(prisma.conteudoTela.updateMany).toHaveBeenCalled();
    }
  });
});

describe('verificação periódica', () => {
  const vencido = (extra: Record<string, unknown> = {}) => ({ id: 'x', proximaAtualizacaoEm: new Date('2026-11-08T12:00:00Z'), intervaloMinutos: 15, horarioInicio: null, horarioFim: null, dataInicio: null, dataFim: null, empresa: { ativa: true, statusAssinatura: 'ATIVA' }, ...extra });
  const agora = new Date('2026-11-08T12:00:30Z');

  it('reivindica no horário antigo: duas verificações não atualizam o mesmo conteúdo', async () => {
    const { s, prisma } = montar();
    const atualizar = jest.spyOn(s, 'atualizarDados').mockResolvedValue();
    prisma.conteudoTela.findMany.mockResolvedValueOnce([vencido()]);
    prisma.conteudoTela.updateMany.mockResolvedValueOnce({ count: 0 });
    await s.verificar(agora);
    expect(atualizar).not.toHaveBeenCalled();
    expect(prisma.conteudoTela.updateMany).toHaveBeenCalledWith({ where: { id: 'x', proximaAtualizacaoEm: vencido().proximaAtualizacaoEm }, data: { proximaAtualizacaoEm: new Date(agora.getTime() + 15 * 60_000) } });
  });

  it('no horário, atualiza', async () => {
    const { s, prisma } = montar();
    const atualizar = jest.spyOn(s, 'atualizarDados').mockResolvedValue();
    prisma.conteudoTela.findMany.mockResolvedValueOnce([vencido()]);
    await s.verificar(agora);
    expect(atualizar).toHaveBeenCalledWith('x');
  });

  it('fora da data não consulta o banco do cliente, e confere de novo em um minuto', async () => {
    const { s, prisma } = montar();
    const atualizar = jest.spyOn(s, 'atualizarDados').mockResolvedValue();
    prisma.conteudoTela.findMany.mockResolvedValueOnce([vencido({ dataFim: '2026-01-01' })]);
    await s.verificar(agora);
    expect(atualizar).not.toHaveBeenCalled();
    expect(prisma.conteudoTela.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { proximaAtualizacaoEm: new Date(agora.getTime() + 60_000) } }));
  });

  it('empresa bloqueada não consulta', async () => {
    const { s, prisma } = montar();
    const atualizar = jest.spyOn(s, 'atualizarDados').mockResolvedValue();
    prisma.conteudoTela.findMany.mockResolvedValueOnce([vencido({ empresa: { ativa: true, statusAssinatura: 'BLOQUEADA' } })]);
    await s.verificar(agora);
    expect(atualizar).not.toHaveBeenCalled();
  });
});

describe('programação da tela', () => {
  const linha = (extra: Record<string, unknown> = {}) => ({
    id: 'p1',
    nome: 'Ofertas',
    modelo: 'DESTAQUE',
    config: CONFIG,
    itens: [{ nome: 'Arroz', preco: 'R$ 10,00' }],
    dadosEm: new Date('2026-11-08T11:50:00Z'),
    atualizadoEm: new Date('2026-11-08T11:50:00Z'),
    validadeMinutos: 60,
    horarioInicio: null,
    horarioFim: null,
    dataInicio: null,
    dataFim: null,
    ...extra,
  });
  const agora = new Date('2026-11-08T12:00:00Z');

  it('filtra pela empresa e pela tela, e entrega só o que o player precisa', async () => {
    const { s, prisma } = montar();
    prisma.conteudoTela.findMany.mockResolvedValue([linha()]);
    const r = await s.programacaoDaTela('e1', 't1', agora);
    expect(prisma.conteudoTela.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ empresaId: 'e1', publicado: true, telas: { some: { telaId: 't1' } } }) }));
    expect(r.programas).toHaveLength(1);
    expect(r.programas[0].validoAte).toBe('2026-11-08T12:50:00.000Z');
    expect(JSON.stringify(r)).not.toContain('colunaPreco');
  });

  it('dado vencido e fora do horário não saem', async () => {
    const { s, prisma } = montar();
    prisma.conteudoTela.findMany.mockResolvedValue([linha({ dadosEm: new Date('2026-11-08T10:00:00Z') }), linha({ id: 'p2', dataFim: '2026-01-01' })]);
    expect((await s.programacaoDaTela('e1', 't1', agora)).programas).toEqual([]);
  });

  it('a versão muda com dados novos e quando o conteúdo vence', async () => {
    const { s, prisma } = montar();
    prisma.conteudoTela.findMany.mockResolvedValue([linha()]);
    const antes = await s.versaoDaProgramacao('e1', 't1', agora);
    prisma.conteudoTela.findMany.mockResolvedValue([linha({ dadosEm: new Date('2026-11-08T11:55:00Z') })]);
    const depois = await s.versaoDaProgramacao('e1', 't1', agora);
    expect(depois).not.toBe(antes);
    prisma.conteudoTela.findMany.mockResolvedValue([linha()]);
    const vencida = await s.versaoDaProgramacao('e1', 't1', new Date('2026-11-08T13:00:00Z'));
    expect(vencida).not.toBe(antes);
  });
});

describe('publicar', () => {
  const autor = { id: 'u1' } as UsuarioRequisicao;

  it('com aprovação obrigatória, recusa em vez de passar por cima', async () => {
    const { s, prisma } = montar();
    prisma.parametroTelas.findFirst.mockResolvedValue({ valores: { aprovacaoObrigatoria: true } });
    await expect(s.publicar('e1', 'x', ['t1'], autor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tela.count).not.toHaveBeenCalled();
  });

  it('recusa tela de outra empresa', async () => {
    const { s, prisma } = montar();
    prisma.tela.count.mockResolvedValue(1);
    await expect(s.publicar('e1', 'x', ['t1', 't2'], autor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tela.count).toHaveBeenCalledWith({ where: { empresaId: 'e1', id: { in: ['t1', 't2'] } } });
  });

  it('recusa consulta que pede parâmetro', async () => {
    const { s, prisma } = montar();
    prisma.consultaSql.findFirst.mockResolvedValue({ id: 'c1', sql: 'SELECT * FROM p WHERE c = {param.busca}', campos: [], conexao: { tipo: 'POSTGRES' } });
    await expect(s.publicar('e1', 'x', ['t1'], autor)).rejects.toThrow(/valores digitados/);
  });
});
