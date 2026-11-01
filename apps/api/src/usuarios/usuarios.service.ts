import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EmailService } from '../email/email.service';
import { gerarHashSenha } from '../auth/senha';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarUsuarioDto, CriarUsuarioDto } from './dto';

const SELECAO = {
  id: true,
  nome: true,
  email: true,
  ativo: true,
  cadastroPendente: true,
  ultimoLoginEm: true,
  criadoEm: true,
  perfil: { select: { id: true, nome: true } },
} satisfies Prisma.UsuarioSelect;

/** Usuários de uma empresa. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly email: EmailService,
  ) {}

  listar(empresaId: string) {
    return this.prisma.usuario.findMany({
      where: { empresaId, superAdmin: false },
      orderBy: { nome: 'asc' },
      select: SELECAO,
    });
  }

  async obter(empresaId: string, id: string) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, empresaId, superAdmin: false },
      select: SELECAO,
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');
    return usuario;
  }

  async criar(empresaId: string, dto: CriarUsuarioDto, autorId: string) {
    await this.exigirPerfilDaEmpresa(empresaId, dto.perfilId);
    const email = dto.email.trim().toLowerCase();
    await this.exigirEmailLivre(email);

    try {
      const usuario = await this.prisma.usuario.create({
        data: {
          empresaId,
          perfilId: dto.perfilId,
          nome: dto.nome.trim(),
          email,
          senhaHash: await gerarHashSenha(dto.senha),
        },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'usuario.criar',
        entidade: 'Usuario',
        entidadeId: usuario.id,
        detalhes: { email, perfilId: dto.perfilId },
      });
      return usuario;
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Este e-mail já está em uso.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarUsuarioDto, autorId: string) {
    const atual = await this.obter(empresaId, id);
    if (atual.cadastroPendente) throw new BadRequestException('Este cadastro aguarda aprovação: aprove ou recuse primeiro.');
    if (id === autorId && dto.ativo === false) {
      throw new BadRequestException('Você não pode desativar o próprio usuário.');
    }
    if (dto.perfilId) await this.exigirPerfilDaEmpresa(empresaId, dto.perfilId);

    const email = dto.email?.trim().toLowerCase();
    if (email && email !== atual.email) await this.exigirEmailLivre(email);

    try {
      const usuario = await this.prisma.usuario.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          email,
          perfilId: dto.perfilId,
          ativo: dto.ativo,
          senhaHash: dto.senha ? await gerarHashSenha(dto.senha) : undefined,
        },
        select: SELECAO,
      });
      const { senha, ...semSenha } = dto;
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'usuario.editar',
        entidade: 'Usuario',
        entidadeId: id,
        detalhes: { ...semSenha, senhaRedefinida: Boolean(senha) },
      });
      return usuario;
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Este e-mail já está em uso.');
      throw erro;
    }
  }

  async contarPendentes(empresaId: string) {
    return { quantidade: await this.prisma.usuario.count({ where: { empresaId, cadastroPendente: true } }) };
  }

  /** Pedido do "Cadastre-se": o aprovador escolhe o perfil, nunca quem pediu. */
  async aprovarCadastro(empresaId: string, id: string, perfilId: string, autorId: string) {
    await this.exigirPerfilDaEmpresa(empresaId, perfilId);
    const { count } = await this.prisma.usuario.updateMany({ where: { id, empresaId, cadastroPendente: true }, data: { cadastroPendente: false, ativo: true, perfilId } });
    if (count === 0) throw new NotFoundException('Pedido de cadastro não encontrado.');
    const usuario = await this.obter(empresaId, id);
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'cadastro.aprovar_usuario', entidade: 'Usuario', entidadeId: id, detalhes: { email: usuario.email, perfilId } });
    void this.email.enviar(usuario.email, 'Cadastro aprovado - Etiquetas', 'Seu cadastro foi aprovado. Você já pode entrar com o e-mail e a senha que informou.');
    return usuario;
  }

  /** Recusar apaga o pedido, e o e-mail fica livre. Só pedido pendente: nunca um usuário de verdade. */
  async recusarCadastro(empresaId: string, id: string, autorId: string) {
    const pedido = await this.prisma.usuario.findFirst({ where: { id, empresaId, cadastroPendente: true }, select: { email: true } });
    if (!pedido) throw new NotFoundException('Pedido de cadastro não encontrado.');
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.deleteMany({ where: { id, empresaId, cadastroPendente: true } });
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'cadastro.recusar_usuario', entidade: 'Usuario', entidadeId: id, detalhes: { email: pedido.email } }, tx);
    });
    void this.email.enviar(pedido.email, 'Cadastro não aprovado - Etiquetas', 'Seu pedido de cadastro não foi aprovado. Em caso de dúvida, fale com o administrador da empresa.');
  }

  private async exigirPerfilDaEmpresa(empresaId: string, perfilId: string) {
    const perfil = await this.prisma.perfil.findFirst({ where: { id: perfilId, empresaId }, select: { id: true } });
    if (!perfil) throw new BadRequestException('Perfil inválido para esta empresa.');
  }

  private async exigirEmailLivre(email: string) {
    const existe = await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (existe) throw new ConflictException('Este e-mail já está em uso.');
  }
}
