import type { DispositivosService } from '../app-movel/app-movel.module';
import type { EmailService } from '../email/email.service';
import type { AgentesGateway } from '../agentes/agentes.gateway';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { completarDias, inicioDoPeriodo } from '../painel/painel.service';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificacoesService } from './notificacoes.service';

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32).toString('base64');
  process.env.FUSO_HORARIO = 'America/Sao_Paulo';
});

const EMPRESA = 'e1';
// Segunda-feira, 10:00 em São Paulo.
const AGORA = new Date('2026-11-02T13:00:00Z');
const DOMINGO = new Date('2026-11-01T13:00:00Z');

type Aberta = Record<string, unknown> & { id: string; evento: string; chave: string };

function montar(opcoes: { abertas?: Aberta[]; regra?: Record<string, unknown>; ultimoTrabalho?: Date; online?: string[] } = {}) {
  const criadas: Record<string, unknown>[] = [];
  const entregas: { agente: string; dados: { id: string } }[] = [];
  const prisma = {
    regraNotificacao: {
      findMany: jest.fn(async () => [{ evento: 'sem_etiquetas', ativo: true, limite: 24, canalAgente: true, canalSistema: true, canalEmail: false, canalCelular: false, repetirMinutos: 60, agenteIds: [], ...opcoes.regra }]),
    },
    janelaNotificacao: { findUnique: jest.fn(async () => null) },
    notificacao: {
      findMany: jest.fn(async () => opcoes.abertas ?? []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (criadas.push(data), { id: 'n1', vezes: 1, ...data })),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...opcoes.abertas?.find((a) => a.id === where.id), ...data, vezes: 2 })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    trabalhoImpressao: { findFirst: jest.fn(async () => ({ criadoEm: opcoes.ultimoTrabalho ?? new Date('2026-10-30T13:00:00Z'), modeloNome: 'Gôndola' })) },
    agente: { findMany: jest.fn(async () => [{ id: 'a1' }, { id: 'a2' }]) },
    empresa: { findUnique: jest.fn(async () => ({ criadoEm: new Date('2026-01-01') })) },
    pedido: { findMany: jest.fn(async (_a?: unknown) => [{ id: 'p1', numero: 7, clienteNome: 'Maria', totalCentavos: 6329, criadoEm: new Date(AGORA.getTime() - 2 * 60_000) }]) },
  };
  const online = new Set(opcoes.online ?? ['a1']);
  const gateway = {
    estaOnline: (id: string) => online.has(id),
    sessao: (agente: string) => ({ requisitar: jest.fn(async (_t: string, dados: { id: string }) => (entregas.push({ agente, dados }), {})) }),
  };
  const email = { disponivel: true, enderecosComPermissao: jest.fn(async () => ['ana@x.com']), enviar: jest.fn(async () => true) };
  const dispositivos = { avisarEmpresa: jest.fn(async () => 1) };
  const servico = new NotificacoesService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, gateway as unknown as AgentesGateway, email as unknown as EmailService, dispositivos as unknown as DispositivosService);
  return { servico, prisma, criadas, entregas, email, dispositivos };
}

const aberta = (extra: Record<string, unknown> = {}): Aberta => ({
  id: 'n1',
  empresaId: EMPRESA,
  evento: 'sem_etiquetas',
  chave: 'empresa',
  agenteIds: [],
  canalAgente: true,
  titulo: 't',
  mensagem: 'm',
  nivel: 'aviso',
  vezes: 1,
  ultimoEnvioEm: new Date(AGORA.getTime() - 10 * 60_000),
  ...extra,
});

describe('avaliação das regras', () => {
  it('pedido novo sem ninguém aceitar vira aviso, um por pedido, procurando só na empresa', async () => {
    const { servico, criadas, prisma } = montar({ regra: { evento: 'pedido_novo', limite: 0 } });
    await servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(prisma.pedido.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: EMPRESA, situacao: 'NOVO', criadoEm: { lte: AGORA } } }));
    expect(criadas).toHaveLength(1);
    expect(criadas[0]).toMatchObject({ evento: 'pedido_novo', chave: 'pedido:p1', titulo: 'Pedido nº 7' });
    expect(String(criadas[0].mensagem)).toBe('Maria fez um pedido de R$ 63,29 há 2 minutos. Aceite em Pedidos.');
  });

  it('problema novo cria a notificação e avisa quem está online', async () => {
    const { servico, criadas, entregas } = montar();
    await servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(criadas).toHaveLength(1);
    expect(criadas[0]).toMatchObject({ evento: 'sem_etiquetas', chave: 'empresa' });
    expect(String(criadas[0].mensagem)).toMatch(/há 3 dias/);
    expect(entregas.map((e) => e.agente)).toEqual(['a1']);
  });

  it('dentro do limite não avisa', async () => {
    const { servico, criadas } = montar({ ultimoTrabalho: new Date(AGORA.getTime() - 3_600_000) });
    await servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(criadas).toHaveLength(0);
  });

  it('fora da janela (domingo, no padrão) não envia, e não fecha o que continua aberto', async () => {
    const { servico, criadas, entregas, prisma } = montar({ abertas: [aberta({ ultimoEnvioEm: new Date('2026-10-01') })] });
    await servico.avaliarEmpresa(EMPRESA, DOMINGO);
    expect(criadas).toHaveLength(0);
    expect(entregas).toHaveLength(0);
    expect(prisma.notificacao.updateMany).not.toHaveBeenCalled();
  });

  it('aberta só repete depois do intervalo, com id novo para o agente', async () => {
    const cedo = montar({ abertas: [aberta()] });
    await cedo.servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(cedo.prisma.notificacao.update).not.toHaveBeenCalled();

    const tarde = montar({ abertas: [aberta({ ultimoEnvioEm: new Date(AGORA.getTime() - 61 * 60_000) })] });
    await tarde.servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(tarde.entregas[0].dados.id).toBe('n1:2');
    expect(tarde.criadas).toHaveLength(0);
  });

  it('condição que acabou resolve a notificação, sem filtrar outra empresa', async () => {
    const { servico, prisma } = montar({ abertas: [aberta()], ultimoTrabalho: AGORA });
    await servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['n1'] }, empresaId: EMPRESA }, data: { resolvidaEm: AGORA } });
  });

  it('só sistema: não fala com agente; agente escolhido: só ele', async () => {
    const soSistema = montar({ regra: { canalAgente: false } });
    await soSistema.servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(soSistema.criadas).toHaveLength(1);
    expect(soSistema.entregas).toHaveLength(0);

    const escolhido = montar({ regra: { agenteIds: ['a2'] }, online: ['a1', 'a2'] });
    await escolhido.servico.avaliarEmpresa(EMPRESA, AGORA);
    expect(escolhido.entregas.map((e) => e.agente)).toEqual(['a2']);
  });

  it('aviso sobre um agente não volta para ele ao reconectar', async () => {
    const { servico, prisma, entregas } = montar();
    (prisma.agente as unknown as { findUnique: unknown }).findUnique = jest.fn(async () => ({ empresaId: EMPRESA }));
    (prisma.notificacao as unknown as { findUnique: unknown }).findUnique = jest.fn(async () => ({ entregueAgentes: [] }));
    prisma.notificacao.findMany.mockResolvedValueOnce([aberta({ chave: 'agente:a1', evento: 'agente_offline', entregueAgentes: [] }), aberta({ id: 'n2', entregueAgentes: [] })]);
    await servico.entregarPendentes('a1');
    expect(entregas.map((e) => e.dados.id)).toEqual(['n2:1']);
  });
});

describe('períodos do painel', () => {
  it('início do período é a meia-noite local', () => {
    expect(inicioDoPeriodo(1, AGORA, 'America/Sao_Paulo').toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(inicioDoPeriodo(7, AGORA, 'America/Sao_Paulo').toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });

  it('dias sem etiqueta entram zerados e na ordem', () => {
    expect(completarDias([{ dia: '2026-11-01', etiquetas: 5 }], 3, '2026-11-02')).toEqual([
      { dia: '2026-10-31', etiquetas: 0 },
      { dia: '2026-11-01', etiquetas: 5 },
      { dia: '2026-11-02', etiquetas: 0 },
    ]);
  });
});

describe('canais de celular e e-mail', () => {
  const agora = new Date('2026-11-02T14:00:00Z');

  it('problema novo vai para o celular e para o e-mail quando a regra pede', async () => {
    const { servico, email, dispositivos } = montar({ regra: { canalCelular: true, canalEmail: true } });
    await servico.avaliarEmpresa(EMPRESA, agora);
    expect(dispositivos.avisarEmpresa).toHaveBeenCalledWith(EMPRESA, expect.objectContaining({ titulo: 'Sem gerar etiquetas', tela: 'avisos' }), 'notificacao.ver');
    expect(email.enviar).toHaveBeenCalledWith(['ana@x.com'], expect.stringContaining('Sem gerar etiquetas'), expect.any(String));
  });

  it('pedido novo vai ao celular de quem atende pedidos e abre a guia Pedidos', async () => {
    const { servico, dispositivos } = montar({ regra: { evento: 'pedido_novo', limite: 0, canalCelular: true } });
    await servico.avaliarEmpresa(EMPRESA, agora);
    expect(dispositivos.avisarEmpresa).toHaveBeenCalledWith(EMPRESA, expect.objectContaining({ titulo: 'Pedido nº 7', tela: 'pedidos' }), 'pedido.ver');
  });

  it('com os canais desligados, nada sai por eles', async () => {
    const { servico, email, dispositivos } = montar();
    await servico.avaliarEmpresa(EMPRESA, agora);
    expect(dispositivos.avisarEmpresa).not.toHaveBeenCalled();
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('celular fora do ar não impede o e-mail', async () => {
    const { servico, email, dispositivos } = montar({ regra: { canalCelular: true, canalEmail: true } });
    dispositivos.avisarEmpresa.mockRejectedValueOnce(new Error('Firebase fora'));
    await servico.avaliarEmpresa(EMPRESA, agora);
    expect(email.enviar).toHaveBeenCalled();
  });
});
