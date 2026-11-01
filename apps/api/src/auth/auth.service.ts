import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ehCodigoPermissao, type LoginDesafio, type LoginResposta, type UsuarioLogado } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { MensagensCobrancaService } from '../cobranca/mensagens-cobranca.service';
import { empresaBloqueada } from './acesso-empresa';
import type { PayloadToken } from './auth.guard';
import { config } from '../config';
import { decifrar } from '../cripto';
import { compararComHashFicticio, conferirSenha, gerarHashSenha } from './senha';
import { conferirTotp, hashDoCodigo } from './totp';

const FALHAS_ATE_BLOQUEAR = 5;
const BLOQUEIO_MS = 5 * 60_000;

const CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly cobranca: MensagensCobrancaService,
  ) {}

  async login(email: string, senha: string, codigo?: string, origem: { ip?: string; agente?: string } = {}): Promise<LoginResposta | LoginDesafio> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { empresa: true },
    });

    const senhaOk = usuario ? await conferirSenha(senha, usuario.senhaHash) : await compararComHashFicticio(senha);
    if (!usuario || !senhaOk) throw new UnauthorizedException(CREDENCIAIS_INVALIDAS);
    if (!usuario.ativo) throw new UnauthorizedException('Usuário desativado. Fale com o administrador da empresa.');

    let aviso: string | null = null;
    if (!usuario.superAdmin) {
      if (!usuario.empresa) throw new ForbiddenException('Usuário sem empresa vinculada.');
      if (empresaBloqueada(usuario.empresa)) throw new ForbiddenException(await this.cobranca.mensagemBloqueio(usuario.empresaId));
      aviso = (await this.cobranca.avisoAtual(usuario.empresa.id))?.mensagem ?? null;
    }

    if (usuario.totpAtivoEm) {
      if (!codigo) return { precisaCodigo: true };
      await this.conferirSegundaEtapa(usuario, codigo);
    }

    await this.prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });
    await this.auditoria.registrar({
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      acao: 'auth.login',
      entidade: 'Usuario',
      entidadeId: usuario.id,
    });

    // O id da sessão nasce aqui porque a validade vem do próprio token assinado.
    const sessaoId = randomUUID();
    const payload: PayloadToken = { sub: usuario.id, sid: sessaoId };
    const token = await this.jwt.signAsync(payload);
    const exp = this.jwt.decode<{ exp?: number } | null>(token)?.exp;
    await this.prisma.sessaoUsuario.create({
      data: {
        id: sessaoId,
        usuarioId: usuario.id,
        descricao: origem.agente?.slice(0, 300) ?? null,
        ip: origem.ip ?? null,
        expiraEm: exp ? new Date(exp * 1000) : new Date(Date.now() + 86_400_000),
      },
    });
    return {
      token,
      usuario: await this.usuarioLogado(usuario.id),
      aviso,
    };
  }

  private async conferirSegundaEtapa(
    usuario: { id: string; totpSegredoCifrado: string | null; totpUltimoPasso: bigint | null; totpFalhas: number; totpBloqueadoAte: Date | null; totpCodigosRecuperacao: string[] },
    codigo: string,
  ) {
    if (usuario.totpBloqueadoAte && usuario.totpBloqueadoAte > new Date()) {
      throw new UnauthorizedException('Muitas tentativas com código errado. Aguarde alguns minutos.');
    }
    const limpo = codigo.trim();
    const passo = usuario.totpSegredoCifrado ? conferirTotp(decifrar(usuario.totpSegredoCifrado, config().chaveCriptografia), limpo) : null;
    if (passo !== null && (usuario.totpUltimoPasso === null || BigInt(passo) > usuario.totpUltimoPasso)) {
      await this.prisma.usuario.update({ where: { id: usuario.id }, data: { totpUltimoPasso: BigInt(passo), totpFalhas: 0, totpBloqueadoAte: null } });
      return;
    }
    const hash = hashDoCodigo(limpo);
    if (usuario.totpCodigosRecuperacao.includes(hash)) {
      await this.prisma.usuario.update({ where: { id: usuario.id }, data: { totpCodigosRecuperacao: usuario.totpCodigosRecuperacao.filter((c) => c !== hash), totpFalhas: 0, totpBloqueadoAte: null } });
      return;
    }
    const falhas = usuario.totpFalhas + 1;
    const bloqueia = falhas >= FALHAS_ATE_BLOQUEAR;
    await this.prisma.usuario.update({ where: { id: usuario.id }, data: { totpFalhas: bloqueia ? 0 : falhas, totpBloqueadoAte: bloqueia ? new Date(Date.now() + BLOQUEIO_MS) : null } });
    throw new UnauthorizedException('Código inválido.');
  }

  async usuarioLogado(id: string): Promise<UsuarioLogado> {
    const u = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        superAdmin: true,
        totpAtivoEm: true,
        empresa: { select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true, statusAssinatura: true } },
        perfil: { select: { id: true, nome: true, permissoes: { select: { permissaoCodigo: true } } } },
      },
    });
    if (!u) throw new NotFoundException('Usuário não encontrado.');

    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      superAdmin: u.superAdmin,
      doisFatores: u.totpAtivoEm !== null,
      empresa: u.empresa,
      perfil: u.perfil ? { id: u.perfil.id, nome: u.perfil.nome } : null,
      permissoes: (u.perfil?.permissoes ?? []).map((p) => p.permissaoCodigo).filter(ehCodigoPermissao),
    };
  }

  async trocarSenha(id: string, senhaAtual: string, novaSenha: string, sessaoAtual?: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');
    if (!(await conferirSenha(senhaAtual, usuario.senhaHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    await this.prisma.usuario.update({ where: { id }, data: { senhaHash: await gerarHashSenha(novaSenha) } });
    // Quem trocou a senha por desconfiança não deixa outra sessão aberta.
    await this.prisma.sessaoUsuario.updateMany({ where: { usuarioId: id, encerradaEm: null, id: sessaoAtual ? { not: sessaoAtual } : undefined }, data: { encerradaEm: new Date() } });
    await this.auditoria.registrar({
      empresaId: usuario.empresaId,
      usuarioId: id,
      acao: 'auth.trocar_senha',
      entidade: 'Usuario',
      entidadeId: id,
    });
  }
}
