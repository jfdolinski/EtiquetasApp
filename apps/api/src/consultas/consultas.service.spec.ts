import { BadRequestException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
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
  const referencias = referenciasDoTeste;
  const prisma = {
    referenciaCampo: { findMany: jest.fn(async () => referencias) },
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

let referenciasDoTeste: { alias: string; nome: string; alternativos: string[]; obrigatoriaEm: string[] }[] = [];

afterEach(() => {
  referenciasDoTeste = [];
});

describe('buscarPorTermo', () => {
  const SQL = 'SELECT ean, descricao FROM produtos WHERE loja = {empresa.codigo_erp}';
  const CAMPOS = [
    { nome: 'ean', tipoBanco: 'VARCHAR', categoria: 'texto' },
    { nome: 'descricao', tipoBanco: 'VARCHAR', categoria: 'texto' },
  ];
  const resultado = (linhas: unknown[][], truncado = false) => ({ colunas: [{ nome: 'ean', tipo: 'VARCHAR' }], linhas, truncado, duracaoMs: 1 });
  const preparar = (extra: Record<string, unknown> = {}) => {
    const m = montar();
    m.prisma.consultaSql.findFirst.mockResolvedValue(consultaBanco({ sql: SQL, campos: CAMPOS, camposHash: hashCampos('c1', SQL), ...extra }));
    return m;
  };
  const chamadas = (m: ReturnType<typeof montar>) => m.conexoes.executar.mock.calls.map((c) => ({ sql: c[2] as string, parametros: c[3], limite: c[4] }));

  it('código exato achado no banco: uma consulta só, filtrada e com parâmetro ligado', async () => {
    const m = preparar();
    m.conexoes.executar.mockResolvedValueOnce(resultado([['789']]) as never);
    const r = await m.servico.buscarPorTermo(EMPRESA, 'q1', 'u1', '789', 5000);
    expect(r.linhas).toEqual([['789']]);
    const [c, ...resto] = chamadas(m);
    expect(resto).toEqual([]);
    expect(c.sql).toContain('"ean" = $');
    // O valor de {empresa.codigo_erp} segue vindo do banco próprio, dentro do filtro.
    expect(c.sql).toContain('loja = $');
    expect(c.parametros).toEqual(expect.arrayContaining(['07', '789']));
    expect(c.sql).not.toContain("'789'");
  });

  it('sem código exato, procura o texto contido; vazio aí é "não está no banco", sem ler a tabela', async () => {
    const m = preparar();
    m.conexoes.executar.mockResolvedValue(resultado([]) as never);
    const r = await m.servico.buscarPorTermo(EMPRESA, 'q1', 'u1', 'feijao', 5000);
    expect(r.linhas).toEqual([]);
    const c = chamadas(m);
    expect(c).toHaveLength(2);
    expect(c[1].sql).toContain('LIKE');
    expect(c[1].parametros).toEqual(expect.arrayContaining(['%f__j__%']));
  });

  it('banco recusa o filtro (ORDER BY no SQL Server): lê as linhas como antes e avisa se ficou incompleto', async () => {
    const m = preparar();
    m.conexoes.executar.mockRejectedValueOnce(new UnprocessableEntityException('ORDER BY inválido em subconsulta'));
    m.conexoes.executar.mockResolvedValueOnce(resultado([['1']], true) as never);
    const r = await m.servico.buscarPorTermo(EMPRESA, 'q1', 'u1', '789', 5000);
    expect(r.truncado).toBe(true);
    const c = chamadas(m);
    expect(c).toHaveLength(2);
    expect(c[1].sql).not.toContain('etiquetas_busca');
    expect(c[1].limite).toBe(5000);
  });

  it('agente offline não tenta de novo: o erro é esse mesmo', async () => {
    const m = preparar();
    m.conexoes.executar.mockRejectedValueOnce(new ServiceUnavailableException('offline'));
    await expect(m.servico.buscarPorTermo(EMPRESA, 'q1', 'u1', '789', 5000)).rejects.toThrow('offline');
    expect(m.conexoes.executar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['campos de outro SQL', { camposHash: 'antigo' }],
    ['campos ainda não lidos', { campos: [], camposHash: null }],
  ])('com %s, não filtra no banco', async (_n, extra) => {
    const m = preparar(extra);
    await m.servico.buscarPorTermo(EMPRESA, 'q1', 'u1', '789', 5000);
    const c = chamadas(m);
    expect(c).toHaveLength(1);
    expect(c[0].sql).not.toContain('etiquetas_busca');
  });

  it('consulta desativada ou de outra empresa não roda', async () => {
    const desativada = preparar({ ativo: false });
    await expect(desativada.servico.buscarPorTermo(EMPRESA, 'q1', 'u1', '789', 5000)).rejects.toThrow(BadRequestException);
    expect(desativada.conexoes.executar).not.toHaveBeenCalled();
    const alheia = montar();
    await expect(alheia.servico.buscarPorTermo(EMPRESA, 'outra', 'u1', '789', 5000)).rejects.toThrow(NotFoundException);
    expect(alheia.prisma.consultaSql.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'outra', empresaId: EMPRESA } }));
  });
});

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

describe('índice de campos ao salvar', () => {
  const DTO = { nome: 'Lista', conexaoId: 'c1', finalidade: 'LISTA_DIARIA' as const, sql: 'SELECT p.preco AS preco FROM produtos p' };
  const obrigatorios = [
    { alias: 'codigo', nome: 'Código do produto', alternativos: ['cod', 'ean'], obrigatoriaEm: ['LISTA_DIARIA'] },
    { alias: 'preco', nome: 'Preço', alternativos: [], obrigatoriaEm: [] },
  ];

  it('recusa SQL sem o campo obrigatório, dizendo o que falta, e não grava', async () => {
    referenciasDoTeste = obrigatorios;
    const { servico, prisma, conexoes } = montar();
    conexoes.executar.mockResolvedValue({ colunas: [{ nome: 'preco', tipo: 'NUMERIC' }], linhas: [], truncado: false, duracaoMs: 1 } as never);
    await expect(servico.criar('e1', DTO as never, 'u1')).rejects.toThrow('codigo (Código do produto)');
    expect(prisma.consultaSql.create).not.toHaveBeenCalled();
    expect(conexoes.executar.mock.calls[0][4]).toBe(1);
  });

  it('nome alternativo atende', async () => {
    referenciasDoTeste = obrigatorios;
    const { servico, prisma, conexoes } = montar();
    conexoes.executar.mockResolvedValue({ colunas: [{ nome: 'EAN', tipo: 'TEXT' }], linhas: [], truncado: false, duracaoMs: 1 } as never);
    await servico.criar('e1', DTO as never, 'u1');
    expect(prisma.consultaSql.create).toHaveBeenCalled();
  });

  it('agente fora do ar não impede salvar', async () => {
    referenciasDoTeste = obrigatorios;
    const { servico, prisma, conexoes } = montar();
    conexoes.executar.mockRejectedValue(new ServiceUnavailableException('Agente offline'));
    await servico.criar('e1', DTO as never, 'u1');
    expect(prisma.consultaSql.create).toHaveBeenCalled();
  });

  it('sem nada obrigatório nessa finalidade, nem consulta o banco antes', async () => {
    referenciasDoTeste = obrigatorios;
    const { servico, conexoes } = montar();
    conexoes.executar.mockResolvedValue({ colunas: [{ nome: 'x', tipo: 'TEXT' }], linhas: [], truncado: false, duracaoMs: 1 } as never);
    await servico.criar('e1', { ...DTO, finalidade: 'OUTRA' } as never, 'u1');
    // Só a leitura dos campos, depois de gravar.
    expect(conexoes.executar).toHaveBeenCalledTimes(1);
  });

  it('cópia de template não é barrada: salva e avisa', async () => {
    referenciasDoTeste = obrigatorios;
    const { servico, prisma, conexoes } = montar();
    conexoes.executar.mockResolvedValue({ colunas: [{ nome: 'preco', tipo: 'NUMERIC' }], linhas: [], truncado: false, duracaoMs: 1 } as never);
    const r = await servico.criar('e1', DTO as never, 'u1', { templateConsultaId: 't1', sql: DTO.sql });
    expect(prisma.consultaSql.create).toHaveBeenCalled();
    expect(r.avisos.join()).toContain('codigo (Código do produto)');
  });
});
