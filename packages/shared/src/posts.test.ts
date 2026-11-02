import { describe, expect, it } from 'vitest';
import { conteudoVazio, corSobre, formatarPrecoPost, FORMATOS_POST, legendaSugerida, montarPost, precoDoRegistro, problemaNoPost, produtoDoRegistro, type DadosPost, type FormatoPost, type ProdutoPost } from './posts';

const MARCA = { nome: 'Mercado Bom', corPrincipal: '#1d4ed8', corDestaque: '#facc15', logoId: null };
const PRODUTO: ProdutoPost = { codigo: '789', descricao: 'Café 500 g', preco: 'R$ 4,99', imagem: { origem: 'CATALOGO', url: 'https://c/files/a.png', ia: false } };
const post = (m: Partial<DadosPost> = {}): DadosPost => ({ titulo: 'Café', modelo: 'PRODUTO', formato: 'QUADRADO', conteudo: { ...conteudoVazio(), produtos: [PRODUTO] }, legenda: '', ajustes: {}, ...m });

describe('preço', () => {
  it.each([
    ['4.99', 'R$ 4,99'],
    ['4,99', 'R$ 4,99'],
    ['1.234,50', 'R$ 1.234,50'],
    ['1234.5', 'R$ 1.234,50'],
    [4.5, 'R$ 4,50'],
    ['R$ 7,00', 'R$ 7,00'],
    ['12', 'R$ 12,00'],
  ])('%s vira %s', (entrada, saida) => expect(formatarPrecoPost(entrada)).toBe(saida));

  it('o que não é número fica como veio; vazio continua vazio', () => {
    expect(formatarPrecoPost('sob consulta')).toBe('sob consulta');
    expect(formatarPrecoPost(null)).toBe('');
  });

  it('acha a coluna de preço do ERP e nunca usa o custo', () => {
    expect(precoDoRegistro({ descricao: 'x', preco: '4.99' })).toBe('R$ 4,99');
    expect(precoDoRegistro({ PRECO_VENDA: 10 })).toBe('R$ 10,00');
    expect(precoDoRegistro({ valor_tabela: '3,50' })).toBe('R$ 3,50');
    expect(precoDoRegistro({ preco_custo: '1.00' })).toBe('');
    expect(precoDoRegistro({ descricao: 'x' })).toBe('');
  });
});

describe('produtoDoRegistro', () => {
  it('prefere o código de barras, a chave do catálogo', () => {
    expect(produtoDoRegistro({ codigo: 12, ean: '0789', descricao: 'Café', preco: 5 })).toEqual({ codigo: '0789', descricao: 'Café', preco: 'R$ 5,00', imagem: null });
  });

  it('sem código de barras, usa o código do produto', () => {
    expect(produtoDoRegistro({ codigo: 12, descricao: 'Café' }).codigo).toBe('12');
  });
});

describe('montarPost', () => {
  it.each(Object.keys(FORMATOS_POST) as FormatoPost[])('nada sai da arte em %s, em nenhum modelo', (formato) => {
    const { largura, altura } = FORMATOS_POST[formato];
    const cenarios: Partial<DadosPost>[] = [
      {},
      { modelo: 'OFERTA', conteudo: { ...conteudoVazio(), titulo: 'Ofertas', produtos: [PRODUTO, PRODUTO] } },
      { modelo: 'OFERTA', conteudo: { ...conteudoVazio(), produtos: [PRODUTO, PRODUTO, PRODUTO] } },
      { modelo: 'OFERTA', conteudo: { ...conteudoVazio(), titulo: 'Ofertas', produtos: [PRODUTO, PRODUTO, PRODUTO, PRODUTO] } },
      { modelo: 'AVISO', conteudo: { ...conteudoVazio(), titulo: 'Aviso', texto: 'Texto', imagem: PRODUTO.imagem } },
    ];
    for (const c of cenarios) {
      for (const e of montarPost(post({ ...c, formato }), MARCA)) {
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.largura).toBeGreaterThan(0);
        expect(e.altura).toBeGreaterThan(0);
        expect(e.x + e.largura).toBeLessThanOrEqual(largura);
        expect(e.y + e.altura).toBeLessThanOrEqual(altura);
      }
    }
  });

  it('mostra aviso na arte quando a imagem é de IA', () => {
    const ia: ProdutoPost = { ...PRODUTO, imagem: { origem: 'CATALOGO', url: 'https://c/files/b.png', ia: true } };
    const textos = (p: ProdutoPost) => montarPost(post({ conteudo: { ...conteudoVazio(), produtos: [p] } }), MARCA).flatMap((e) => (e.tipo === 'texto' ? [e.texto] : []));
    expect(textos(ia)).toContain('Imagem gerada por IA');
    expect(textos(PRODUTO)).not.toContain('Imagem gerada por IA');
  });

  it('logomarca ocupa o lugar do nome da empresa', () => {
    const ids = (logoId: string | null) => montarPost(post(), { ...MARCA, logoId }).map((e) => e.id);
    expect(ids(null)).toContain('marca');
    expect(ids('x')).toContain('logo');
    expect(ids('x')).not.toContain('marca');
  });

  it('ajuste vale só no tamanho em que foi feito', () => {
    const ajustes = { QUADRADO: { 'preco-0': { x: 1, y: 2, largura: 300, altura: 100 } } };
    const preco = (formato: FormatoPost) => montarPost(post({ formato, ajustes }), MARCA).find((e) => e.id === 'preco-0')!;
    expect(preco('QUADRADO')).toMatchObject({ x: 1, y: 2, largura: 300, altura: 100 });
    expect(preco('RETRATO').x).not.toBe(1);
  });
});

it('corSobre escolhe o texto legível', () => {
  expect(corSobre('#000000')).toBe('#ffffff');
  expect(corSobre('#facc15')).toBe('#0f172a');
});

it('legenda sugerida traz produto e preço', () => {
  expect(legendaSugerida('PRODUTO', { ...conteudoVazio(), rodape: '', produtos: [PRODUTO] }, MARCA)).toBe('Café 500 g por R$ 4,99!\n\nVenha conferir na Mercado Bom.');
});

describe('problemaNoPost', () => {
  it('aceita um post correto', () => expect(problemaNoPost(post())).toBeNull());

  it.each<[string, Partial<DadosPost>]>([
    ['sem nome', { titulo: '  ' }],
    ['modelo inválido', { modelo: 'X' as never }],
    ['tamanho inválido', { formato: 'X' as never }],
    ['legenda grande', { legenda: 'x'.repeat(2201) }],
    ['produto sem lugar', { modelo: 'AVISO' }],
    ['oferta com um produto', { modelo: 'OFERTA' }],
    ['imagem sem origem', { conteudo: { ...conteudoVazio(), produtos: [{ ...PRODUTO, imagem: { origem: 'X' } as never }] } }],
    ['galeria com id estranho', { conteudo: { ...conteudoVazio(), produtos: [{ ...PRODUTO, imagem: { origem: 'GALERIA', id: '../x' } }] } }],
    ['ajuste sem número', { ajustes: { QUADRADO: { a: { x: NaN, y: 0, largura: 1, altura: 1 } } } }],
    ['ajuste com tamanho zero', { ajustes: { QUADRADO: { a: { x: 0, y: 0, largura: 0, altura: 1 } } } }],
    ['ajuste em tamanho que não existe', { ajustes: { X: {} } as never }],
  ])('recusa %s', (_n, m) => expect(problemaNoPost(post(m))).toBeTruthy());
});
