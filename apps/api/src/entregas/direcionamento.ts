import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsObject, Max, Min, ValidateNested } from 'class-validator';
import {
  classificar,
  DIAS_MEDIA_AVALIACAO,
  distanciaMetros,
  motivoDaOferta,
  primeiroNome,
  problemaNasRegras,
  quantosOferecer,
  raioDaRodada,
  regrasVigentes,
  SEGUNDOS_POSICAO_VALIDA,
  SITUACOES_EM_ANDAMENTO,
  podePegarOutra,
  exigeTermoCustodia,
  inicioDaDistribuicao,
  VERSAO_TERMO_CUSTODIA,
  SITUACOES_FINAIS,
  textoDoMotivo,
  TIPOS_CHAMADA,
  type CandidatoDirecionamento,
  type ConfigEntregasEmpresa,
  type EntregadorDaEmpresa,
  type EventoChamada,
  type ParadaChamada,
  type Ponto,
  type RegrasDirecionamento,
  type Simulacao,
  type TipoChamada,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { Prisma } from '@prisma/client';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { EntregasEmpresaService } from './empresa';

const INTERVALO_RELOGIO_MS = 5_000;
const DIA_MS = 86_400_000;
const KM_POR_GRAU_LAT = 111.32;

class RegrasDto {
  @IsObject() regras: RegrasDirecionamento;
}

class PontoDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
}

class SimularDto {
  @IsObject() regras: RegrasDirecionamento;
  @ValidateNested() @Type(() => PontoDto) ponto: PontoDto;
  @IsIn(TIPOS_CHAMADA) tipo: TipoChamada;
}

class MarcaEntregadorDto {
  @IsBoolean() preferido: boolean;
  @IsBoolean() bloqueado: boolean;
}

type Cliente = Prisma.TransactionClient | PrismaService;

const evento = (texto: string): EventoChamada => ({ em: new Date().toISOString(), texto, por: 'sistema' });

/**
 * Direcionamento automático (docs/ENTREGAS.md): quem pode receber, em que ordem e como oferecer.
 * As regras são puras (shared/entregas-direcionamento.ts); aqui se juntam os dados e se grava o porquê.
 */
@Injectable()
export class DirecionamentoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Direcionamento');
  private relogio?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly empresas: EntregasEmpresaService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.rodar(), INTERVALO_RELOGIO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  // Regras ---------------------------------------------------------------------------------------

  async salvarRegras(empresaId: string, recebidas: unknown, autorId: string): Promise<ConfigEntregasEmpresa> {
    const regras = this.validar(recebidas);
    await this.prisma.configuracaoEntregas.upsert({ where: { empresaId }, create: { empresaId, direcionamento: regras as never }, update: { direcionamento: regras as never } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entregas.direcionamento', entidade: 'ConfiguracaoEntregas', entidadeId: empresaId, detalhes: regras as never });
    return this.empresas.config(empresaId);
  }

  private validar(recebidas: unknown): RegrasDirecionamento {
    const regras = regrasVigentes(recebidas);
    const problema = problemaNasRegras(regras);
    if (problema) throw new BadRequestException(problema);
    return regras;
  }

  // Candidatos -----------------------------------------------------------------------------------

  /**
   * Quem passa nos filtros que o banco resolve: aprovado, online, com posição recente, sem chamada
   * nem oferta esperando, perto da coleta. O resto (raio exato, veículo, bloqueio, preferidos) é do `classificar`.
   */
  async candidatos(empresaId: string, origem: Ponto, raioMaxKm: number, chamadaId: string | null, tx: Cliente = this.prisma, agora = new Date()): Promise<CandidatoDirecionamento[]> {
    const dLat = raioMaxKm / KM_POR_GRAU_LAT;
    const dLon = raioMaxKm / (KM_POR_GRAU_LAT * Math.max(0.01, Math.cos((origem.lat * Math.PI) / 180)));
    // Chamada de máquina: só quem aceitou o termo de custódia vigente.
    const daChamada = chamadaId ? await tx.chamadaEntrega.findUnique({ where: { id: chamadaId }, select: { tipo: true, serieEsperada: true } }) : null;
    const exigeTermo = !!daChamada && exigeTermoCustodia(daChamada.tipo as TipoChamada, daChamada.serieEsperada);
    let lista = await tx.entregador.findMany({
      where: {
        situacao: 'APROVADO',
        ...(exigeTermo ? { termoCustodiaVersao: { gte: VERSAO_TERMO_CUSTODIA } } : {}),
        online: true,
        posicaoEm: { gte: new Date(agora.getTime() - SEGUNDOS_POSICAO_VALIDA * 1000) },
        lat: { gte: origem.lat - dLat, lte: origem.lat + dLat },
        lon: { gte: origem.lon - dLon, lte: origem.lon + dLon },
        // Ocupado só com chamadas desta empresa (que pode permitir mais de uma); o limite é conferido abaixo.
        chamadas: { none: { situacao: { in: [...SITUACOES_EM_ANDAMENTO] }, empresaId: { not: empresaId } } },
        ofertas: { none: { resultado: 'PENDENTE' } },
      },
      select: {
        id: true,
        nome: true,
        veiculo: true,
        lat: true,
        lon: true,
        onlineDesde: true,
        empresas: { where: { empresaId }, select: { preferido: true, bloqueado: true } },
        chamadas: { where: { situacao: { in: [...SITUACOES_FINAIS] } }, orderBy: { atualizadoEm: 'desc' }, take: 1, select: { atualizadoEm: true } },
        ...(chamadaId ? { ofertas: { where: { chamadaId, resultado: { in: ['RECUSADA', 'EXPIRADA', 'ACEITA', 'DESISTIU'] } }, select: { id: true }, take: 1 } } : {}),
      },
      take: 500,
    });
    const limite = (await tx.configuracaoEntregas.findUnique({ where: { empresaId }, select: { chamadasSimultaneas: true } }))?.chamadasSimultaneas ?? 1;
    const ativas = await tx.chamadaEntrega.findMany({ where: { entregadorId: { in: lista.map((e) => e.id) }, situacao: { in: [...SITUACOES_EM_ANDAMENTO] } }, select: { entregadorId: true, empresaId: true } });
    lista = lista.filter((e) => podePegarOutra(ativas.filter((a) => a.entregadorId === e.id), empresaId, limite));
    if (!lista.length) return [];
    // Aceite dos últimos 30 dias: canceladas (a empresa desistiu, outro do grupo aceitou) não contam.
    const respostas = await tx.ofertaChamada.groupBy({
      by: ['entregadorId', 'resultado'],
      where: { entregadorId: { in: lista.map((e) => e.id) }, criadoEm: { gte: new Date(agora.getTime() - 30 * DIA_MS) }, resultado: { in: ['ACEITA', 'RECUSADA', 'EXPIRADA', 'DESISTIU'] } },
      _count: { _all: true },
    });
    // Avaliação: média dos últimos 90 dias, de todas as empresas.
    const notas = await tx.chamadaEntrega.groupBy({ by: ['entregadorId'], where: { entregadorId: { in: lista.map((e) => e.id) }, avaliadaEm: { gte: new Date(agora.getTime() - DIAS_MEDIA_AVALIACAO * DIA_MS) } }, _avg: { avaliacaoNota: true } });
    const media = new Map(notas.map((n) => [n.entregadorId, n._avg.avaliacaoNota]));
    // Escala: inscritos num turno desta empresa que vale agora.
    const noTurno = new Set(
      (
        await tx.inscricaoTurno.findMany({
          where: { entregadorId: { in: lista.map((e) => e.id) }, situacao: 'INSCRITO', turno: { empresaId, canceladoEm: null, inicio: { lte: agora }, fim: { gt: agora } } },
          select: { entregadorId: true },
        })
      ).map((x) => x.entregadorId),
    );
    const ofertadas = new Map<string, number>();
    const aceitas = new Map<string, number>();
    for (const r of respostas) {
      ofertadas.set(r.entregadorId, (ofertadas.get(r.entregadorId) ?? 0) + r._count._all);
      if (r.resultado === 'ACEITA') aceitas.set(r.entregadorId, r._count._all);
    }
    return lista.map((e) => {
      const marca = e.empresas[0];
      const ultima = e.chamadas[0]?.atualizadoEm;
      const livreDesde = Math.max(ultima?.getTime() ?? 0, e.onlineDesde?.getTime() ?? agora.getTime());
      return {
        id: e.id,
        nome: primeiroNome(e.nome),
        veiculo: e.veiculo as TipoVeiculo,
        metrosAteColeta: Math.round(distanciaMetros(origem, { lat: e.lat!, lon: e.lon! })),
        minutosLivre: Math.max(0, (agora.getTime() - livreDesde) / 60_000),
        ofertadas30d: ofertadas.get(e.id) ?? 0,
        aceitas30d: aceitas.get(e.id) ?? 0,
        avaliacao: media.get(e.id) ?? null,
        preferido: !!marca?.preferido,
        bloqueado: !!marca?.bloqueado,
        emTurno: noTurno.has(e.id),
        jaOfertado: 'ofertas' in e && Array.isArray(e.ofertas) && e.ofertas.length > 0,
      };
    });
  }

  /** Com as regras que a empresa está editando, quem receberia agora uma chamada que começa neste ponto. */
  async simular(empresaId: string, dto: SimularDto): Promise<Simulacao> {
    const regras = this.validar(dto.regras);
    const lista = await this.candidatos(empresaId, dto.ponto, regras.raioLimiteKm, null);
    const r = classificar(lista, regras, dto.tipo, regras.raioKm);
    return { ...r, classificados: r.classificados.slice(0, 20), descartados: r.descartados.slice(0, 20), regras };
  }

  // Distribuição ---------------------------------------------------------------------------------

  /** Liga (ou religa do começo) a distribuição de uma chamada aberta e já faz a primeira oferta. */
  async ligar(empresaId: string, chamadaId: string, autorId: string | null): Promise<void> {
    const agora = new Date();
    const atual = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId }, select: { agendadaPara: true } });
    // Agendada: a distribuição só começa um pouco antes da hora da coleta.
    const inicio = atual?.agendadaPara ? new Date(Math.max(agora.getTime(), inicioDaDistribuicao(atual.agendadaPara).getTime())) : agora;
    const { count } = await this.prisma.chamadaEntrega.updateMany({
      where: { id: chamadaId, empresaId, situacao: 'ABERTA' },
      data: { distribuicaoAtiva: true, rodada: 0, tentativas: 0, proximaTentativaEm: inicio, semEntregadorEm: null },
    });
    if (!count) throw new ConflictException('A chamada não está aguardando entregador.');
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: config().fusoHorario, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(inicio);
    await this.registrar(chamadaId, evento(inicio > agora ? `Distribuição automática ligada: começa em ${hora}.` : 'Distribuição automática ligada.'));
    if (autorId) await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.distribuir', entidade: 'ChamadaEntrega', entidadeId: chamadaId });
    if (inicio <= agora) await this.passo(chamadaId);
  }

  async parar(empresaId: string, chamadaId: string, autorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chamadaEntrega.updateMany({ where: { id: chamadaId, empresaId, distribuicaoAtiva: true }, data: { distribuicaoAtiva: false, proximaTentativaEm: null } });
      if (!count) throw new ConflictException('A distribuição automática não está ligada.');
      await tx.ofertaChamada.updateMany({ where: { chamadaId, resultado: 'PENDENTE', motivo: { not: Prisma.DbNull } }, data: { resultado: 'CANCELADA', respondidaEm: new Date() } });
      await this.registrar(chamadaId, { ...evento('Distribuição automática parada pela empresa.'), por: 'empresa' }, tx);
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.parar_distribuicao', entidade: 'ChamadaEntrega', entidadeId: chamadaId }, tx);
    });
  }

  /** Relógio: chamadas em distribuição, sem oferta esperando e na hora de tentar. */
  async rodar(agora = new Date()): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const prontas = await this.prisma.chamadaEntrega.findMany({
        where: { distribuicaoAtiva: true, situacao: 'ABERTA', proximaTentativaEm: { lte: agora }, ofertas: { none: { resultado: 'PENDENTE' } } },
        orderBy: { proximaTentativaEm: 'asc' },
        select: { id: true },
        take: 50,
      });
      for (const c of prontas) {
        await this.passo(c.id, agora).catch((e) => this.log.error(`Distribuição da chamada ${c.id}: ${(e as Error).message}`));
      }
      return prontas.length;
    } catch (e) {
      this.log.error(`Falha no relógio da distribuição: ${(e as Error).message}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Um passo: oferece aos próximos da lista ou, sem ninguém (ou com as tentativas da rodada
   * esgotadas), espera `minutosNovaTentativa` e passa para a próxima rodada, com o raio maior.
   */
  async passo(chamadaId: string, agora = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Prende a chamada: relógio e aceite não andam juntos sobre ela.
      const [c] = await tx.$queryRaw<{ empresa_id: string; situacao: string; tipo: string; origem: ParadaChamada; distribuicao_ativa: boolean; rodada: number; tentativas: number; sem_entregador_em: Date | null; agendada_para: Date | null }[]>`
        SELECT empresa_id, situacao, tipo, origem, distribuicao_ativa, rodada, tentativas, sem_entregador_em, agendada_para FROM chamadas_entrega WHERE id = ${chamadaId}::uuid FOR UPDATE`;
      if (!c || c.situacao !== 'ABERTA' || !c.distribuicao_ativa) return;
      // Agendada (inclusive reaberta antes da hora): espera o início da distribuição.
      if (c.agendada_para && agora < inicioDaDistribuicao(c.agendada_para)) {
        await tx.chamadaEntrega.update({ where: { id: chamadaId }, data: { proximaTentativaEm: inicioDaDistribuicao(c.agendada_para) } });
        return;
      }
      if (await tx.ofertaChamada.count({ where: { chamadaId, resultado: 'PENDENTE' } })) return;
      const cfg = await this.empresas.config(c.empresa_id);
      const regras = cfg.direcionamento;
      const raio = raioDaRodada(regras, c.rodada);
      const tipo = c.tipo as TipoChamada;

      const escolhidos =
        c.tentativas < regras.maxTentativas ? classificar(await this.candidatos(c.empresa_id, c.origem, raio, chamadaId, tx, agora), regras, tipo, raio).classificados.slice(0, quantosOferecer(regras)) : [];

      if (!escolhidos.length) {
        const novoRaio = raioDaRodada(regras, c.rodada + 1);
        await tx.chamadaEntrega.update({
          where: { id: chamadaId },
          data: { rodada: { increment: 1 }, tentativas: 0, proximaTentativaEm: new Date(agora.getTime() + regras.minutosNovaTentativa * 60_000), semEntregadorEm: c.sem_entregador_em ?? agora },
        });
        // Uma linha por mudança, não uma a cada 2 minutos.
        if (!c.sem_entregador_em || novoRaio !== raio) {
          const quem = c.tentativas > 0 ? 'Ninguém aceitou' : 'Ninguém disponível';
          const depois = novoRaio > raio ? ` com raio de ${novoRaio} km` : '';
          await this.registrar(chamadaId, evento(`${quem} em até ${raio} km. Nova tentativa a cada ${regras.minutosNovaTentativa} min${depois}.`), tx);
        }
        return;
      }

      const expiraEm = new Date(agora.getTime() + cfg.segundosParaAceitar * 1000);
      for (const e of escolhidos) {
        await tx.ofertaChamada.create({ data: { chamadaId, entregadorId: e.id, metrosAteColeta: e.metrosAteColeta, expiraEm, motivo: motivoDaOferta(e, regras, c.rodada, raio) as never } });
      }
      await tx.chamadaEntrega.update({ where: { id: chamadaId }, data: { tentativas: { increment: 1 }, proximaTentativaEm: expiraEm } });
      const textos = escolhidos.map((e) => `${e.nome} (${textoDoMotivo(motivoDaOferta(e, regras, c.rodada, raio))})`);
      await this.registrar(chamadaId, evento(`Oferecida automaticamente a ${textos.join('; ')}.`), tx);
    });
  }

  private async registrar(id: string, e: EventoChamada, tx: Cliente = this.prisma) {
    await tx.$executeRaw`UPDATE chamadas_entrega SET historico = historico || ${JSON.stringify([e])}::jsonb WHERE id = ${id}::uuid`;
  }

  // Preferidos e bloqueados ----------------------------------------------------------------------

  /** Quem já atendeu ou recebeu oferta da empresa, e quem ela marcou. */
  async entregadoresDaEmpresa(empresaId: string): Promise<EntregadorDaEmpresa[]> {
    const lista = await this.prisma.entregador.findMany({
      where: { OR: [{ empresas: { some: { empresaId } } }, { chamadas: { some: { empresaId } } }, { ofertas: { some: { chamada: { empresaId } } } }] },
      select: {
        id: true,
        nome: true,
        veiculo: true,
        placa: true,
        empresas: { where: { empresaId }, select: { preferido: true, bloqueado: true } },
        chamadas: { where: { empresaId }, orderBy: { criadoEm: 'desc' }, take: 1, select: { criadoEm: true } },
        _count: { select: { chamadas: { where: { empresaId, situacao: 'CONCLUIDA' } } } },
      },
      take: 300,
    });
    const notas = await this.prisma.chamadaEntrega.groupBy({ by: ['entregadorId'], where: { entregadorId: { in: lista.map((e) => e.id) }, avaliadaEm: { gte: new Date(Date.now() - DIAS_MEDIA_AVALIACAO * DIA_MS) } }, _avg: { avaliacaoNota: true } });
    const media = new Map(notas.map((n) => [n.entregadorId, n._avg.avaliacaoNota]));
    return lista
      .map((e) => ({
        id: e.id,
        nome: `${primeiroNome(e.nome)}${e.placa ? ` (${e.placa})` : ''}`,
        veiculo: e.veiculo as TipoVeiculo,
        preferido: !!e.empresas[0]?.preferido,
        bloqueado: !!e.empresas[0]?.bloqueado,
        concluidas: e._count.chamadas,
        ultimaEm: e.chamadas[0]?.criadoEm.toISOString() ?? null,
        avaliacaoMedia: media.get(e.id) != null ? Math.round(media.get(e.id)! * 10) / 10 : null,
      }))
      .sort((a, b) => Number(b.preferido) - Number(a.preferido) || b.concluidas - a.concluidas || a.nome.localeCompare(b.nome));
  }

  async marcar(empresaId: string, entregadorId: string, dto: MarcaEntregadorDto, autorId: string): Promise<EntregadorDaEmpresa[]> {
    if (dto.preferido && dto.bloqueado) throw new BadRequestException('Um entregador não pode ser preferido e bloqueado ao mesmo tempo.');
    const existe = await this.prisma.entregador.count({ where: { id: entregadorId } });
    if (!existe) throw new NotFoundException('Entregador não encontrado.');
    await this.prisma.$transaction(async (tx) => {
      await tx.entregadorEmpresa.upsert({ where: { empresaId_entregadorId: { empresaId, entregadorId } }, create: { empresaId, entregadorId, ...dto }, update: dto });
      // Bloqueado: a oferta que ele tem desta empresa deixa de valer.
      if (dto.bloqueado) await tx.ofertaChamada.updateMany({ where: { entregadorId, resultado: 'PENDENTE', chamada: { empresaId } }, data: { resultado: 'CANCELADA', respondidaEm: new Date() } });
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entregas.entregador.marcar', entidade: 'Entregador', entidadeId: entregadorId, detalhes: { ...dto } }, tx);
    });
    return this.entregadoresDaEmpresa(empresaId);
  }
}

@Controller('entregas')
export class DirecionamentoController {
  constructor(private readonly direcionamento: DirecionamentoService) {}

  @Put('direcionamento')
  @RequerPermissao('entrega.configurar')
  salvar(@EmpresaAtual() empresaId: string, @Body() dto: RegrasDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ConfigEntregasEmpresa> {
    return this.direcionamento.salvarRegras(empresaId, dto.regras, u.id);
  }

  @Post('direcionamento/simular')
  @HttpCode(200)
  @RequerPermissao('entrega.configurar')
  simular(@EmpresaAtual() empresaId: string, @Body() dto: SimularDto): Promise<Simulacao> {
    return this.direcionamento.simular(empresaId, dto);
  }

  @Get('entregadores')
  @RequerPermissao('entrega.ver')
  entregadores(@EmpresaAtual() empresaId: string): Promise<EntregadorDaEmpresa[]> {
    return this.direcionamento.entregadoresDaEmpresa(empresaId);
  }

  @Put('entregadores/:id')
  @RequerPermissao('entrega.configurar')
  marcar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarcaEntregadorDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<EntregadorDaEmpresa[]> {
    return this.direcionamento.marcar(empresaId, id, dto, u.id);
  }
}
