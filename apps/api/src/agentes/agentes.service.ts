import {
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizarCnpj, type AgenteResumo, type AtivacaoAgenteResposta, type CodigoAtivacaoResposta } from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { empresaBloqueada, MENSAGEM_BLOQUEIO } from '../auth/acesso-empresa';
import { gerarCodigoAtivacao, gerarTokenAgente, normalizarCodigoAtivacao, sha256 } from '../cripto';
import { ehViolacaoUnica } from '../prisma/erros';
import { PrismaService } from '../prisma/prisma.service';
import { AgentesGateway, FECHAMENTO } from './agentes.gateway';
import type { AtivarAgenteDto, AtualizarAgenteDto, CriarAgenteDto } from './dto';
import type { DadosRotacionarToken } from './protocolo';
import { AgenteDesconectado, TempoEsgotadoAgente } from './sessao-agente';

export const VALIDADE_CODIGO_ATIVACAO_MS = 24 * 60 * 60 * 1000;

const SELECAO = {
  id: true,
  nome: true,
  ativo: true,
  tokenHash: true,
  versao: true,
  hostname: true,
  sistemaOperacional: true,
  ultimoContatoEm: true,
  ativadoEm: true,
  codigoAtivacaoExpiraEm: true,
  criadoEm: true,
  _count: { select: { conexoes: true } },
} satisfies Prisma.AgenteSelect;

type AgenteSelecionado = Prisma.AgenteGetPayload<{ select: typeof SELECAO }>;

const MENSAGEM_ATIVACAO_INVALIDA = 'CNPJ ou código de ativação inválido, expirado ou já utilizado.';

/** Agentes locais de uma empresa. Todo método de tenant recebe `empresaId` e filtra por ele. */
@Injectable()
export class AgentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: AgentesGateway,
  ) {}

  async listar(empresaId: string): Promise<AgenteResumo[]> {
    const agentes = await this.prisma.agente.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO });
    return agentes.map((a) => this.resumo(a));
  }

  async obter(empresaId: string, id: string): Promise<AgenteResumo> {
    return this.resumo(await this.buscar(empresaId, id));
  }

  async criar(empresaId: string, dto: CriarAgenteDto, autorId: string): Promise<CodigoAtivacaoResposta> {
    const codigo = gerarCodigoAtivacao();
    const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_ATIVACAO_MS);
    try {
      const agente = await this.prisma.agente.create({
        data: { empresaId, nome: dto.nome.trim(), codigoAtivacaoHash: sha256(codigo), codigoAtivacaoExpiraEm: expiraEm },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'agente.criar',
        entidade: 'Agente',
        entidadeId: agente.id,
        detalhes: { nome: agente.nome },
      });
      return { agente: this.resumo(agente), codigo, expiraEm: expiraEm.toISOString(), cnpj: await this.cnpj(empresaId) };
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe um agente com este nome.');
      throw erro;
    }
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarAgenteDto, autorId: string): Promise<AgenteResumo> {
    await this.buscar(empresaId, id);
    try {
      const agente = await this.prisma.agente.update({
        where: { id },
        data: { nome: dto.nome?.trim(), ativo: dto.ativo },
        select: SELECAO,
      });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: autorId,
        acao: 'agente.editar',
        entidade: 'Agente',
        entidadeId: id,
        detalhes: { ...dto },
      });
      if (dto.ativo === false) this.gateway.desconectar(id, FECHAMENTO.REVOGADO, 'Agente desativado.');
      return this.resumo(agente);
    } catch (erro) {
      if (ehViolacaoUnica(erro)) throw new ConflictException('Já existe um agente com este nome.');
      throw erro;
    }
  }

  /**
   * Gera um novo código de ativação e revoga o token atual: usado para reinstalar o
   * agente ou quando o token vazou. O agente conectado cai na hora.
   */
  async novoCodigoAtivacao(empresaId: string, id: string, autorId: string): Promise<CodigoAtivacaoResposta> {
    await this.buscar(empresaId, id);
    const codigo = gerarCodigoAtivacao();
    const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_ATIVACAO_MS);
    const agente = await this.prisma.agente.update({
      where: { id },
      data: { codigoAtivacaoHash: sha256(codigo), codigoAtivacaoExpiraEm: expiraEm, tokenHash: null },
      select: SELECAO,
    });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'agente.novo_codigo',
      entidade: 'Agente',
      entidadeId: id,
    });
    this.gateway.desconectar(id, FECHAMENTO.REVOGADO, 'Token revogado.');
    return { agente: this.resumo(agente), codigo, expiraEm: expiraEm.toISOString(), cnpj: await this.cnpj(empresaId) };
  }

  /**
   * Troca o token sem tocar na máquina: o agente online recebe o novo token, grava em
   * disco e confirma; só então o hash novo substitui o antigo no banco.
   */
  async rotacionarToken(empresaId: string, id: string, autorId: string): Promise<AgenteResumo> {
    const atual = await this.buscar(empresaId, id);
    if (!atual.tokenHash) throw new ConflictException('O agente ainda não foi ativado.');

    const token = gerarTokenAgente();
    try {
      const sessao = this.gateway.sessao(id);
      await sessao.requisitar<unknown>('rotacionar_token', { token } satisfies DadosRotacionarToken, 15_000);
    } catch (erro) {
      if (erro instanceof AgenteDesconectado) {
        throw new ConflictException(
          'O agente precisa estar online para rotacionar o token. Se ele não conecta mais, gere um novo código de ativação.',
        );
      }
      if (erro instanceof TempoEsgotadoAgente) throw new GatewayTimeoutException(erro.message);
      throw new ConflictException(`O agente recusou o novo token: ${(erro as Error).message}`);
    }

    const agente = await this.prisma.agente.update({ where: { id }, data: { tokenHash: sha256(token) }, select: SELECAO });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'agente.rotacionar_token',
      entidade: 'Agente',
      entidadeId: id,
    });
    return this.resumo(agente);
  }

  /**
   * Primeira execução do agente: troca CNPJ + código de ativação por um token.
   * O CNPJ sozinho não autentica (é público); o código é de uso único e expira.
   */
  async ativar(dto: AtivarAgenteDto): Promise<AtivacaoAgenteResposta> {
    const cnpj = normalizarCnpj(dto.cnpj);
    const codigoHash = sha256(normalizarCodigoAtivacao(dto.codigo));

    const agente = await this.prisma.agente.findFirst({
      where: {
        empresa: { cnpj },
        codigoAtivacaoHash: codigoHash,
        codigoAtivacaoExpiraEm: { gt: new Date() },
        ativo: true,
      },
      select: {
        id: true,
        nome: true,
        empresaId: true,
        empresa: { select: { razaoSocial: true, nomeFantasia: true, ativa: true, statusAssinatura: true } },
      },
    });
    if (!agente) throw new UnauthorizedException(MENSAGEM_ATIVACAO_INVALIDA);
    if (empresaBloqueada(agente.empresa)) throw new ForbiddenException(MENSAGEM_BLOQUEIO);

    const token = gerarTokenAgente();
    // updateMany com o hash na condição: dois pedidos simultâneos com o mesmo código não geram dois tokens.
    const { count } = await this.prisma.agente.updateMany({
      where: { id: agente.id, codigoAtivacaoHash: codigoHash },
      data: {
        tokenHash: sha256(token),
        codigoAtivacaoHash: null,
        codigoAtivacaoExpiraEm: null,
        ativadoEm: new Date(),
        hostname: dto.hostname?.slice(0, 255),
      },
    });
    if (count === 0) throw new UnauthorizedException(MENSAGEM_ATIVACAO_INVALIDA);

    await this.auditoria.registrar({
      empresaId: agente.empresaId,
      usuarioId: null,
      acao: 'agente.ativar',
      entidade: 'Agente',
      entidadeId: agente.id,
      detalhes: { hostname: dto.hostname ?? null },
    });
    return {
      token,
      agenteId: agente.id,
      agenteNome: agente.nome,
      empresaNome: agente.empresa.nomeFantasia || agente.empresa.razaoSocial,
    };
  }

  private async cnpj(empresaId: string) {
    const empresa = await this.prisma.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { cnpj: true } });
    return empresa.cnpj;
  }

  private async buscar(empresaId: string, id: string) {
    const agente = await this.prisma.agente.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!agente) throw new NotFoundException('Agente não encontrado.');
    return agente;
  }

  private resumo(a: AgenteSelecionado): AgenteResumo {
    const codigoValido = a.codigoAtivacaoExpiraEm && a.codigoAtivacaoExpiraEm > new Date();
    return {
      id: a.id,
      nome: a.nome,
      ativo: a.ativo,
      online: this.gateway.estaOnline(a.id),
      ativado: Boolean(a.tokenHash),
      versao: a.versao,
      hostname: a.hostname,
      sistemaOperacional: a.sistemaOperacional,
      ultimoContatoEm: a.ultimoContatoEm?.toISOString() ?? null,
      ativadoEm: a.ativadoEm?.toISOString() ?? null,
      codigoAtivacaoExpiraEm: codigoValido ? a.codigoAtivacaoExpiraEm!.toISOString() : null,
      totalConexoes: a._count.conexoes,
      criadoEm: a.criadoEm.toISOString(),
    };
  }
}
