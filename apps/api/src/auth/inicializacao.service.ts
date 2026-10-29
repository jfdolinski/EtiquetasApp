import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CODIGOS_PERMISSAO, PERMISSOES } from '@etiquetas/shared';
import { config } from '../config';
import { NOME_PERFIL_ADMIN } from '../empresas/empresas.service';
import { PrismaService } from '../prisma/prisma.service';
import { gerarHashSenha } from './senha';

/** Sincroniza o catálogo de permissões e garante o super-admin inicial. Idempotente. */
@Injectable()
export class InicializacaoService implements OnApplicationBootstrap {
  private readonly log = new Logger(InicializacaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.sincronizarPermissoes();
    await this.garantirSuperAdmin();
  }

  /**
   * Sincroniza o catálogo. Códigos que acabaram de surgir (nova versão do sistema) são
   * concedidos aos perfis "Administrador" já existentes: sem isso, empresas antigas nunca
   * teriam acesso às funções novas. Códigos que já existiam não são reconcedidos (o
   * administrador pode tê-los removido de propósito).
   */
  private async sincronizarPermissoes() {
    const conhecidos = new Set((await this.prisma.permissao.findMany({ select: { codigo: true } })).map((p) => p.codigo));
    // Banco vazio (primeira subida): não há perfis antigos para atualizar.
    const novos = conhecidos.size ? CODIGOS_PERMISSAO.filter((c) => !conhecidos.has(c)) : [];
    await this.prisma.$transaction([
      ...PERMISSOES.map((p) =>
        this.prisma.permissao.upsert({
          where: { codigo: p.codigo },
          create: { codigo: p.codigo, grupo: p.grupo, descricao: p.descricao },
          update: { grupo: p.grupo, descricao: p.descricao },
        }),
      ),
      this.prisma.permissao.deleteMany({ where: { codigo: { notIn: [...CODIGOS_PERMISSAO] } } }),
    ]);
    if (novos.length) {
      const admins = await this.prisma.perfil.findMany({ where: { nome: NOME_PERFIL_ADMIN }, select: { id: true } });
      await this.prisma.perfilPermissao.createMany({
        data: admins.flatMap((p) => novos.map((permissaoCodigo) => ({ perfilId: p.id, permissaoCodigo }))),
        skipDuplicates: true,
      });
      this.log.log(`Permissões novas (${novos.join(', ')}) concedidas a ${admins.length} perfil(is) Administrador.`);
    }
  }

  private async garantirSuperAdmin() {
    const dados = config().superAdmin;
    if (!dados) {
      const existe = await this.prisma.usuario.count({ where: { superAdmin: true } });
      if (existe === 0) this.log.warn('Nenhum super-admin cadastrado. Defina SUPERADMIN_EMAIL e SUPERADMIN_SENHA.');
      return;
    }

    const existente = await this.prisma.usuario.findUnique({ where: { email: dados.email } });
    if (existente) return;

    await this.prisma.usuario.create({
      data: { nome: dados.nome, email: dados.email, senhaHash: await gerarHashSenha(dados.senha), superAdmin: true },
    });
    this.log.log(`Super-admin criado: ${dados.email}`);
  }
}
