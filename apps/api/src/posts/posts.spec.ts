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
  const empresaComChave = () => buscaMarca.mockResolvedValue({ chaveCatalogoCifrada: cifrar('segredo', config().chaveCriptografia) });

  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

  it('produto pendente (cadastrado sozinho) não tem nome nem categoria de verdade', async () => {
    empresaComChave();
    pedido.mockResolvedValue(resposta({ name: 'PRODUTO NÃO CADASTRADO 789', category: '', pending: true, images: [{ url: `${BASE}/padrao/10.png`, placeholder: true }] }));
    expect(await servico.produto('e', '789')).toMatchObject({ encontrado: true, nome: null, categoria: null, imagens: [] });
  });

  it('some com a imagem provisória e marca a de IA', async () => {
    empresaComChave();
    pedido.mockResolvedValue(
      resposta({
        name: ' Café ',
        category: 'Mercearia',
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
      categoria: 'Mercearia',
      medicamento: true,
      imagens: [
        { url: `${BASE}/files/ia.png`, ia: true },
        { url: `${BASE}/files/real.png`, ia: false },
      ],
      aviso: null,
    });
  });

  describe('avisarConsulta', () => {
    const colunas = [{ nome: 'CodBarras', tipo: 'texto' }, { nome: 'descricao', tipo: 'texto' }];
    const esperar = () => new Promise((r) => setTimeout(r, 20));
    const comChave = () => buscaMarca.mockResolvedValue({ chaveCatalogoCifrada: cifrar('segredo', config().chaveCriptografia) });
    const urls = () => pedido.mock.calls.map((c) => String(c[0]).replace(`${BASE}/api/v1/barcodes/`, ''));
    // Serviço novo a cada teste: os códigos já avisados ficam guardados nele.
    const novo = () => new CatalogoService({ marcaPost: { findUnique: buscaMarca } } as never);

    it('avisa com a chave, na forma do catálogo, e uma vez só por dia', async () => {
      comChave();
      pedido.mockImplementation(async () => resposta({}));
      const s = novo();
      const linhas = [['07896004801216', 'A'], ['0000001343519', 'B'], ['12345670', 'C'], ['17896004801213', 'D'], ['7896004801216', 'repetido'], ['5692', 'interno'], [null, 'vazio']];
      s.avisarConsulta('e', { colunas, linhas });
      await esperar();
      expect(urls().sort()).toEqual(['0000001343519', '12345670', '17896004801213', '7896004801216']);
      expect((pedido.mock.calls[0][1] as RequestInit).headers).toEqual({ 'X-Api-Key': 'segredo' });
      pedido.mockClear();
      s.avisarConsulta('e', { colunas, linhas });
      await esperar();
      expect(pedido).not.toHaveBeenCalled();
      s.avisarConsulta('outra', { colunas, linhas });
      await esperar();
      expect(pedido).toHaveBeenCalledTimes(4);
    });

    it('sem chave, sem coluna de barras ou sem catálogo não chama nada', async () => {
      const s = novo();
      s.avisarConsulta('e', { colunas, linhas: [['7896004801216', 'A']] });
      comChave();
      s.avisarConsulta('e2', { colunas: [{ nome: 'codigo', tipo: 'texto' }], linhas: [['7896004801216']] });
      await esperar();
      expect(pedido).not.toHaveBeenCalled();
    });

    it('na busca que leu linhas a mais, só avisa as que têm o termo', async () => {
      comChave();
      pedido.mockImplementation(async () => resposta({}));
      novo().avisarConsulta('e', { colunas, linhas: [['7896004801216', 'Dipirona'], ['7891000100103', 'Outro']] }, 'dipi');
      await esperar();
      expect(urls()).toEqual(['7896004801216']);
    });

    it('catálogo fora do ar não derruba nada e a próxima consulta tenta de novo', async () => {
      comChave();
      pedido.mockRejectedValueOnce(new Error('rede'));
      const s = novo();
      const r = { colunas, linhas: [['7896004801216', 'A']] };
      s.avisarConsulta('e', r);
      await esperar();
      pedido.mockImplementation(async () => resposta({}));
      s.avisarConsulta('e', r);
      await esperar();
      expect(pedido).toHaveBeenCalledTimes(2);
    });

    it('chave recusada descarta o resto da fila daquela empresa', async () => {
      comChave();
      pedido.mockImplementation(async () => resposta({}, 401));
      const linhas = Array.from({ length: 50 }, (_, i) => [String(7896004800000 + i), 'x']);
      novo().avisarConsulta('e', { colunas, linhas });
      await esperar();
      expect(pedido.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it('limita os avisos de uma consulta enorme', async () => {
      comChave();
      pedido.mockImplementation(async () => resposta({}));
      const linhas = Array.from({ length: 1500 }, (_, i) => [String(7896004800000 + i), 'x']);
      novo().avisarConsulta('e', { colunas, linhas });
      await new Promise((r) => setTimeout(r, 300));
      expect(pedido).toHaveBeenCalledTimes(1000);
    });
  });

  it('sem a chave da empresa, nada vai ao catálogo: nem produto, nem imagem', async () => {
    const r = await servico.produto('e', '7894900011517');
    expect(r).toMatchObject({ encontrado: false, aviso: expect.stringMatching(/chave do catálogo/) });
    await expect(servico.imagem('e', `${BASE}/files/a.png`)).rejects.toThrow(/chave do catálogo/);
    expect(await servico.temChave('e')).toBe(false);
    expect(pedido).not.toHaveBeenCalled();
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
    empresaComChave();
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
    empresaComChave();
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
  const buscarPorTermo = jest.fn();
  const servico = new PostsService({ consultaSql: { findFirst: achar } } as never, {} as never, { executar, buscarPorTermo } as never, { conjunto } as never);
  const resultado = { colunas: [{ nome: 'ean' }, { nome: 'descricao' }, { nome: 'preco' }], linhas: [['789', 'Café moído', '4.99'], ['790', 'Café banido', '5.00'], ['791', 'Arroz', '9.00']] };

  beforeEach(() => {
    achar.mockReset();
    executar.mockReset().mockResolvedValue(resultado);
    buscarPorTermo.mockReset().mockResolvedValue(resultado);
    conjunto.mockReset().mockResolvedValue(new Set(['790']));
  });

  it('passa o termo para os parâmetros e tira o produto banido, sem filtrar de novo', async () => {
    achar.mockResolvedValue({ sql: 'SELECT ean, descricao, preco FROM p WHERE descricao ILIKE {param.busca}', conexao: { tipo: 'POSTGRES' } });
    const r = await servico.buscarProdutos('e', 'c', '%a%', 'u');
    expect(achar).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c', empresaId: 'e' } }));
    expect(executar).toHaveBeenCalledWith('e', 'c', 'u', { busca: '%a%' }, 50);
    expect(r.banidos).toBe(1);
    expect(r.produtos).toMatchObject([
      { codigo: '789', descricao: 'Café moído', preco: 'R$ 4,99', imagem: null },
      { codigo: '791', descricao: 'Arroz', preco: 'R$ 9,00', imagem: null, registro: { ean: '791', descricao: 'Arroz', preco: '9.00' } },
    ]);
  });

  it('consulta sem parâmetro: filtra no banco, confere as linhas aqui e avisa se ficou incompleto', async () => {
    achar.mockResolvedValue({ sql: 'SELECT ean, descricao, preco FROM p', conexao: { tipo: 'POSTGRES' } });
    buscarPorTermo.mockResolvedValue({ ...resultado, truncado: true });
    const r = await servico.buscarProdutos('e', 'c', 'arroz', 'u');
    expect(buscarPorTermo).toHaveBeenCalledWith('e', 'c', 'u', 'arroz', 5000);
    expect(executar).not.toHaveBeenCalled();
    expect(r.produtos.map((p) => p.descricao)).toEqual(['Arroz']);
    expect(r.incompleta).toBe(true);
  });

  it('planilha recebe o termo no parâmetro de busca dela', async () => {
    achar.mockResolvedValue({ sql: '', conexao: { tipo: 'PASTA' } });
    await servico.buscarProdutos('e', 'c', 'arroz', 'u');
    expect(executar).toHaveBeenCalledWith('e', 'c', 'u', { busca: 'arroz' }, 50);
  });
});

describe('limpeza da galeria e template padrão', () => {
  const DADOS: DadosPost = { titulo: 'Aviso', modelo: 'AVISO', formato: 'QUADRADO', conteudo: conteudoVazio(), legenda: '', ajustes: {} };
  const registro = { id: 'p', titulo: 'Aviso', modelo: 'AVISO', formato: 'QUADRADO', conteudo: conteudoVazio(), legenda: '', ajustes: {}, atualizadoEm: new Date() };
  const comum: UsuarioRequisicao = { id: 'u', empresaId: 'e', superAdmin: false, permissoes: ['post.editar'] };
  const livre: UsuarioRequisicao = { ...comum, permissoes: ['post.editar', 'post.edicao_livre'] };
  const USADA = '11111111-1111-4111-8111-111111111111';
  const LOGO = '22222222-2222-4222-8222-222222222222';
  const DO_TEMPLATE = '33333333-3333-4333-8333-333333333333';
  const SOLTA = '44444444-4444-4444-8444-444444444444';
  const montar = () => {
    const imagensAntigas = jest.fn().mockResolvedValue([USADA, LOGO, DO_TEMPLATE, SOLTA].map((id) => ({ id })));
    const apagar = jest.fn().mockResolvedValue({ count: 1 });
    const marca = jest.fn().mockResolvedValue({ logoId: LOGO, templatePadrao: { design: { fundo: { tipo: 'imagem', imagem: { origem: 'GALERIA', id: DO_TEMPLATE } } } } });
    const registrar = jest.fn();
    const prisma = {
      postSocial: { create: jest.fn().mockResolvedValue(registro), findMany: jest.fn().mockResolvedValue([{ conteudo: { imagem: { origem: 'GALERIA', id: USADA } }, design: {} }]) },
      usuario: { findUnique: jest.fn().mockResolvedValue({ nome: 'Ana' }) },
      imagemPost: { findMany: imagensAntigas, deleteMany: apagar },
      marcaPost: { findUnique: marca },
    };
    return { servico: new PostsService(prisma as never, { registrar } as never, {} as never, {} as never), imagensAntigas, apagar, marca, registrar, prisma };
  };

  it('ao criar um post, apaga só o que ninguém usa, dentro da empresa, e registra na auditoria', async () => {
    const m = montar();
    await m.servico.criar('e', DADOS, livre);
    expect(m.apagar).toHaveBeenCalledWith({ where: { empresaId: 'e', id: { in: [SOLTA] } } });
    expect(m.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'post.imagem.limpeza', detalhes: { apagadas: 1 } }));
    expect(m.prisma.postSocial.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: 'e' } }));
  });

  it('imagem enviada há pouco fica: pode estar num post ainda não salvo', async () => {
    const m = montar();
    await m.servico.criar('e', DADOS, livre);
    const limite: Date = m.imagensAntigas.mock.calls[0][0].where.criadoEm.lt;
    expect(Date.now() - limite.getTime()).toBeGreaterThanOrEqual(3_600_000 - 1000);
  });

  it('nada a apagar: nem consulta os posts; falha na limpeza não derruba a criação do post', async () => {
    const vazio = montar();
    vazio.imagensAntigas.mockResolvedValue([]);
    await vazio.servico.criar('e', DADOS, livre);
    expect(vazio.prisma.postSocial.findMany).not.toHaveBeenCalled();
    const falha = montar();
    falha.apagar.mockRejectedValue(new Error('banco'));
    await expect(falha.servico.criar('e', DADOS, livre)).resolves.toMatchObject({ id: 'p' });
  });

  it('sem a edição livre, o post pode nascer do template padrão, mas não de outra aparência', async () => {
    const design = { corPrincipal: '#123456' };
    const ajustes = { QUADRADO: { titulo: { x: 1 } } };
    const m = montar();
    m.marca.mockResolvedValue({ templatePadrao: { design, ajustes }, logoId: null });
    await expect(m.servico.criar('e', { ...DADOS, design, ajustes }, comum)).resolves.toMatchObject({ id: 'p' });
    await expect(m.servico.criar('e', { ...DADOS, design: { corPrincipal: '#654321' } }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.servico.criar('e', { ...DADOS, ajustes: { QUADRADO: { titulo: { x: 9 } } } }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    m.marca.mockResolvedValue(null);
    await expect(m.servico.criar('e', { ...DADOS, design }, comum)).rejects.toBeInstanceOf(ForbiddenException);
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
  const prisma = { postSocial: { findFirst: achar, update: atualizar, create: criar }, usuario: { findUnique: jest.fn().mockResolvedValue({ nome: 'Ana' }) }, imagemPost: { count: contar, create: criarImagem }, marcaPost: { findUnique: jest.fn().mockResolvedValue(null) } };
  const servico = new PostsService(prisma as never, { registrar: jest.fn() } as never, {} as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sem a permissão, não cria post com ajustes nem muda os ajustes de um post', async () => {
    await expect(servico.criar('e', { ...DADOS, ajustes: AJUSTES }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    achar.mockResolvedValue({ ajustes: {}, design: {} });
    await expect(servico.atualizar('e', 'p', { ...DADOS, ajustes: AJUSTES }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    expect(atualizar).not.toHaveBeenCalled();
  });

  it('sem a permissão, não muda a aparência; com ela, muda', async () => {
    const design = { corPrincipal: '#123456' };
    await expect(servico.criar('e', { ...DADOS, design }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    achar.mockResolvedValue({ ajustes: {}, design: {} });
    await expect(servico.atualizar('e', 'p', { ...DADOS, design }, comum)).rejects.toBeInstanceOf(ForbiddenException);
    await servico.atualizar('e', 'p', { ...DADOS, design }, livre);
    expect(atualizar.mock.calls[0][0].data.design).toEqual(design);
  });

  it('sem a permissão, ainda edita o texto de um post que já tem ajustes', async () => {
    achar.mockResolvedValue({ ajustes: AJUSTES, design: { corPrincipal: '#123456' } });
    await servico.atualizar('e', 'p', { ...DADOS, legenda: 'nova', ajustes: AJUSTES, design: { corPrincipal: '#123456' } }, comum);
    expect(atualizar).toHaveBeenCalled();
  });

  it('com a permissão, muda os ajustes; a busca é sempre dentro da empresa', async () => {
    achar.mockResolvedValue({ ajustes: {}, design: {} });
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
