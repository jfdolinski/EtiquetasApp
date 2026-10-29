import { BadRequestException } from '@nestjs/common';
import { LAYOUT_PADRAO, gerarZpl, type LayoutEtiqueta, type ModeloExportado } from '@etiquetas/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditoriaConsultaService } from './auditoria/auditoria-consulta.service';
import type { AuditoriaService } from './auditoria/auditoria.service';
import { InicializacaoService } from './auth/inicializacao.service';
import type { ConsultasService } from './consultas/consultas.service';
import { CriarUsuarioDto } from './usuarios/dto';
import { ModelosService } from './modelos/modelos.service';
import type { PrismaService } from './prisma/prisma.service';
import { traduzirErros } from './validacao';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
});

describe('mensagens de validação em português', () => {
  it('traduz as padrão e mantém as personalizadas', async () => {
    const dto = plainToInstance(CriarUsuarioDto, { nome: 1, email: 'x', senha: '123', perfilId: 'abc', extra: true });
    const erros = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const msgs = traduzirErros(erros);
    expect(msgs).toContain('O campo "nome" deve ser um texto.');
    expect(msgs).toContain('O campo "extra" não é permitido.');
    expect(msgs).toContain('Informe um e-mail válido.'); // personalizada
    expect(msgs).toContain('A senha deve ter ao menos 8 caracteres.'); // personalizada
    expect(msgs.join(' ')).not.toMatch(/\b(must|should)\b/);
  });

  it('extrai o limite da mensagem original', async () => {
    class X {}
    const msgs = traduzirErros([{ property: 'nome', constraints: { minLength: 'nome must be longer than or equal to 2 characters' }, children: [], target: new X() }]);
    expect(msgs).toEqual(['O campo "nome" deve ter ao menos 2 caractere(s).']);
  });
});

const LAYOUT: LayoutEtiqueta = {
  ...LAYOUT_PADRAO,
  elementos: [
    { id: 't', tipo: 'texto', x: 1, y: 1, largura: 40, altura: 6, rotacao: 0, valor: { tipo: 'campo', campo: 'preco' }, prefixo: '', sufixo: '', tamanhoPt: 10, negrito: false, alinhamento: 'esquerda' },
    { id: 'c', tipo: 'texto', x: 1, y: 8, largura: 20, altura: 6, rotacao: 0, valor: { tipo: 'contador', inicio: 1, passo: 1, digitos: 4 }, prefixo: '', sufixo: '', tamanhoPt: 8, negrito: false, alinhamento: 'esquerda' },
  ],
};

const ARQUIVO: ModeloExportado = {
  formato: 'etiquetas.modelo',
  versao: 1,
  exportadoEm: '2026-10-29T00:00:00Z',
  nome: 'Gôndola',
  descricao: null,
  layout: LAYOUT,
  consulta: { nome: 'Lista do dia', templateConsultaId: 'tpl-1' },
};

function montarModelos(opcoes: { nomes?: string[]; porTemplate?: unknown; porNome?: unknown } = {}) {
  const criados: Record<string, unknown>[] = [];
  const prisma = {
    modeloEtiqueta: {
      findMany: jest.fn(async () => (opcoes.nomes ?? []).map((nome) => ({ nome }))),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return { id: 'novo', impressoraId: null, naListaDiaria: false, ativo: true, criadoEm: new Date(), atualizadoEm: new Date(), ...data };
      }),
    },
    consultaSql: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ('templateConsultaId' in where ? (opcoes.porTemplate ?? null) : (opcoes.porNome ?? null))),
    },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  return { servico: new ModelosService(prisma as unknown as PrismaService, auditoria, {} as ConsultasService), prisma, criados };
}

describe('importar/copiar modelo', () => {
  it('recusa arquivo de outro formato e layout inválido', async () => {
    const { servico } = montarModelos();
    await expect(servico.importar('e1', { ...ARQUIVO, formato: 'outro' } as never, 'u')).rejects.toThrow(/inválido/);
    await expect(servico.importar('e1', { ...ARQUIVO, layout: { ...LAYOUT, larguraMm: 1 } }, 'u')).rejects.toThrow(BadRequestException);
  });

  it('vincula a consulta do mesmo template do ERP e avisa campo ausente', async () => {
    const { servico, prisma, criados } = montarModelos({ porTemplate: { id: 'q9', nome: 'Lista (ERP)', campos: [{ nome: 'codigo' }] } });
    const r = await servico.importar('e1', ARQUIVO, 'u');
    expect(prisma.consultaSql.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: 'e1', templateConsultaId: 'tpl-1', ativo: true } }));
    expect(criados[0]).toMatchObject({ empresaId: 'e1', consultaId: 'q9', nome: 'Gôndola' });
    expect(criados[0]).not.toHaveProperty('impressoraId');
    expect(r.avisos.join()).toMatch(/não devolve: preco/);
  });

  it('sem consulta equivalente: cria sem vínculo e com aviso; nome em uso ganha sufixo', async () => {
    const { servico, criados } = montarModelos({ nomes: ['Gôndola', 'gôndola (2)'] });
    const r = await servico.importar('e1', ARQUIVO, 'u');
    expect(criados[0]).toMatchObject({ consultaId: null, nome: 'Gôndola (3)' });
    expect(r.avisos.join()).toMatch(/Nenhuma consulta equivalente/);
  });
});

describe('auditoria', () => {
  function montarAuditoria() {
    const prisma = { logAuditoria: { findMany: jest.fn(async (_: unknown) => [] as unknown[]) } };
    return { servico: new AuditoriaConsultaService(prisma as unknown as PrismaService), prisma };
  }

  it('empresa vê só os próprios registros, com filtros', async () => {
    const { servico, prisma } = montarAuditoria();
    await servico.listar({ empresaId: 'e1' }, { acao: 'impressao.', de: '2026-10-01', limite: 10 });
    const { where, take } = prisma.logAuditoria.findMany.mock.calls[0][0] as { where: { AND: unknown[] }; take: number };
    expect(where.AND).toEqual(
      expect.arrayContaining([{ empresaId: 'e1' }, { acao: { startsWith: 'impressao.' } }, { criadoEm: { gte: new Date('2026-10-01T00:00:00Z') } }]),
    );
    expect(take).toBe(11);
  });

  it('plataforma sem filtro de empresa vê tudo; cursor inválido é recusado', async () => {
    const { servico, prisma } = montarAuditoria();
    await servico.listar({ plataforma: true }, {});
    const { where } = prisma.logAuditoria.findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(where.AND).toEqual([]);
    await expect(servico.listar({ empresaId: 'e1' }, { cursor: 'lixo' })).rejects.toThrow(/Cursor inválido/);
  });

  it('pagina por cursor (criadoEm + id)', async () => {
    const { servico, prisma } = montarAuditoria();
    const linhas = [1, 2, 3].map((i) => ({
      id: `0000000${i}-0000-0000-0000-000000000000`,
      criadoEm: new Date(`2026-10-2${i}T10:00:00Z`),
      acao: 'x',
      entidade: 'X',
      entidadeId: null,
      detalhes: null,
      usuario: null,
      empresa: null,
    }));
    prisma.logAuditoria.findMany.mockResolvedValueOnce(linhas);
    const p = await servico.listar({ empresaId: 'e1' }, { limite: 2 });
    expect(p.itens).toHaveLength(2);
    expect(p.proximo).not.toBeNull();
    await servico.listar({ empresaId: 'e1' }, { limite: 2, cursor: p.proximo! });
    const { where } = prisma.logAuditoria.findMany.mock.calls[1][0] as { where: { AND: unknown[] } };
    expect(where.AND).toContainEqual({
      OR: [{ criadoEm: { lt: linhas[1].criadoEm } }, { criadoEm: linhas[1].criadoEm, id: { lt: linhas[1].id } }],
    });
  });
});

describe('permissões novas', () => {
  it('concede só os códigos recém-criados aos perfis Administrador', async () => {
    const prisma = {
      permissao: { findMany: jest.fn(async () => [{ codigo: 'usuario.ver' }]), upsert: jest.fn(), deleteMany: jest.fn() },
      perfil: { findMany: jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }]) },
      perfilPermissao: { createMany: jest.fn(async () => ({ count: 0 })) },
      usuario: { count: jest.fn(async () => 1) },
      $transaction: jest.fn(async () => []),
    };
    process.env.SUPERADMIN_EMAIL = '';
    await new InicializacaoService(prisma as unknown as PrismaService).onApplicationBootstrap();
    const { data } = (prisma.perfilPermissao.createMany.mock.calls[0] as unknown as [{ data: { perfilId: string; permissaoCodigo: string }[] }])[0];
    expect(data.some((d) => d.permissaoCodigo === 'usuario.ver')).toBe(false);
    expect(data.filter((d) => d.permissaoCodigo === 'auditoria.ver').map((d) => d.perfilId)).toEqual(['p1', 'p2']);
    expect(prisma.perfil.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { nome: 'Administrador' } }));
  });

  it('banco vazio (primeira subida) não concede nada', async () => {
    const prisma = {
      permissao: { findMany: jest.fn(async () => []), upsert: jest.fn(), deleteMany: jest.fn() },
      perfil: { findMany: jest.fn() },
      perfilPermissao: { createMany: jest.fn() },
      usuario: { count: jest.fn(async () => 1) },
      $transaction: jest.fn(async () => []),
    };
    await new InicializacaoService(prisma as unknown as PrismaService).onApplicationBootstrap();
    expect(prisma.perfilPermissao.createMany).not.toHaveBeenCalled();
  });
});

describe('contador contínuo entre lotes', () => {
  it('o segundo lote começa de onde o primeiro parou', () => {
    const r = gerarZpl(LAYOUT, [{}, {}], { dpi: 203, hoje: '2026-10-29', indiceInicial: 2000 });
    expect(r.conteudo).toContain('^FD2001^FS');
    expect(r.conteudo).toContain('^FD2002^FS');
  });
});
