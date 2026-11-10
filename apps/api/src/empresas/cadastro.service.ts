import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CODIGOS_PERMISSAO, formatarCnpj, normalizarCnpj, validarCnpj, type CadastrosPendentes, type DadosCnpj } from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { gerarHashSenha } from '../auth/senha';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EmailService } from '../email/email.service';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultaCnpjService } from './consulta-cnpj';
import type { CadastroDto } from './dto';
import { NOME_PERFIL_ADMIN } from './empresas.service';

/** A resposta é a mesma em todos os casos: quem está de fora não descobre quem é cliente. */
export const MENSAGEM_CADASTRO = 'Cadastro recebido. Você poderá entrar assim que um administrador aprovar.';
export const SITUACAO_NAO_ENCONTRADA = 'NÃO ENCONTRADA';

// Rota pública: limites para ninguém encher o banco de pedidos falsos.
const MAXIMO_EMPRESAS_PENDENTES = 200;
const MAXIMO_USUARIOS_PENDENTES_POR_EMPRESA = 20;

type DadosDaBusca = Pick<DadosCnpj, 'razaoSocial' | 'nomeFantasia' | 'situacao'>;

/**
 * "Cadastre-se" da tela de login. O pedido sempre fica pendente:
 * - empresa ativa: o usuário aguarda quem tem `usuario.editar` nela;
 * - CNPJ novo: a empresa nasce pendente, com os dados da busca de CNPJ, e aguarda o super-admin;
 * - empresa existente fora do ar: ela fica como está (um anônimo não muda a situação de um cliente)
 *   e o usuário aguarda. O super-admin vê o pedido e decide.
 * Pendente = `ativo: false`, então login, guard e envio de avisos já o deixam de fora.
 */
@Injectable()
export class CadastroService {
  private readonly log = new Logger('Cadastro');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly email: EmailService,
    private readonly consultaCnpj: ConsultaCnpjService,
  ) {}

  async solicitar(dto: CadastroDto): Promise<{ mensagem: string }> {
    if (!validarCnpj(dto.cnpj)) throw new BadRequestException('CNPJ inválido.');
    const cnpj = normalizarCnpj(dto.cnpj);
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException('Este e-mail já está em uso.');
    const senhaHash = await gerarHashSenha(dto.senha);
    const nome = email.split('@')[0].slice(0, 120);

    try {
      const existente = await this.prisma.empresa.findUnique({ where: { cnpj }, select: { id: true, ativa: true, statusAssinatura: true, aprovacaoPendente: true } });
      if (existente) await this.pedirEntrada(existente, { email, nome, senhaHash });
      else await this.criarEmpresaPendente(cnpj, { email, nome, senhaHash });
    } catch (erro) {
      if (!ehViolacaoUnica(erro)) throw erro;
      // Dois pedidos ao mesmo tempo: o e-mail foi usado, ou o outro acabou de criar a empresa.
      if (await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException('Este e-mail já está em uso.');
      const criada = await this.prisma.empresa.findUniqueOrThrow({ where: { cnpj }, select: { id: true, ativa: true, statusAssinatura: true, aprovacaoPendente: true } });
      await this.pedirEntrada(criada, { email, nome, senhaHash });
    }
    return { mensagem: MENSAGEM_CADASTRO };
  }

  private async pedirEntrada(empresa: { id: string; ativa: boolean; statusAssinatura: Parameters<typeof empresaBloqueada>[0]['statusAssinatura']; aprovacaoPendente: boolean }, u: { email: string; nome: string; senhaHash: string }) {
    const pendentes = await this.prisma.usuario.count({ where: { empresaId: empresa.id, cadastroPendente: true } });
    if (pendentes >= MAXIMO_USUARIOS_PENDENTES_POR_EMPRESA) throw this.limite();
    const criado = await this.prisma.usuario.create({ data: { empresaId: empresa.id, ...u, ativo: false, cadastroPendente: true }, select: { id: true } });
    await this.auditoria.registrar({ empresaId: empresa.id, usuarioId: criado.id, acao: 'cadastro.solicitar', entidade: 'Usuario', entidadeId: criado.id, detalhes: { email: u.email } });
    const aberta = !empresa.aprovacaoPendente && !empresaBloqueada(empresa);
    const destinos = aberta ? await this.email.enderecosComPermissao(empresa.id, 'usuario.editar') : await this.enderecosSuperAdmin();
    void this.email.enviar(destinos, 'Novo cadastro aguardando aprovação - Flow', `${u.email} pediu acesso ao Flow. Aprove ou recuse em Usuários.`);
  }

  private async criarEmpresaPendente(cnpj: string, u: { email: string; nome: string; senhaHash: string }) {
    if ((await this.prisma.empresa.count({ where: { aprovacaoPendente: true } })) >= MAXIMO_EMPRESAS_PENDENTES) throw this.limite();
    const dados = await this.buscarDados(cnpj);
    const criado = await this.prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({
        data: { razaoSocial: dados.razaoSocial, nomeFantasia: dados.nomeFantasia, situacaoReceita: dados.situacao, cnpj, ativa: false, aprovacaoPendente: true },
      });
      await tx.perfil.create({
        data: { empresaId: empresa.id, nome: NOME_PERFIL_ADMIN, descricao: 'Acesso total à empresa', permissoes: { create: CODIGOS_PERMISSAO.map((permissaoCodigo) => ({ permissaoCodigo })) } },
      });
      const usuario = await tx.usuario.create({ data: { empresaId: empresa.id, ...u, ativo: false, cadastroPendente: true }, select: { id: true } });
      await this.auditoria.registrar({ empresaId: empresa.id, usuarioId: usuario.id, acao: 'cadastro.solicitar', entidade: 'Empresa', entidadeId: empresa.id, detalhes: { cnpj, email: u.email, situacaoReceita: dados.situacao } }, tx);
      return empresa;
    });
    void this.email.enviar(await this.enderecosSuperAdmin(), 'Nova empresa aguardando aprovação - Flow', `${criado.razaoSocial} (${formatarCnpj(cnpj)}) se cadastrou. Aprove ou recuse em Empresas.`);
  }

  /** A busca de CNPJ fora do ar não impede o pedido: o super-admin completa os dados ao aprovar. */
  private async buscarDados(cnpj: string): Promise<DadosDaBusca> {
    try {
      const d = await this.consultaCnpj.consultar(cnpj);
      return { razaoSocial: d.razaoSocial, nomeFantasia: d.nomeFantasia, situacao: d.situacao };
    } catch (erro) {
      const naoExiste = erro instanceof NotFoundException;
      if (!naoExiste) this.log.warn(`Busca de CNPJ no cadastro: ${(erro as Error).message}`);
      return { razaoSocial: `CNPJ ${formatarCnpj(cnpj)}`, nomeFantasia: null, situacao: naoExiste ? SITUACAO_NAO_ENCONTRADA : null };
    }
  }

  private limite() {
    return new HttpException('Muitos cadastros aguardando aprovação. Tente de novo mais tarde.', HttpStatus.TOO_MANY_REQUESTS);
  }

  private async enderecosSuperAdmin(): Promise<string[]> {
    return (await this.prisma.usuario.findMany({ where: { superAdmin: true, ativo: true }, select: { email: true } })).map((u) => u.email);
  }

  // ---- Super-admin ----

  async pendentes(): Promise<CadastrosPendentes> {
    const [empresas, usuarios] = await Promise.all([
      this.prisma.empresa.findMany({
        where: { aprovacaoPendente: true },
        orderBy: { criadoEm: 'asc' },
        select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true, situacaoReceita: true, criadoEm: true, usuarios: { where: { cadastroPendente: true }, orderBy: { criadoEm: 'asc' }, select: { email: true } } },
      }),
      // Empresa ativa resolve sozinha, em Usuários; aqui fica quem pediu entrada em empresa fora do ar.
      this.prisma.usuario.findMany({
        where: { cadastroPendente: true, empresa: { aprovacaoPendente: false, OR: [{ ativa: false }, { statusAssinatura: { in: ['BLOQUEADA', 'CANCELADA'] } }] } },
        orderBy: { criadoEm: 'asc' },
        select: { id: true, email: true, criadoEm: true, empresa: { select: { id: true, razaoSocial: true, cnpj: true } } },
      }),
    ]);
    return {
      empresas: empresas.map(({ usuarios: us, criadoEm, ...e }) => ({ ...e, emails: us.map((u) => u.email), criadoEm: criadoEm.toISOString() })),
      usuarios: usuarios.map((u) => ({ id: u.id, email: u.email, criadoEm: u.criadoEm.toISOString(), empresa: u.empresa! })),
    };
  }

  /** Libera a empresa, e quem pediu primeiro vira o administrador dela. Os demais pedidos ficam com esse administrador. */
  async aprovarEmpresa(id: string, autorId: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.empresa.updateMany({ where: { id, aprovacaoPendente: true }, data: { aprovacaoPendente: false, ativa: true } });
      if (count === 0) throw new NotFoundException('Esta empresa não está aguardando aprovação.');
      const perfil = await tx.perfil.findFirst({ where: { empresaId: id, nome: NOME_PERFIL_ADMIN }, select: { id: true } });
      const primeiro = await tx.usuario.findFirst({ where: { empresaId: id, cadastroPendente: true }, orderBy: { criadoEm: 'asc' }, select: { id: true, email: true } });
      if (primeiro) await tx.usuario.update({ where: { id: primeiro.id }, data: { ativo: true, cadastroPendente: false, perfilId: perfil?.id } });
      await this.auditoria.registrar({ empresaId: id, usuarioId: autorId, acao: 'cadastro.aprovar_empresa', entidade: 'Empresa', entidadeId: id, detalhes: { administrador: primeiro?.email ?? null } }, tx);
      return primeiro;
    });
    if (r) void this.email.enviar(r.email, 'Cadastro aprovado - Flow', 'Seu cadastro foi aprovado. Você já pode entrar com o e-mail e a senha que informou.');
  }

  /** Recusar apaga o pedido: a empresa nunca chegou a funcionar. */
  async recusarEmpresa(id: string, autorId: string) {
    const empresa = await this.prisma.empresa.findFirst({ where: { id, aprovacaoPendente: true }, select: { cnpj: true, razaoSocial: true, usuarios: { select: { email: true } } } });
    if (!empresa) throw new NotFoundException('Esta empresa não está aguardando aprovação.');
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.deleteMany({ where: { empresaId: id } });
      await tx.empresa.delete({ where: { id } });
      // Sem empresaId: o registro precisa sobreviver à empresa apagada.
      await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'cadastro.recusar_empresa', entidade: 'Empresa', entidadeId: id, detalhes: { cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial } }, tx);
    });
    void this.email.enviar(empresa.usuarios.map((u) => u.email), 'Cadastro não aprovado - Flow', 'Seu pedido de cadastro não foi aprovado. Em caso de dúvida, fale com o suporte.');
  }
}
