import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Res, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import {
  aplicarParametros,
  codigoDoVinculoDaTela,
  dentroDoHorarioDaTela,
  horarioValido,
  NIVEIS_ANIMACAO,
  PARAMETROS_DA_EMPRESA,
  parametrosVigentes,
  problemaNosParametros,
  problemaNosPrazos,
  RESOLUCAO_MAXIMA,
  RESOLUCAO_MINIMA,
  resolucaoConfere,
  resolucaoValida,
  situacaoDaTela,
  TIPOS_EQUIPAMENTO,
  type ChaveParametroTela,
  type ComandoTela,
  type NivelAnimacao,
  type ParametrosTelas,
  type ParametrosTelasResposta,
  type PedidoTelaCriado,
  type PedidoTelaLido,
  type PerfilTelaResumo,
  type QuedaTelaResumo,
  type RespostaAvisoTela,
  type SituacaoPedidoTela,
  type TelaResumo,
  type TipoEquipamento,
} from '@etiquetas/shared';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { hashDoToken } from '../auth/conta.service';
import { EmpresaAtual, PermitidoNoApp, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MensagensCobrancaService } from '../cobranca/mensagens-cobranca.service';
import { config } from '../config';
import { BanidosModule } from '../banidos/banidos.module';
import { ConsultasModule } from '../consultas/consultas.module';
import { PrismaService } from '../prisma/prisma.service';
import { ConteudosTelaController, ConteudosTelaService } from './conteudos';
import { horaLocal } from './hora';

const VALIDADE_PEDIDO_MS = 10 * 60_000;
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 8;
const DIA_MS = 24 * 3_600_000;
const COMANDOS: readonly ComandoTela[] = ['IDENTIFICAR', 'RECARREGAR'];
const MENSAGEM_HORA = 'Use o formato HH:MM.';
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function gerarCodigoTela(): string {
  return [...randomBytes(TAMANHO_CODIGO)].map((b) => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]).join('');
}

export { horaLocal };

class ResolucaoDto {
  @IsInt()
  @Min(1)
  @Max(RESOLUCAO_MAXIMA)
  largura: number;

  @IsInt()
  @Min(1)
  @Max(RESOLUCAO_MAXIMA)
  altura: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(16)
  escala?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  navegador?: string;
}

class SituacaoPedidoDto {
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  segredo: string;
}

class AvisoTelaDto extends ResolucaoDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  versao?: string;

  @IsOptional()
  @IsBoolean()
  segundoPlano?: boolean;
}

class PerfilTelaDto {
  @IsString()
  @MinLength(2, { message: 'Informe o nome do perfil.' })
  @MaxLength(80)
  nome: string;

  @IsIn(TIPOS_EQUIPAMENTO, { message: 'Equipamento desconhecido.' })
  tipo: TipoEquipamento;

  @IsInt({ message: 'Informe a largura em pixels.' })
  @Min(RESOLUCAO_MINIMA, { message: `A largura precisa ter ao menos ${RESOLUCAO_MINIMA} pixels.` })
  @Max(RESOLUCAO_MAXIMA, { message: `A largura pode ter até ${RESOLUCAO_MAXIMA} pixels.` })
  largura: number;

  @IsInt({ message: 'Informe a altura em pixels.' })
  @Min(RESOLUCAO_MINIMA, { message: `A altura precisa ter ao menos ${RESOLUCAO_MINIMA} pixels.` })
  @Max(RESOLUCAO_MAXIMA, { message: `A altura pode ter até ${RESOLUCAO_MAXIMA} pixels.` })
  altura: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(25, { message: 'A margem de segurança pode ser de até 25%.' })
  margemPct?: number;

  @IsOptional()
  @IsIn(NIVEIS_ANIMACAO, { message: 'Nível de animação desconhecido.' })
  nivelAnimacao?: NivelAnimacao;
}

class VincularTelaDto {
  @IsString()
  @MaxLength(20)
  codigo: string;

  /** Substitui o equipamento desta tela, mantendo a configuração. */
  @IsOptional()
  @IsUUID('all', { message: 'Tela inválida.' })
  telaId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Informe o nome da tela.' })
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  local?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Perfil inválido.' })
  perfilId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilTelaDto)
  novoPerfil?: PerfilTelaDto;
}

class AtualizarTelaDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Informe o nome da tela.' })
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  local?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Perfil inválido.' })
  perfilId?: string;

  @IsOptional()
  @Matches(HORA, { message: MENSAGEM_HORA })
  horarioInicio?: string | null;

  @IsOptional()
  @Matches(HORA, { message: MENSAGEM_HORA })
  horarioFim?: string | null;

  /** Sem horário: a tela conta o dia inteiro. */
  @IsOptional()
  @IsBoolean()
  semHorario?: boolean;
}

class ComandoTelaDto {
  @IsIn(COMANDOS, { message: 'Comando desconhecido.' })
  comando: ComandoTela;
}

class ParametrosDto {
  @IsObject()
  valores: Record<string, unknown>;
}

const SELECAO_TELA = {
  id: true,
  nome: true,
  local: true,
  tokenHash: true,
  ultimoContatoEm: true,
  larguraDetectada: true,
  alturaDetectada: true,
  escalaDetectada: true,
  navegador: true,
  versaoPlayer: true,
  emSegundoPlano: true,
  horarioInicio: true,
  horarioFim: true,
  perfil: { select: { id: true, nome: true, tipo: true, largura: true, altura: true } },
} satisfies Prisma.TelaSelect;

type TelaSelecionada = Prisma.TelaGetPayload<{ select: typeof SELECAO_TELA }>;

function resumir(t: TelaSelecionada, quedas: number, agora: Date, hora: string, p: ParametrosTelas): TelaResumo {
  return {
    id: t.id,
    nome: t.nome,
    local: t.local,
    perfil: { ...t.perfil, tipo: t.perfil.tipo as TipoEquipamento },
    situacao: situacaoDaTela({ vinculada: t.tokenHash !== null, ultimoContatoEm: t.ultimoContatoEm, horarioInicio: t.horarioInicio, horarioFim: t.horarioFim }, agora, hora, p),
    ultimoContatoEm: t.ultimoContatoEm?.toISOString() ?? null,
    larguraDetectada: t.larguraDetectada,
    alturaDetectada: t.alturaDetectada,
    escalaDetectada: t.escalaDetectada,
    navegador: t.navegador,
    versaoPlayer: t.versaoPlayer,
    emSegundoPlano: t.emSegundoPlano,
    horarioInicio: t.horarioInicio,
    horarioFim: t.horarioFim,
    resolucaoConfere: resolucaoConfere(t.perfil, { largura: t.larguraDetectada, altura: t.alturaDetectada }),
    quedas30Dias: quedas,
  };
}

@Injectable()
export class ParametrosTelasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private guardados(empresaId: string | null) {
    return this.prisma.parametroTelas.findFirst({ where: { empresaId }, select: { id: true, valores: true } });
  }

  async vigentes(empresaId: string): Promise<ParametrosTelas> {
    const [global, daEmpresa] = await Promise.all([this.guardados(null), this.guardados(empresaId)]);
    return parametrosVigentes(global?.valores, daEmpresa?.valores);
  }

  /** Só o que a própria empresa pode mudar, e publicidade só quando o administrador geral deixa. */
  private editaveis(vigentes: ParametrosTelas, u: UsuarioRequisicao): ChaveParametroTela[] {
    if (u.superAdmin) return Object.keys(vigentes) as ChaveParametroTela[];
    const podeEditar = u.permissoes.includes('tela.editar');
    if (!podeEditar) return [];
    return vigentes.empresaPodeRecusarAnuncios ? [...PARAMETROS_DA_EMPRESA, 'anunciosLigados'] : [...PARAMETROS_DA_EMPRESA];
  }

  async ler(empresaId: string, u: UsuarioRequisicao): Promise<ParametrosTelasResposta> {
    const [global, daEmpresa] = await Promise.all([this.guardados(null), this.guardados(empresaId)]);
    const vigentes = parametrosVigentes(global?.valores, daEmpresa?.valores);
    return {
      vigentes,
      global: u.superAdmin ? ((global?.valores ?? {}) as Partial<ParametrosTelas>) : null,
      daEmpresa: (daEmpresa?.valores ?? {}) as Partial<ParametrosTelas>,
      editaveis: this.editaveis(vigentes, u),
    };
  }

  private async gravar(empresaId: string | null, atual: { id: string; valores: unknown } | null, valores: Partial<ParametrosTelas>, autorId: string) {
    const json = valores as Prisma.InputJsonValue;
    if (atual) await this.prisma.parametroTelas.update({ where: { id: atual.id }, data: { valores: json } });
    else await this.prisma.parametroTelas.create({ data: { empresaId, valores: json } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: empresaId ? 'tela.parametros_empresa' : 'tela.parametros_globais', entidade: 'ParametroTelas', detalhes: { valores } });
  }

  async salvarDaEmpresa(empresaId: string, alteracao: Record<string, unknown>, u: UsuarioRequisicao) {
    const problema = problemaNosParametros(alteracao);
    if (problema) throw new BadRequestException(problema);
    const [global, atual] = await Promise.all([this.guardados(null), this.guardados(empresaId)]);
    const permitidos = this.editaveis(parametrosVigentes(global?.valores, atual?.valores), u);
    const barrado = Object.keys(alteracao).find((k) => !permitidos.includes(k as ChaveParametroTela));
    if (barrado) throw new ForbiddenException('Este parâmetro é definido pelo administrador geral.');
    const novos = aplicarParametros(atual?.valores, alteracao);
    const prazos = problemaNosPrazos(parametrosVigentes(global?.valores, novos));
    if (prazos) throw new BadRequestException(prazos);
    await this.gravar(empresaId, atual, novos, u.id);
    return this.ler(empresaId, u);
  }

  async salvarGlobais(empresaId: string, alteracao: Record<string, unknown>, u: UsuarioRequisicao) {
    if (!u.superAdmin) throw new ForbiddenException('Só o administrador geral altera o padrão da plataforma.');
    const problema = problemaNosParametros(alteracao);
    if (problema) throw new BadRequestException(problema);
    const atual = await this.guardados(null);
    const novos = aplicarParametros(atual?.valores, alteracao);
    const prazos = problemaNosPrazos(parametrosVigentes(novos, null));
    if (prazos) throw new BadRequestException(prazos);
    await this.gravar(null, atual, novos, u.id);
    return this.ler(empresaId, u);
  }
}

@Injectable()
export class TelasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly parametros: ParametrosTelasService,
    private readonly cobranca: MensagensCobrancaService,
    private readonly conteudos: ConteudosTelaService,
  ) {}

  // Perfis ---------------------------------------------------------------------------------

  async listarPerfis(empresaId: string): Promise<PerfilTelaResumo[]> {
    const perfis = await this.prisma.perfilTela.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, include: { _count: { select: { telas: true } } } });
    return perfis.map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo as TipoEquipamento, largura: p.largura, altura: p.altura, margemPct: p.margemPct, nivelAnimacao: p.nivelAnimacao as NivelAnimacao, telas: p._count.telas }));
  }

  private conflitoDeNome(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Já existe um perfil com este nome.');
    throw e;
  }

  async criarPerfil(empresaId: string, dto: PerfilTelaDto, autorId: string, tx: Prisma.TransactionClient = this.prisma) {
    if (!resolucaoValida(dto.largura, dto.altura)) throw new BadRequestException('Resolução inválida.');
    const perfil = await tx.perfilTela
      .create({ data: { empresaId, nome: dto.nome.trim(), tipo: dto.tipo, largura: dto.largura, altura: dto.altura, margemPct: dto.margemPct ?? 0, nivelAnimacao: dto.nivelAnimacao ?? 'AUTOMATICO' } })
      .catch((e) => this.conflitoDeNome(e));
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.perfil_criar', entidade: 'PerfilTela', entidadeId: perfil.id, detalhes: { nome: perfil.nome, largura: perfil.largura, altura: perfil.altura } }, tx);
    return perfil;
  }

  async atualizarPerfil(empresaId: string, id: string, dto: PerfilTelaDto, autorId: string) {
    const { count } = await this.prisma.perfilTela
      .updateMany({ where: { id, empresaId }, data: { nome: dto.nome.trim(), tipo: dto.tipo, largura: dto.largura, altura: dto.altura, margemPct: dto.margemPct ?? 0, nivelAnimacao: dto.nivelAnimacao ?? 'AUTOMATICO' } })
      .catch((e) => this.conflitoDeNome(e));
    if (count === 0) throw new NotFoundException('Perfil não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.perfil_editar', entidade: 'PerfilTela', entidadeId: id, detalhes: { nome: dto.nome, largura: dto.largura, altura: dto.altura } });
  }

  async excluirPerfil(empresaId: string, id: string, autorId: string) {
    const emUso = await this.prisma.tela.count({ where: { empresaId, perfilId: id } });
    if (emUso > 0) throw new ConflictException('Há telas usando este perfil. Troque o perfil delas antes de excluir.');
    const { count } = await this.prisma.perfilTela.deleteMany({ where: { id, empresaId } });
    if (count === 0) throw new NotFoundException('Perfil não encontrado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.perfil_excluir', entidade: 'PerfilTela', entidadeId: id });
  }

  // Vínculo --------------------------------------------------------------------------------

  /** A TV abriu o link sem vínculo. Público: não diz nada sobre ninguém e o segredo fica só com ela. */
  async criarPedido(dto: ResolucaoDto): Promise<PedidoTelaCriado> {
    const codigo = gerarCodigoTela();
    const segredo = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + VALIDADE_PEDIDO_MS);
    await this.prisma.pedidoVinculoTela.deleteMany({ where: { expiraEm: { lt: new Date(Date.now() - DIA_MS) } } });
    await this.prisma.pedidoVinculoTela.create({
      data: { codigoHash: hashDoToken(codigo), segredoHash: hashDoToken(segredo), largura: dto.largura, altura: dto.altura, escala: dto.escala ?? null, navegador: dto.navegador ?? null, expiraEm },
    });
    return { codigo, segredo, expiraEm: expiraEm.toISOString() };
  }

  /** O token só nasce aqui, entregue uma vez a quem tem o segredo: uma foto do QR não dá acesso à tela. */
  async situacaoDoPedido(segredo: string): Promise<SituacaoPedidoTela> {
    const pedido = await this.prisma.pedidoVinculoTela.findUnique({ where: { segredoHash: hashDoToken(segredo) } });
    if (!pedido || pedido.entregueEm) return { situacao: 'VENCIDO' };
    if (!pedido.telaId) return { situacao: pedido.expiraEm < new Date() ? 'VENCIDO' : 'AGUARDANDO' };
    const token = `tv_${randomBytes(32).toString('base64url')}`;
    const entregue = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.pedidoVinculoTela.updateMany({ where: { id: pedido.id, entregueEm: null }, data: { entregueEm: new Date() } });
      if (count === 0) return false;
      await tx.tela.update({ where: { id: pedido.telaId! }, data: { tokenHash: hashDoToken(token), ultimoContatoEm: new Date(), larguraDetectada: pedido.largura, alturaDetectada: pedido.altura, escalaDetectada: pedido.escala, navegador: pedido.navegador, emSegundoPlano: false, comando: null } });
      return true;
    });
    return entregue ? { situacao: 'VINCULADA', token } : { situacao: 'VENCIDO' };
  }

  private async pedidoValido(texto: string) {
    const invalido = () => new NotFoundException('Código inválido ou vencido. Confira o que está na tela.');
    const codigo = codigoDoVinculoDaTela(texto);
    if (!codigo) throw invalido();
    const pedido = await this.prisma.pedidoVinculoTela.findUnique({ where: { codigoHash: hashDoToken(codigo) } });
    if (!pedido || pedido.telaId || pedido.expiraEm < new Date()) throw invalido();
    return pedido;
  }

  async lerPedido(empresaId: string, codigo: string): Promise<PedidoTelaLido> {
    const pedido = await this.pedidoValido(codigo);
    const perfil = await this.prisma.perfilTela.findFirst({ where: { empresaId, largura: pedido.largura, altura: pedido.altura }, orderBy: { nome: 'asc' }, select: { id: true } });
    return { largura: pedido.largura, altura: pedido.altura, escala: pedido.escala, navegador: pedido.navegador, expiraEm: pedido.expiraEm.toISOString(), perfilSugeridoId: perfil?.id ?? null };
  }

  /** A empresa vem de quem aprovou, nunca da TV. */
  async vincular(empresaId: string, dto: VincularTelaDto, autorId: string): Promise<{ id: string }> {
    const pedido = await this.pedidoValido(dto.codigo);
    return this.prisma.$transaction(async (tx) => {
      let telaId: string;
      if (dto.telaId) {
        const atual = await tx.tela.findFirst({ where: { id: dto.telaId, empresaId }, select: { id: true } });
        if (!atual) throw new NotFoundException('Tela não encontrada.');
        // O equipamento antigo perde o acesso e volta ao QR.
        await tx.tela.update({ where: { id: atual.id }, data: { tokenHash: null } });
        telaId = atual.id;
      } else {
        if (!dto.nome?.trim()) throw new BadRequestException('Informe o nome da tela.');
        const perfilId = dto.perfilId ? (await tx.perfilTela.findFirst({ where: { id: dto.perfilId, empresaId }, select: { id: true } }))?.id : dto.novoPerfil ? (await this.criarPerfil(empresaId, dto.novoPerfil, autorId, tx)).id : undefined;
        if (!perfilId) throw new BadRequestException('Escolha o perfil de resolução.');
        const nova = await tx.tela.create({ data: { empresaId, perfilId, nome: dto.nome.trim(), local: dto.local?.trim() || null } });
        telaId = nova.id;
      }
      // updateMany no estado antigo: o mesmo QR não vincula duas telas.
      const { count } = await tx.pedidoVinculoTela.updateMany({ where: { id: pedido.id, telaId: null }, data: { telaId } });
      if (count === 0) throw new NotFoundException('Este código acabou de ser usado.');
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: dto.telaId ? 'tela.substituir' : 'tela.vincular', entidade: 'Tela', entidadeId: telaId, detalhes: { largura: pedido.largura, altura: pedido.altura } }, tx);
      return { id: telaId };
    });
  }

  // Equipamentos ---------------------------------------------------------------------------

  async listar(empresaId: string): Promise<TelaResumo[]> {
    const agora = new Date();
    const [telas, parametros, quedas] = await Promise.all([
      this.prisma.tela.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: SELECAO_TELA }),
      this.parametros.vigentes(empresaId),
      this.prisma.quedaTela.groupBy({ by: ['telaId'], where: { empresaId, fim: { gte: new Date(agora.getTime() - 30 * DIA_MS) } }, _count: { _all: true } }),
    ]);
    const hora = horaLocal(agora, config().fusoHorario);
    return telas.map((t) => resumir(t, quedas.find((q) => q.telaId === t.id)?._count._all ?? 0, agora, hora, parametros));
  }

  async quedas(empresaId: string, id: string): Promise<QuedaTelaResumo[]> {
    const quedas = await this.prisma.quedaTela.findMany({ where: { empresaId, telaId: id }, orderBy: { inicio: 'desc' }, take: 50 });
    return quedas.map((q) => ({ inicio: q.inicio.toISOString(), fim: q.fim.toISOString() }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarTelaDto, autorId: string) {
    if (dto.perfilId && !(await this.prisma.perfilTela.findFirst({ where: { id: dto.perfilId, empresaId }, select: { id: true } }))) throw new BadRequestException('Perfil inválido.');
    if (!dto.semHorario && !!dto.horarioInicio !== !!dto.horarioFim) throw new BadRequestException('Informe o início e o fim do horário.');
    if (dto.horarioInicio && (!horarioValido(dto.horarioInicio) || !horarioValido(dto.horarioFim!))) throw new BadRequestException(MENSAGEM_HORA);
    const { count } = await this.prisma.tela.updateMany({
      where: { id, empresaId },
      data: {
        nome: dto.nome?.trim(),
        local: dto.local === undefined ? undefined : dto.local.trim() || null,
        perfilId: dto.perfilId,
        ...(dto.semHorario ? { horarioInicio: null, horarioFim: null } : dto.horarioInicio ? { horarioInicio: dto.horarioInicio, horarioFim: dto.horarioFim } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Tela não encontrada.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.editar', entidade: 'Tela', entidadeId: id, detalhes: { nome: dto.nome, perfilId: dto.perfilId } });
  }

  async enviarComando(empresaId: string, id: string, comando: ComandoTela, autorId: string) {
    const { count } = await this.prisma.tela.updateMany({ where: { id, empresaId, tokenHash: { not: null } }, data: { comando } });
    if (count === 0) throw new NotFoundException('Tela sem equipamento vinculado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.comando', entidade: 'Tela', entidadeId: id, detalhes: { comando } });
  }

  /** O equipamento volta ao QR e a configuração fica, para vincular outro no lugar. */
  async desvincular(empresaId: string, id: string, autorId: string) {
    const { count } = await this.prisma.tela.updateMany({ where: { id, empresaId }, data: { tokenHash: null, comando: null } });
    if (count === 0) throw new NotFoundException('Tela não encontrada.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.desvincular', entidade: 'Tela', entidadeId: id });
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const { count } = await this.prisma.tela.deleteMany({ where: { id, empresaId } });
    if (count === 0) throw new NotFoundException('Tela não encontrada.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'tela.excluir', entidade: 'Tela', entidadeId: id });
  }

  // Aviso do player ------------------------------------------------------------------------

  /** O token da TV não serve para mais nada, e empresa bloqueada não tem nada no ar. */
  private async telaDoToken(token: string | undefined) {
    if (!token?.startsWith('tv_')) throw new UnauthorizedException('Tela não vinculada.');
    const tela = await this.prisma.tela.findUnique({
      where: { tokenHash: hashDoToken(token) },
      include: { perfil: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
    });
    if (!tela) throw new UnauthorizedException('Tela não vinculada.');
    if (empresaBloqueada(tela.empresa)) throw new ForbiddenException(await this.cobranca.mensagemBloqueio(tela.empresaId));
    return tela;
  }

  async programacao(token: string | undefined) {
    const tela = await this.telaDoToken(token);
    return this.conteudos.programacaoDaTela(tela.empresaId, tela.id);
  }

  /** Grava o contato; o histórico só guarda as quedas, não cada aviso. */
  async receberAviso(token: string | undefined, dto: AvisoTelaDto): Promise<RespostaAvisoTela> {
    const tela = await this.telaDoToken(token);

    const agora = new Date();
    const p = await this.parametros.vigentes(tela.empresaId);
    const caiu = tela.ultimoContatoEm && agora.getTime() - tela.ultimoContatoEm.getTime() >= p.minutosOffline * 60_000;
    // Desligar fora do horário não é queda.
    const contaComoQueda = caiu && (dentroDoHorarioDaTela(tela.horarioInicio, tela.horarioFim, horaLocal(tela.ultimoContatoEm!, config().fusoHorario)) || dentroDoHorarioDaTela(tela.horarioInicio, tela.horarioFim, horaLocal(agora, config().fusoHorario)));
    await this.prisma.$transaction([
      this.prisma.tela.update({
        where: { id: tela.id },
        data: { ultimoContatoEm: agora, larguraDetectada: dto.largura, alturaDetectada: dto.altura, escalaDetectada: dto.escala ?? null, navegador: dto.navegador ?? null, versaoPlayer: dto.versao ?? null, emSegundoPlano: dto.segundoPlano ?? false, ...(tela.comando ? { comando: null } : {}) },
      }),
      ...(contaComoQueda ? [this.prisma.quedaTela.create({ data: { empresaId: tela.empresaId, telaId: tela.id, inicio: tela.ultimoContatoEm!, fim: agora } })] : []),
    ]);
    return {
      tela: { nome: tela.nome, local: tela.local },
      perfil: { largura: tela.perfil.largura, altura: tela.perfil.altura, tipo: tela.perfil.tipo as TipoEquipamento, margemPct: tela.perfil.margemPct, nivelAnimacao: tela.perfil.nivelAnimacao as NivelAnimacao },
      comando: tela.comando as ComandoTela | null,
      versaoProgramacao: await this.conteudos.versaoDaProgramacao(tela.empresaId, tela.id, agora),
      agora: agora.toISOString(),
    };
  }
}

/** O que o player usa: público na rota, com o token próprio da tela, que não serve para mais nada. */
@Controller('tv')
export class TvController {
  constructor(
    private readonly telas: TelasService,
    private readonly conteudos: ConteudosTelaService,
  ) {}

  /**
   * Pública: `<img>` não manda token e a TV não tem login. O id é aleatório, o conteúdo é o que já
   * aparece na vitrine e os bytes nunca mudam, por isso a TV pode guardar a imagem por muito tempo.
   */
  @Get('imagens/:id')
  @Publico()
  @SkipThrottle()
  async imagem(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const i = await this.conteudos.arquivoDaImagem(id);
    res.setHeader('Content-Type', i.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(i.conteudo));
  }

  @Post('pedidos')
  @Publico()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  criarPedido(@Body() dto: ResolucaoDto) {
    return this.telas.criarPedido(dto);
  }

  @Post('pedidos/situacao')
  @Publico()
  @HttpCode(200)
  situacao(@Body() dto: SituacaoPedidoDto) {
    return this.telas.situacaoDoPedido(dto.segredo);
  }

  @Post('aviso')
  @Publico()
  @HttpCode(200)
  aviso(@Headers('authorization') autorizacao: string | undefined, @Body() dto: AvisoTelaDto) {
    return this.telas.receberAviso(autorizacao?.replace(/^Bearer /, ''), dto);
  }

  @Post('programacao')
  @Publico()
  @HttpCode(200)
  programacao(@Headers('authorization') autorizacao: string | undefined) {
    return this.telas.programacao(autorizacao?.replace(/^Bearer /, ''));
  }
}

@Controller('telas')
export class TelasController {
  constructor(
    private readonly telas: TelasService,
    private readonly parametros: ParametrosTelasService,
  ) {}

  @Get()
  @PermitidoNoApp()
  @RequerPermissao('tela.ver')
  listar(@EmpresaAtual() empresaId: string) {
    return this.telas.listar(empresaId);
  }

  @Get('perfis')
  @PermitidoNoApp()
  @RequerPermissao('tela.ver')
  perfis(@EmpresaAtual() empresaId: string) {
    return this.telas.listarPerfis(empresaId);
  }

  @Post('perfis')
  @RequerPermissao('tela.editar')
  async criarPerfil(@EmpresaAtual() empresaId: string, @Body() dto: PerfilTelaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    const { id } = await this.telas.criarPerfil(empresaId, dto, u.id);
    return { id };
  }

  @Put('perfis/:id')
  @RequerPermissao('tela.editar')
  atualizarPerfil(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PerfilTelaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.telas.atualizarPerfil(empresaId, id, dto, u.id);
  }

  @Delete('perfis/:id')
  @HttpCode(204)
  @RequerPermissao('tela.editar')
  async excluirPerfil(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.telas.excluirPerfil(empresaId, id, u.id);
  }

  @Get('parametros')
  @RequerPermissao('tela.ver')
  lerParametros(@EmpresaAtual() empresaId: string, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.parametros.ler(empresaId, u);
  }

  @Put('parametros/empresa')
  @RequerPermissao('tela.editar')
  parametrosDaEmpresa(@EmpresaAtual() empresaId: string, @Body() dto: ParametrosDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.parametros.salvarDaEmpresa(empresaId, dto.valores, u);
  }

  @Put('parametros/global')
  @RequerPermissao('tela.editar')
  parametrosGlobais(@EmpresaAtual() empresaId: string, @Body() dto: ParametrosDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.parametros.salvarGlobais(empresaId, dto.valores, u);
  }

  @Get('pedidos/:codigo')
  @PermitidoNoApp()
  @RequerPermissao('tela.editar')
  lerPedido(@EmpresaAtual() empresaId: string, @Param('codigo') codigo: string) {
    return this.telas.lerPedido(empresaId, codigo);
  }

  @Post('vincular')
  @PermitidoNoApp()
  @RequerPermissao('tela.editar')
  vincular(@EmpresaAtual() empresaId: string, @Body() dto: VincularTelaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.telas.vincular(empresaId, dto, u.id);
  }

  @Patch(':id')
  @RequerPermissao('tela.editar')
  atualizar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarTelaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    return this.telas.atualizar(empresaId, id, dto, u.id);
  }

  @Get(':id/quedas')
  @RequerPermissao('tela.ver')
  quedas(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.telas.quedas(empresaId, id);
  }

  @Post(':id/comando')
  @HttpCode(204)
  @PermitidoNoApp()
  @RequerPermissao('tela.editar')
  async comando(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ComandoTelaDto, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.telas.enviarComando(empresaId, id, dto.comando, u.id);
  }

  @Post(':id/desvincular')
  @HttpCode(204)
  @PermitidoNoApp()
  @RequerPermissao('tela.editar')
  async desvincular(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.telas.desvincular(empresaId, id, u.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequerPermissao('tela.editar')
  async excluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao) {
    await this.telas.excluir(empresaId, id, u.id);
  }
}

// O controlador de conteúdos vem antes: `telas/conteudos` não pode cair nas rotas de `telas/:id`.
@Module({ imports: [ConsultasModule, BanidosModule], controllers: [TvController, ConteudosTelaController, TelasController], providers: [TelasService, ParametrosTelasService, ConteudosTelaService] })
export class TelasModule {}
