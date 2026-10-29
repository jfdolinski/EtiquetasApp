import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CODIGOS_PERMISSAO, normalizarCnpj, validarCnpj } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { gerarHashSenha } from '../auth/senha';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarEmpresaDto, CriarEmpresaDto } from './dto';

export const NOME_PERFIL_ADMIN = 'Administrador';

type EmpresaComContagem = Prisma.EmpresaGetPayload<{ include: { _count: { select: { usuarios: true } } } }>;

function paraResumo({ _count, atualizadoEm: _, ...empresa }: EmpresaComContagem) {
  return { ...empresa, totalUsuarios: _count.usuarios };
}

function cnpjValido(valor: string): string {
  if (!validarCnpj(valor)) throw new BadRequestException('CNPJ inválido.');
  return normalizarCnpj(valor);
}

/** Gestão de empresas (tenants). Acessível apenas ao super-admin. */
@Injectable()
export class EmpresasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar() {
    const empresas = await this.prisma.empresa.findMany({
      orderBy: { razaoSocial: 'asc' },
      include: { _count: { select: { usuarios: true } } },
    });
    return empresas.map(paraResumo);
  }

  async obter(id: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    return paraResumo(empresa);
  }

  /** Cria a empresa com o perfil "Administrador" (todas as permissões) e o primeiro usuário. */
  async criar(dto: CriarEmpresaDto, autorId: string) {
    const cnpj = cnpjValido(dto.cnpj);
    const emailAdmin = dto.admin.email.trim().toLowerCase();

    if (await this.prisma.empresa.findUnique({ where: { cnpj } })) {
      throw new ConflictException('Já existe uma empresa com este CNPJ.');
    }
    if (await this.prisma.usuario.findUnique({ where: { email: emailAdmin } })) {
      throw new ConflictException('O e-mail do administrador já está em uso.');
    }
    const senhaHash = await gerarHashSenha(dto.admin.senha);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const empresa = await tx.empresa.create({
          data: {
            razaoSocial: dto.razaoSocial.trim(),
            nomeFantasia: dto.nomeFantasia?.trim() || null,
            cnpj,
            codigoErp: dto.codigoErp?.trim() || null,
            plano: dto.plano?.trim() || undefined,
          },
        });
        const perfil = await tx.perfil.create({
          data: {
            empresaId: empresa.id,
            nome: NOME_PERFIL_ADMIN,
            descricao: 'Acesso total à empresa',
            permissoes: { create: CODIGOS_PERMISSAO.map((permissaoCodigo) => ({ permissaoCodigo })) },
          },
        });
        await tx.usuario.create({
          data: { empresaId: empresa.id, perfilId: perfil.id, nome: dto.admin.nome.trim(), email: emailAdmin, senhaHash },
        });
        await this.auditoria.registrar(
          {
            empresaId: empresa.id,
            usuarioId: autorId,
            acao: 'empresa.criar',
            entidade: 'Empresa',
            entidadeId: empresa.id,
            detalhes: { cnpj, admin: emailAdmin },
          },
          tx,
        );
        return empresa.id;
      });
      return this.obter(id);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('CNPJ ou e-mail já cadastrado.');
      throw erro;
    }
  }

  async atualizar(id: string, dto: AtualizarEmpresaDto, autorId: string) {
    await this.obter(id);
    const data: Prisma.EmpresaUpdateInput = {
      razaoSocial: dto.razaoSocial?.trim(),
      nomeFantasia: dto.nomeFantasia === undefined ? undefined : dto.nomeFantasia.trim() || null,
      cnpj: dto.cnpj === undefined ? undefined : cnpjValido(dto.cnpj),
      codigoErp: dto.codigoErp === undefined ? undefined : dto.codigoErp.trim() || null,
      plano: dto.plano?.trim() || undefined,
      statusAssinatura: dto.statusAssinatura,
      ativa: dto.ativa,
    };

    try {
      await this.prisma.empresa.update({ where: { id }, data });
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe uma empresa com este CNPJ.');
      throw erro;
    }
    await this.auditoria.registrar({
      empresaId: id,
      usuarioId: autorId,
      acao: 'empresa.editar',
      entidade: 'Empresa',
      entidadeId: id,
      detalhes: { ...dto },
    });
    return this.obter(id);
  }
}
