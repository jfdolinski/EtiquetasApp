import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IniciarDoisFatoresResposta, SessaoResumo } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { cifrar, decifrar } from '../cripto';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { conferirSenha, gerarHashSenha } from './senha';
import { conferirTotp, gerarCodigosRecuperacao, gerarSegredoTotp, hashDoCodigo, uriTotp } from './totp';

const VALIDADE_REDEFINICAO_MS = 3_600_000;
const MAXIMO_PEDIDOS_POR_HORA = 3;

export const hashDoToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Segurança da própria conta: sessões, verificação em duas etapas e senha esquecida. */
@Injectable()
export class ContaService {
  private readonly log = new Logger('Conta');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly email: EmailService,
  ) {}

  // ---- Sessões ----

  async sessoes(usuarioId: string, atual: string | undefined): Promise<SessaoResumo[]> {
    const lista = await this.prisma.sessaoUsuario.findMany({
      where: { usuarioId, encerradaEm: null, expiraEm: { gt: new Date() } },
      orderBy: { ultimoUsoEm: 'desc' },
      take: 50,
    });
    return lista.map((s) => ({ id: s.id, descricao: s.descricao, ip: s.ip, criadoEm: s.criadoEm.toISOString(), ultimoUsoEm: s.ultimoUsoEm.toISOString(), atual: s.id === atual }));
  }

  async encerrarSessao(usuarioId: string, id: string, empresaId: string | null) {
    const { count } = await this.prisma.sessaoUsuario.updateMany({ where: { id, usuarioId, encerradaEm: null }, data: { encerradaEm: new Date() } });
    if (count === 0) throw new NotFoundException('Sessão não encontrada.');
    await this.auditoria.registrar({ empresaId, usuarioId, acao: 'auth.encerrar_sessao', entidade: 'SessaoUsuario', entidadeId: id });
  }

  /** Encerra todas as sessões, menos a informada. */
  async encerrarOutras(usuarioId: string, manter: string | undefined) {
    const { count } = await this.prisma.sessaoUsuario.updateMany({ where: { usuarioId, encerradaEm: null, id: manter ? { not: manter } : undefined }, data: { encerradaEm: new Date() } });
    return { encerradas: count };
  }

  // ---- Verificação em duas etapas ----

  async iniciarDoisFatores(usuarioId: string, senha: string): Promise<IniciarDoisFatoresResposta> {
    const usuario = await this.exigirSenha(usuarioId, senha);
    if (usuario.totpAtivoEm) throw new BadRequestException('A verificação em duas etapas já está ativa.');
    const segredo = gerarSegredoTotp();
    await this.prisma.usuario.update({ where: { id: usuarioId }, data: { totpSegredoCifrado: cifrar(segredo, config().chaveCriptografia) } });
    return { segredo, uri: uriTotp(segredo, usuario.email) };
  }

  async ativarDoisFatores(usuarioId: string, codigo: string): Promise<{ codigosRecuperacao: string[] }> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (usuario.totpAtivoEm) throw new BadRequestException('A verificação em duas etapas já está ativa.');
    if (!usuario.totpSegredoCifrado) throw new BadRequestException('Comece pela leitura do QR code.');
    const passo = conferirTotp(decifrar(usuario.totpSegredoCifrado, config().chaveCriptografia), codigo);
    if (passo === null) throw new BadRequestException('Código inválido. Confira o relógio do celular e tente de novo.');
    const codigos = gerarCodigosRecuperacao();
    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { totpAtivoEm: new Date(), totpUltimoPasso: BigInt(passo), totpFalhas: 0, totpBloqueadoAte: null, totpCodigosRecuperacao: codigos.map(hashDoCodigo) },
    });
    await this.auditoria.registrar({ empresaId: usuario.empresaId, usuarioId, acao: 'auth.2fa_ativar', entidade: 'Usuario', entidadeId: usuarioId });
    return { codigosRecuperacao: codigos };
  }

  async desativarDoisFatores(usuarioId: string, senha: string, codigo: string) {
    const usuario = await this.exigirSenha(usuarioId, senha);
    if (!usuario.totpAtivoEm || !usuario.totpSegredoCifrado) throw new BadRequestException('A verificação em duas etapas não está ativa.');
    const hash = hashDoCodigo(codigo);
    if (conferirTotp(decifrar(usuario.totpSegredoCifrado, config().chaveCriptografia), codigo.trim()) === null && !usuario.totpCodigosRecuperacao.includes(hash)) {
      throw new BadRequestException('Código inválido.');
    }
    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { totpAtivoEm: null, totpSegredoCifrado: null, totpUltimoPasso: null, totpFalhas: 0, totpBloqueadoAte: null, totpCodigosRecuperacao: [] },
    });
    await this.auditoria.registrar({ empresaId: usuario.empresaId, usuarioId, acao: 'auth.2fa_desativar', entidade: 'Usuario', entidadeId: usuarioId });
  }

  private async exigirSenha(usuarioId: string, senha: string) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (!(await conferirSenha(senha, usuario.senhaHash))) throw new BadRequestException('Senha incorreta.');
    return usuario;
  }

  // ---- Senha esquecida ----

  /** Responde igual exista ou não o e-mail; o envio não segura a resposta para o tempo não revelar. */
  async pedirRedefinicao(email: string): Promise<void> {
    const url = config().urlPublica;
    if (!this.email.disponivel || !url) {
      this.log.warn('Pedido de redefinição de senha ignorado: configure SMTP_HOST e URL_PUBLICA.');
      return;
    }
    const usuario = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, nome: true, email: true, ativo: true, empresaId: true } });
    if (!usuario?.ativo) return;
    const recentes = await this.prisma.redefinicaoSenha.count({ where: { usuarioId: usuario.id, criadoEm: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recentes >= MAXIMO_PEDIDOS_POR_HORA) return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.redefinicaoSenha.updateMany({ where: { usuarioId: usuario.id, usadoEm: null }, data: { usadoEm: new Date() } }),
      this.prisma.redefinicaoSenha.create({ data: { usuarioId: usuario.id, tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + VALIDADE_REDEFINICAO_MS) } }),
    ]);
    // O token vai depois do #: não aparece em log de servidor nem em Referer.
    const link = `${url}/redefinir-senha#token=${token}`;
    void this.email.enviar(
      usuario.email,
      'Redefinição de senha - Etiquetas',
      `Olá, ${usuario.nome}.\n\nPara criar uma nova senha, abra este link em até 1 hora:\n${link}\n\nSe não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.`,
    );
    await this.auditoria.registrar({ empresaId: usuario.empresaId, usuarioId: usuario.id, acao: 'auth.pedir_redefinicao', entidade: 'Usuario', entidadeId: usuario.id });
  }

  async redefinirSenha(token: string, novaSenha: string): Promise<void> {
    const pedido = await this.prisma.redefinicaoSenha.findUnique({ where: { tokenHash: hashDoToken(token) }, include: { usuario: { select: { id: true, empresaId: true, ativo: true } } } });
    if (!pedido || pedido.usadoEm || pedido.expiraEm < new Date() || !pedido.usuario.ativo) {
      throw new BadRequestException('Este link já foi usado ou expirou. Peça um novo.');
    }
    const agora = new Date();
    const senhaHash = await gerarHashSenha(novaSenha);
    await this.prisma.$transaction(async (tx) => {
      // updateMany no estado antigo: dois cliques simultâneos não usam o mesmo link.
      const { count } = await tx.redefinicaoSenha.updateMany({ where: { id: pedido.id, usadoEm: null }, data: { usadoEm: agora } });
      if (count === 0) throw new BadRequestException('Este link já foi usado ou expirou. Peça um novo.');
      await tx.usuario.update({ where: { id: pedido.usuarioId }, data: { senhaHash } });
      await tx.sessaoUsuario.updateMany({ where: { usuarioId: pedido.usuarioId, encerradaEm: null }, data: { encerradaEm: agora } });
      await this.auditoria.registrar({ empresaId: pedido.usuario.empresaId, usuarioId: pedido.usuarioId, acao: 'auth.redefinir_senha', entidade: 'Usuario', entidadeId: pedido.usuarioId }, tx);
    });
  }
}
