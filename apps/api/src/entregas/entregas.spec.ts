import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { distanciaMetros } from '@etiquetas/shared';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { hashDoToken } from '../auth/conta.service';
import type { PrismaService } from '../prisma/prisma.service';
import { contextoHttp } from '../testes/contexto-http';
import { CreditosService, gerarTxid } from './creditos';
import { EntregasEmpresaService } from './empresa';
import { EntregadoresService, EntregadorGuard } from './entregadores';
import { chaveDoEndereco, type MapasService } from './mapas';

class Rotas {
  rota() {}
}

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
});

const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;

describe('EntregadorGuard', () => {
  function guarda(sessao: unknown) {
    const prisma = { sessaoEntregador: { findUnique: jest.fn(async () => sessao), update: jest.fn(async () => ({})) } };
    return { g: new EntregadorGuard(prisma as unknown as PrismaService), prisma };
  }
  const ctx = (authorization?: string) => contextoHttp({ headers: { authorization } }, Rotas, 'rota');

  it('aceita só token ent_ de sessão aberta', async () => {
    const { g, prisma } = guarda({ id: 's1', entregadorId: 'e1', encerradaEm: null, ultimoUsoEm: new Date() });
    const c = ctx('Bearer ent_abc');
    await expect(g.canActivate(c)).resolves.toBe(true);
    expect(prisma.sessaoEntregador.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashDoToken('ent_abc') } }));
    expect((c.switchToHttp().getRequest() as { entregador: unknown }).entregador).toEqual({ id: 'e1', sessaoId: 's1' });
  });

  it('recusa token de usuário, de celular e sessão encerrada', async () => {
    const { g, prisma } = guarda(null);
    await expect(g.canActivate(ctx('Bearer app_abc'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(g.canActivate(ctx('Bearer eyJhbGciOi'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(g.canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sessaoEntregador.findUnique).not.toHaveBeenCalled();
    await expect(guarda({ id: 's1', entregadorId: 'e1', encerradaEm: new Date(), ultimoUsoEm: new Date() }).g.canActivate(ctx('Bearer ent_x'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('diária e posição', () => {
  function montar(opcoes: { situacao?: string; online?: boolean; diaria?: unknown; lotes?: { id: string; restante: number }[]; criarFalha?: boolean } = {}) {
    const lotes = opcoes.lotes ?? [{ id: 'l1', restante: 2 }];
    const tx = {
      diariaEntregador: {
        findUnique: jest.fn(async () => opcoes.diaria ?? null),
        create: jest.fn(async () => {
          if (opcoes.criarFalha) throw new Prisma.PrismaClientKnownRequestError('repetido', { code: 'P2002', clientVersion: 'x' });
          return {};
        }),
      },
      loteCredito: {
        findFirst: jest.fn(async () => lotes.find((l) => l.restante > 0) ?? null),
        updateMany: jest.fn(async ({ where }: { where: { id: string } }) => {
          const l = lotes.find((x) => x.id === where.id)!;
          if (l.restante <= 0) return { count: 0 };
          l.restante--;
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)),
      entregador: {
        findUniqueOrThrow: jest.fn(async () => ({ situacao: opcoes.situacao ?? 'APROVADO', online: opcoes.online ?? false, onlineDesde: null })),
        update: jest.fn(async () => ({})),
      },
    };
    const creditos = { saldo: jest.fn(async () => lotes.reduce((s, l) => s + l.restante, 0)) } as unknown as CreditosService;
    return { s: new EntregadoresService(prisma as unknown as PrismaService, creditos), prisma, tx, lotes };
  }
  const ponto = { lat: -23.55, lon: -46.63, precisao: 10 };

  it('desconta uma diária por dia, do lote que vence antes', async () => {
    const { s, tx, lotes } = montar();
    await expect(s.garantirDiaria('e1')).resolves.toBe(true);
    expect(lotes[0].restante).toBe(1);
    expect(tx.diariaEntregador.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entregadorId: 'e1', loteId: 'l1' }) });
  });

  it('não desconta de novo no mesmo dia', async () => {
    const { s, tx } = montar({ diaria: { id: 'd1' } });
    await expect(s.garantirDiaria('e1')).resolves.toBe(true);
    expect(tx.loteCredito.updateMany).not.toHaveBeenCalled();
  });

  it('sem saldo não fica online', async () => {
    const { s } = montar({ lotes: [] });
    await expect(s.garantirDiaria('e1')).resolves.toBe(false);
  });

  it('dois avisos juntos: o repetido conta como já descontado', async () => {
    const { s } = montar({ criarFalha: true });
    await expect(s.garantirDiaria('e1')).resolves.toBe(true);
  });

  it('fica online gravando a posição', async () => {
    const { s, prisma } = montar();
    await expect(s.posicao('e1', ponto, true)).resolves.toMatchObject({ online: true, aviso: null });
    expect(prisma.entregador.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: expect.objectContaining({ online: true, lat: -23.55, lon: -46.63, posicaoEm: expect.any(Date) }) });
  });

  it('GPS falso não grava a posição nem liga', async () => {
    const { s, prisma } = montar();
    await expect(s.posicao('e1', { ...ponto, simulada: true }, true)).resolves.toMatchObject({ online: false, aviso: 'GPS_FALSO' });
    expect(prisma.entregador.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { avisoEm: expect.any(Date) } });
  });

  it('sem crédito desliga e avisa', async () => {
    const { s, prisma } = montar({ online: true, lotes: [] });
    await expect(s.posicao('e1', ponto, false)).resolves.toMatchObject({ online: false, aviso: 'SEM_CREDITO' });
    expect(prisma.entregador.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: expect.objectContaining({ online: false }) });
  });

  it('cadastro não aprovado não fica online', async () => {
    const { s, tx } = montar({ situacao: 'PENDENTE' });
    await expect(s.posicao('e1', ponto, true)).resolves.toMatchObject({ online: false, aviso: 'NAO_APROVADO' });
    expect(tx.loteCredito.updateMany).not.toHaveBeenCalled();
  });

  it('posição de quem já está offline não liga de novo', async () => {
    const { s, prisma } = montar();
    await expect(s.posicao('e1', ponto, false)).resolves.toMatchObject({ online: false, aviso: null });
    expect(prisma.entregador.update).not.toHaveBeenCalled();
  });
});

describe('CreditosService', () => {
  function montar(opcoes: { pix?: boolean; abertos?: number; confirmados?: number } = {}) {
    const tx = {
      pedidoCredito: {
        updateMany: jest.fn(async () => ({ count: opcoes.confirmados ?? 1 })),
        findUniqueOrThrow: jest.fn(async () => ({ id: 'p1', entregadorId: 'e1', diarias: 7, validadeDias: 30, precoCentavos: 3500, txid: 'ENTX' })),
      },
      loteCredito: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)),
      parametrosEntregas: { findUnique: jest.fn(async () => (opcoes.pix === false ? null : { pixChave: 'pix@flow.com', pixNome: 'Flow', pixCidade: 'Sao Paulo', diariasBonusCadastro: 0, validadeBonusDias: 30 })) },
      pacoteCredito: { findFirst: jest.fn(async () => ({ id: 'k1', nome: 'Semana', diarias: 7, precoCentavos: 3500, validadeDias: 30 })) },
      pedidoCredito: {
        count: jest.fn(async () => opcoes.abertos ?? 0),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', situacao: 'AGUARDANDO', pagamentoInformadoEm: null, comprovanteMime: null, motivo: null, criadoEm: new Date(), decididoEm: null, ...data })),
      },
    };
    return { c: new CreditosService(prisma as unknown as PrismaService, auditoria), prisma, tx };
  }

  it('gera o Pix com o valor do pacote', async () => {
    const { c } = montar();
    const p = await c.pedir('e1', 'k1');
    expect(p.situacao).toBe('AGUARDANDO');
    expect(p.pixCopiaECola).toContain('540535.00');
    expect(p.pixCopiaECola).toContain(p.txid);
  });

  it('sem Pix configurado ou com compras demais em aberto, recusa', async () => {
    await expect(montar({ pix: false }).c.pedir('e1', 'k1')).rejects.toBeInstanceOf(ConflictException);
    await expect(montar({ abertos: 3 }).c.pedir('e1', 'k1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirmar cria o lote com a validade e só vale uma vez', async () => {
    const { c, tx } = montar();
    const antes = Date.now();
    await c.confirmar('p1', 'admin');
    const data = (tx.loteCredito.create.mock.calls[0] as unknown as [{ data: { quantidade: number; restante: number; venceEm: Date; pedidoId: string } }])[0].data;
    expect(data).toMatchObject({ quantidade: 7, restante: 7, pedidoId: 'p1' });
    expect(data.venceEm.getTime() - antes).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    await expect(montar({ confirmados: 0 }).c.confirmar('p1', 'admin')).rejects.toBeInstanceOf(ConflictException);
  });

  it('txid curto, só letras e números', () => {
    expect(gerarTxid()).toMatch(/^ENT[A-Z2-9]{10}$/);
  });
});

describe('mapa da empresa', () => {
  const base = { lat: -23.5505, lon: -46.6333 };
  function montar(entregadores: unknown[], comBase = true) {
    const prisma = {
      configuracaoEntregas: { findUnique: jest.fn(async () => (comBase ? { baseLat: base.lat, baseLon: base.lon, baseEndereco: 'Sé', raioAtendimentoKm: 5 } : null)) },
      entregador: { findMany: jest.fn(async () => entregadores) },
    };
    return { s: new EntregasEmpresaService(prisma as unknown as PrismaService, auditoria, {} as MapasService), prisma };
  }
  const agora = new Date('2026-11-17T12:00:00Z');

  it('mostra só quem está no raio, aproximado e pelo primeiro nome', async () => {
    const perto = { id: 'a', nome: 'Ana Souza', veiculo: 'MOTO', lat: -23.5614, lon: -46.6559, posicaoEm: new Date('2026-11-17T11:59:30Z') };
    const longe = { id: 'b', nome: 'Bruno Lima', veiculo: 'CARRO', lat: -23.6, lon: -46.7, posicaoEm: new Date('2026-11-17T11:59:30Z') };
    const { s } = montar([longe, perto]);
    const m = await s.mapa('emp', agora);
    expect(m.entregadores).toHaveLength(1);
    expect(m.entregadores[0]).toMatchObject({ id: 'a', nome: 'Ana', situacao: 'LIVRE' });
    expect(m.entregadores[0].lat).not.toBe(perto.lat);
    expect(distanciaMetros(perto, m.entregadores[0])).toBeLessThan(200);
  });

  it('sem ponto de partida não mostra ninguém', async () => {
    const { s, prisma } = montar([], false);
    expect((await s.mapa('emp', agora)).entregadores).toEqual([]);
    expect(prisma.entregador.findMany).not.toHaveBeenCalled();
  });
});

describe('busca de endereço', () => {
  it('a chave do cache ignora acento, caixa e pontuação', () => {
    expect(chaveDoEndereco('  Praça da Sé, 1 - São Paulo ')).toBe('praca da se 1 sao paulo');
  });
});
