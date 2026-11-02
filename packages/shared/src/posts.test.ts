import { describe, expect, it } from 'vitest';
import { alterarTextoDoElemento, conteudoVazio, corSobre, formatarPrecoPost, FORMATOS_POST, legendaSugerida, montarPost, partesDoPreco, precoDoRegistro, problemaNoPost, produtoDoRegistro, rotuloElemento, VARIACOES_POST, type ConteudoPost, type DadosPost, type FormatoPost, type FundoPost, type ProdutoPost, type VariacaoPost } from './posts';

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
  const CHEIO: ProdutoPost = { ...PRODUTO, precoDe: 'R$ 9,99', unidade: '/kg', detalhe: 'Leve 3, pague 2', selo: '-20%' };
  const INFO = { subtitulo: 'Só hoje', chamada: 'Compre agora', validade: 'Até 31/12', telefone: '1', whatsapp: '2', instagram: '@a', site: 'b.com', endereco: 'Rua A, 1' };
  const VARIACOES = Object.keys(VARIACOES_POST) as VariacaoPost[];

  it.each((Object.keys(FORMATOS_POST) as FormatoPost[]).flatMap((f) => VARIACOES.map((v) => [f, v] as const)))('nada sai da arte em %s, variação %s, nem com todos os dados preenchidos', (formato, variacao) => {
    const { largura, altura } = FORMATOS_POST[formato];
    const cenarios: Partial<DadosPost>[] = [
      {},
      { conteudo: { ...conteudoVazio(), ...INFO, produtos: [CHEIO] } },
      { modelo: 'OFERTA', conteudo: { ...conteudoVazio(), titulo: 'Ofertas', produtos: [PRODUTO, PRODUTO] } },
      { modelo: 'OFERTA', conteudo: { ...conteudoVazio(), produtos: [PRODUTO, PRODUTO, PRODUTO] } },
      { modelo: 'OFERTA', conteudo: { ...conteudoVazio(), ...INFO, titulo: 'Ofertas', produtos: [CHEIO, CHEIO, CHEIO, CHEIO] } },
      { modelo: 'AVISO', conteudo: { ...conteudoVazio(), titulo: 'Aviso', texto: 'Texto', imagem: PRODUTO.imagem } },
      { modelo: 'AVISO', conteudo: { ...conteudoVazio(), ...INFO, titulo: 'Aviso', texto: 'Texto' } },
    ];
    for (const c of cenarios) {
      const dados = post({ ...c, formato });
      for (const e of montarPost({ ...dados, conteudo: { ...dados.conteudo, variacao } }, MARCA)) {
        expect(e.x, e.id).toBeGreaterThanOrEqual(0);
        expect(e.y, e.id).toBeGreaterThanOrEqual(0);
        expect(e.largura, e.id).toBeGreaterThan(0);
        expect(e.altura, e.id).toBeGreaterThan(0);
        expect(e.x + e.largura, e.id).toBeLessThanOrEqual(largura);
        expect(e.y + e.altura, e.id).toBeLessThanOrEqual(altura);
      }
    }
  });

  it('cada dado preenchido aparece na arte; vazio não ocupa lugar', () => {
    const ids = (c: ConteudoPost) => montarPost(post({ conteudo: c }), MARCA).map((e) => e.id);
    expect(ids({ ...conteudoVazio(), ...INFO, produtos: [CHEIO] })).toEqual(expect.arrayContaining(['chamada', 'chamada-fundo', 'validade', 'contato', 'endereco', 'preco-de-0', 'unidade-0', 'detalhe-0', 'selo-0', 'selo-fundo-0']));
    expect(ids({ ...conteudoVazio(), produtos: [PRODUTO] })).not.toEqual(expect.arrayContaining(['chamada']));
  });

  it('estilo vale em todos os tamanhos; posição, só naquele em que foi feita', () => {
    const design = { estilos: { 'nome-0': { fonte: 'inter', cor: '#ff0000' } } };
    const ajustes = { QUADRADO: { 'nome-0': { x: 5, oculto: true } } };
    const nome = (formato: FormatoPost) => montarPost(post({ formato, design, ajustes }), MARCA).find((e) => e.id === 'nome-0')!;
    expect(nome('STORIES')).toMatchObject({ fonte: 'inter', cor: '#ff0000' });
    expect(nome('QUADRADO')).toMatchObject({ fonte: 'inter', x: 5, oculto: true });
    expect(nome('STORIES').x).not.toBe(5);
    expect(nome('STORIES').oculto).toBeUndefined();
  });

  it('fonte de todos os textos vale menos que a escolhida no elemento', () => {
    const design = { fontePadrao: 'lato', estilos: { 'nome-0': { fonte: 'inter' } } };
    const els = montarPost(post({ design }), MARCA);
    expect(els.find((e) => e.id === 'nome-0')).toMatchObject({ fonte: 'inter' });
    expect(els.find((e) => e.id === 'marca')).toMatchObject({ fonte: 'lato' });
  });

  it('elemento acrescentado entra na mesma proporção de altura em todos os tamanhos', () => {
    const design = { extras: [{ id: 'extra-a', tipo: 'texto' as const, x: 10, yRel: 0.5, largura: 300, altura: 80, texto: 'Oi' }] };
    const y = (formato: FormatoPost) => montarPost(post({ formato, design }), MARCA).find((e) => e.id === 'extra-a')!.y;
    expect(y('QUADRADO')).toBe(540);
    expect(y('STORIES')).toBe(960);
  });

  it('camadas: fundo sempre atrás, ordem escolhida respeitada e elemento novo na frente', () => {
    const extra = { id: 'extra-a', tipo: 'retangulo' as const, x: 0, yRel: 0, largura: 10, altura: 10 };
    const els = montarPost(post({ design: { ordem: { QUADRADO: ['nome-0', 'marca'] }, extras: [extra] } }), MARCA);
    expect(els[0].id).toBe('fundo');
    expect(els.findIndex((e) => e.id === 'nome-0')).toBeLessThan(els.findIndex((e) => e.id === 'marca'));
    expect(els[els.length - 1].id).toBe('extra-a');
  });

  it('fundo em degradê e em imagem, com véu', () => {
    const fundo = (f: FundoPost) => montarPost(post({ design: { fundo: f } }), MARCA);
    expect(fundo({ tipo: 'degrade', cor: '#000000', cor2: '#ffffff' })[0]).toMatchObject({ cor: '#000000', cor2: '#ffffff' });
    const comImagem = fundo({ tipo: 'imagem', imagem: PRODUTO.imagem, veu: 0.5 });
    expect(comImagem.slice(0, 3).map((e) => e.id)).toEqual(['fundo', 'fundo-imagem', 'fundo-veu']);
    expect(comImagem[2]).toMatchObject({ opacidade: 0.5 });
    expect(comImagem[1]).toMatchObject({ ajusteImagem: 'cobrir' });
  });

  it('cores do post valem no lugar das da marca', () => {
    expect(montarPost(post({ design: { corPrincipal: '#123456' } }), MARCA)[0]).toMatchObject({ cor: '#123456' });
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

it('legenda muda com o tom e traz preço anterior e hashtags', () => {
  const c = { ...conteudoVazio(), rodape: '', hashtags: '#oferta', produtos: [{ ...PRODUTO, precoDe: 'R$ 9,99' }] };
  const animada = legendaSugerida('PRODUTO', c, MARCA, 'animado');
  expect(animada).toContain('Olha essa oferta');
  expect(animada).toContain('de R$ 9,99 por R$ 4,99');
  expect(animada.endsWith('#oferta')).toBe(true);
  expect(legendaSugerida('PRODUTO', c, MARCA, 'formal')).toContain('Conte com a Mercado Bom');
});

it('partesDoPreco separa valor e centavos; texto livre fica sem partes', () => {
  expect(partesDoPreco('R$ 1.234,50')).toEqual({ moeda: 'R$', valor: '1.234', centavos: ',50' });
  expect(partesDoPreco('sob consulta')).toBeNull();
});

it('escrever no elemento muda o dado do post', () => {
  const c = { ...conteudoVazio(), produtos: [PRODUTO, { ...PRODUTO, descricao: 'Outro' }] };
  expect(alterarTextoDoElemento(c, 'titulo', 'Novo')?.titulo).toBe('Novo');
  expect(alterarTextoDoElemento(c, 'nome-1', 'Novo')?.produtos.map((p) => p.descricao)).toEqual(['Café 500 g', 'Novo']);
  expect(alterarTextoDoElemento(c, 'preco-0', 'R$ 1,00')?.produtos[0].preco).toBe('R$ 1,00');
  // Montado pelo sistema: não há um dado único para mudar.
  expect(alterarTextoDoElemento(c, 'contato', 'x')).toBeNull();
});

it('rótulos das camadas numeram os produtos só quando há vários', () => {
  const nome = montarPost(post(), MARCA).find((e) => e.id === 'nome-0')!;
  expect(rotuloElemento(nome)).toBe('Nome');
  expect(rotuloElemento(nome, true)).toBe('Nome 1');
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
    ['variação inválida', { conteudo: { ...conteudoVazio(), variacao: 'X' as never, produtos: [PRODUTO] } }],
    ['cor que não é cor', { design: { corPrincipal: 'red;' } }],
    ['fonte desconhecida', { design: { fontePadrao: 'comic' } }],
    ['fonte desconhecida no elemento', { design: { estilos: { a: { fonte: 'comic' } } } }],
    ['cor inválida no elemento', { design: { estilos: { a: { cor: 'url(x)' } } } }],
    ['número inválido no elemento', { design: { estilos: { a: { tamanho: Infinity } } } }],
    ['fundo inválido', { design: { fundo: { tipo: 'x' as never } } }],
    ['elemento acrescentado sem id certo', { design: { extras: [{ id: 'a', tipo: 'texto', x: 0, yRel: 0, largura: 1, altura: 1 }] } }],
    ['elemento de tipo desconhecido', { design: { extras: [{ id: 'extra-a', tipo: 'x' as never, x: 0, yRel: 0, largura: 1, altura: 1 }] } }],
    ['elementos demais', { design: { extras: Array.from({ length: 41 }, (_, i) => ({ id: `extra-${i}`, tipo: 'texto' as const, x: 0, yRel: 0, largura: 1, altura: 1 })) } }],
  ])('recusa %s', (_n, m) => expect(problemaNoPost(post(m))).toBeTruthy());
});
