import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  DIAS_MEDIA_AVALIACAO,
  formatarCentavos,
  INSCRICOES_ATIVAS,
  LIMITE_COMENTARIO_AVALIACAO,
  mediaDaEmpresa,
  podeAvaliarEmpresa,
  podeMarcarPresenca,
  podeRegistrarAvaria,
  podeSairDoTurno,
  primeiroNome,
  problemaNaAvaliacao,
  problemaNaAvaria,
  problemaNoTurno,
  RESPONSAVEIS_AVARIA,
  TIPOS_AVARIA,
  turnoPerto,
  type AvariaResumo,
  type EmpresaAvaliada,
  type ReputacaoEmpresa,
  type ResponsavelAvaria,
  type SituacaoAvaria,
  type SituacaoInscricao,
  type TipoAvaria,
  type TurnoParaEntregador,
  type TurnoResumo,
} from '@etiquetas/shared';
import { Prisma } from '@prisma/client';
import { ApenasSuperAdmin, EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { EntregadorAtual, EntregadorGuard } from './guarda';
import { dataUrl, imagemDoDataUrl } from './imagens';

const DIA_MS = 86_400_000;
/** Turnos que o entregador vê: os que ainda não acabaram, até 14 dias à frente. */
const DIAS_TURNOS_NO_APP = 14;

class NovoTurnoDto {
  @IsISO8601({}, { message: 'Início inválido.' }) inicio: string;
  @IsISO8601({}, { message: 'Fim inválido.' }) fim: string;
  @IsInt() @Min(1) @Max(50) vagas: number;
  @IsInt() @Min(0) @Max(100_000) valorCentavos: number;
  @IsString() @MaxLength(300) observacao: string;
}

class PresencaDto {
  @IsIn(['PRESENTE', 'FALTOU'], { message: 'Marque presente ou faltou.' }) situacao: 'PRESENTE' | 'FALTOU';
}

class AvaliarEmpresaDto {
  @IsInt() @Min(1, { message: 'A nota vai de 1 a 5.' }) @Max(5, { message: 'A nota vai de 1 a 5.' }) nota: number;
  @IsString() @MaxLength(LIMITE_COMENTARIO_AVALIACAO) comentario: string;
}

class NovaAvariaDto {
  @IsIn(TIPOS_AVARIA, { message: 'Escolha se foi avaria ou extravio.' }) tipo: TipoAvaria;
  @IsString() @MaxLength(500) descricao: string;
  @IsInt() @Min(0) @Max(5_000_000) prejuizoCentavos: number;
  @IsIn(RESPONSAVEIS_AVARIA, { message: 'Escolha o responsável.' }) responsavel: ResponsavelAvaria;
  @IsInt() @Min(0) @Max(5_000_000) descontoCentavos: number;
  @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(7_200_000, { each: true }) fotos: string[];
}

class RespostaAvariaDto {
  @IsBoolean() aceitar: boolean;
  @IsString() @MaxLength(500) texto: string;
}

const hora = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: config().fusoHorario, hour: '2-digit', minute: '2-digit' }).format(d);
const dia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: config().fusoHorario, day: '2-digit', month: '2-digit' }).format(d);
const textoDoTurno = (t: { inicio: Date; fim: Date }) => `Turno de ${dia(t.inicio)}, ${hora(t.inicio)} às ${hora(t.fim)}`;

/**
 * Entregas, etapa 13 (docs/ENTREGAS.md): escala de turnos (quem está no turno recebe primeiro e,
 * presente, ganha o valor do turno), avaliação da empresa pelo entregador e avaria/extravio com o
 * desconto que o entregador aceita ou contesta. Turno e desconto viram lançamentos no fechamento.
 */
@Injectable()
export class EscalaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async historico(chamadaId: string, texto: string, por: 'empresa' | 'entregador', tx: Prisma.TransactionClient = this.prisma) {
    const e = [{ em: new Date().toISOString(), texto, por }];
    await tx.$executeRaw`UPDATE chamadas_entrega SET historico = historico || ${JSON.stringify(e)}::jsonb WHERE id = ${chamadaId}::uuid`;
  }

  // Turnos: empresa ----------------------------------------------------------------------------

  async turnos(empresaId: string, agora = new Date()): Promise<TurnoResumo[]> {
    const lista = await this.prisma.turnoEntrega.findMany({
      where: { empresaId, fim: { gte: new Date(agora.getTime() - 14 * DIA_MS) } },
      orderBy: { inicio: 'asc' },
      take: 300,
      include: { inscricoes: { orderBy: { criadoEm: 'asc' }, include: { entregador: { select: { nome: true } }, lancamento: { select: { fechamentoId: true } } } } },
    });
    // Chamadas desta empresa que cada inscrito terminou dentro do turno: ajuda a marcar a presença.
    const ids = [...new Set(lista.flatMap((t) => t.inscricoes.map((i) => i.entregadorId)))];
    const feitas = ids.length
      ? await this.prisma.chamadaEntrega.findMany({ where: { empresaId, entregadorId: { in: ids }, situacao: 'CONCLUIDA', concluidaEm: { gte: new Date(agora.getTime() - 15 * DIA_MS) } }, select: { entregadorId: true, concluidaEm: true } })
      : [];
    return lista.map((t) => ({
      id: t.id,
      inicio: t.inicio.toISOString(),
      fim: t.fim.toISOString(),
      vagas: t.vagas,
      valorCentavos: t.valorCentavos,
      observacao: t.observacao,
      canceladoEm: t.canceladoEm?.toISOString() ?? null,
      inscritos: t.inscricoes.map((i) => ({
        id: i.id,
        entregadorId: i.entregadorId,
        nome: primeiroNome(i.entregador.nome),
        situacao: i.situacao as SituacaoInscricao,
        chamadas: feitas.filter((f) => f.entregadorId === i.entregadorId && f.concluidaEm! >= t.inicio && f.concluidaEm! < t.fim).length,
        pago: !!i.lancamento?.fechamentoId,
      })),
    }));
  }

  async criarTurno(empresaId: string, dto: NovoTurnoDto, autorId: string): Promise<TurnoResumo[]> {
    const problema = problemaNoTurno(dto, new Date());
    if (problema) throw new BadRequestException(problema);
    const t = await this.prisma.turnoEntrega.create({ data: { empresaId, inicio: new Date(dto.inicio), fim: new Date(dto.fim), vagas: dto.vagas, valorCentavos: dto.valorCentavos, observacao: dto.observacao.trim(), criadoPorId: autorId } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.turno.criar', entidade: 'TurnoEntrega', entidadeId: t.id, detalhes: { inicio: dto.inicio, fim: dto.fim, vagas: dto.vagas, valorCentavos: dto.valorCentavos } });
    return this.turnos(empresaId);
  }

  async cancelarTurno(empresaId: string, id: string, autorId: string): Promise<TurnoResumo[]> {
    const t = await this.prisma.turnoEntrega.findFirst({ where: { id, empresaId }, select: { fim: true, canceladoEm: true } });
    if (!t) throw new NotFoundException('Turno não encontrado.');
    if (t.canceladoEm) throw new ConflictException('O turno já está cancelado.');
    if (t.fim <= new Date()) throw new ConflictException('O turno já terminou: marque a presença de cada um.');
    await this.prisma.turnoEntrega.updateMany({ where: { id, empresaId, canceladoEm: null }, data: { canceladoEm: new Date() } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.turno.cancelar', entidade: 'TurnoEntrega', entidadeId: id });
    return this.turnos(empresaId);
  }

  /** Depois do turno: presente com valor vira lançamento a pagar; faltou tira o lançamento (se não foi pago). */
  async presenca(empresaId: string, inscricaoId: string, situacao: 'PRESENTE' | 'FALTOU', autorId: string): Promise<TurnoResumo[]> {
    const i = await this.prisma.inscricaoTurno.findFirst({ where: { id: inscricaoId, turno: { empresaId } }, include: { turno: true, lancamento: true } });
    if (!i) throw new NotFoundException('Inscrição não encontrada.');
    if (i.turno.canceladoEm) throw new ConflictException('O turno foi cancelado.');
    if (!podeMarcarPresenca(i.turno.fim, new Date())) throw new ConflictException('A presença se marca depois que o turno termina.');
    if (i.situacao === 'SAIU') throw new ConflictException('O entregador saiu do turno antes de começar.');
    if (i.lancamento?.fechamentoId) throw new ConflictException('O valor deste turno já foi pago: desfaça o pagamento para mudar.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.inscricaoTurno.updateMany({ where: { id: i.id, atualizadoEm: i.atualizadoEm }, data: { situacao } });
      if (!count) throw new ConflictException('A inscrição mudou. Recarregue.');
      if (situacao === 'PRESENTE' && i.turno.valorCentavos > 0 && !i.lancamento) {
        await tx.lancamentoEntrega.create({ data: { empresaId, entregadorId: i.entregadorId, tipo: 'TURNO', descricao: textoDoTurno(i.turno), valorCentavos: i.turno.valorCentavos, inscricaoId: i.id } });
      }
      if (situacao === 'FALTOU' && i.lancamento) await tx.lancamentoEntrega.deleteMany({ where: { id: i.lancamento.id, fechamentoId: null } });
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.turno.presenca', entidade: 'InscricaoTurno', entidadeId: i.id, detalhes: { situacao } }, tx);
    });
    return this.turnos(empresaId);
  }

  /** A empresa tira alguém do turno antes de começar. */
  async removerInscrito(empresaId: string, inscricaoId: string, autorId: string): Promise<TurnoResumo[]> {
    const i = await this.prisma.inscricaoTurno.findFirst({ where: { id: inscricaoId, turno: { empresaId } }, include: { turno: { select: { inicio: true } } } });
    if (!i) throw new NotFoundException('Inscrição não encontrada.');
    if (i.turno.inicio <= new Date()) throw new ConflictException('O turno já começou: depois dele, marque a presença.');
    await this.prisma.inscricaoTurno.updateMany({ where: { id: i.id, situacao: 'INSCRITO' }, data: { situacao: 'SAIU' } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.turno.remover', entidade: 'InscricaoTurno', entidadeId: i.id });
    return this.turnos(empresaId);
  }

  /** Quem está inscrito num turno da empresa que vale agora (entra antes no direcionamento). */
  async emTurno(empresaId: string, entregadorIds: string[], agora = new Date(), tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Set<string>> {
    if (!entregadorIds.length) return new Set();
    const lista = await tx.inscricaoTurno.findMany({
      where: { entregadorId: { in: entregadorIds }, situacao: 'INSCRITO', turno: { empresaId, canceladoEm: null, inicio: { lte: agora }, fim: { gt: agora } } },
      select: { entregadorId: true },
    });
    return new Set(lista.map((l) => l.entregadorId));
  }

  // Turnos: entregador -------------------------------------------------------------------------

  async turnosDoEntregador(entregadorId: string, agora = new Date()): Promise<TurnoParaEntregador[]> {
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id: entregadorId }, select: { lat: true, lon: true, empresas: { where: { bloqueado: true }, select: { empresaId: true } } } });
    const bloqueado = new Set(e.empresas.map((x) => x.empresaId));
    const lista = await this.prisma.turnoEntrega.findMany({
      where: { canceladoEm: null, fim: { gt: agora }, inicio: { lt: new Date(agora.getTime() + DIAS_TURNOS_NO_APP * DIA_MS) } },
      orderBy: { inicio: 'asc' },
      take: 300,
      include: {
        empresa: { select: { nomeFantasia: true, razaoSocial: true, configuracaoEntregas: { select: { baseLat: true, baseLon: true } } } },
        inscricoes: { where: { situacao: { in: [...INSCRICOES_ATIVAS] } }, select: { entregadorId: true, situacao: true } },
      },
    });
    const minhas = await this.prisma.inscricaoTurno.findMany({ where: { entregadorId, turnoId: { in: lista.map((t) => t.id) } }, select: { turnoId: true, situacao: true } });
    const minha = new Map(minhas.map((m) => [m.turnoId, m.situacao as SituacaoInscricao]));
    const posicao = e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null;
    return lista
      .filter((t) => !bloqueado.has(t.empresaId))
      .map((t) => {
        const cfg = t.empresa.configuracaoEntregas;
        const base = cfg?.baseLat != null && cfg.baseLon != null ? { lat: cfg.baseLat, lon: cfg.baseLon } : null;
        const perto = turnoPerto(base, posicao);
        return { t, perto };
      })
      .filter(({ t, perto }) => perto.perto || minha.has(t.id))
      .map(({ t, perto }) => ({
        id: t.id,
        empresa: t.empresa.nomeFantasia || t.empresa.razaoSocial,
        inicio: t.inicio.toISOString(),
        fim: t.fim.toISOString(),
        vagas: t.vagas,
        livres: Math.max(0, t.vagas - t.inscricoes.length),
        valorCentavos: t.valorCentavos,
        observacao: t.observacao,
        metros: perto.metros,
        minha: minha.get(t.id) ?? null,
        podeSair: minha.get(t.id) === 'INSCRITO' && podeSairDoTurno(t.inicio, agora),
      }));
  }

  async inscrever(entregadorId: string, turnoId: string): Promise<TurnoParaEntregador[]> {
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id: entregadorId }, select: { situacao: true } });
    if (e.situacao !== 'APROVADO') throw new ForbiddenException('Seu cadastro ainda não foi aprovado.');
    await this.prisma.$transaction(async (tx) => {
      // Prende o turno: duas inscrições ao mesmo tempo não passam da vaga.
      const linhas = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM turnos_entrega WHERE id = ${turnoId}::uuid FOR UPDATE`;
      if (!linhas.length) throw new NotFoundException('Turno não encontrado.');
      const t = await tx.turnoEntrega.findUniqueOrThrow({ where: { id: turnoId } });
      if (t.canceladoEm) throw new ConflictException('A empresa cancelou este turno.');
      if (t.fim <= new Date()) throw new ConflictException('Este turno já terminou.');
      const bloqueado = await tx.entregadorEmpresa.findFirst({ where: { entregadorId, empresaId: t.empresaId, bloqueado: true }, select: { entregadorId: true } });
      if (bloqueado) throw new ForbiddenException('Você não recebe chamadas desta empresa.');
      const ocupadas = await tx.inscricaoTurno.count({ where: { turnoId, situacao: { in: [...INSCRICOES_ATIVAS] }, entregadorId: { not: entregadorId } } });
      if (ocupadas >= t.vagas) throw new ConflictException('As vagas deste turno acabaram.');
      const choque = await tx.inscricaoTurno.findFirst({ where: { entregadorId, situacao: 'INSCRITO', turnoId: { not: turnoId }, turno: { canceladoEm: null, inicio: { lt: t.fim }, fim: { gt: t.inicio } } }, select: { id: true } });
      if (choque) throw new ConflictException('Você já está em outro turno nesse horário.');
      await tx.inscricaoTurno.upsert({ where: { turnoId_entregadorId: { turnoId, entregadorId } }, create: { turnoId, entregadorId }, update: { situacao: 'INSCRITO' } });
    });
    return this.turnosDoEntregador(entregadorId);
  }

  async sair(entregadorId: string, turnoId: string): Promise<TurnoParaEntregador[]> {
    const i = await this.prisma.inscricaoTurno.findUnique({ where: { turnoId_entregadorId: { turnoId, entregadorId } }, include: { turno: { select: { inicio: true } } } });
    if (!i || i.situacao !== 'INSCRITO') throw new NotFoundException('Você não está neste turno.');
    if (!podeSairDoTurno(i.turno.inicio, new Date())) throw new ConflictException('Falta pouco para o turno começar: fale com a empresa pela conversa de uma chamada ou por telefone.');
    await this.prisma.inscricaoTurno.updateMany({ where: { id: i.id, situacao: 'INSCRITO' }, data: { situacao: 'SAIU' } });
    return this.turnosDoEntregador(entregadorId);
  }

  // Avaliação da empresa -----------------------------------------------------------------------

  async avaliarEmpresa(entregadorId: string, chamadaId: string, dto: AvaliarEmpresaDto): Promise<void> {
    const problema = problemaNaAvaliacao(dto.nota, dto.comentario);
    if (problema) throw new BadRequestException(problema);
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId }, select: { concluidaEm: true, situacao: true } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    if (!(c.situacao === 'CONCLUIDA' || c.situacao === 'CANCELADA') || !podeAvaliarEmpresa(c.concluidaEm, new Date())) throw new ConflictException('A avaliação vale até 7 dias depois de terminar a chamada.');
    const { count } = await this.prisma.chamadaEntrega.updateMany({ where: { id: chamadaId, entregadorId, avaliacaoEmpresaEm: null }, data: { avaliacaoEmpresaNota: dto.nota, avaliacaoEmpresaComentario: dto.comentario.trim(), avaliacaoEmpresaEm: new Date() } });
    if (!count) throw new ConflictException('Você já avaliou a empresa nesta chamada.');
  }

  async reputacao(empresaId: string, agora = new Date()): Promise<ReputacaoEmpresa> {
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, avaliacaoEmpresaEm: { gte: new Date(agora.getTime() - DIAS_MEDIA_AVALIACAO * DIA_MS) } },
      orderBy: { avaliacaoEmpresaEm: 'desc' },
      select: { avaliacaoEmpresaNota: true, avaliacaoEmpresaComentario: true, avaliacaoEmpresaEm: true },
      take: 1000,
    });
    const soma = lista.reduce((s, x) => s + (x.avaliacaoEmpresaNota ?? 0), 0);
    const media = mediaDaEmpresa(soma, lista.length);
    // Com poucas avaliações, nem os comentários: daria para saber quem escreveu.
    const comentarios = media === null ? [] : lista.filter((x) => x.avaliacaoEmpresaComentario).slice(0, 30).map((x) => ({ nota: x.avaliacaoEmpresaNota!, comentario: x.avaliacaoEmpresaComentario, em: x.avaliacaoEmpresaEm!.toISOString().slice(0, 10) }));
    return { media, avaliacoes: lista.length, comentarios };
  }

  /** Super-admin: as empresas pela média, da pior para a melhor. */
  async empresasAvaliadas(agora = new Date()): Promise<EmpresaAvaliada[]> {
    const desde = new Date(agora.getTime() - DIAS_MEDIA_AVALIACAO * DIA_MS);
    const [grupos, ruins] = await Promise.all([
      this.prisma.chamadaEntrega.groupBy({ by: ['empresaId'], where: { avaliacaoEmpresaEm: { gte: desde } }, _sum: { avaliacaoEmpresaNota: true }, _count: { avaliacaoEmpresaNota: true } }),
      this.prisma.chamadaEntrega.groupBy({ by: ['empresaId'], where: { avaliacaoEmpresaEm: { gte: desde }, avaliacaoEmpresaNota: { lte: 2 } }, _count: { _all: true } }),
    ]);
    if (!grupos.length) return [];
    const empresas = await this.prisma.empresa.findMany({ where: { id: { in: grupos.map((g) => g.empresaId) } }, select: { id: true, nomeFantasia: true, razaoSocial: true } });
    const nome = new Map(empresas.map((e) => [e.id, e.nomeFantasia || e.razaoSocial]));
    const mapaRuins = new Map(ruins.map((r) => [r.empresaId, r._count._all]));
    return grupos
      .map((g) => ({ empresaId: g.empresaId, nome: nome.get(g.empresaId) ?? '-', avaliacoes: g._count.avaliacaoEmpresaNota, media: mediaDaEmpresa(g._sum.avaliacaoEmpresaNota ?? 0, g._count.avaliacaoEmpresaNota), ruins: mapaRuins.get(g.empresaId) ?? 0 }))
      .sort((a, b) => (a.media ?? 6) - (b.media ?? 6) || b.ruins - a.ruins);
  }

  // Avarias ------------------------------------------------------------------------------------

  private resumoAvaria(a: Prisma.AvariaChamadaGetPayload<{ include: { chamada: { select: { numero: true; valorDeclaradoCentavos: true } }; empresa: { select: { nomeFantasia: true; razaoSocial: true } }; entregador: { select: { nome: true } }; _count: { select: { fotos: true } }; lancamento: { select: { fechamentoId: true } } } }>): AvariaResumo {
    return {
      id: a.id,
      chamadaId: a.chamadaId,
      numero: a.chamada.numero,
      empresa: a.empresa.nomeFantasia || a.empresa.razaoSocial,
      entregadorNome: primeiroNome(a.entregador.nome),
      tipo: a.tipo as TipoAvaria,
      descricao: a.descricao,
      prejuizoCentavos: a.prejuizoCentavos,
      responsavel: a.responsavel as ResponsavelAvaria,
      descontoCentavos: a.descontoCentavos,
      valorDeclaradoCentavos: a.chamada.valorDeclaradoCentavos,
      situacao: a.situacao as SituacaoAvaria,
      resposta: a.resposta,
      fotos: a._count.fotos,
      criadoEm: a.criadoEm.toISOString(),
      respondidaEm: a.respondidaEm?.toISOString() ?? null,
      pago: !!a.lancamento?.fechamentoId,
    };
  }

  private readonly incluirAvaria = {
    chamada: { select: { numero: true, valorDeclaradoCentavos: true } },
    empresa: { select: { nomeFantasia: true, razaoSocial: true } },
    entregador: { select: { nome: true } },
    _count: { select: { fotos: true } },
    lancamento: { select: { fechamentoId: true } },
  } as const;

  async avarias(filtro: { empresaId?: string; entregadorId?: string; chamadaId?: string }): Promise<AvariaResumo[]> {
    const lista = await this.prisma.avariaChamada.findMany({ where: filtro, orderBy: { criadoEm: 'desc' }, take: 200, include: this.incluirAvaria });
    return lista.map((a) => this.resumoAvaria(a));
  }

  async registrarAvaria(empresaId: string, chamadaId: string, dto: NovaAvariaDto, autorId: string): Promise<AvariaResumo> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId }, select: { id: true, entregadorId: true, coletadaEm: true, concluidaEm: true, valorDeclaradoCentavos: true } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    if (!podeRegistrarAvaria(c, new Date())) throw new ConflictException('A avaria se registra depois da coleta, até 30 dias depois de terminar a chamada.');
    const problema = problemaNaAvaria(dto, c.valorDeclaradoCentavos);
    if (problema) throw new BadRequestException(problema);
    const fotos = dto.fotos.map((f, i) => imagemDoDataUrl(f, `A foto ${i + 1}`));
    const situacao: SituacaoAvaria = dto.descontoCentavos > 0 ? 'AGUARDANDO' : 'SEM_DESCONTO';
    const id = await this.prisma.$transaction(async (tx) => {
      const a = await tx.avariaChamada.create({
        data: { chamadaId, empresaId, entregadorId: c.entregadorId!, tipo: dto.tipo, descricao: dto.descricao.trim(), prejuizoCentavos: dto.prejuizoCentavos, responsavel: dto.responsavel, descontoCentavos: dto.descontoCentavos, situacao, criadoPorId: autorId },
      });
      for (const f of fotos) await tx.fotoAvaria.create({ data: { avariaId: a.id, mime: f.mime, bytes: f.bytes } });
      const desconto = dto.descontoCentavos ? ` Proposta de desconto ao entregador: ${formatarCentavos(dto.descontoCentavos)}.` : '';
      await this.historico(chamadaId, `Empresa registrou ${dto.tipo === 'AVARIA' ? 'avaria' : 'extravio'} (prejuízo de ${formatarCentavos(dto.prejuizoCentavos)}).${desconto}`, 'empresa', tx);
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.avaria.registrar', entidade: 'AvariaChamada', entidadeId: a.id, detalhes: { chamadaId, tipo: dto.tipo, prejuizoCentavos: dto.prejuizoCentavos, descontoCentavos: dto.descontoCentavos, responsavel: dto.responsavel } }, tx);
      return a.id;
    });
    return this.resumoAvaria(await this.prisma.avariaChamada.findUniqueOrThrow({ where: { id }, include: this.incluirAvaria }));
  }

  /** A empresa desiste: o desconto ainda não pago sai do que vai ser pago. */
  async retirarAvaria(empresaId: string, id: string, autorId: string): Promise<AvariaResumo> {
    const a = await this.prisma.avariaChamada.findFirst({ where: { id, empresaId }, include: { lancamento: true } });
    if (!a) throw new NotFoundException('Avaria não encontrada.');
    if (a.situacao === 'RETIRADA') throw new ConflictException('A avaria já foi retirada.');
    if (a.lancamento?.fechamentoId) throw new ConflictException('O desconto já saiu num pagamento: desfaça o pagamento antes.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.avariaChamada.updateMany({ where: { id, atualizadoEm: a.atualizadoEm }, data: { situacao: 'RETIRADA' } });
      if (!count) throw new ConflictException('A avaria mudou. Recarregue.');
      if (a.lancamento) await tx.lancamentoEntrega.deleteMany({ where: { id: a.lancamento.id, fechamentoId: null } });
      await this.historico(a.chamadaId, 'Empresa retirou a avaria registrada.', 'empresa', tx);
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.avaria.retirar', entidade: 'AvariaChamada', entidadeId: id }, tx);
    });
    return this.resumoAvaria(await this.prisma.avariaChamada.findUniqueOrThrow({ where: { id }, include: this.incluirAvaria }));
  }

  /** O entregador aceita (o desconto entra no próximo pagamento) ou contesta (nada é descontado). */
  async responderAvaria(entregadorId: string, id: string, dto: RespostaAvariaDto): Promise<AvariaResumo> {
    const a = await this.prisma.avariaChamada.findFirst({ where: { id, entregadorId }, include: { chamada: { select: { numero: true } } } });
    if (!a) throw new NotFoundException('Avaria não encontrada.');
    if (a.situacao !== 'AGUARDANDO') throw new ConflictException('Esta avaria não espera mais a sua resposta.');
    if (!dto.aceitar && dto.texto.trim().length < 5) throw new BadRequestException('Explique por que não concorda.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.avariaChamada.updateMany({ where: { id, situacao: 'AGUARDANDO' }, data: { situacao: dto.aceitar ? 'ACEITA' : 'CONTESTADA', resposta: dto.texto.trim() || null, respondidaEm: new Date() } });
      if (!count) throw new ConflictException('A avaria mudou. Atualize a tela.');
      if (dto.aceitar) await tx.lancamentoEntrega.create({ data: { empresaId: a.empresaId, entregadorId, tipo: 'DESCONTO', descricao: `Desconto da ${a.tipo === 'AVARIA' ? 'avaria' : 'extravio'} na chamada nº ${a.chamada.numero}`, valorCentavos: -a.descontoCentavos, avariaId: a.id } });
      await this.historico(a.chamadaId, dto.aceitar ? `Entregador aceitou o desconto de ${formatarCentavos(a.descontoCentavos)}.` : `Entregador contestou a avaria: ${dto.texto.trim()}`, 'entregador', tx);
    });
    return this.resumoAvaria(await this.prisma.avariaChamada.findUniqueOrThrow({ where: { id }, include: this.incluirAvaria }));
  }

  async fotoAvaria(filtro: { empresaId?: string; entregadorId?: string }, id: string, n: number): Promise<{ dados: string }> {
    const a = await this.prisma.avariaChamada.findFirst({ where: { id, ...filtro }, select: { fotos: { orderBy: { criadoEm: 'asc' }, select: { mime: true, bytes: true } } } });
    const f = a?.fotos[n];
    if (!f) throw new NotFoundException('Foto não encontrada.');
    return { dados: dataUrl(f.mime, f.bytes) };
  }

  async avariasPendentes(entregadorId: string): Promise<number> {
    return this.prisma.avariaChamada.count({ where: { entregadorId, situacao: 'AGUARDANDO' } });
  }
}


// Rotas da empresa ---------------------------------------------------------------------------

@Controller('entregas')
export class EscalaEmpresaController {
  constructor(private readonly escala: EscalaService) {}

  @Get('turnos')
  @RequerPermissao('entrega.ver')
  turnos(@EmpresaAtual() empresaId: string): Promise<TurnoResumo[]> {
    return this.escala.turnos(empresaId);
  }

  @Post('turnos')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: NovoTurnoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<TurnoResumo[]> {
    return this.escala.criarTurno(empresaId, dto, u.id);
  }

  @Post('turnos/:id/cancelar')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  cancelar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<TurnoResumo[]> {
    return this.escala.cancelarTurno(empresaId, id, u.id);
  }

  @Post('turnos/inscricoes/:id/presenca')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  presenca(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PresencaDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<TurnoResumo[]> {
    return this.escala.presenca(empresaId, id, dto.situacao, u.id);
  }

  @Post('turnos/inscricoes/:id/remover')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  remover(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<TurnoResumo[]> {
    return this.escala.removerInscrito(empresaId, id, u.id);
  }

  @Get('reputacao')
  @RequerPermissao('entrega.ver')
  reputacao(@EmpresaAtual() empresaId: string): Promise<ReputacaoEmpresa> {
    return this.escala.reputacao(empresaId);
  }

  @Get('avarias')
  @RequerPermissao('entrega.ver')
  avarias(@EmpresaAtual() empresaId: string): Promise<AvariaResumo[]> {
    return this.escala.avarias({ empresaId });
  }

  @Get('chamadas/:id/avarias')
  @RequerPermissao('entrega.ver')
  daChamada(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<AvariaResumo[]> {
    return this.escala.avarias({ empresaId, chamadaId: id });
  }

  @Post('chamadas/:id/avarias')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  registrar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NovaAvariaDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<AvariaResumo> {
    return this.escala.registrarAvaria(empresaId, id, dto, u.id);
  }

  @Post('avarias/:id/retirar')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  retirar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<AvariaResumo> {
    return this.escala.retirarAvaria(empresaId, id, u.id);
  }

  @Get('avarias/:id/fotos/:n')
  @RequerPermissao('entrega.ver')
  foto(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Param('n', ParseIntPipe) n: number): Promise<{ dados: string }> {
    return this.escala.fotoAvaria({ empresaId }, id, n);
  }
}

// Rotas do app do entregador -----------------------------------------------------------------

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador')
export class EscalaEntregadorController {
  constructor(private readonly escala: EscalaService) {}

  @Get('turnos')
  turnos(@EntregadorAtual() e: { id: string }): Promise<TurnoParaEntregador[]> {
    return this.escala.turnosDoEntregador(e.id);
  }

  @Post('turnos/:id/inscrever')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  inscrever(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<TurnoParaEntregador[]> {
    return this.escala.inscrever(e.id, id);
  }

  @Post('turnos/:id/sair')
  @HttpCode(200)
  sair(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<TurnoParaEntregador[]> {
    return this.escala.sair(e.id, id);
  }

  @Post('chamadas/:id/avaliar-empresa')
  @HttpCode(200)
  async avaliar(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AvaliarEmpresaDto): Promise<{ ok: true }> {
    await this.escala.avaliarEmpresa(e.id, id, dto);
    return { ok: true };
  }

  @Get('avarias')
  avarias(@EntregadorAtual() e: { id: string }): Promise<AvariaResumo[]> {
    return this.escala.avarias({ entregadorId: e.id });
  }

  @Post('avarias/:id/responder')
  @HttpCode(200)
  responder(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespostaAvariaDto): Promise<AvariaResumo> {
    return this.escala.responderAvaria(e.id, id, dto);
  }

  @Get('avarias/:id/fotos/:n')
  foto(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Param('n', ParseIntPipe) n: number): Promise<{ dados: string }> {
    return this.escala.fotoAvaria({ entregadorId: e.id }, id, n);
  }
}

// Super-admin --------------------------------------------------------------------------------

@ApenasSuperAdmin()
@Controller('plataforma-entregas')
export class EscalaAdminController {
  constructor(private readonly escala: EscalaService) {}

  @Get('empresas-avaliadas')
  empresas(): Promise<EmpresaAvaliada[]> {
    return this.escala.empresasAvaliadas();
  }
}
