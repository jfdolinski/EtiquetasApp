import { randomBytes } from 'node:crypto';
import { BadRequestException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { decifrar } from '../cripto';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentesGateway } from './agentes.gateway';
import { ConexoesService } from './conexoes.service';
import { AgenteDesconectado, ErroDoAgente } from './sessao-agente';

const EMPRESA = 'e1';
const CHAVE = randomBytes(32);

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = CHAVE.toString('base64');
});

function conexaoBanco(extra: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    agenteId: 'a1',
    nome: 'ERP',
    tipo: 'POSTGRES',
    host: 'db',
    porta: 5432,
    banco: 'erp',
    usuario: 'leitura',
    senhaCifrada: null,
    opcoes: {},
    ativo: true,
    criadoEm: new Date(),
    ...extra,
  };
}

function montar() {
  const prisma = {
    conexaoBanco: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null as unknown),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => conexaoBanco(data)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => conexaoBanco(data)),
      delete: jest.fn(async () => undefined),
    },
    agente: { findFirst: jest.fn(async () => null as unknown) },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  const requisitar = jest.fn(async () => ({}) as unknown);
  const gateway = {
    enviarConfiguracao: jest.fn(async () => undefined),
    sessao: jest.fn(() => ({ requisitar })),
  } as unknown as jest.Mocked<AgentesGateway>;
  return {
    servico: new ConexoesService(prisma as unknown as PrismaService, auditoria, gateway),
    prisma,
    gateway,
    requisitar,
    auditoria,
  };
}

const NOVA = { agenteId: 'a1', nome: 'ERP', tipo: 'POSTGRES' as const, host: 'db', porta: 5432, banco: 'erp', usuario: 'leitura' };

describe('ConexoesService', () => {
  it('recusa agente de outra empresa', async () => {
    const { servico, prisma } = montar();
    await expect(servico.criar(EMPRESA, NOVA, 'autor')).rejects.toThrow(BadRequestException);
    expect(prisma.agente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', empresaId: EMPRESA } }));
    expect(prisma.conexaoBanco.create).not.toHaveBeenCalled();
  });

  it('cifra a senha, nunca a devolve e reenvia a configuração ao agente', async () => {
    const { servico, prisma, gateway, auditoria } = montar();
    prisma.agente.findFirst.mockResolvedValue({ id: 'a1' });
    const r = await servico.criar(EMPRESA, { ...NOVA, senha: 's3nh@' }, 'autor');
    const { data } = prisma.conexaoBanco.create.mock.calls[0][0] as { data: Record<string, string> };
    expect(data.empresaId).toBe(EMPRESA);
    expect(data).not.toHaveProperty('senha');
    expect(decifrar(data.senhaCifrada, CHAVE)).toBe('s3nh@');
    expect(r).toMatchObject({ temSenha: true });
    expect(r).not.toHaveProperty('senhaCifrada');
    expect(JSON.stringify((auditoria.registrar as jest.Mock).mock.calls)).not.toContain('s3nh@');
    expect(gateway.enviarConfiguracao).toHaveBeenCalledWith('a1');
  });

  it('mantém a senha quando o campo não vem e remove com string vazia', async () => {
    const { servico, prisma } = montar();
    prisma.conexaoBanco.findFirst.mockResolvedValue(conexaoBanco({ senhaCifrada: 'v1:x' }));
    await servico.atualizar(EMPRESA, 'c1', { nome: 'ERP 2' }, 'autor');
    expect((prisma.conexaoBanco.update.mock.calls[0][0] as { data: { senhaCifrada?: unknown } }).data.senhaCifrada).toBeUndefined();
    await servico.atualizar(EMPRESA, 'c1', { senha: '' }, 'autor');
    expect((prisma.conexaoBanco.update.mock.calls[1][0] as { data: { senhaCifrada?: unknown } }).data.senhaCifrada).toBeNull();
  });

  it('não encontra conexão de outra empresa', async () => {
    const { servico, prisma } = montar();
    await expect(servico.consultar(EMPRESA, 'c-alheia', { sql: 'select 1' }, 'autor')).rejects.toThrow(NotFoundException);
    expect(prisma.conexaoBanco.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-alheia', empresaId: EMPRESA } }));
  });

  it('envia a consulta ao agente da conexão', async () => {
    const { servico, prisma, gateway, requisitar } = montar();
    prisma.conexaoBanco.findFirst.mockResolvedValue(conexaoBanco({ opcoes: { tempoLimiteSegundos: 5 } }));
    await servico.consultar(EMPRESA, 'c1', { sql: 'select 1', limiteLinhas: 10 }, 'autor');
    expect(gateway.sessao).toHaveBeenCalledWith('a1');
    expect(requisitar).toHaveBeenCalledWith(
      'consultar',
      { conexaoId: 'c1', sql: 'select 1', parametros: [], limiteLinhas: 10, tempoLimiteSegundos: 5 },
      15_000,
    );
  });

  it('traduz agente offline e erro do banco em respostas HTTP', async () => {
    const { servico, prisma, gateway, requisitar } = montar();
    prisma.conexaoBanco.findFirst.mockResolvedValue(conexaoBanco());
    gateway.sessao.mockImplementationOnce(() => {
      throw new AgenteDesconectado('offline');
    });
    await expect(servico.testar(EMPRESA, 'c1')).rejects.toThrow(ServiceUnavailableException);
    requisitar.mockRejectedValueOnce(new ErroDoAgente('banco', 'password authentication failed'));
    await expect(servico.testar(EMPRESA, 'c1')).rejects.toThrow(UnprocessableEntityException);
  });
});
