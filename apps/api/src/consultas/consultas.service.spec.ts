import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConexoesService } from '../agentes/conexoes.service';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { agoraNoFuso, ConsultasService, hashCampos } from './consultas.service';

const EMPRESA = 'e1';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
});

function consultaBanco(extra: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    conexaoId: 'c1',
    nome: 'Lista',
    descricao: null,
    finalidade: 'LISTA_DIARIA',
    sql: 'SELECT codigo FROM produtos WHERE loja = {empresa.codigo_erp}',
    campos: [],
    camposHash: null,
    camposAtualizadosEm: null,
    ativo: true,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    conexao: { tipo: 'POSTGRES' },
    ...extra,
  };
}

function montar() {
  const prisma = {
    consultaSql: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async (_: unknown) => null as unknown),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => consultaBanco(data)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => consultaBanco(data)),
      delete: jest.fn(),
    },
    empresa: { findUniqueOrThrow: jest.fn(async () => ({ cnpj: '11222333000181', codigoErp: '07', razaoSocial: 'Mercado A' })) },
    usuario: { findUniqueOrThrow: jest.fn(async () => ({ id: 'u1', email: 'u@a.com' })) },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  const conexoes = {
    tipo: jest.fn(async () => 'POSTGRES'),
    executar: jest.fn(async (..._: unknown[]) => ({
      colunas: [
        { nome: 'codigo', tipo: 'INT4' },
        { nome: 'preco', tipo: 'NUMERIC' },
      ],
      linhas: [],
      truncado: false,
      duracaoMs: 3,
    })),
  };
  return {
    servico: new ConsultasService(prisma as unknown as PrismaService, auditoria, conexoes as unknown as ConexoesService),
    prisma,
    conexoes,
  };
}

describe('ConsultasService', () => {
  it('lista e busca só na empresa atual', async () => {
    const { servico, prisma } = montar();
    await servico.listar(EMPRESA);
    expect(prisma.consultaSql.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: EMPRESA } }));
    await expect(servico.obter(EMPRESA, 'q-alheia')).rejects.toThrow(NotFoundException);
    expect(prisma.consultaSql.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'q-alheia', empresaId: EMPRESA } }));
  });

  it('recusa conexão de outra empresa', async () => {
    const { servico, conexoes, prisma } = montar();
    conexoes.tipo.mockRejectedValueOnce(new NotFoundException());
    await expect(servico.criar(EMPRESA, { conexaoId: 'c-alheia', nome: 'X', sql: 'SELECT 1' }, 'u1')).rejects.toThrow(BadRequestException);
    expect(conexoes.tipo).toHaveBeenCalledWith(EMPRESA, 'c-alheia');
    expect(prisma.consultaSql.create).not.toHaveBeenCalled();
  });

  it('recusa SQL com placeholder desconhecido ou entre aspas antes de gravar', async () => {
    const { servico, prisma } = montar();
    await expect(servico.criar(EMPRESA, { conexaoId: 'c1', nome: 'X', sql: 'SELECT {senha}' }, 'u1')).rejects.toThrow(/desconhecido/);
    await expect(servico.criar(EMPRESA, { conexaoId: 'c1', nome: 'X', sql: "SELECT '{data_hoje}'" }, 'u1')).rejects.toThrow(/aspas/);
    expect(prisma.consultaSql.create).not.toHaveBeenCalled();
  });

  it('ao salvar, executa com 1 linha e grava os campos com o hash do SQL', async () => {
    const { servico, conexoes, prisma } = montar();
    const sql = 'SELECT codigo, preco FROM p WHERE loja = {empresa.codigo_erp} AND cod = {param.busca}';
    const r = await servico.criar(EMPRESA, { conexaoId: 'c1', nome: 'Busca', sql }, 'u1');
    expect(conexoes.executar).toHaveBeenCalledWith(EMPRESA, 'c1', 'SELECT codigo, preco FROM p WHERE loja = $1 AND cod = $2', ['07', null], 1);
    const { data } = prisma.consultaSql.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.camposHash).toBe(hashCampos('c1', sql));
    expect(data.campos).toEqual([
      { nome: 'codigo', tipoBanco: 'INT4', categoria: 'numero' },
      { nome: 'preco', tipoBanco: 'NUMERIC', categoria: 'numero' },
    ]);
    expect(r.avisos).toEqual([]);
  });

  it('agente offline: salva mesmo assim, com aviso e campos desatualizados', async () => {
    const { servico, conexoes, prisma } = montar();
    conexoes.executar.mockRejectedValueOnce(new ServiceUnavailableException('O agente desta conexão está offline.'));
    const r = await servico.criar(EMPRESA, { conexaoId: 'c1', nome: 'Lista', sql: 'SELECT 1 AS um' }, 'u1');
    expect(prisma.consultaSql.create).toHaveBeenCalled();
    expect(prisma.consultaSql.update).not.toHaveBeenCalled();
    expect(r.consulta.camposDesatualizados).toBe(true);
    expect(r.avisos[0]).toMatch(/offline/);
  });

  it('prévia: valores vêm do banco próprio, nunca do cliente', async () => {
    const { servico, conexoes } = montar();
    const r = await servico.previa(
      EMPRESA,
      { conexaoId: 'c1', sql: 'SELECT * FROM p WHERE cnpj = {empresa.cnpj} AND u = {usuario.email} AND c = {param.codigo}', parametros: { codigo: '789' } },
      'u1',
    );
    expect(conexoes.executar).toHaveBeenCalledWith(EMPRESA, 'c1', expect.any(String), ['11222333000181', 'u@a.com', '789'], 50);
    expect(r.sqlExecutado).toBe('SELECT * FROM p WHERE cnpj = $1 AND u = $2 AND c = $3');
    // Um "parâmetro" com nome de placeholder fixo não sobrescreve o valor real.
    await servico.previa(EMPRESA, { conexaoId: 'c1', sql: 'SELECT {empresa.cnpj}', parametros: { 'empresa.cnpj': 'x' } }, 'u1').catch((e) => e);
    expect(conexoes.executar).toHaveBeenCalledTimes(1);
  });

  it('prévia: exige os valores de {param.*}', async () => {
    const { servico } = montar();
    await expect(servico.previa(EMPRESA, { conexaoId: 'c1', sql: 'SELECT {param.codigo}' }, 'u1')).rejects.toThrow(/param\.codigo/);
  });

  it('campos ficam desatualizados quando o SQL muda', async () => {
    const { servico, prisma } = montar();
    prisma.consultaSql.findFirst.mockResolvedValue(consultaBanco({ camposHash: hashCampos('c1', 'SELECT 1') }));
    expect((await servico.obter(EMPRESA, 'q1')).camposDesatualizados).toBe(true);
    prisma.consultaSql.findFirst.mockResolvedValue(consultaBanco({ sql: 'SELECT 1', camposHash: hashCampos('c1', 'SELECT 1') }));
    expect((await servico.obter(EMPRESA, 'q1')).camposDesatualizados).toBe(false);
  });
});

describe('agoraNoFuso', () => {
  it('usa a data local do fuso, não a UTC', () => {
    // 02:30 UTC de 30/10 ainda é 29/10 em São Paulo (UTC-3).
    const r = agoraNoFuso(new Date('2026-10-30T02:30:00Z'), 'America/Sao_Paulo');
    expect(r).toEqual({ data: '2026-10-29', dataHora: '2026-10-29 23:30:00' });
  });
});
