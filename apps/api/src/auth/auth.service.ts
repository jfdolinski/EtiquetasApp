import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ehCodigoPermissao, type LoginResposta, type UsuarioLogado } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { avisoEmpresa, empresaBloqueada, MENSAGEM_BLOQUEIO } from './acesso-empresa';
import type { PayloadToken } from './auth.guard';
import { compararComHashFicticio, conferirSenha, gerarHashSenha } from './senha';

const CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async login(email: string, senha: string): Promise<LoginResposta> {
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
      if (empresaBloqueada(usuario.empresa)) throw new ForbiddenException(MENSAGEM_BLOQUEIO);
      aviso = avisoEmpresa(usuario.empresa);
    }

    await this.prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });
    await this.auditoria.registrar({
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      acao: 'auth.login',
      entidade: 'Usuario',
      entidadeId: usuario.id,
    });

    const payload: PayloadToken = { sub: usuario.id };
    return {
      token: await this.jwt.signAsync(payload),
      usuario: await this.usuarioLogado(usuario.id),
      aviso,
    };
  }

  async usuarioLogado(id: string): Promise<UsuarioLogado> {
    const u = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        superAdmin: true,
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
      empresa: u.empresa,
      perfil: u.perfil ? { id: u.perfil.id, nome: u.perfil.nome } : null,
      permissoes: (u.perfil?.permissoes ?? []).map((p) => p.permissaoCodigo).filter(ehCodigoPermissao),
    };
  }

  async trocarSenha(id: string, senhaAtual: string, novaSenha: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');
    if (!(await conferirSenha(senhaAtual, usuario.senhaHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    await this.prisma.usuario.update({ where: { id }, data: { senhaHash: await gerarHashSenha(novaSenha) } });
    await this.auditoria.registrar({
      empresaId: usuario.empresaId,
      usuarioId: id,
      acao: 'auth.trocar_senha',
      entidade: 'Usuario',
      entidadeId: id,
    });
  }
}
