import type { CatalogoService } from '../posts/catalogo.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FotosProdutoTelaService } from './fotos';

process.env.JWT_SECRET = 'x'.repeat(32);
process.env.DATABASE_URL = 'postgresql://teste';
process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
process.env.CATALOGO_URL = 'https://catalogo.exemplo';

const EAN = '7891000100103';
const ID = '11111111-1111-4111-8111-111111111111';
const AGORA = new Date('2026-11-08T12:00:00Z');
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 24 * 3_600_000);
const produto = (extra: Record<string, unknown> = {}) => ({ encontrado: true, nome: 'X', medicamento: false, imagens: [{ url: 'https://catalogo.exemplo/files/a.png', ia: false }], aviso: null, ...extra });

function montar(guardadas: Record<string, unknown>[] = []) {
  const prisma = {
    fotoProdutoTela: {
      findMany: jest.fn(async () => guardadas),
      findUnique: jest.fn(async () => null as unknown),
      update: jest.fn(async () => ({})),
      upsert: jest.fn(async () => ({})),
    },
  };
  const catalogo = {
    produto: jest.fn(async () => produto() as unknown),
    imagem: jest.fn(async () => ({ tipo: 'image/png', bytes: Buffer.from([1, 2, 3]) })),
  };
  return { s: new FotosProdutoTelaService(prisma as unknown as PrismaService, catalogo as unknown as CatalogoService), prisma, catalogo };
}

describe('fotos já guardadas', () => {
  it('coloca a foto no item, e código interno não vai ao catálogo', async () => {
    const { s } = montar([{ id: ID, codigo: EAN, mime: 'image/png', verificadoEm: diasAtras(1) }]);
    const { itens, faltam } = await s.aplicar('e1', [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN }, { nome: 'B', preco: 'R$ 1,00', codigo: '123' }, { nome: 'C', preco: 'R$ 1,00' }], AGORA);
    expect(itens[0].foto).toBe(`/api/tv/fotos/${ID}`);
    expect(itens[1].foto).toBeUndefined();
    expect(faltam).toEqual([]);
  });

  it('EAN com zeros à esquerda é o mesmo produto, e duas linhas iguais buscam uma vez', async () => {
    const { s } = montar();
    const { faltam } = await s.aplicar('e1', [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN }, { nome: 'A', preco: 'R$ 1,00', codigo: `0${EAN}` }], AGORA);
    expect(faltam).toEqual([EAN]);
  });

  it('confere de novo só depois do prazo: um mês com foto; sem foto, cada vez mais espaçado', async () => {
    const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000);
    const casos: [Record<string, unknown>, boolean][] = [
      [{ mime: 'image/png', tentativasSemFoto: 0, verificadoEm: diasAtras(29) }, false],
      [{ mime: 'image/png', tentativasSemFoto: 0, verificadoEm: diasAtras(31) }, true],
      // A primeira busca pode ter vindo antes de o catálogo cadastrar o código: volta logo.
      [{ mime: null, tentativasSemFoto: 1, verificadoEm: minutosAtras(5) }, false],
      [{ mime: null, tentativasSemFoto: 1, verificadoEm: minutosAtras(11) }, true],
      // Quem já estava guardado antes desta regra também volta logo.
      [{ mime: null, tentativasSemFoto: 0, verificadoEm: minutosAtras(11) }, true],
      [{ mime: null, tentativasSemFoto: 2, verificadoEm: minutosAtras(30) }, false],
      [{ mime: null, tentativasSemFoto: 2, verificadoEm: minutosAtras(61) }, true],
      [{ mime: null, tentativasSemFoto: 3, verificadoEm: minutosAtras(61) }, false],
      [{ mime: null, tentativasSemFoto: 9, verificadoEm: diasAtras(0.5) }, false],
      [{ mime: null, tentativasSemFoto: 9, verificadoEm: diasAtras(2) }, true],
    ];
    for (const [guardada, procura] of casos) {
      const { s } = montar([{ id: ID, codigo: EAN, ...guardada }]);
      const { faltam, itens } = await s.aplicar('e1', [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN }], AGORA);
      expect(faltam).toEqual(procura ? [EAN] : []);
      // Vencida para conferir, a foto continua valendo enquanto isso.
      expect(!!itens[0].foto).toBe(!!guardada.mime);
    }
  });

  it('ao carregar a pré-visualização, quem está sem foto é procurado na hora, e quem tem foto não', async () => {
    const { s, catalogo, prisma } = montar([{ id: ID, codigo: EAN, mime: null, tentativasSemFoto: 9, verificadoEm: new Date() }, { id: '22222222-2222-4222-8222-222222222222', codigo: '7891000100110', mime: 'image/png', tentativasSemFoto: 0, verificadoEm: new Date() }]);
    await s.paraPrevia('e1', [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN }, { nome: 'B', preco: 'R$ 1,00', codigo: '7891000100110' }]);
    expect(catalogo.produto).toHaveBeenCalledTimes(1);
    expect(catalogo.produto).toHaveBeenCalledWith('e1', EAN);
    expect(prisma.fotoProdutoTela.upsert).toHaveBeenCalled();
  });

  it('a atualização periódica não faz isso: respeita o prazo, para não gastar consumo', async () => {
    const { s } = montar([{ id: ID, codigo: EAN, mime: null, tentativasSemFoto: 9, verificadoEm: new Date() }]);
    expect((await s.aplicar('e1', [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN }])).faltam).toEqual([]);
  });

  it('foto que deixou de existir sai do item', async () => {
    const { s } = montar();
    const { itens } = await s.aplicar('e1', [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN, foto: `/api/tv/fotos/${ID}` }], AGORA);
    expect(itens[0].foto).toBeUndefined();
  });
});

describe('busca no catálogo', () => {
  it('guarda a foto, sem usar a de IA', async () => {
    const { s, prisma, catalogo } = montar();
    catalogo.produto.mockResolvedValueOnce(produto({ imagens: [{ url: 'https://catalogo.exemplo/files/ia.png', ia: true }, { url: 'https://catalogo.exemplo/files/real.png', ia: false }], medicamento: true }));
    expect(await s.buscar('e1', [EAN])).toBeNull();
    expect(catalogo.imagem).toHaveBeenCalledWith('e1', 'https://catalogo.exemplo/files/real.png');
    expect(prisma.fotoProdutoTela.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ empresaId: 'e1', codigo: EAN, mime: 'image/png', medicamento: true, urlOrigem: 'https://catalogo.exemplo/files/real.png' }) }));
  });

  it('conta as tentativas sem foto e zera quando a foto aparece', async () => {
    const semFoto = montar([{ id: ID, codigo: EAN, mime: null, urlOrigem: null, tentativasSemFoto: 2, verificadoEm: diasAtras(1) }]);
    semFoto.catalogo.produto.mockResolvedValueOnce(produto({ imagens: [] }));
    await semFoto.s.buscar('e1', [EAN]);
    expect(semFoto.prisma.fotoProdutoTela.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ tentativasSemFoto: 3 }), create: expect.objectContaining({ tentativasSemFoto: 3 }) }));
    const achou = montar([{ id: ID, codigo: EAN, mime: null, urlOrigem: null, tentativasSemFoto: 2, verificadoEm: diasAtras(1) }]);
    await achou.s.buscar('e1', [EAN]);
    expect(achou.prisma.fotoProdutoTela.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ tentativasSemFoto: 0, mime: 'image/png' }) }));
  });

  it('foto que não baixa: avisa quem está editando, guarda a tentativa e segue com as outras', async () => {
    const { s, prisma, catalogo } = montar();
    catalogo.imagem.mockRejectedValueOnce(new Error('fora'));
    const aviso = await s.buscar('e1', [EAN, '7891000100110']);
    expect(aviso).toContain('1 foto(s) do catálogo não puderam ser trazidas');
    expect(catalogo.produto).toHaveBeenCalledTimes(2);
    expect(prisma.fotoProdutoTela.upsert).toHaveBeenCalledTimes(2);
  });

  it('só com foto de IA ou nenhum produto: registra que não tem, para não gastar consumo a cada ciclo', async () => {
    for (const r of [produto({ imagens: [{ url: 'https://catalogo.exemplo/files/ia.png', ia: true }] }), { encontrado: false, nome: null, medicamento: false, imagens: [], aviso: null }]) {
      const { s, prisma, catalogo } = montar();
      catalogo.produto.mockResolvedValueOnce(r);
      await s.buscar('e1', [EAN]);
      expect(catalogo.imagem).not.toHaveBeenCalled();
      expect(prisma.fotoProdutoTela.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ mime: null, conteudo: null }) }));
    }
  });

  it('mesma foto: não baixa de novo nem troca o id, que está em cache nas TVs', async () => {
    const { s, prisma, catalogo } = montar([{ id: ID, codigo: EAN, mime: 'image/png', urlOrigem: 'https://catalogo.exemplo/files/a.png', verificadoEm: diasAtras(31) }]);
    await s.buscar('e1', [EAN]);
    expect(catalogo.imagem).not.toHaveBeenCalled();
    expect(prisma.fotoProdutoTela.upsert).not.toHaveBeenCalled();
    expect(prisma.fotoProdutoTela.update).toHaveBeenCalledWith({ where: { id: ID }, data: expect.objectContaining({ verificadoEm: expect.any(Date) }) });
  });

  it('foto nova: troca o id, senão a TV continuaria com a antiga', async () => {
    const { s, prisma } = montar([{ id: ID, codigo: EAN, mime: 'image/png', urlOrigem: 'https://catalogo.exemplo/files/antiga.png', verificadoEm: diasAtras(31) }]);
    await s.buscar('e1', [EAN]);
    const { update } = (prisma.fotoProdutoTela.upsert.mock.calls[0] as unknown as [{ update: { id?: string } }])[0];
    expect(update.id).toEqual(expect.any(String));
    expect(update.id).not.toBe(ID);
  });

  it('foto nova que não baixa ou é grande demais: mantém a antiga', async () => {
    const grande = Buffer.alloc(5_000_001);
    for (const falha of [() => Promise.reject(new Error('fora')), () => Promise.resolve({ tipo: 'image/png', bytes: grande })]) {
      const { s, prisma, catalogo } = montar([{ id: ID, codigo: EAN, mime: 'image/png', urlOrigem: 'https://catalogo.exemplo/files/antiga.png', verificadoEm: diasAtras(31) }]);
      catalogo.imagem.mockImplementationOnce(falha);
      await s.buscar('e1', [EAN]);
      expect(prisma.fotoProdutoTela.upsert).not.toHaveBeenCalled();
      expect(prisma.fotoProdutoTela.update).toHaveBeenCalled();
    }
  });

  it('catálogo fora do ar: para na primeira, não marca nada e pode tentar de novo', async () => {
    const { s, prisma, catalogo } = montar();
    catalogo.produto.mockResolvedValue(produto({ encontrado: false, imagens: [], aviso: 'O catálogo não respondeu.' }));
    const codigos = Array.from({ length: 50 }, (_, i) => String(7891000100000 + i));
    expect(await s.buscar('e1', codigos)).toBe('O catálogo não respondeu.');
    expect(catalogo.produto.mock.calls.length).toBeLessThanOrEqual(4);
    expect(prisma.fotoProdutoTela.upsert).not.toHaveBeenCalled();
    catalogo.produto.mockClear();
    await s.buscar('e1', codigos);
    expect(catalogo.produto).toHaveBeenCalled();
  });

  it('dois conteúdos com o mesmo produto ao mesmo tempo: uma busca só', async () => {
    const { s, catalogo } = montar();
    await Promise.all([s.buscar('e1', [EAN]), s.buscar('e1', [EAN])]);
    expect(catalogo.produto).toHaveBeenCalledTimes(1);
  });

  it('a mesma foto em outra empresa é buscada com a chave dela', async () => {
    const { s, catalogo } = montar();
    await Promise.all([s.buscar('e1', [EAN]), s.buscar('e2', [EAN])]);
    expect(catalogo.produto).toHaveBeenCalledTimes(2);
    expect(catalogo.produto).toHaveBeenCalledWith('e2', EAN);
  });
});

describe('arquivo', () => {
  it('sem foto guardada responde que não achou', async () => {
    const { s, prisma } = montar();
    await expect(s.arquivo(ID)).rejects.toThrow('Foto não encontrada');
    prisma.fotoProdutoTela.findUnique.mockResolvedValueOnce({ mime: null, conteudo: null });
    await expect(s.arquivo(ID)).rejects.toThrow('Foto não encontrada');
  });
});

describe('nome e categoria do catálogo (Pedidos)', () => {
  it('guarda nome e categoria na mesma busca da foto, e conta as buscas sem os dois', async () => {
    const { s, prisma, catalogo } = montar();
    catalogo.produto.mockResolvedValueOnce(produto({ nome: 'Arroz Tio João 5kg', categoria: 'Mercearia' }));
    await s.buscar('e1', [EAN]);
    expect(prisma.fotoProdutoTela.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ nome: 'Arroz Tio João 5kg', categoria: 'Mercearia', tentativasSemDados: 0, dadosEm: expect.any(Date) }) }));
    const sem = montar([{ id: ID, codigo: EAN, mime: 'image/png', urlOrigem: 'https://catalogo.exemplo/files/a.png', tentativasSemFoto: 0, tentativasSemDados: 2, verificadoEm: diasAtras(40) }]);
    sem.catalogo.produto.mockResolvedValueOnce(produto({ categoria: null }));
    await sem.s.buscar('e1', [EAN]);
    expect(sem.prisma.fotoProdutoTela.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nome: 'X', categoria: null, tentativasSemDados: 3 }) }));
  });

  it('com dados: procura quem nunca teve nome e categoria lidos e quem está incompleto no prazo; as telas não', async () => {
    const item = [{ nome: 'A', preco: 'R$ 1,00', codigo: EAN }];
    const casos: [Record<string, unknown>, boolean][] = [
      [{ dadosEm: null }, true],
      [{ dadosEm: diasAtras(1), nome: 'A', categoria: 'B' }, false],
      [{ dadosEm: new Date(AGORA.getTime() - 5 * 60_000), nome: 'A', categoria: null, tentativasSemDados: 1 }, false],
      [{ dadosEm: new Date(AGORA.getTime() - 15 * 60_000), nome: 'A', categoria: null, tentativasSemDados: 1 }, true],
    ];
    for (const [g, procura] of casos) {
      const { s } = montar([{ id: ID, codigo: EAN, mime: 'image/png', tentativasSemFoto: 0, tentativasSemDados: 0, verificadoEm: diasAtras(1), nome: null, categoria: null, ...g }]);
      expect((await s.aplicar('e1', item, AGORA, false, true)).faltam).toEqual(procura ? [EAN] : []);
      expect((await s.aplicar('e1', item, AGORA)).faltam).toEqual([]);
    }
    // "Atualizar agora": incompleto é procurado na hora.
    const { s } = montar([{ id: ID, codigo: EAN, mime: 'image/png', tentativasSemFoto: 0, tentativasSemDados: 4, verificadoEm: diasAtras(1), dadosEm: new Date(AGORA.getTime() - 60_000), nome: 'A', categoria: null }]);
    expect((await s.aplicar('e1', item, AGORA, true, true)).faltam).toEqual([EAN]);
  });
});
