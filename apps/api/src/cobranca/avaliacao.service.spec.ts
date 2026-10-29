import { PARAMETROS_COBRANCA_PADRAO } from '@etiquetas/shared';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AvaliacaoCobrancaService } from './avaliacao.service';
import type { MensagensCobrancaService } from './mensagens-cobranca.service';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
  process.env.FUSO_HORARIO = 'America/Sao_Paulo';
});

const P = { ...PARAMETROS_COBRANCA_PADRAO, diasAvisoPrevio: 5, diasCarencia: 5, diasAteBloqueio: 15, frequenciaAvisoDias: 2 };

function montar(empresa: Record<string, unknown>, ultimoAviso: Date | null = null) {
  const prisma = {
    empresa: { findUnique: jest.fn(async () => empresa), update: jest.fn(async () => ({})) },
    avisoCobranca: {
      findFirst: jest.fn(async () => (ultimoAviso ? { criadoEm: ultimoAviso } : null)),
      create: jest.fn(async (_: unknown) => ({})),
    },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const mensagens = { daEmpresa: jest.fn(async () => ({ efetivos: P, sobrescritos: {} })) };
  const servico = new AvaliacaoCobrancaService(
    prisma as unknown as PrismaService,
    auditoria as unknown as AuditoriaService,
    mensagens as unknown as MensagensCobrancaService,
  );
  return { servico, prisma, auditoria };
}

const assinatura = (vencimento: string, controleManual = false) => ({
  valorMensal: 199.9,
  vencimentoAtual: new Date(`${vencimento}T00:00:00Z`),
  controleManual,
});

describe('AvaliacaoCobrancaService.avaliarEmpresa', () => {
  it('bloqueia após os dias até o bloqueio, audita e emite aviso com a mensagem preenchida', async () => {
    const { servico, prisma, auditoria } = montar({ razaoSocial: 'Mercado A', nomeFantasia: null, statusAssinatura: 'CARENCIA', assinatura: assinatura('2026-10-01') });
    const r = await servico.avaliarEmpresa('e1', '2026-10-20');
    expect(r).toEqual({ alterou: true, aviso: true, bloqueou: true, liberou: false });
    expect(prisma.empresa.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { statusAssinatura: 'BLOQUEADA' } });
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'assinatura.status_automatico', usuarioId: null }));
    const { data } = (prisma.avisoCobranca.create.mock.calls[0] as unknown as [{ data: { tipo: string; mensagem: string } }])[0];
    expect(data.tipo).toBe('BLOQUEADA');
    expect(data.mensagem).toContain('01/10/2026');
  });

  it('após o pagamento (vencimento no futuro) libera a empresa bloqueada', async () => {
    const { servico, prisma } = montar({ razaoSocial: 'A', nomeFantasia: null, statusAssinatura: 'BLOQUEADA', assinatura: assinatura('2026-11-30') });
    const r = await servico.avaliarEmpresa('e1', '2026-10-20');
    expect(r).toMatchObject({ alterou: true, liberou: true, aviso: false });
    expect(prisma.empresa.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { statusAssinatura: 'ATIVA' } });
  });

  it('respeita a frequência dos avisos', async () => {
    const ontem = new Date('2026-10-19T15:00:00Z');
    const a = montar({ razaoSocial: 'A', nomeFantasia: null, statusAssinatura: 'CARENCIA', assinatura: assinatura('2026-10-17') }, ontem);
    expect((await a.servico.avaliarEmpresa('e1', '2026-10-20')).aviso).toBe(false);
    const doisDias = new Date('2026-10-18T15:00:00Z');
    const b = montar({ razaoSocial: 'A', nomeFantasia: null, statusAssinatura: 'CARENCIA', assinatura: assinatura('2026-10-17') }, doisDias);
    expect((await b.servico.avaliarEmpresa('e1', '2026-10-20')).aviso).toBe(true);
  });

  it('controle manual: não muda o status (mas avisa)', async () => {
    const { servico, prisma } = montar({ razaoSocial: 'A', nomeFantasia: null, statusAssinatura: 'ATIVA', assinatura: assinatura('2026-09-01', true) });
    const r = await servico.avaliarEmpresa('e1', '2026-10-20');
    expect(r.alterou).toBe(false);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
    expect(r.aviso).toBe(true);
  });

  it('empresa cancelada ou sem assinatura não é avaliada', async () => {
    const cancelada = montar({ statusAssinatura: 'CANCELADA', assinatura: assinatura('2026-01-01') });
    expect(await cancelada.servico.avaliarEmpresa('e1', '2026-10-20')).toEqual({ alterou: false, aviso: false, bloqueou: false, liberou: false });
    const sem = montar({ statusAssinatura: 'ATIVA', assinatura: null });
    expect((await sem.servico.avaliarEmpresa('e1', '2026-10-20')).alterou).toBe(false);
    expect(cancelada.prisma.empresa.update).not.toHaveBeenCalled();
  });
});
