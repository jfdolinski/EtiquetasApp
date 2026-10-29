import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ehCodigoPermissao, PERMISSOES, type PerfilResumo } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarPerfilDto, CriarPerfilDto } from './dto';

const INCLUIR = {
  permissoes: { select: { permissaoCodigo: true } },
  _count: { select: { usuarios: true } },
} satisfies Prisma.PerfilInclude;

type PerfilCompleto = Prisma.PerfilGetPayload<{ include: typeof INCLUIR }>;

function paraResumo(p: PerfilCompleto): PerfilResumo {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    permissoes: p.permissoes.map((x) => x.permissaoCodigo).filter(ehCodigoPermissao),
    totalUsuarios: p._count.usuarios,
  };
}

const NOME_DUPLICADO = 'Já existe um perfil com este nome.';

/** Perfis de acesso de uma empresa. Todo método recebe `empresaId` e filtra por ele. */
@Injectable()
export class PerfisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  catalogo() {
    return PERMISSOES;
  }

  async listar(empresaId: string) {
    const perfis = await this.prisma.perfil.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, include: INCLUIR });
    return perfis.map(paraResumo);
  }

  async obter(empresaId: string, id: string) {
    const perfil = await this.prisma.perfil.findFirst({ where: { id, empresaId }, include: INCLUIR });
    if (!perfil) throw new NotFoundException('Perfil não encontrado.');
    return paraResumo(perfil);
  }

  async criar(empresaId: string, dto: CriarPerfilDto, autorId: string) {
    try {
      const perfil = await this.prisma.perfil.create({
        data: {
          empresaId,
          nome: dto.nome.trim(),
          descricao: dto.descricao?.trim() || null,
          permissoes: { create: dto.permissoes.map((permissaoCodigo) => ({ permissaoCodigo })) },
        },
        include: INCLUIR,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'perfil.criar',
        entidade: 'Perfil',
        entidadeId: perfil.id,
        detalhes: { nome: perfil.nome, permissoes: dto.permissoes },
      });
      return paraResumo(perfil);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException(NOME_DUPLICADO);
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarPerfilDto, autorId: string) {
    await this.obter(empresaId, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.perfil.update({
          where: { id },
          data: {
            nome: dto.nome?.trim(),
            descricao: dto.descricao === undefined ? undefined : dto.descricao.trim() || null,
          },
        });
        if (dto.permissoes) {
          await tx.perfilPermissao.deleteMany({ where: { perfilId: id } });
          await tx.perfilPermissao.createMany({
            data: dto.permissoes.map((permissaoCodigo) => ({ perfilId: id, permissaoCodigo })),
          });
        }
        await this.auditoria.registrar(
          { empresaId, usuarioId: autorId, acao: 'perfil.editar', entidade: 'Perfil', entidadeId: id, detalhes: { ...dto } },
          tx,
        );
      });
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException(NOME_DUPLICADO);
      throw erro;
    }
    return this.obter(empresaId, id);
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const perfil = await this.obter(empresaId, id);
    if (perfil.totalUsuarios > 0) {
      throw new ConflictException('Este perfil possui usuários. Mova-os para outro perfil antes de excluir.');
    }
    await this.prisma.perfil.delete({ where: { id } });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'perfil.excluir',
      entidade: 'Perfil',
      entidadeId: id,
      detalhes: { nome: perfil.nome },
    });
  }
}
