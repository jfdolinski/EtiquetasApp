import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  contaNaMeta,
  DIAS_META_ENCERRADA_NO_APP,
  formatarCentavos,
  primeiroNome,
  problemaNaMeta,
  situacaoDaMeta,
  textoDaFaixa,
  turnoPerto,
  type FaixaMeta,
  type MetaParaEntregador,
  type MetaResumo,
} from '@etiquetas/shared';
import { Publico, EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { EntregadorAtual, EntregadorGuard } from './guarda';

const DIA_MS = 86_400_000;
const INTERVALO_APURACAO_MS = 15_000;

class FaixaDto {
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) dias: number[];
  @IsString() @Matches(/^\d\d:\d\d$/, { message: 'Use horas no formato 11:00.' }) inicio: string;
  @IsString() @Matches(/^\d\d:\d\d$/, { message: 'Use horas no formato 11:00.' }) fim: string;
}

class NovaMetaDto {
  @IsString() @MaxLength(80) nome: string;
  @IsISO8601({}, { message: 'Início inválido.' }) inicio: string;
  @IsISO8601({}, { message: 'Fim inválido.' }) fim: string;
  @IsInt() @Min(1) @Max(500) minimoChamadas: number;
  @IsInt() @Min(0) @Max(200_000) valorCentavos: number;
  @IsOptional() @ValidateNested() @Type(() => FaixaDto) faixa: FaixaDto | null;
}

type MetaDoBanco = { id: string; empresaId: string; nome: string; inicio: Date; fim: Date; minimoChamadas: number; valorCentavos: number; faixa: unknown; canceladaEm: Date | null; apuradaEm: Date | null };

/**
 * Entregas, etapa 14: metas com bônus. Contam as chamadas CONCLUÍDAS da empresa no período (e no
 * horário de pico, se houver). Quando a meta acaba, o relógio apura uma vez e lança o bônus (BONUS em
 * `lancamentos_entrega`, um por meta e entregador) para quem chegou lá; entra no próximo pagamento.
 */
@Injectable()
export class MetasService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Metas');
  private relogio?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.apurarVencidas(), INTERVALO_APURACAO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  /** Quantas chamadas cada entregador fez que contam em cada meta (mesma empresa). */
  private async contagens(empresaId: string, metas: MetaDoBanco[], entregadorId?: string): Promise<Map<string, Map<string, number>>> {
    const resultado = new Map<string, Map<string, number>>(metas.map((m) => [m.id, new Map()]));
    if (!metas.length) return resultado;
    const de = new Date(Math.min(...metas.map((m) => m.inicio.getTime())));
    const ate = new Date(Math.max(...metas.map((m) => m.fim.getTime())));
    const feitas = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, situacao: 'CONCLUIDA', entregadorId: entregadorId ?? { not: null }, concluidaEm: { gte: de, lt: ate } },
      select: { entregadorId: true, concluidaEm: true },
    });
    const fuso = config().fusoHorario;
    for (const m of metas) {
      const mapa = resultado.get(m.id)!;
      const regra = { inicio: m.inicio, fim: m.fim, faixa: (m.faixa as FaixaMeta | null) ?? null };
      for (const c of feitas) if (contaNaMeta(c.concluidaEm!, regra, fuso)) mapa.set(c.entregadorId!, (mapa.get(c.entregadorId!) ?? 0) + 1);
    }
    return resultado;
  }

  async listar(empresaId: string, agora = new Date()): Promise<MetaResumo[]> {
    const metas = await this.prisma.metaEntrega.findMany({ where: { empresaId, fim: { gte: new Date(agora.getTime() - 60 * DIA_MS) } }, orderBy: { inicio: 'desc' }, take: 100 });
    const contagens = await this.contagens(empresaId, metas);
    const ids = [...new Set([...contagens.values()].flatMap((m) => [...m.keys()]))];
    const [nomes, lancados] = await Promise.all([
      this.prisma.entregador.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }),
      this.prisma.lancamentoEntrega.findMany({ where: { metaId: { in: metas.map((m) => m.id) } }, select: { metaId: true, entregadorId: true, fechamentoId: true } }),
    ]);
    const nome = new Map(nomes.map((n) => [n.id, primeiroNome(n.nome)]));
    return metas.map((m) => ({
      id: m.id,
      nome: m.nome,
      inicio: m.inicio.toISOString(),
      fim: m.fim.toISOString(),
      minimoChamadas: m.minimoChamadas,
      valorCentavos: m.valorCentavos,
      faixa: (m.faixa as FaixaMeta | null) ?? null,
      situacao: situacaoDaMeta(m, agora),
      apuradaEm: m.apuradaEm?.toISOString() ?? null,
      participantes: [...contagens.get(m.id)!.entries()]
        .map(([entregadorId, feitas]) => ({ entregadorId, nome: nome.get(entregadorId) ?? '-', feitas, atingida: feitas >= m.minimoChamadas, pago: !!lancados.find((l) => l.metaId === m.id && l.entregadorId === entregadorId)?.fechamentoId }))
        .sort((a, b) => b.feitas - a.feitas || a.nome.localeCompare(b.nome)),
    }));
  }

  async criar(empresaId: string, dto: NovaMetaDto, autorId: string): Promise<MetaResumo[]> {
    const faixa = dto.faixa ? { dias: [...new Set(dto.faixa.dias)].sort(), inicio: dto.faixa.inicio, fim: dto.faixa.fim } : null;
    const problema = problemaNaMeta({ ...dto, faixa }, new Date());
    if (problema) throw new BadRequestException(problema);
    const m = await this.prisma.metaEntrega.create({ data: { empresaId, nome: dto.nome.trim(), inicio: new Date(dto.inicio), fim: new Date(dto.fim), minimoChamadas: dto.minimoChamadas, valorCentavos: dto.valorCentavos, faixa: (faixa ?? undefined) as never, criadoPorId: autorId } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.meta.criar', entidade: 'MetaEntrega', entidadeId: m.id, detalhes: { nome: m.nome, inicio: dto.inicio, fim: dto.fim, minimoChamadas: dto.minimoChamadas, valorCentavos: dto.valorCentavos, faixa } as never });
    return this.listar(empresaId);
  }

  /** Só antes de acabar: depois, o bônus já foi (ou vai ser) lançado. */
  async cancelar(empresaId: string, id: string, autorId: string): Promise<MetaResumo[]> {
    const m = await this.prisma.metaEntrega.findFirst({ where: { id, empresaId }, select: { fim: true, canceladaEm: true } });
    if (!m) throw new NotFoundException('Meta não encontrada.');
    if (m.canceladaEm) throw new ConflictException('A meta já está cancelada.');
    const { count } = await this.prisma.metaEntrega.updateMany({ where: { id, empresaId, canceladaEm: null, apuradaEm: null, fim: { gt: new Date() } }, data: { canceladaEm: new Date() } });
    if (!count) throw new ConflictException('A meta já terminou: o bônus de quem chegou lá vai para o Financeiro.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.meta.cancelar', entidade: 'MetaEntrega', entidadeId: id });
    return this.listar(empresaId);
  }

  /** Relógio: cada meta encerrada é apurada uma vez (reivindicada por `apuradaEm`). */
  async apurarVencidas(agora = new Date()): Promise<number> {
    try {
      const vencidas = await this.prisma.metaEntrega.findMany({ where: { apuradaEm: null, canceladaEm: null, fim: { lte: agora } }, take: 20 });
      let lancados = 0;
      for (const m of vencidas) {
        const contagem = (await this.contagens(m.empresaId, [m])).get(m.id)!;
        const ganhadores = [...contagem.entries()].filter(([, n]) => n >= m.minimoChamadas);
        await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.metaEntrega.updateMany({ where: { id: m.id, apuradaEm: null, canceladaEm: null }, data: { apuradaEm: agora } });
          if (!count) return;
          if (ganhadores.length) {
            await tx.lancamentoEntrega.createMany({
              data: ganhadores.map(([entregadorId, n]) => ({ empresaId: m.empresaId, entregadorId, tipo: 'BONUS', descricao: `Bônus da meta "${m.nome}" (${n} chamadas)`, valorCentavos: m.valorCentavos, metaId: m.id })),
              skipDuplicates: true,
            });
          }
          await this.auditoria.registrar({ empresaId: m.empresaId, usuarioId: null, acao: 'entrega.meta.apurar', entidade: 'MetaEntrega', entidadeId: m.id, detalhes: { ganhadores: ganhadores.length, totalCentavos: ganhadores.length * m.valorCentavos } }, tx);
          lancados += ganhadores.length;
        });
        if (ganhadores.length) this.log.log(`Meta ${m.id}: ${ganhadores.length} bônus de ${formatarCentavos(m.valorCentavos)}.`);
      }
      return lancados;
    } catch (e) {
      this.log.error(`Falha ao apurar metas: ${(e as Error).message}`);
      return 0;
    }
  }

  /** As metas valendo (e as encerradas há pouco) das empresas por perto ou em que ele já trabalhou no período. */
  async doEntregador(entregadorId: string, agora = new Date()): Promise<MetaParaEntregador[]> {
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id: entregadorId }, select: { lat: true, lon: true, empresas: { where: { bloqueado: true }, select: { empresaId: true } } } });
    const bloqueado = new Set(e.empresas.map((x) => x.empresaId));
    const metas = await this.prisma.metaEntrega.findMany({
      where: { canceladaEm: null, inicio: { lte: new Date(agora.getTime() + 14 * DIA_MS) }, fim: { gte: new Date(agora.getTime() - DIAS_META_ENCERRADA_NO_APP * DIA_MS) } },
      orderBy: { fim: 'asc' },
      take: 200,
      include: { empresa: { select: { nomeFantasia: true, razaoSocial: true, configuracaoEntregas: { select: { baseLat: true, baseLon: true } } } } },
    });
    const posicao = e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null;
    const porEmpresa = new Map<string, typeof metas>();
    for (const m of metas) if (!bloqueado.has(m.empresaId)) porEmpresa.set(m.empresaId, [...(porEmpresa.get(m.empresaId) ?? []), m]);
    const ganhos = new Set((await this.prisma.lancamentoEntrega.findMany({ where: { entregadorId, metaId: { in: metas.map((m) => m.id) } }, select: { metaId: true } })).map((l) => l.metaId));
    const saida: MetaParaEntregador[] = [];
    for (const [empresaId, lista] of porEmpresa) {
      const contagens = await this.contagens(empresaId, lista, entregadorId);
      for (const m of lista) {
        const feitas = contagens.get(m.id)!.get(entregadorId) ?? 0;
        const cfg = m.empresa.configuracaoEntregas;
        const base = cfg?.baseLat != null && cfg.baseLon != null ? { lat: cfg.baseLat, lon: cfg.baseLon } : null;
        if (!feitas && !turnoPerto(base, posicao).perto) continue;
        saida.push({
          id: m.id,
          empresa: m.empresa.nomeFantasia || m.empresa.razaoSocial,
          nome: m.nome,
          inicio: m.inicio.toISOString(),
          fim: m.fim.toISOString(),
          minimoChamadas: m.minimoChamadas,
          valorCentavos: m.valorCentavos,
          faixa: textoDaFaixa((m.faixa as FaixaMeta | null) ?? null),
          situacao: situacaoDaMeta(m, agora),
          feitas,
          atingida: feitas >= m.minimoChamadas,
          ganhou: ganhos.has(m.id),
        });
      }
    }
    return saida.sort((a, b) => Number(a.situacao === 'ENCERRADA') - Number(b.situacao === 'ENCERRADA') || a.fim.localeCompare(b.fim));
  }
}

@Controller('entregas/metas')
export class MetasEmpresaController {
  constructor(private readonly metas: MetasService) {}

  @Get()
  @RequerPermissao('entrega.ver')
  listar(@EmpresaAtual() empresaId: string): Promise<MetaResumo[]> {
    return this.metas.listar(empresaId);
  }

  @Post()
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: NovaMetaDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<MetaResumo[]> {
    return this.metas.criar(empresaId, dto, u.id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  cancelar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<MetaResumo[]> {
    return this.metas.cancelar(empresaId, id, u.id);
  }
}

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador/metas')
export class MetasEntregadorController {
  constructor(private readonly metas: MetasService) {}

  @Get()
  listar(@EntregadorAtual() e: { id: string }): Promise<MetaParaEntregador[]> {
    return this.metas.doEntregador(e.id);
  }
}
