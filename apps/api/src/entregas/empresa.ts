import { BadRequestException, Body, Controller, Get, Injectable, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import {
  coordenadaValida,
  distanciaMetros,
  posicaoAproximada,
  primeiroNome,
  RAIO_ATENDIMENTO_MAXIMO_KM,
  RAIO_ATENDIMENTO_PADRAO_KM,
  LIMITES_SEGUNDOS_PARA_ACEITAR,
  problemaNaTabelaPrecos,
  SEGUNDOS_PARA_ACEITAR_PADRAO,
  SITUACOES_EM_ANDAMENTO,
  TABELA_PRECOS_PADRAO,
  SITUACOES_EM_CUSTODIA,
  type MaquinaEmCustodia,
  type SituacaoChamada,
  ADICIONAIS_VAZIOS,
  adicionaisVigentes,
  gradeDeDemanda,
  momentoNoFuso,
  pontoDoCliente,
  problemaNosAdicionais,
  type Adicionais,
  type DemandaEntregas,
  type ParadaChamada,
  type TipoChamada,
  REGRAS_DIRECIONAMENTO_PADRAO,
  regrasVigentes,
  type TabelaPrecos,
  situacaoNoMapa,
  type ConfigEntregasEmpresa,
  type ConfigMapa,
  type MapaEntregas,
  type ResultadoEndereco,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { EmpresaAtual, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { MapasService } from './mapas';

class BaseDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsString() @MaxLength(300) endereco: string;
}

class PrecoTipoDto {
  @IsInt() @Min(0) baseCentavos: number;
  @IsInt() @Min(0) porKmCentavos: number;
  @IsNumber() @Min(0) kmIncluso: number;
  @IsOptional() @IsInt() @Min(0) porParadaCentavos?: number;
  @IsOptional() @IsInt() @Min(0) taxaCancelamentoCentavos?: number;
  @IsOptional() @IsInt() @Min(0) esperaToleranciaMinutos?: number;
  @IsOptional() @IsInt() @Min(0) esperaPorBlocoCentavos?: number;
}

class TabelaPrecosDto {
  @ValidateNested() @Type(() => PrecoTipoDto) ENTREGA: PrecoTipoDto;
  @ValidateNested() @Type(() => PrecoTipoDto) COLETA: PrecoTipoDto;
  @ValidateNested() @Type(() => PrecoTipoDto) DEVOLUCAO_MAQUINA: PrecoTipoDto;
}

class FotosDto {
  @IsBoolean() coleta: boolean;
  @IsBoolean() entrega: boolean;
}

class ConfigEntregasDto {
  @IsOptional() @ValidateNested() @Type(() => TabelaPrecosDto) precos?: TabelaPrecos;
  @IsOptional() @IsInt() @Min(LIMITES_SEGUNDOS_PARA_ACEITAR.minimo) @Max(LIMITES_SEGUNDOS_PARA_ACEITAR.maximo) segundosParaAceitar?: number;
  @IsOptional() @ValidateNested() @Type(() => BaseDto) base: BaseDto | null;
  @IsOptional() @IsBoolean() chamarAoAceitarPedido?: boolean;
  @IsOptional() @IsObject() adicionais?: Adicionais;
  @IsOptional() @ValidateNested() @Type(() => FotosDto) fotos?: FotosDto;
  @IsInt() @Min(1, { message: 'O raio vai de 1 a 100 km.' }) @Max(RAIO_ATENDIMENTO_MAXIMO_KM, { message: 'O raio vai de 1 a 100 km.' }) raioAtendimentoKm: number;
}

class BuscaEnderecoDto {
  @IsString() @MinLength(4, { message: 'Digite mais do endereço.' }) @MaxLength(200) q: string;
}

const KM_POR_GRAU_LAT = 111.32;

class DemandaDto {
  @IsOptional() @IsIn(['7', '30', '90']) dias?: string;
}

/** Só os campos conhecidos de cada adicional (o corpo é JSON livre). */
function adicionaisLimpos(a: Adicionais): Adicionais {
  const v = adicionaisVigentes(a);
  const base = (x: { nome?: unknown; percentual?: unknown; fixoCentavos?: unknown }) => ({ nome: String(x.nome ?? '').trim().slice(0, 40), percentual: Number(x.percentual), fixoCentavos: Number(x.fixoCentavos) });
  return {
    horarios: v.horarios.map((h) => ({ ...base(h), dias: Array.isArray(h.dias) ? [...new Set(h.dias.map(Number))].sort() : [], inicio: String(h.inicio ?? ''), fim: String(h.fim ?? '') })),
    regioes: v.regioes.map((r) => ({ ...base(r), centro: { lat: Number(r.centro?.lat), lon: Number(r.centro?.lon) }, raioKm: Number(r.raioKm) })),
  };
}

/** O que a empresa vê das entregas: o ponto de partida dela e os entregadores online por perto. */
@Injectable()
export class EntregasEmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly mapas: MapasService,
  ) {}

  /** Tabela do super-admin (Entregadores > Parâmetros) ou, sem ela, a do código. */
  async tabelaPadrao(): Promise<TabelaPrecos> {
    const p = await this.prisma.parametrosEntregas.findUnique({ where: { id: 1 }, select: { tabelaPadrao: true } });
    return { ...TABELA_PRECOS_PADRAO, ...((p?.tabelaPadrao as Partial<TabelaPrecos> | null) ?? {}) };
  }

  async valorMinimo(): Promise<number> {
    const p = await this.prisma.parametrosEntregas.findUnique({ where: { id: 1 }, select: { valorMinimoCentavos: true } });
    return p?.valorMinimoCentavos ?? 0;
  }

  async config(empresaId: string): Promise<ConfigEntregasEmpresa> {
    const [c, padrao] = await Promise.all([this.prisma.configuracaoEntregas.findUnique({ where: { empresaId } }), this.tabelaPadrao()]);
    if (!c) return { base: null, raioAtendimentoKm: RAIO_ATENDIMENTO_PADRAO_KM, precos: padrao, segundosParaAceitar: SEGUNDOS_PARA_ACEITAR_PADRAO, direcionamento: REGRAS_DIRECIONAMENTO_PADRAO, chamarAoAceitarPedido: false, adicionais: ADICIONAIS_VAZIOS, fotos: { coleta: false, entrega: false } };
    const base = c.baseLat !== null && c.baseLon !== null ? { lat: c.baseLat, lon: c.baseLon, endereco: c.baseEndereco } : null;
    // Tipo novo sem preço na tabela gravada fica com o padrão.
    const precos = { ...padrao, ...((c.precos as Partial<TabelaPrecos> | null) ?? {}) };
    return { base, raioAtendimentoKm: c.raioAtendimentoKm, precos, segundosParaAceitar: c.segundosParaAceitar, direcionamento: regrasVigentes(c.direcionamento), chamarAoAceitarPedido: c.chamarAoAceitarPedido, adicionais: adicionaisVigentes(c.adicionais), fotos: { coleta: c.fotoColeta, entrega: c.fotoEntrega } };
  }

  async salvar(empresaId: string, dto: ConfigEntregasDto, autorId: string): Promise<ConfigEntregasEmpresa> {
    if (dto.base && !coordenadaValida(dto.base)) throw new BadRequestException('Ponto inválido.');
    if (dto.precos) {
      const problema = problemaNaTabelaPrecos(dto.precos);
      if (problema) throw new BadRequestException(problema);
    }
    const adicionais = dto.adicionais ? adicionaisLimpos(dto.adicionais) : null;
    if (adicionais) {
      const problema = problemaNosAdicionais(adicionais);
      if (problema) throw new BadRequestException(problema);
    }
    const data = {
      baseLat: dto.base?.lat ?? null,
      baseLon: dto.base?.lon ?? null,
      baseEndereco: dto.base?.endereco.trim() ?? '',
      raioAtendimentoKm: dto.raioAtendimentoKm,
      ...(dto.precos ? { precos: dto.precos as never } : {}),
      ...(dto.segundosParaAceitar ? { segundosParaAceitar: dto.segundosParaAceitar } : {}),
      ...(dto.chamarAoAceitarPedido !== undefined ? { chamarAoAceitarPedido: dto.chamarAoAceitarPedido } : {}),
      ...(adicionais ? { adicionais: adicionais as never } : {}),
      ...(dto.fotos ? { fotoColeta: dto.fotos.coleta, fotoEntrega: dto.fotos.entrega } : {}),
    };
    await this.prisma.configuracaoEntregas.upsert({ where: { empresaId }, create: { empresaId, ...data }, update: data });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entregas.configurar', entidade: 'ConfiguracaoEntregas', entidadeId: empresaId, detalhes: { base: !!dto.base, raioAtendimentoKm: dto.raioAtendimentoKm } });
    return this.config(empresaId);
  }

  /** Máquinas (série lida na coleta) com o entregador agora: coletadas e ainda não entregues. */
  async maquinas(empresaId: string, agora = new Date()): Promise<MaquinaEmCustodia[]> {
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, serieColetada: { not: null }, situacao: { in: [...SITUACOES_EM_CUSTODIA] }, entregadorId: { not: null } },
      orderBy: { coletadaEm: 'asc' },
      take: 500,
      select: { id: true, numero: true, tipo: true, situacao: true, serieColetada: true, coletadaEm: true, entregador: { select: { id: true, nome: true, veiculo: true, celular: true, posicaoEm: true } } },
    });
    return lista.map((c) => ({
      chamadaId: c.id,
      numero: c.numero,
      tipo: c.tipo as TipoChamada,
      situacao: c.situacao as SituacaoChamada,
      serie: c.serieColetada!,
      coletadaEm: c.coletadaEm?.toISOString() ?? null,
      entregador: { id: c.entregador!.id, nome: primeiroNome(c.entregador!.nome), veiculo: c.entregador!.veiculo as TipoVeiculo, celular: c.entregador!.celular },
      semSinalMinutos: c.entregador!.posicaoEm ? Math.floor((agora.getTime() - c.entregador!.posicaoEm.getTime()) / 60_000) : null,
    }));
  }

  /** Onde e quando a empresa mais chama: pontos dos clientes em células (~550 m) e contagem por hora e dia. */
  async demanda(empresaId: string, dias: number, agora = new Date()): Promise<DemandaEntregas> {
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, criadoEm: { gte: new Date(agora.getTime() - dias * 86_400_000) }, situacao: { not: 'CANCELADA' } },
      select: { tipo: true, origem: true, destino: true, criadoEm: true, paradas: { select: { parada: true } } },
      take: 20_000,
    });
    const fuso = config().fusoHorario;
    const porHora = Array.from({ length: 24 }, () => 0);
    const porDia = Array.from({ length: 7 }, () => 0);
    const pontos: { lat: number; lon: number }[] = [];
    for (const c of lista) {
      const m = momentoNoFuso(c.criadoEm, fuso);
      porHora[Number(m.hhmm.slice(0, 2))]++;
      porDia[m.dia]++;
      pontos.push(pontoDoCliente(c.tipo as TipoChamada, c.origem as unknown as ParadaChamada, c.destino as unknown as ParadaChamada));
      for (const p of c.paradas) pontos.push(p.parada as unknown as ParadaChamada);
    }
    return { dias, total: lista.length, celulas: gradeDeDemanda(pontos).slice(0, 400), porHora, porDia };
  }

  configuracaoDoMapa(): ConfigMapa {
    return this.mapas.configuracaoDoMapa();
  }

  geocodificar(q: string): Promise<ResultadoEndereco[]> {
    return this.mapas.geocodificar(q);
  }

  /** Só aprovados online dentro do raio, com posição arredondada: a empresa não segue ninguém. */
  async mapa(empresaId: string, agora = new Date()): Promise<MapaEntregas> {
    const config = await this.config(empresaId);
    if (!config.base) return { config, entregadores: [], atualizadoEm: agora.toISOString() };
    const { lat, lon } = config.base;
    const raio = config.raioAtendimentoKm;
    const dLat = raio / KM_POR_GRAU_LAT;
    const dLon = raio / (KM_POR_GRAU_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    const candidatos = await this.prisma.entregador.findMany({
      where: { situacao: 'APROVADO', online: true, posicaoEm: { not: null }, lat: { gte: lat - dLat, lte: lat + dLat }, lon: { gte: lon - dLon, lte: lon + dLon } },
      select: { id: true, nome: true, veiculo: true, lat: true, lon: true, posicaoEm: true, chamadas: { where: { situacao: { in: [...SITUACOES_EM_ANDAMENTO] } }, select: { id: true }, take: 1 } },
      take: 500,
    });
    const entregadores = candidatos
      .map((e) => ({ e, distancia: distanciaMetros(config.base!, { lat: e.lat!, lon: e.lon! }) }))
      .filter(({ distancia }) => distancia <= raio * 1000)
      .sort((a, b) => a.distancia - b.distancia)
      .map(({ e, distancia }) => {
        const p = posicaoAproximada({ lat: e.lat!, lon: e.lon! });
        return {
          id: e.id,
          nome: primeiroNome(e.nome),
          veiculo: e.veiculo as TipoVeiculo,
          lat: p.lat,
          lon: p.lon,
          situacao: e.chamadas.length ? ('OCUPADO' as const) : situacaoNoMapa(e.posicaoEm, agora),
          posicaoEm: e.posicaoEm!.toISOString(),
          // Arredondada: a distância exata entregaria a posição.
          distanciaKm: Math.round(distancia / 100) / 10,
        };
      });
    return { config, entregadores, atualizadoEm: agora.toISOString() };
  }
}

@Controller('entregas')
export class EntregasEmpresaController {
  constructor(private readonly entregas: EntregasEmpresaService) {}

  @Get('config')
  @RequerPermissao('entrega.ver')
  async config(@EmpresaAtual() empresaId: string): Promise<{ config: ConfigEntregasEmpresa; mapa: ConfigMapa }> {
    return { config: await this.entregas.config(empresaId), mapa: this.entregas.configuracaoDoMapa() };
  }

  @Put('config')
  @RequerPermissao('entrega.configurar')
  salvar(@EmpresaAtual() empresaId: string, @Body() dto: ConfigEntregasDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ConfigEntregasEmpresa> {
    return this.entregas.salvar(empresaId, dto, u.id);
  }

  @Get('enderecos')
  @RequerPermissao('entrega.configurar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  enderecos(@Query() dto: BuscaEnderecoDto): Promise<ResultadoEndereco[]> {
    return this.entregas.geocodificar(dto.q);
  }

  @Get('maquinas')
  @RequerPermissao('entrega.ver')
  maquinas(@EmpresaAtual() empresaId: string): Promise<MaquinaEmCustodia[]> {
    return this.entregas.maquinas(empresaId);
  }

  @Get('demanda')
  @RequerPermissao('entrega.ver')
  demanda(@EmpresaAtual() empresaId: string, @Query() dto: DemandaDto): Promise<DemandaEntregas> {
    return this.entregas.demanda(empresaId, Number(dto.dias ?? 30));
  }

  @Get('mapa')
  @RequerPermissao('entrega.ver')
  mapa(@EmpresaAtual() empresaId: string): Promise<MapaEntregas> {
    return this.entregas.mapa(empresaId);
  }
}
