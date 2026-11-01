import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { EmailService } from '../email/email.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CadastroService, MENSAGEM_CADASTRO, SITUACAO_NAO_ENCONTRADA } from './cadastro.service';
import type { ConsultaCnpjService } from './consulta-cnpj';

const CNPJ = '11222333000181';
const dto = { cnpj: '11.222.333/0001-81', email: 'Ana@Mercado.com', senha: 'senha-forte-123' };

function montar(opcoes: { empresa?: unknown; emailEmUso?: boolean; consulta?: () => Promise<unknown>; pendentes?: number; empresasPendentes?: number } = {}) {
  const tx = {
    empresa: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'e1', ...data })) },
    perfil: { create: jest.fn(async () => ({ id: 'p1' })) },
    usuario: { create: jest.fn(async () => ({ id: 'u1' })) },
  };
  const prisma = {
    usuario: {
      findUnique: jest.fn(async () => (opcoes.emailEmUso ? { id: 'x' } : null)),
      count: jest.fn(async () => opcoes.pendentes ?? 0),
      create: jest.fn(async () => ({ id: 'u1' })),
      findMany: jest.fn(async () => [{ email: 'super@x.com' }]),
    },
    empresa: { findUnique: jest.fn(async () => opcoes.empresa ?? null), count: jest.fn(async () => opcoes.empresasPendentes ?? 0) },
    $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)),
  };
  const email = { enderecosComPermissao: jest.fn(async () => ['admin@x.com']), enviar: jest.fn(async () => true) };
  const consulta = { consultar: jest.fn(opcoes.consulta ?? (async () => ({ razaoSocial: 'MERCADO LTDA', nomeFantasia: 'Mercadinho', situacao: 'ATIVA' }))) };
  const s = new CadastroService(prisma as unknown as PrismaService, { registrar: jest.fn() } as unknown as AuditoriaService, email as unknown as EmailService, consulta as unknown as ConsultaCnpjService);
  return { s, tx, prisma, email, consulta };
}

const criada = (tx: ReturnType<typeof montar>['tx']) => (tx.empresa.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;

describe('CadastroService.solicitar', () => {
  it('CNPJ novo usa a busca de dados e nasce pendente, com o usuário pendente', async () => {
    const { s, tx, consulta } = montar();
    await expect(s.solicitar(dto)).resolves.toEqual({ mensagem: MENSAGEM_CADASTRO });
    expect(consulta.consultar).toHaveBeenCalledWith(CNPJ);
    expect(criada(tx)).toMatchObject({ razaoSocial: 'MERCADO LTDA', nomeFantasia: 'Mercadinho', situacaoReceita: 'ATIVA', cnpj: CNPJ, ativa: false, aprovacaoPendente: true });
    const usuario = (tx.usuario.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(usuario).toMatchObject({ email: 'ana@mercado.com', nome: 'ana', ativo: false, cadastroPendente: true, empresaId: 'e1' });
    expect(usuario.senhaHash).not.toBe(dto.senha);
    expect(usuario.perfilId).toBeUndefined();
  });

  it('CNPJ que a Receita não conhece fica pendente mesmo assim, marcado', async () => {
    const { s, tx } = montar({ consulta: async () => { throw new NotFoundException(); } });
    await s.solicitar(dto);
    expect(criada(tx)).toMatchObject({ razaoSocial: 'CNPJ 11.222.333/0001-81', situacaoReceita: SITUACAO_NAO_ENCONTRADA, aprovacaoPendente: true });
  });

  it('busca fora do ar não impede o pedido e fica sem situação', async () => {
    const { s, tx } = montar({ consulta: async () => { throw new ServiceUnavailableException(); } });
    await expect(s.solicitar(dto)).resolves.toEqual({ mensagem: MENSAGEM_CADASTRO });
    expect(criada(tx)).toMatchObject({ situacaoReceita: null, aprovacaoPendente: true });
  });

  it('empresa ativa: não consulta nem cria empresa, e avisa quem aprova nela', async () => {
    const { s, tx, prisma, consulta, email } = montar({ empresa: { id: 'e9', ativa: true, statusAssinatura: 'ATIVA', aprovacaoPendente: false } });
    await expect(s.solicitar(dto)).resolves.toEqual({ mensagem: MENSAGEM_CADASTRO });
    expect(consulta.consultar).not.toHaveBeenCalled();
    expect(tx.empresa.create).not.toHaveBeenCalled();
    expect(prisma.usuario.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ empresaId: 'e9', ativo: false, cadastroPendente: true }) }));
    expect(email.enderecosComPermissao).toHaveBeenCalledWith('e9', 'usuario.editar');
  });

  it('empresa bloqueada: o aviso vai para o super-admin, nunca para ela', async () => {
    const { s, email } = montar({ empresa: { id: 'e9', ativa: true, statusAssinatura: 'BLOQUEADA', aprovacaoPendente: false } });
    await s.solicitar(dto);
    expect(email.enderecosComPermissao).not.toHaveBeenCalled();
    expect(email.enviar).toHaveBeenCalledWith(['super@x.com'], expect.any(String), expect.any(String));
  });

  it('e-mail em uso é recusado antes de qualquer consulta', async () => {
    const { s, consulta } = montar({ emailEmUso: true });
    await expect(s.solicitar(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(consulta.consultar).not.toHaveBeenCalled();
  });

  it('limites contra pedidos em massa', async () => {
    await expect(montar({ empresasPendentes: 200 }).s.solicitar(dto)).rejects.toBeInstanceOf(HttpException);
    await expect(montar({ pendentes: 20, empresa: { id: 'e9', ativa: true, statusAssinatura: 'ATIVA', aprovacaoPendente: false } }).s.solicitar(dto)).rejects.toBeInstanceOf(HttpException);
  });
});
