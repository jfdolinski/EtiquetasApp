import { BadRequestException, Body, Controller, Get, Injectable, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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
}

class TabelaPrecosDto {
  @ValidateNested() @Type(() => PrecoTipoDto) ENTREGA: PrecoTipoDto;
  @ValidateNested() @Type(() => PrecoTipoDto) COLETA: PrecoTipoDto;
  @ValidateNested() @Type(() => PrecoTipoDto) DEVOLUCAO_MAQUINA: PrecoTipoDto;
}

class ConfigEntregasDto {
  @IsOptional() @ValidateNested() @Type(() => TabelaPrecosDto) precos?: TabelaPrecos;
  @IsOptional() @IsInt() @Min(LIMITES_SEGUNDOS_PARA_ACEITAR.minimo) @Max(LIMITES_SEGUNDOS_PARA_ACEITAR.maximo) segundosParaAceitar?: number;
  @IsOptional() @ValidateNested() @Type(() => BaseDto) base: BaseDto | null;
  @IsInt() @Min(1, { message: 'O raio vai de 1 a 100 km.' }) @Max(RAIO_ATENDIMENTO_MAXIMO_KM, { message: 'O raio vai de 1 a 100 km.' }) raioAtendimentoKm: number;
}

class BuscaEnderecoDto {
  @IsString() @MinLength(4, { message: 'Digite mais do endereço.' }) @MaxLength(200) q: string;
}

const KM_POR_GRAU_LAT = 111.32;

/** O que a empresa vê das entregas: o ponto de partida dela e os entregadores online por perto. */
@Injectable()
export class EntregasEmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly mapas: MapasService,
  ) {}

  async config(empresaId: string): Promise<ConfigEntregasEmpresa> {
    const c = await this.prisma.configuracaoEntregas.findUnique({ where: { empresaId } });
    if (!c) return { base: null, raioAtendimentoKm: RAIO_ATENDIMENTO_PADRAO_KM, precos: TABELA_PRECOS_PADRAO, segundosParaAceitar: SEGUNDOS_PARA_ACEITAR_PADRAO };
    const base = c.baseLat !== null && c.baseLon !== null ? { lat: c.baseLat, lon: c.baseLon, endereco: c.baseEndereco } : null;
    // Tipo novo sem preço na tabela gravada fica com o padrão.
    const precos = { ...TABELA_PRECOS_PADRAO, ...((c.precos as Partial<TabelaPrecos> | null) ?? {}) };
    return { base, raioAtendimentoKm: c.raioAtendimentoKm, precos, segundosParaAceitar: c.segundosParaAceitar };
  }

  async salvar(empresaId: string, dto: ConfigEntregasDto, autorId: string): Promise<ConfigEntregasEmpresa> {
    if (dto.base && !coordenadaValida(dto.base)) throw new BadRequestException('Ponto inválido.');
    if (dto.precos) {
      const problema = problemaNaTabelaPrecos(dto.precos);
      if (problema) throw new BadRequestException(problema);
    }
    const data = {
      baseLat: dto.base?.lat ?? null,
      baseLon: dto.base?.lon ?? null,
      baseEndereco: dto.base?.endereco.trim() ?? '',
      raioAtendimentoKm: dto.raioAtendimentoKm,
      ...(dto.precos ? { precos: dto.precos as never } : {}),
      ...(dto.segundosParaAceitar ? { segundosParaAceitar: dto.segundosParaAceitar } : {}),
    };
    await this.prisma.configuracaoEntregas.upsert({ where: { empresaId }, create: { empresaId, ...data }, update: data });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entregas.configurar', entidade: 'ConfiguracaoEntregas', entidadeId: empresaId, detalhes: { base: !!dto.base, raioAtendimentoKm: dto.raioAtendimentoKm } });
    return this.config(empresaId);
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

  @Get('mapa')
  @RequerPermissao('entrega.ver')
  mapa(@EmpresaAtual() empresaId: string): Promise<MapaEntregas> {
    return this.entregas.mapa(empresaId);
  }
}
