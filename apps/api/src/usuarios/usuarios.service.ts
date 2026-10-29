import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { gerarHashSenha } from '../auth/senha';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarUsuarioDto, CriarUsuarioDto } from './dto';

const SELECAO = {
  id: true,
  nome: true,
  email: true,
  ativo: true,
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

  private async exigirPerfilDaEmpresa(empresaId: string, perfilId: string) {
    const perfil = await this.prisma.perfil.findFirst({ where: { id: perfilId, empresaId }, select: { id: true } });
    if (!perfil) throw new BadRequestException('Perfil inválido para esta empresa.');
  }

  private async exigirEmailLivre(email: string) {
    const existe = await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (existe) throw new ConflictException('Este e-mail já está em uso.');
  }
}
