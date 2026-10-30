import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LAYOUT_PADRAO, type LayoutEtiqueta } from '@etiquetas/shared';
import { PDFDocument } from 'pdf-lib';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { ConsultasService } from '../consultas/consultas.service';
import type { PrismaService } from '../prisma/prisma.service';
import { normalizarEndereco } from './impressoras.service';
import { ModelosService } from './modelos.service';
import { gerarPdf } from './pdf';

const EMPRESA = 'e1';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
});

const LAYOUT: LayoutEtiqueta = {
  ...LAYOUT_PADRAO,
  larguraMm: 50,
  alturaMm: 30,
  colunas: 2,
  elementos: [
    {
      id: 't',
      tipo: 'texto',
      x: 2,
      y: 2,
      largura: 46,
      altura: 8,
      rotacao: 0,
      valor: { tipo: 'campo', campo: 'descricao' },
      prefixo: '',
      sufixo: '',
      tamanhoPt: 10,
      negrito: true,
      alinhamento: 'centro',
    },
    { id: 'r', tipo: 'texto', x: 40, y: 10, largura: 8, altura: 18, rotacao: 90, valor: { tipo: 'fixo', texto: 'Girado ç' }, prefixo: '', sufixo: '', tamanhoPt: 8, negrito: false, alinhamento: 'esquerda' },
    { id: 'b', tipo: 'codigo_barras', x: 2, y: 12, largura: 34, altura: 14, rotacao: 0, valor: { tipo: 'campo', campo: 'ean' }, simbologia: 'EAN13', mostrarTexto: true },
    { id: 'q', tipo: 'qrcode', x: 38, y: 0, largura: 10, altura: 10, rotacao: 0, valor: { tipo: 'fixo', texto: 'https://exemplo.com' } },
    { id: 'l', tipo: 'linha', x: 0, y: 11, largura: 50, altura: 0.5, rotacao: 0, espessuraMm: 0.3 },
  ],
};

function montar() {
  const prisma = {
    modeloEtiqueta: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async (_: unknown) => null as unknown),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', criadoEm: new Date(), atualizadoEm: new Date(), ativo: true, ...data })),
    },
    consultaSql: { findFirst: jest.fn(async (_: unknown) => null as unknown) },
    impressora: { findFirst: jest.fn(async (_: unknown) => null as unknown) },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  return { servico: new ModelosService(prisma as unknown as PrismaService, auditoria, {} as ConsultasService), prisma };
}

describe('ModelosService', () => {
  it('busca só na empresa atual', async () => {
    const { servico, prisma } = montar();
    await expect(servico.obter(EMPRESA, 'm-alheio')).rejects.toThrow(NotFoundException);
    expect(prisma.modeloEtiqueta.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm-alheio', empresaId: EMPRESA } }));
  });

  it('recusa layout inválido e consulta de outra empresa', async () => {
    const { servico, prisma } = montar();
    await expect(servico.criar(EMPRESA, { nome: 'X', layout: { ...LAYOUT, larguraMm: 1 } }, 'u')).rejects.toThrow(BadRequestException);
    await expect(servico.criar(EMPRESA, { nome: 'X', layout: LAYOUT, consultaId: 'q-alheia' }, 'u')).rejects.toThrow(/Consulta inválida/);
    expect(prisma.consultaSql.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'q-alheia', empresaId: EMPRESA } }));
    expect(prisma.modeloEtiqueta.create).not.toHaveBeenCalled();
  });

  it('gerar: usa linguagem e DPI da impressora da empresa', async () => {
    const { servico, prisma } = montar();
    prisma.impressora.findFirst.mockResolvedValue({ linguagem: 'ZPL', dpi: 300 });
    const r = await servico.gerar(EMPRESA, { layout: LAYOUT, impressoraId: 'i1', linguagem: 'PPLB', registros: [{ descricao: 'A', ean: '7891000000045' }] });
    expect(prisma.impressora.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i1', empresaId: EMPRESA } }));
    expect(r.linguagem).toBe('ZPL');
    expect(r.conteudo).toContain(`^PW${Math.round((102 * 300) / 25.4)}`);
  });

  it('gerar: recusa impressora de outra empresa e registros com objetos aninhados', async () => {
    const { servico } = montar();
    await expect(servico.gerar(EMPRESA, { layout: LAYOUT, impressoraId: 'i-alheia', registros: [] })).rejects.toThrow(/Impressora inválida/);
    await expect(
      servico.gerar(EMPRESA, { layout: LAYOUT, linguagem: 'ZPL', registros: [{ descricao: { $gt: 1 } } as never] }),
    ).rejects.toThrow(/Valor inválido/);
  });
});

describe('gerarPdf', () => {
  it('gera PDF válido: uma página por fileira, no tamanho da etiqueta', async () => {
    const registros = [1, 2, 3].map((i) => ({ descricao: `Produto ${i} çã`, ean: '7891000000045' }));
    const r = await gerarPdf(LAYOUT, registros, '2026-10-29');
    expect(r.avisos).toEqual([]);
    const doc = await PDFDocument.load(Buffer.from(r.conteudo, 'base64'));
    expect(doc.getPageCount()).toBe(2); // 3 etiquetas em 2 colunas
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo((102 * 72) / 25.4, 0);
    expect(height).toBeCloseTo((30 * 72) / 25.4, 0);
  });

  it('código inválido vira aviso', async () => {
    const r = await gerarPdf(LAYOUT, [{ descricao: 'X', ean: '12' }], '2026-10-29');
    expect(r.avisos[0]).toMatch(/código de barras não impresso/);
  });

  it('embute imagem em tons de cinza, girada', async () => {
    const cinza = Buffer.from([0, 64, 128, 255, 0, 64, 128, 255]).toString('base64');
    const layout = {
      ...LAYOUT,
      elementos: [
        { id: 'img', tipo: 'imagem' as const, nome: 'logo.png', x: 1, y: 1, largura: 4, altura: 8, rotacao: 90 as const, larguraPx: 4, alturaPx: 2, cinza, limiar: 128, pontilhado: false },
      ],
    };
    const r = await gerarPdf(layout, [{}, {}], '2026-10-29');
    expect(r.avisos).toEqual([]);
    const pdf = Buffer.from(r.conteudo, 'base64');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    // Uma única imagem (2 × 4 depois de girada) embutida para as duas etiquetas.
    expect(pdf.toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(pdf.toString('latin1')).toMatch(/\/Width 2[\s\S]*?\/Height 4|\/Height 4[\s\S]*?\/Width 2/);
  });
});

describe('normalizarEndereco', () => {
  it('aceita IP/nome com porta e aplica 9100 por padrão', () => {
    expect(normalizarEndereco('REDE', ' 192.168.0.50 ')).toBe('192.168.0.50:9100');
    expect(normalizarEndereco('REDE', 'zebra-caixa:6101')).toBe('zebra-caixa:6101');
    expect(() => normalizarEndereco('REDE', 'http://x')).toThrow(BadRequestException);
    expect(normalizarEndereco('SISTEMA', ' ZDesigner GC420t ')).toBe('ZDesigner GC420t');
  });
});
