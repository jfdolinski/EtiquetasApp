import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { LoginResposta } from '@etiquetas/shared';
import type { JwtService } from '@nestjs/jwt';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MensagensCobrancaService } from '../cobranca/mensagens-cobranca.service';
import { AuthService } from './auth.service';
import { cifrar } from '../cripto';
import { gerarHashSenha } from './senha';
import { codigoDoPasso, deBase32, hashDoCodigo } from './totp';

async function montar(sobrescrever: Record<string, unknown> = {}) {
  const usuario = {
    id: 'u1',
    empresaId: 'e1',
    nome: 'Ana',
    email: 'ana@empresa.com',
    senhaHash: await gerarHashSenha('senha-correta'),
    totpAtivoEm: null as Date | null,
    totpSegredoCifrado: null as string | null,
    totpUltimoPasso: null as bigint | null,
    totpFalhas: 0,
    totpBloqueadoAte: null as Date | null,
    totpCodigosRecuperacao: [] as string[],
    superAdmin: false,
    ativo: true,
    empresa: { id: 'e1', ativa: true, statusAssinatura: 'ATIVA' },
    perfil: { id: 'p1', nome: 'Operador', permissoes: [{ permissaoCodigo: 'imprimir' }] },
    ...sobrescrever,
  };
  const prisma = {
    usuario: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
        where.email === undefined || where.email === usuario.email ? usuario : null,
      ),
      update: jest.fn(async () => usuario),
    },
    sessaoUsuario: { create: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const jwt = { signAsync: jest.fn(async () => 'token-assinado'), decode: jest.fn(() => ({ exp: 2_000_000_000 })) } as unknown as JwtService;
  const auditoria = { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService;
  const cobranca = {
    mensagemBloqueio: jest.fn(async () => 'Bloqueada: vencimento 10/11/2026'),
    avisoAtual: jest.fn(async () =>
      usuario.empresa?.statusAssinatura === 'CARENCIA' ? { id: 'a1', tipo: 'CARENCIA', mensagem: 'Venceu há 3 dias', criadoEm: '' } : null,
    ),
  };
  return { servico: new AuthService(prisma as unknown as PrismaService, jwt, auditoria, cobranca as unknown as MensagensCobrancaService), prisma, cobranca };
}

describe('AuthService.login', () => {
  it('retorna token e usuário com as permissões do perfil', async () => {
    const { servico, prisma } = await montar();
    const r = (await servico.login('  ANA@empresa.com ', 'senha-correta')) as LoginResposta;
    expect(r.token).toBe('token-assinado');
    expect(r.usuario.permissoes).toEqual(['imprimir']);
    expect(r.aviso).toBeNull();
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ana@empresa.com' } }),
    );
  });

  it('mesma mensagem para e-mail inexistente e senha errada', async () => {
    const { servico } = await montar();
    await expect(servico.login('ana@empresa.com', 'errada')).rejects.toThrow('E-mail ou senha inválidos.');
    await expect(servico.login('outro@empresa.com', 'senha-correta')).rejects.toThrow('E-mail ou senha inválidos.');
  });

  it('rejeita usuário desativado', async () => {
    const { servico } = await montar({ ativo: false });
    await expect(servico.login('ana@empresa.com', 'senha-correta')).rejects.toThrow(UnauthorizedException);
  });

  it('bloqueia empresa bloqueada com a mensagem dos parâmetros de cobrança', async () => {
    const { servico, cobranca } = await montar({ empresa: { id: 'e1', ativa: true, statusAssinatura: 'BLOQUEADA' } });
    await expect(servico.login('ana@empresa.com', 'senha-correta')).rejects.toThrow(ForbiddenException);
    await expect(servico.login('ana@empresa.com', 'senha-correta')).rejects.toThrow('Bloqueada: vencimento 10/11/2026');
    expect(cobranca.mensagemBloqueio).toHaveBeenCalledWith('e1');
  });

  it('devolve o aviso de cobrança vigente', async () => {
    const { servico } = await montar({ empresa: { id: 'e1', ativa: true, statusAssinatura: 'CARENCIA' } });
    const r = (await servico.login('ana@empresa.com', 'senha-correta')) as LoginResposta;
    expect(r.aviso).toBe('Venceu há 3 dias');
  });
});

describe('AuthService.login com verificação em duas etapas', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = 'postgresql://teste';
    process.env.CHAVE_CRIPTOGRAFIA = Buffer.alloc(32, 7).toString('base64');
  });

  const SEGREDO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const codigoAgora = () => codigoDoPasso(deBase32(SEGREDO), Math.floor(Date.now() / 30_000));
  const com2fa = (extra: Record<string, unknown> = {}) => montar({ totpAtivoEm: new Date(), totpSegredoCifrado: cifrar(SEGREDO, Buffer.alloc(32, 7)), ...extra });

  it('senha certa sem código pede o código e não abre sessão', async () => {
    const { servico, prisma } = await com2fa();
    await expect(servico.login('ana@empresa.com', 'senha-correta')).resolves.toEqual({ precisaCodigo: true });
    expect(prisma.sessaoUsuario.create).not.toHaveBeenCalled();
  });

  it('senha errada não revela que a conta tem duas etapas', async () => {
    const { servico } = await com2fa();
    await expect(servico.login('ana@empresa.com', 'errada')).rejects.toThrow('E-mail ou senha inválidos.');
  });

  it('código certo entra e abre sessão', async () => {
    const { servico, prisma } = await com2fa();
    const r = (await servico.login('ana@empresa.com', 'senha-correta', codigoAgora())) as LoginResposta;
    expect(r.token).toBe('token-assinado');
    expect(r.usuario.doisFatores).toBe(true);
    expect(prisma.sessaoUsuario.create).toHaveBeenCalledTimes(1);
  });

  it('o mesmo código não entra duas vezes', async () => {
    const passo = Math.floor(Date.now() / 30_000);
    const { servico } = await com2fa({ totpUltimoPasso: BigInt(passo + 1) });
    await expect(servico.login('ana@empresa.com', 'senha-correta', codigoAgora())).rejects.toThrow('Código inválido.');
  });

  it('código de recuperação entra uma vez e é consumido', async () => {
    const { servico, prisma } = await com2fa({ totpCodigosRecuperacao: [hashDoCodigo('ABCD-EFGH'), hashDoCodigo('IJKL-MNOP')] });
    await servico.login('ana@empresa.com', 'senha-correta', 'abcd-efgh');
    expect(prisma.usuario.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totpCodigosRecuperacao: [hashDoCodigo('IJKL-MNOP')] }) }));
  });

  it('a quinta falha bloqueia por alguns minutos', async () => {
    const { servico, prisma } = await com2fa({ totpFalhas: 4 });
    await expect(servico.login('ana@empresa.com', 'senha-correta', '000000x')).rejects.toThrow('Código inválido.');
    expect(prisma.usuario.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totpFalhas: 0, totpBloqueadoAte: expect.any(Date) }) }));
  });

  it('bloqueado não confere nem o código certo', async () => {
    const { servico } = await com2fa({ totpBloqueadoAte: new Date(Date.now() + 60_000) });
    await expect(servico.login('ana@empresa.com', 'senha-correta', codigoAgora())).rejects.toThrow('Aguarde');
  });
});
