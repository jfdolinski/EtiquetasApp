import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { sha256 } from '../cripto';
import type { PrismaService } from '../prisma/prisma.service';
import { AgentesGateway } from './agentes.gateway';
import { AgentesService } from './agentes.service';
import { AgenteDesconectado } from './sessao-agente';

const EMPRESA = 'e1';
const EMPRESA_OK = { razaoSocial: 'Mercado A', nomeFantasia: null, ativa: true, statusAssinatura: 'ATIVA' };

function agenteBanco(extra: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    nome: 'Loja 1',
    ativo: true,
    tokenHash: null,
    versao: null,
    hostname: null,
    sistemaOperacional: null,
    ultimoContatoEm: null,
    ativadoEm: null,
    codigoAtivacaoExpiraEm: null,
    criadoEm: new Date(),
    _count: { conexoes: 0 },
    ...extra,
  };
}

function montar() {
  const prisma = {
    agente: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async (_: unknown) => null as unknown),
      findUnique: jest.fn(async () => null as unknown),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => agenteBanco(data)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => agenteBanco(data)),
      updateMany: jest.fn(async (_: unknown) => ({ count: 1 })),
    },
    empresa: { findUniqueOrThrow: jest.fn(async () => ({ cnpj: '11222333000181' })) },
  };
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  const gateway = {
    estaOnline: jest.fn(() => false),
    desconectar: jest.fn(),
    sessao: jest.fn(() => {
      throw new AgenteDesconectado('offline');
    }),
  } as unknown as jest.Mocked<AgentesGateway>;
  return { servico: new AgentesService(prisma as unknown as PrismaService, auditoria, gateway), prisma, gateway };
}

describe('AgentesService', () => {
  it('lista e busca apenas agentes da empresa', async () => {
    const { servico, prisma } = montar();
    await servico.listar(EMPRESA);
    expect(prisma.agente.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: EMPRESA } }));
    await expect(servico.obter(EMPRESA, 'a-alheio')).rejects.toThrow(NotFoundException);
    expect(prisma.agente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a-alheio', empresaId: EMPRESA } }));
  });

  it('cria com código de ativação e grava só o hash', async () => {
    const { servico, prisma } = montar();
    const r = await servico.criar(EMPRESA, { nome: ' Loja 1 ' }, 'autor');
    const { data } = prisma.agente.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ empresaId: EMPRESA, nome: 'Loja 1', codigoAtivacaoHash: sha256(r.codigo) });
    expect(JSON.stringify(data)).not.toContain(r.codigo);
    expect(r.agente.ativado).toBe(false);
  });

  it('novo código revoga o token e derruba o agente conectado', async () => {
    const { servico, prisma, gateway } = montar();
    prisma.agente.findFirst.mockResolvedValue(agenteBanco({ tokenHash: 'h' }));
    await servico.novoCodigoAtivacao(EMPRESA, 'a1', 'autor');
    expect(prisma.agente.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: null }) }));
    expect(gateway.desconectar).toHaveBeenCalledWith('a1', expect.any(Number), expect.any(String));
  });

  it('não rotaciona o token de agente offline', async () => {
    const { servico, prisma } = montar();
    prisma.agente.findFirst.mockResolvedValue(agenteBanco({ tokenHash: 'h' }));
    await expect(servico.rotacionarToken(EMPRESA, 'a1', 'autor')).rejects.toThrow(ConflictException);
    expect(prisma.agente.update).not.toHaveBeenCalled();
  });

  it('rotaciona: só troca o hash depois que o agente confirma', async () => {
    const { servico, prisma, gateway } = montar();
    prisma.agente.findFirst.mockResolvedValue(agenteBanco({ tokenHash: 'antigo' }));
    let tokenEnviado = '';
    gateway.sessao.mockReturnValue({
      requisitar: jest.fn(async (_tipo: string, dados: { token: string }) => {
        tokenEnviado = dados.token;
        expect(prisma.agente.update).not.toHaveBeenCalled();
        return {};
      }),
    } as never);
    await servico.rotacionarToken(EMPRESA, 'a1', 'autor');
    expect(prisma.agente.update).toHaveBeenCalledWith(expect.objectContaining({ data: { tokenHash: sha256(tokenEnviado) } }));
  });

  describe('ativar', () => {
    it('procura pelo CNPJ normalizado e hash do código, só códigos válidos', async () => {
      const { servico, prisma } = montar();
      await expect(servico.ativar({ cnpj: '11.222.333/0001-81', codigo: 'abcd efgh' })).rejects.toThrow(UnauthorizedException);
      const { where } = prisma.agente.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(where).toMatchObject({
        empresa: { cnpj: '11222333000181' },
        codigoAtivacaoHash: sha256('ABCD-EFGH'),
        codigoAtivacaoExpiraEm: { gt: expect.any(Date) },
        ativo: true,
      });
    });

    it('recusa empresa bloqueada', async () => {
      const { servico, prisma } = montar();
      prisma.agente.findFirst.mockResolvedValue({
        id: 'a1',
        nome: 'Loja 1',
        empresaId: EMPRESA,
        empresa: { ...EMPRESA_OK, statusAssinatura: 'BLOQUEADA' },
      });
      await expect(servico.ativar({ cnpj: '11222333000181', codigo: 'ABCD-EFGH' })).rejects.toThrow(ForbiddenException);
      expect(prisma.agente.updateMany).not.toHaveBeenCalled();
    });

    it('troca o código por um token de uso único', async () => {
      const { servico, prisma } = montar();
      prisma.agente.findFirst.mockResolvedValue({ id: 'a1', nome: 'Loja 1', empresaId: EMPRESA, empresa: EMPRESA_OK });
      const r = await servico.ativar({ cnpj: '11222333000181', codigo: 'ABCD-EFGH' });
      const { where, data } = prisma.agente.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(where).toEqual({ id: 'a1', codigoAtivacaoHash: sha256('ABCD-EFGH') });
      expect(data).toMatchObject({ tokenHash: sha256(r.token), codigoAtivacaoHash: null });
      expect(r).toMatchObject({ agenteId: 'a1', empresaNome: 'Mercado A' });
    });

    it('perde a corrida se o código já foi usado em paralelo', async () => {
      const { servico, prisma } = montar();
      prisma.agente.findFirst.mockResolvedValue({ id: 'a1', nome: 'Loja 1', empresaId: EMPRESA, empresa: EMPRESA_OK });
      prisma.agente.updateMany.mockResolvedValue({ count: 0 });
      await expect(servico.ativar({ cnpj: '11222333000181', codigo: 'ABCD-EFGH' })).rejects.toThrow(UnauthorizedException);
    });
  });
});

describe('AgentesGateway.autenticar', () => {
  function gatewayCom(agente: unknown) {
    const prisma = { agente: { findUnique: jest.fn(async () => agente) } };
    return { gateway: new AgentesGateway({} as never, prisma as unknown as PrismaService), prisma };
  }

  it('exige Bearer', async () => {
    const { gateway } = gatewayCom(null);
    await expect(gateway.autenticar(undefined)).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(gateway.autenticar('Basic xyz')).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('procura pelo hash do token', async () => {
    const { gateway, prisma } = gatewayCom(null);
    await expect(gateway.autenticar('Bearer agt_x')).resolves.toMatchObject({ ok: false, status: 401 });
    expect(prisma.agente.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: sha256('agt_x') } }));
  });

  it('recusa agente desativado e empresa bloqueada', async () => {
    const desativado = gatewayCom({ id: 'a1', empresaId: EMPRESA, ativo: false, empresa: EMPRESA_OK }).gateway;
    await expect(desativado.autenticar('Bearer t')).resolves.toMatchObject({ ok: false, status: 401 });
    const bloqueada = gatewayCom({ id: 'a1', empresaId: EMPRESA, ativo: true, empresa: { ...EMPRESA_OK, ativa: false } }).gateway;
    await expect(bloqueada.autenticar('Bearer t')).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it('aceita token válido', async () => {
    const { gateway } = gatewayCom({ id: 'a1', empresaId: EMPRESA, ativo: true, empresa: EMPRESA_OK });
    await expect(gateway.autenticar('Bearer t')).resolves.toEqual({ ok: true, agenteId: 'a1', empresaId: EMPRESA });
  });
});
