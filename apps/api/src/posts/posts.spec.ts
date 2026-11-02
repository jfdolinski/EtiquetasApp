import { BadGatewayException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { conteudoVazio, type DadosPost } from '@etiquetas/shared';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { config } from '../config';
import { cifrar } from '../cripto';
import { CatalogoService, tipoDaImagem } from './catalogo.service';
import { PostsService } from './posts.service';

const BASE = 'https://catalogo.teste';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(40);
  process.env.DATABASE_URL = 'postgresql://x';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32, 1).toString('base64');
  process.env.CATALOGO_URL = `${BASE}/`;
});

describe('tipoDaImagem', () => {
  it('olha os bytes, não o nome', () => {
    expect(tipoDaImagem(PNG)).toBe('image/png');
    expect(tipoDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoDaImagem(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'))).toBeNull();
  });
});

describe('CatalogoService', () => {
  const buscaMarca = jest.fn();
  const servico = new CatalogoService({ marcaPost: { findUnique: buscaMarca } } as never);
  const pedido = jest.spyOn(global, 'fetch');

  beforeEach(() => {
    pedido.mockReset();
    buscaMarca.mockReset().mockResolvedValue(null);
  });
  afterAll(() => pedido.mockRestore());

  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

  it('some com a imagem provisória e marca a de IA', async () => {
    pedido.mockResolvedValue(
      resposta({
        name: 'Café',
        is_medicine: true,
        images: [
          { url: `${BASE}/files/p.png`, placeholder: true },
          { url: `${BASE}/files/ia.png`, ai_generated: true },
          { url: `${BASE}/files/real.png` },
        ],
      }),
    );
    expect(await servico.produto('e', '789')).toEqual({
      encontrado: true,
      nome: 'Café',
      medicamento: true,
      imagens: [
        { url: `${BASE}/files/ia.png`, ia: true },
        { url: `${BASE}/files/real.png`, ia: false },
      ],
      aviso: null,
    });
  });

  it('envia a chave da empresa e tenta sem os zeros à esquerda', async () => {
    buscaMarca.mockResolvedValue({ chaveCatalogoCifrada: cifrar('segredo', config().chaveCriptografia) });
    pedido.mockResolvedValueOnce(resposta({}, 404)).mockResolvedValueOnce(resposta({ name: 'Café', images: [] }));
    const r = await servico.produto('e', '00789');
    expect(r.encontrado).toBe(true);
    expect(pedido.mock.calls.map((c) => c[0])).toEqual([`${BASE}/api/v1/barcodes/00789`, `${BASE}/api/v1/barcodes/789`]);
    expect((pedido.mock.calls[0][1] as RequestInit).headers).toEqual({ 'X-Api-Key': 'segredo' });
  });

  it('catálogo fora do ar ou recusando não impede o post: vira aviso', async () => {
    pedido.mockRejectedValueOnce(new Error('rede'));
    expect((await servico.produto('e', '1')).aviso).toMatch(/não respondeu/);
    pedido.mockResolvedValueOnce(resposta({}, 403));
    expect((await servico.produto('e', '1')).aviso).toMatch(/chave/);
    pedido.mockResolvedValue(resposta({}, 404));
    expect(await servico.produto('e', '1')).toMatchObject({ encontrado: false, aviso: null });
  });

  it.each(['http://169.254.169.254/latest/meta-data', 'https://outro.site/files/a.png', `${BASE}/api/v1/catalog.json`, `${BASE}.mal.com/files/a.png`, 'nem-url'])('não baixa %s', async (url) => {
    await expect(servico.imagem('e', url)).rejects.toBeInstanceOf(BadRequestException);
    expect(pedido).not.toHaveBeenCalled();
  });

  it('entrega a imagem do catálogo pelo tipo real e recusa o que não for imagem', async () => {
    pedido.mockResolvedValueOnce(new Response(PNG, { headers: { 'content-type': 'text/html' } }));
    expect(await servico.imagem('e', `${BASE}/files/a.png`)).toMatchObject({ tipo: 'image/png' });
    pedido.mockResolvedValueOnce(new Response('<svg/>', { headers: { 'content-type': 'image/png' } }));
    await expect(servico.imagem('e', `${BASE}/files/a.svg`)).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('busca de produtos no ERP', () => {
  const achar = jest.fn();
  const executar = jest.fn();
  const conjunto = jest.fn();
  const servico = new PostsService({ consultaSql: { findFirst: achar } } as never, {} as never, { executar } as never, { conjunto } as never);
  const resultado = { colunas: [{ nome: 'ean' }, { nome: 'descricao' }, { nome: 'preco' }], linhas: [['789', 'Café moído', '4.99'], ['790', 'Café banido', '5.00'], ['791', 'Arroz', '9.00']] };

  beforeEach(() => {
    achar.mockReset();
    executar.mockReset().mockResolvedValue(resultado);
    conjunto.mockReset().mockResolvedValue(new Set(['790']));
  });

  it('passa o termo para os parâmetros e tira o produto banido, sem filtrar de novo', async () => {
    achar.mockResolvedValue({ sql: 'SELECT ean, descricao, preco FROM p WHERE descricao ILIKE {param.busca}', conexao: { tipo: 'POSTGRES' } });
    const r = await servico.buscarProdutos('e', 'c', '%a%', 'u');
    expect(achar).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c', empresaId: 'e' } }));
    expect(executar).toHaveBeenCalledWith('e', 'c', 'u', { busca: '%a%' }, 50);
    expect(r.banidos).toBe(1);
    expect(r.produtos).toEqual([
      { codigo: '789', descricao: 'Café moído', preco: 'R$ 4,99', imagem: null },
      { codigo: '791', descricao: 'Arroz', preco: 'R$ 9,00', imagem: null },
    ]);
  });

  it('consulta sem parâmetro: lê mais linhas e procura o termo aqui', async () => {
    achar.mockResolvedValue({ sql: 'SELECT ean, descricao, preco FROM p', conexao: { tipo: 'POSTGRES' } });
    const r = await servico.buscarProdutos('e', 'c', 'arroz', 'u');
    expect(executar).toHaveBeenCalledWith('e', 'c', 'u', {}, 5000);
    expect(r.produtos.map((p) => p.descricao)).toEqual(['Arroz']);
  });

  it('planilha recebe o termo no parâmetro de busca dela', async () => {
    achar.mockResolvedValue({ sql: '', conexao: { tipo: 'PASTA' } });
    await servico.buscarProdutos('e', 'c', 'arroz', 'u');
    expect(executar).toHaveBeenCalledWith('e', 'c', 'u', { busca: 'arroz' }, 50);
  });
});

describe('PostsService', () => {
  const DADOS: DadosPost = { titulo: 'Aviso', modelo: 'AVISO', formato: 'QUADRADO', conteudo: conteudoVazio(), legenda: '', ajustes: {} };
  const AJUSTES = { QUADRADO: { titulo: { x: 1, y: 1, largura: 10, altura: 10 } } };
  const comum: UsuarioRequisicao = { id: 'u', empresaId: 'e', superAdmin: false, permissoes: ['post.editar'] };
  const livre: UsuarioRequisicao = { ...comum, permissoes: ['post.editar', 'post.edicao_livre'] };
  const registro = { id: 'p', titulo: 'Aviso', modelo: 'AVISO', formato: 'QUADRADO', conteudo: conteudoVazio(), legenda: '', ajustes: {}, atualizadoEm: new Date() };
  const achar = jest.fn();
  const atualizar = jest.fn().mockResolvedValue(registro);
  const criar = jest.fn().mockResolvedValue(registro);
  const contar = jest.fn().mockResolvedValue(0);
  const criarImagem = jest.fn();
  const prisma = { postSocial: { findFirst: achar, update: atualizar, create: criar }, usuario: { findUnique: jest.fn().mockResolvedValue({ nome: 'Ana' }) }, imagemPost: { count: contar, create: criarImagem } };
  const servico = new PostsService(prisma as never, { registrar: jest.fn() } as never, {} as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sem a permissão, não cria post com ajustes nem muda os ajustes de um post', async () => {
    await expect(servico.criar('e', { ...DADOS, ajustes: AJUSTES }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    achar.mockResolvedValue({ ajustes: {} });
    await expect(servico.atualizar('e', 'p', { ...DADOS, ajustes: AJUSTES }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    expect(atualizar).not.toHaveBeenCalled();
  });

  it('sem a permissão, ainda edita o texto de um post que já tem ajustes', async () => {
    achar.mockResolvedValue({ ajustes: AJUSTES });
    await servico.atualizar('e', 'p', { ...DADOS, legenda: 'nova', ajustes: AJUSTES }, comum);
    expect(atualizar).toHaveBeenCalled();
  });

  it('com a permissão, muda os ajustes; a busca é sempre dentro da empresa', async () => {
    achar.mockResolvedValue({ ajustes: {} });
    await servico.atualizar('e', 'p', { ...DADOS, ajustes: AJUSTES }, livre);
    expect(atualizar).toHaveBeenCalled();
    expect(achar).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p', empresaId: 'e' } }));
  });

  it('recusa SVG mesmo declarado como PNG e grava o tipo real', async () => {
    const svg = `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`;
    await expect(servico.enviarImagem('e', 'a.png', svg, 'u')).rejects.toBeInstanceOf(BadRequestException);
    expect(criarImagem).not.toHaveBeenCalled();
    criarImagem.mockResolvedValue({ id: 'i', nome: 'a.png', criadoEm: new Date() });
    await servico.enviarImagem('e', 'a.webp', `data:image/webp;base64,${PNG.toString('base64')}`, 'u');
    expect(criarImagem.mock.calls[0][0].data.mime).toBe('image/png');
  });
});
