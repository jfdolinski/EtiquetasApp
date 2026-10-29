import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConexoesService } from '../agentes/conexoes.service';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { hashSql, type ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ErpEmpresaService } from './erp-empresa.service';
import { ErpsService } from './erps.service';

const EMPRESA = 'e1';
const agora = new Date();

function template(id: string, nome: string, sql: string, camposEsperados: unknown[] = []) {
  return { id, nome, descricao: null, finalidade: 'LISTA_DIARIA', sql, camposEsperados, ordem: 0, atualizadoEm: agora };
}

function sistema(extra: Record<string, unknown> = {}) {
  return {
    id: 's1',
    nome: 'ERP X',
    fabricante: null,
    tipoBanco: 'SQLSERVER',
    descricao: null,
    ativo: true,
    atualizadoEm: agora,
    _count: { consultas: 1, empresas: 0 },
    consultas: [template('t1', 'Lista', 'SELECT TOP 10 codigo FROM produtos WHERE loja = {empresa.codigo_erp}')],
    ...extra,
  };
}

describe('ErpsService', () => {
  function montar(s = sistema()) {
    const prisma = {
      sistemaErp: { findUnique: jest.fn(async () => s as unknown), update: jest.fn(), delete: jest.fn(), create: jest.fn() },
      templateConsulta: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...template('n', String(data.nome), String(data.sql)), ...data })),
        update: jest.fn(),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const auditoria = { registrar: jest.fn() } as unknown as AuditoriaService;
    return { servico: new ErpsService(prisma as unknown as PrismaService, auditoria), prisma };
  }

  it('valida o SQL do template no dialeto do ERP', async () => {
    const { servico, prisma } = montar();
    // $1 é parâmetro cru do PostgreSQL; no SQL Server "?" e @p1 também são recusados.
    await expect(servico.criarConsulta('s1', { nome: 'X', sql: 'SELECT * FROM t WHERE a = @p1' }, 'u')).rejects.toThrow(BadRequestException);
    await expect(servico.criarConsulta('s1', { nome: 'X', sql: "SELECT '{data_hoje}'" }, 'u')).rejects.toThrow(/aspas/);
    expect(prisma.templateConsulta.create).not.toHaveBeenCalled();
  });

  it('recusa mapeamento com campo repetido', async () => {
    const { servico } = montar();
    await expect(
      servico.criarConsulta('s1', { nome: 'X', sql: 'SELECT 1 AS a', camposEsperados: [{ campo: 'preco' }, { campo: 'PRECO' }] }, 'u'),
    ).rejects.toThrow(/repetidos/);
  });

  it('trocar o tipo de banco revalida todas as consultas do template', async () => {
    const { servico, prisma } = montar(sistema({ consultas: [template('t1', 'Lista', 'SELECT [codigo] FROM t WHERE a = ?')] }));
    // No SQL Server "?" seria só um caractere; no MySQL vira parâmetro cru e é recusado.
    await expect(servico.atualizar('s1', { tipoBanco: 'MYSQL' }, 'u')).rejects.toThrow(/Lista/);
    expect(prisma.sistemaErp.update).not.toHaveBeenCalled();
  });

  it('não exclui ERP com empresas vinculadas', async () => {
    const { servico, prisma } = montar(sistema({ _count: { consultas: 1, empresas: 2 } }));
    await expect(servico.excluir('s1', 'u')).rejects.toThrow(ConflictException);
    expect(prisma.sistemaErp.delete).not.toHaveBeenCalled();
  });
});

describe('ErpEmpresaService', () => {
  function montar(opcoes: { semErp?: boolean; tipoConexao?: string; copias?: unknown[]; nomes?: string[] } = {}) {
    const s = sistema({
      consultas: [
        template('t1', 'Lista', 'SELECT codigo, preco FROM p', [{ campo: 'codigo' }, { campo: 'preco' }, { campo: 'ean' }]),
        template('t2', 'Busca', 'SELECT codigo FROM p WHERE ean = {param.busca}'),
      ],
    });
    const prisma = {
      empresa: { findUniqueOrThrow: jest.fn(async () => ({ sistemaErp: opcoes.semErp ? null : s })) },
      consultaSql: {
        findMany: jest.fn(async (args: { select: Record<string, unknown> }) =>
          'sql' in args.select ? (opcoes.copias ?? []) : (opcoes.nomes ?? []).map((nome) => ({ nome })),
        ),
      },
    };
    const consultas = {
      criar: jest.fn(async (_e: string, dto: { nome: string }) => ({ consulta: { id: `c-${dto.nome}` }, avisos: [] })),
    };
    const conexoes = { tipo: jest.fn(async () => opcoes.tipoConexao ?? 'SQLSERVER') };
    return {
      servico: new ErpEmpresaService(prisma as unknown as PrismaService, consultas as unknown as ConsultasService, conexoes as unknown as ConexoesService),
      consultas,
      conexoes,
    };
  }

  it('sem ERP vinculado não copia', async () => {
    const { servico } = montar({ semErp: true });
    await expect(servico.copiar(EMPRESA, { conexaoId: 'c1' }, 'u')).rejects.toThrow(/não tem ERP/);
  });

  it('exige conexão da empresa com o mesmo tipo de banco do ERP', async () => {
    const { servico, conexoes } = montar({ tipoConexao: 'POSTGRES' });
    await expect(servico.copiar(EMPRESA, { conexaoId: 'c1' }, 'u')).rejects.toThrow(/SQLSERVER/);
    expect(conexoes.tipo).toHaveBeenCalledWith(EMPRESA, 'c1');
  });

  it('copia com vínculo ao template, ajusta nome em conflito e pula o que já foi copiado', async () => {
    const copia = { id: 'cx', nome: 'Lista', sql: 'SELECT codigo, preco FROM p', campos: [], templateConsultaId: 't1', templateSqlHash: hashSql('SELECT codigo, preco FROM p') };
    const { servico, consultas } = montar({ copias: [copia], nomes: ['Lista', 'Busca'] });
    const r = await servico.copiar(EMPRESA, { conexaoId: 'c1' }, 'u');
    expect(consultas.criar).toHaveBeenCalledTimes(1);
    expect(consultas.criar).toHaveBeenCalledWith(
      EMPRESA,
      expect.objectContaining({ conexaoId: 'c1', nome: 'Busca (2)', sql: 'SELECT codigo FROM p WHERE ean = {param.busca}' }),
      'u',
      { templateConsultaId: 't2', sql: 'SELECT codigo FROM p WHERE ean = {param.busca}' },
    );
    expect(r.avisos.join()).toMatch(/"Lista" já foi copiada/);
    expect(r.avisos.join()).toMatch(/copiada como "Busca \(2\)"/);
  });

  it('recusa ids que não são do template do ERP da empresa', async () => {
    const { servico } = montar();
    await expect(servico.copiar(EMPRESA, { conexaoId: 'c1', templateIds: ['t-de-outro-erp'] }, 'u')).rejects.toThrow(/não pertencem/);
  });

  it('situação e campos faltando da cópia', async () => {
    const copia = {
      id: 'cx',
      nome: 'Lista',
      sql: 'SELECT codigo FROM p -- ajustada',
      campos: [{ nome: 'CODIGO' }],
      templateConsultaId: 't1',
      templateSqlHash: hashSql('SELECT codigo, preco FROM p'),
    };
    const { servico } = montar({ copias: [copia] });
    const r = await servico.obter(EMPRESA);
    expect(r.consultas[0].copia).toEqual({ id: 'cx', nome: 'Lista', situacao: 'ajustada', camposFaltando: ['preco', 'ean'] });
    expect(r.consultas[1].copia).toBeNull();
  });
});
