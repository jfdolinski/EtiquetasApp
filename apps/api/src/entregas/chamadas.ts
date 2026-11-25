import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { randomInt } from 'node:crypto';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import {
  gerarCodigoColeta,
  inicioDaDistribuicao,
  normalizarCodigoColeta,
  problemaNoAgendamento,
  problemaNosVolumes,
  exigeTermoCustodia,
  temTermoVigente,
  textoVolumes,
  podePegarOutra,
  problemaNaAssinatura,
  rasterizarAssinatura,
  type ModoAssinatura,
  type TracoAssinatura,
  checklistLimpo,
  comMinimo,
  ESPERA_BLOCO_MINUTOS,
  ESTADOS_MAQUINA,
  formatarKm,
  minutosNoPonto,
  podeDevolver,
  problemaNoChecklist,
  regraDeEspera,
  textoDoChecklist,
  valorDaDevolucao,
  valorDaEspera,
  type ChecklistsDaChamada,
  type DevolucaoChamada,
  type EstadoMaquina,
  chegouPerto,
  etapaAtrasada,
  momentoDaEtapa,
  etapaDaFoto,
  formatarCentavos,
  podeDesistir,
  taxaDoCancelamento,
  vaiProRastro,
  type PontoRastro,
  adicionaisQueValem,
  aposEntregarParada,
  momentoNoFuso,
  pontoDoCliente,
  problemaNasParadas,
  totalDosAdicionais,
  type AdicionalAplicado,
  type DestinoDoEntregador,
  type ParadaExtraResumo,
  LIMITE_TEXTO_EMERGENCIA,
  type EmergenciaChamada,
  pedidoPodeChamarEntregador,
  type EnderecoPedido,
  type ModalidadeEntrega,
  type SituacaoPedido,
  classificar,
  motivoParaEntregador,
  raioDaRodada,
  textoDoMotivo,
  type MotivoOferta,
  type OfertaDaChamada,
  type RegrasDirecionamento,
  coordenadaValida,
  diaNoFuso,
  distanciaMetros,
  MOTIVOS_OCORRENCIA,
  normalizarSerie,
  primeiroNome,
  problemaNaChamada,
  PROXIMA_ETAPA,
  resumoDoEndereco,
  ROTULO_MOTIVO_OCORRENCIA,
  ROTULO_SITUACAO_CHAMADA,
  SEGUNDOS_POSICAO_VALIDA,
  SITUACOES_CHAMADA,
  SITUACOES_EM_ANDAMENTO,
  TENTATIVAS_CODIGO,
  TIPOS_CHAMADA,
  valorDaChamada,
  type ChamadaEntregador,
  type ChamadaResumo,
  type ElegivelOferta,
  type EventoChamada,
  type GanhosEntregador,
  type MotivoOcorrencia,
  type NovaChamada,
  type OfertaResumo,
  type ParadaChamada,
  type PreviaChamada,
  type SituacaoChamada,
  type TipoChamada,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { Prisma } from '@prisma/client';
import { EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { DirecionamentoService } from './direcionamento';
import { FechamentoService } from './fechamento';
import { caminhoDoRastreio, novoRastreio } from './rastreio';
import { EntregasEmpresaService } from './empresa';
import { EntregadorAtual, EntregadorGuard } from './guarda';
import { dataUrl, imagemDoDataUrl } from './imagens';
import { MapasService } from './mapas';
import { pngCinza } from '../modelos/png';

const INTERVALO_RELOGIO_MS = 5_000;
const DIA_MS = 86_400_000;

// DTOs -------------------------------------------------------------------------------------

class ParadaDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsString() @MaxLength(300) endereco: string;
  @IsString() @MaxLength(80) contato: string;
  @IsString() @MaxLength(20) telefone: string;
  @IsString() @MaxLength(300) instrucoes: string;
  /** Pedidos juntos: a parada extra que entrega um pedido do Flow ou do ERP. */
  @IsOptional() @IsUUID('all', { message: 'Pedido inválido.' }) pedidoId?: string | null;
  @IsOptional() @IsUUID('all', { message: 'Pedido do ERP inválido.' }) pedidoErpId?: string | null;
}

class AssinaturaDto {
  @IsArray() @ArrayMaxSize(60) tracos: TracoAssinatura[];
  @IsString() @MaxLength(80) recebedor: string;
}

class NovaChamadaDto {
  @IsIn(TIPOS_CHAMADA, { message: 'Escolha o tipo do serviço.' }) tipo: TipoChamada;
  @ValidateNested() @Type(() => ParadaDto) origem: ParadaDto;
  @ValidateNested() @Type(() => ParadaDto) destino: ParadaDto;
  @IsOptional() @IsString() @MaxLength(60) serieEsperada: string | null;
  @IsString() @MaxLength(500) observacao: string;
  @IsOptional() @IsBoolean() distribuir?: boolean;
  @IsOptional() @IsUUID('all', { message: 'Pedido inválido.' }) pedidoId?: string | null;
  @IsOptional() @IsUUID('all', { message: 'Pedido do ERP inválido.' }) pedidoErpId?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Data do agendamento inválida.' }) agendadaPara?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => ParadaDto) paradasExtras?: ParadaDto[];
}

class OferecerDto {
  @IsUUID('all', { message: 'Entregador inválido.' }) entregadorId: string;
}

class MotivoDto {
  @IsString() @MinLength(3, { message: 'Informe o motivo.' }) @MaxLength(300) motivo: string;
}

class ResolverOcorrenciaDto {
  @IsIn(['CONTINUAR', 'REABRIR', 'CANCELAR', 'DEVOLVER']) acao: 'CONTINUAR' | 'REABRIR' | 'CANCELAR' | 'DEVOLVER';
  @IsOptional() @IsString() @MaxLength(300) motivo?: string;
}

class FiltroChamadasDto {
  @IsOptional() @IsIn(['ATIVAS', 'TODAS']) filtro?: 'ATIVAS' | 'TODAS';
  @IsOptional() @IsUUID() pedidoId?: string;
}

class ChecklistDto {
  @IsBoolean() carregador: boolean;
  @IsBoolean() bobina: boolean;
  @IsBoolean() chip: boolean;
  @IsIn(ESTADOS_MAQUINA, { message: 'Informe o estado da máquina.' }) estado: EstadoMaquina;
  @IsString() @MaxLength(300) observacao: string;
}

class AvancarDto {
  @IsIn(SITUACOES_CHAMADA) para: SituacaoChamada;
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsOptional() @IsNumber() @Min(0) precisao?: number | null;
  @IsOptional() @IsBoolean() simulada?: boolean;
  @IsOptional() @IsString() @MaxLength(60) serie?: string;
  @IsOptional() @IsString() @MaxLength(10) codigo?: string;
  @IsOptional() @IsString() @MaxLength(7_200_000) foto?: string | null;
  /** Quando o entregador fez a etapa (o app guardou sem internet e mandou depois). */
  @IsOptional() @IsISO8601() em?: string;
  /** Maquininha: o que veio junto e o estado, na coleta e na entrega. */
  @IsOptional() @ValidateNested() @Type(() => ChecklistDto) checklist?: ChecklistDto;
  /** Assinatura de quem recebe (quando a empresa pede). */
  @IsOptional() @ValidateNested() @Type(() => AssinaturaDto) assinatura?: AssinaturaDto;
  /** Etapa 12: volumes que saem na coleta e que chegam na entrega; a etiqueta lida na coleta. */
  @IsOptional() @IsNumber() volumes?: number;
  @IsOptional() @IsNumber() volumesEntregues?: number;
  @IsOptional() @IsString() @MaxLength(60) etiqueta?: string;
}

class BalcaoDto {
  @IsString() @MaxLength(60) codigo: string;
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lon: number;
  @IsOptional() @IsNumber() @Min(0) precisao?: number | null;
}

class DesistenciaDto {
  @IsString() @MaxLength(300) motivo: string;
}

class EmergenciaDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lon?: number | null;
  @IsString() @MaxLength(LIMITE_TEXTO_EMERGENCIA) texto: string;
}

class OcorrenciaDto {
  @IsIn(MOTIVOS_OCORRENCIA, { message: 'Escolha o motivo.' }) motivo: MotivoOcorrencia;
  @IsString() @MaxLength(500) texto: string;
  @IsString() @MaxLength(7_200_000) foto: string;
}

// Serviço ----------------------------------------------------------------------------------

type ChamadaDoBanco = Prisma.ChamadaEntregaGetPayload<{
  include: { entregador: { select: { id: true; nome: true; veiculo: true; placa: true; celular: true; lat: true; lon: true; posicaoEm: true } }; ofertas: { include: { entregador: { select: { nome: true } } }; orderBy: { criadoEm: 'asc' } }; fotos: { select: { id: true; etapa: true } }; pedido: { select: { id: true; numero: true } }; fechamento: { select: { pagoEm: true } }; contestacoes: { orderBy: { criadoEm: 'desc' }; take: 1 }; paradas: { orderBy: { ordem: 'asc' } } };
}>;

const INCLUIR = {
  entregador: { select: { id: true, nome: true, veiculo: true, placa: true, celular: true, lat: true, lon: true, posicaoEm: true } },
  ofertas: { include: { entregador: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } },
  fotos: { select: { id: true, etapa: true } },
  pedido: { select: { id: true, numero: true } },
  fechamento: { select: { pagoEm: true } },
  contestacoes: { orderBy: { criadoEm: 'desc' }, take: 1 },
  paradas: { orderBy: { ordem: 'asc' } },
} as const;

type ParadaDoBanco = { ordem: number; parada: Prisma.JsonValue; codigoConfirmacao: string; entregueEm: Date | null; rastreioCifrado?: string | null };
const novoCodigo = () => String(randomInt(0, 10_000)).padStart(4, '0');

/** O destino da parada atual: 0 = o principal; 1… = paradas extras. */
function destinoAtual(c: { destino: Prisma.JsonValue; paradaAtual: number; codigoConfirmacao: string }, paradas: ParadaDoBanco[]): { parada: ParadaChamada; codigo: string; extra: ParadaDoBanco | null } {
  const extra = c.paradaAtual > 0 ? (paradas.find((p) => p.ordem === c.paradaAtual) ?? null) : null;
  return extra ? { parada: extra.parada as unknown as ParadaChamada, codigo: extra.codigoConfirmacao, extra } : { parada: c.destino as unknown as ParadaChamada, codigo: c.codigoConfirmacao, extra: null };
}

type Ocorrencia = { motivo: MotivoOcorrencia; texto: string; em: string; situacaoAnterior: SituacaoChamada; serieLida?: string | null };

/** Maquininha: série, checklist e foto na coleta e na entrega. */
const ehMaquina = (c: { tipo: string; serieEsperada: string | null }) => c.tipo === 'DEVOLUCAO_MAQUINA' || !!c.serieEsperada;
const terminou = (situacao: string) => situacao === 'CONCLUIDA' || situacao === 'CANCELADA';

const evento = (texto: string, por: EventoChamada['por']): EventoChamada => ({ em: new Date().toISOString(), texto, por });

@Injectable()
export class ChamadasService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Chamadas');
  private relogio?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly mapas: MapasService,
    private readonly empresas: EntregasEmpresaService,
    private readonly direcionamento: DirecionamentoService,
    private readonly fechamento: FechamentoService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.expirarOfertas(), INTERVALO_RELOGIO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  /** Histórico em JSON: acrescenta no banco, sem ler e regravar (duas mudanças juntas não se apagam). */
  private async registrar(id: string, e: EventoChamada, tx: Prisma.TransactionClient = this.prisma) {
    await tx.$executeRaw`UPDATE chamadas_entrega SET historico = historico || ${JSON.stringify([e])}::jsonb WHERE id = ${id}::uuid`;
  }

  async expirarOfertas(agora = new Date()): Promise<number> {
    try {
      const vencidas = await this.prisma.ofertaChamada.findMany({ where: { resultado: 'PENDENTE', expiraEm: { lt: agora } }, include: { entregador: { select: { nome: true } } }, take: 200 });
      for (const o of vencidas) {
        const { count } = await this.prisma.ofertaChamada.updateMany({ where: { id: o.id, resultado: 'PENDENTE' }, data: { resultado: 'EXPIRADA', respondidaEm: agora } });
        if (count) await this.registrar(o.chamadaId, evento(`${primeiroNome(o.entregador.nome)} não respondeu a tempo.`, 'sistema'));
      }
      return vencidas.length;
    } catch (e) {
      this.log.error(`Falha ao expirar ofertas: ${(e as Error).message}`);
      return 0;
    }
  }

  // Empresa --------------------------------------------------------------------------------------

  async previa(empresaId: string, c: NovaChamada): Promise<PreviaChamada> {
    const problema = problemaNaChamada(c);
    if (problema) throw new BadRequestException(problema);
    const extras = c.paradasExtras ?? [];
    const problemaParadas = problemaNasParadas(c.tipo, extras);
    if (problemaParadas) throw new BadRequestException(problemaParadas);
    const cfg = await this.empresas.config(empresaId);
    const rota = await this.mapas.rotaPorPontos([c.origem, c.destino, ...extras]);
    const valorTabelaCentavos = valorDaChamada(cfg.precos[c.tipo], rota.metros, extras.length);
    const clientes = c.tipo === 'ENTREGA' ? [c.destino, ...extras] : [pontoDoCliente(c.tipo, c.origem, c.destino)];
    const adicionais = adicionaisQueValem(cfg.adicionais, valorTabelaCentavos, momentoNoFuso(new Date(), config().fusoHorario), clientes);
    const bruto = valorTabelaCentavos + totalDosAdicionais(adicionais);
    const valorCentavos = comMinimo(bruto, await this.empresas.valorMinimo());
    return { ...rota, valorTabelaCentavos, adicionais, valorCentavos, minimoAplicado: valorCentavos > bruto };
  }

  async criar(empresaId: string, dto: NovaChamadaDto, autorId: string | null): Promise<ChamadaResumo> {
    const c: NovaChamada = { ...dto, serieEsperada: dto.serieEsperada ? normalizarSerie(dto.serieEsperada) : null, observacao: dto.observacao.trim() };
    const problemaAgenda = problemaNoAgendamento(dto.agendadaPara, new Date());
    if (problemaAgenda) throw new BadRequestException(problemaAgenda);
    const previa = await this.previa(empresaId, c);
    const pedidoId = dto.pedidoId ? await this.conferirPedido(empresaId, dto.pedidoId) : null;
    const erp = dto.pedidoErpId ? await this.conferirPedidoErp(empresaId, dto.pedidoErpId) : null;
    const pedidoErp = erp?.codigo ?? null;
    const { fotos, precos, assinatura } = await this.empresas.config(empresaId);
    // Pedidos juntos: cada parada pode entregar um pedido do Flow ou do ERP, conferido como o principal.
    const extrasDto = dto.paradasExtras ?? [];
    const idsFlow = [dto.pedidoId, ...extrasDto.map((p) => p.pedidoId)].filter((x): x is string => !!x);
    const idsErp = [dto.pedidoErpId, ...extrasDto.map((p) => p.pedidoErpId)].filter((x): x is string => !!x);
    if (new Set(idsFlow).size !== idsFlow.length || new Set(idsErp).size !== idsErp.length) throw new BadRequestException('O mesmo pedido aparece duas vezes.');
    for (const p of extrasDto) if (p.pedidoId) await this.conferirPedido(empresaId, p.pedidoId);
    const erpsExtras = new Map<string, Awaited<ReturnType<ChamadasService['conferirPedidoErp']>>>();
    for (const p of extrasDto) if (p.pedidoErpId) erpsExtras.set(p.pedidoErpId, await this.conferirPedidoErp(empresaId, p.pedidoErpId));
    const espera = regraDeEspera(precos[c.tipo]);
    const maquina = ehMaquina(c);
    const rastreio = novoRastreio();
    const limpa = (p: ParadaDto): ParadaChamada => ({ lat: p.lat, lon: p.lon, endereco: p.endereco.trim(), contato: p.contato.trim(), telefone: p.telefone.replace(/\D/g, ''), instrucoes: p.instrucoes.trim() });
    const id = await this.prisma.$transaction(async (tx) => {
      const cfg = await tx.configuracaoEntregas.upsert({ where: { empresaId }, create: { empresaId, proximoNumero: 2 }, update: { proximoNumero: { increment: 1 } }, select: { proximoNumero: true } });
      const criada = await tx.chamadaEntrega.create({
        data: {
          empresaId,
          numero: cfg.proximoNumero - 1,
          tipo: c.tipo,
          origem: limpa(dto.origem) as never,
          destino: limpa(dto.destino) as never,
          metros: previa.metros,
          segundos: previa.segundos,
          estimada: previa.estimada,
          valorCentavos: previa.valorCentavos,
          serieEsperada: c.serieEsperada,
          observacao: c.observacao,
          codigoConfirmacao: novoCodigo(),
          adicionais: previa.adicionais as never,
          fotoColeta: fotos.coleta || maquina,
          fotoEntrega: fotos.entrega || maquina,
          esperaToleranciaMinutos: espera.toleranciaMinutos,
          esperaPorBlocoCentavos: espera.porBlocoCentavos,
          pedidoErp,
          assinatura,
          codigoColeta: gerarCodigoColeta((n) => randomInt(0, n)),
          agendadaPara: dto.agendadaPara ? new Date(dto.agendadaPara) : null,
          historico: [evento('Chamada aberta.', 'empresa')] as never,
          criadoPorId: autorId,
          pedidoId,
          rastreioHash: rastreio.rastreioHash,
          rastreioCifrado: rastreio.rastreioCifrado,
        },
      });
      // Pedido do ERP: reivindica sobre a versão lida, então dois cliques (ou o relógio e um clique) não abrem duas chamadas.
      if (erp) {
        const { count } = await tx.pedidoErpEntrega.updateMany({ where: { id: erp.id, empresaId, atualizadoEm: erp.atualizadoEm }, data: { situacao: 'CHAMADA', chamadaId: criada.id, mensagem: null } });
        if (!count) throw new ConflictException('Este pedido do ERP já foi chamado.');
      }
      for (const [i, p] of (dto.paradasExtras ?? []).entries()) {
        const r = novoRastreio();
        const erpDaParada = p.pedidoErpId ? erpsExtras.get(p.pedidoErpId)! : null;
        if (erpDaParada) {
          const { count } = await tx.pedidoErpEntrega.updateMany({ where: { id: erpDaParada.id, empresaId, atualizadoEm: erpDaParada.atualizadoEm }, data: { situacao: 'CHAMADA', chamadaId: criada.id, mensagem: null } });
          if (!count) throw new ConflictException(`O pedido ${erpDaParada.codigo} do ERP já foi chamado.`);
        }
        await tx.paradaExtraChamada.create({ data: { chamadaId: criada.id, ordem: i + 1, parada: limpa(p) as never, codigoConfirmacao: novoCodigo(), rastreioHash: r.rastreioHash, rastreioCifrado: r.rastreioCifrado, pedidoId: p.pedidoId ?? null, pedidoErp: erpDaParada?.codigo ?? null } });
      }
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.abrir', entidade: 'ChamadaEntrega', entidadeId: criada.id, detalhes: { tipo: c.tipo, valorCentavos: previa.valorCentavos, paradas: 1 + (dto.paradasExtras?.length ?? 0), adicionais: previa.adicionais } as never }, tx);
      return criada.id;
    });
    const { direcionamento } = await this.empresas.config(empresaId);
    if (dto.distribuir ?? direcionamento.automatico) await this.direcionamento.ligar(empresaId, id, null);
    return this.obter(empresaId, id);
  }

  /** Pedido da empresa, com entrega, em andamento e sem outra chamada ativa. */
  private async conferirPedido(empresaId: string, pedidoId: string): Promise<string> {
    const p = await this.prisma.pedido.findFirst({ where: { id: pedidoId, empresaId }, select: { id: true, situacao: true, modalidade: true, endereco: true } });
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    if (!pedidoPodeChamarEntregador({ modalidade: p.modalidade as ModalidadeEntrega, situacao: p.situacao as SituacaoPedido, endereco: p.endereco as unknown as EnderecoPedido | null })) throw new ConflictException('Só pedido com entrega, em separação ou saindo, chama entregador.');
    const ativa = await this.prisma.chamadaEntrega.findFirst({ where: { empresaId, pedidoId, situacao: { in: ['ABERTA', ...SITUACOES_EM_ANDAMENTO] } }, select: { numero: true } });
    if (ativa) throw new ConflictException(`Este pedido já tem a chamada nº ${ativa.numero} em andamento.`);
    const naParada = await this.prisma.paradaExtraChamada.findFirst({ where: { pedidoId, chamada: { empresaId, situacao: { in: ['ABERTA', ...SITUACOES_EM_ANDAMENTO] } } }, select: { chamada: { select: { numero: true } } } });
    if (naParada) throw new ConflictException(`O pedido já está na chamada nº ${naParada.chamada.numero}.`);
    return p.id;
  }

  /** Pedido do ERP esperando a empresa, ou com a chamada anterior cancelada. */
  private async conferirPedidoErp(empresaId: string, id: string) {
    const p = await this.prisma.pedidoErpEntrega.findFirst({ where: { id, empresaId } });
    if (!p) throw new NotFoundException('Pedido do ERP não encontrado.');
    if (p.situacao === 'CHAMADA' && p.chamadaId) {
      const c = await this.prisma.chamadaEntrega.findUnique({ where: { id: p.chamadaId }, select: { numero: true, situacao: true } });
      if (c && c.situacao !== 'CANCELADA') throw new ConflictException(`Este pedido do ERP já tem a chamada nº ${c.numero}.`);
    }
    return p;
  }

  async listar(empresaId: string, filtro: 'ATIVAS' | 'TODAS', pedidoId?: string): Promise<ChamadaResumo[]> {
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, ...(pedidoId ? { OR: [{ pedidoId }, { paradas: { some: { pedidoId } } }] } : {}), ...(filtro === 'ATIVAS' ? { OR: [{ situacao: { notIn: ['CONCLUIDA', 'CANCELADA'] } }, { atualizadoEm: { gt: new Date(Date.now() - DIA_MS) } }] } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: 200,
      include: INCLUIR,
    });
    const { direcionamento } = await this.empresas.config(empresaId);
    const numeros = await this.numerosDosPedidos(lista);
    const naoLidas = await this.naoLidasDaEmpresa(lista);
    return lista.map((c) => this.resumo(c, direcionamento, numeros, naoLidas));
  }

  /** Mensagens do entregador que a empresa ainda não viu, por chamada. */
  private async naoLidasDaEmpresa(lista: { id: string; mensagensLidasEmpresaEm: Date | null }[]): Promise<Map<string, number>> {
    if (!lista.length) return new Map();
    const msgs = await this.prisma.mensagemChamadaEntrega.findMany({ where: { chamadaId: { in: lista.map((c) => c.id) }, autor: 'entregador' }, select: { chamadaId: true, criadoEm: true } });
    const lidas = new Map(lista.map((c) => [c.id, c.mensagensLidasEmpresaEm?.getTime() ?? 0]));
    const n = new Map<string, number>();
    for (const m of msgs) if (m.criadoEm.getTime() > (lidas.get(m.chamadaId) ?? 0)) n.set(m.chamadaId, (n.get(m.chamadaId) ?? 0) + 1);
    return n;
  }

  /** Número dos pedidos entregues nas paradas (pedidos juntos). */
  private async numerosDosPedidos(lista: { paradas: { pedidoId: string | null }[] }[]): Promise<Map<string, number>> {
    const ids = [...new Set(lista.flatMap((c) => c.paradas.flatMap((p) => (p.pedidoId ? [p.pedidoId] : []))))];
    if (!ids.length) return new Map();
    const pedidos = await this.prisma.pedido.findMany({ where: { id: { in: ids } }, select: { id: true, numero: true } });
    return new Map(pedidos.map((p) => [p.id, p.numero]));
  }

  async obter(empresaId: string, id: string): Promise<ChamadaResumo> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id, empresaId }, include: INCLUIR });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    return this.resumo(c, (await this.empresas.config(empresaId)).direcionamento, await this.numerosDosPedidos([c]), await this.naoLidasDaEmpresa([c]));
  }

  private resumo(c: ChamadaDoBanco, regras: RegrasDirecionamento, numeros: Map<string, number> = new Map(), naoLidas: Map<string, number> = new Map()): ChamadaResumo {
    const andamento = SITUACOES_EM_ANDAMENTO.includes(c.situacao as SituacaoChamada);
    const e = c.entregador;
    const oferta = c.ofertas.find((o) => o.resultado === 'PENDENTE');
    const oc = c.ocorrencia as Ocorrencia | null;
    return {
      id: c.id,
      numero: c.numero,
      tipo: c.tipo as TipoChamada,
      situacao: c.situacao as SituacaoChamada,
      origem: c.origem as unknown as ParadaChamada,
      destino: c.destino as unknown as ParadaChamada,
      metros: c.metros,
      estimada: c.estimada,
      valorCentavos: c.valorCentavos,
      serieEsperada: c.serieEsperada,
      serieColetada: c.serieColetada,
      observacao: c.observacao,
      entregador: e ? { id: e.id, nome: primeiroNome(e.nome), veiculo: e.veiculo as TipoVeiculo, placa: e.placa, celular: andamento ? e.celular : null } : null,
      posicaoEntregador: andamento && e?.lat != null && e.lon != null && e.posicaoEm ? { lat: e.lat, lon: e.lon, em: e.posicaoEm.toISOString() } : null,
      ofertaPendente: oferta ? { entregadorNome: primeiroNome(oferta.entregador.nome), expiraEm: oferta.expiraEm.toISOString() } : null,
      ofertas: c.ofertas.map(
        (o): OfertaDaChamada => ({
          entregadorNome: primeiroNome(o.entregador.nome),
          resultado: o.resultado as OfertaDaChamada['resultado'],
          expiraEm: o.expiraEm.toISOString(),
          criadoEm: o.criadoEm.toISOString(),
          motivo: o.motivo ? textoDoMotivo(o.motivo as unknown as MotivoOferta) : null,
        }),
      ),
      distribuicao: {
        ativa: c.distribuicaoAtiva && c.situacao === 'ABERTA',
        rodada: c.rodada,
        tentativas: c.tentativas,
        raioKm: raioDaRodada(regras, c.rodada),
        proximaTentativaEm: c.proximaTentativaEm?.toISOString() ?? null,
        semEntregadorDesde: c.semEntregadorEm?.toISOString() ?? null,
      },
      ocorrencia: oc ? { motivo: oc.motivo, texto: oc.texto, em: oc.em, temFoto: c.fotos.some((f) => f.etapa === 'OCORRENCIA'), serieLida: oc.serieLida ?? null, situacaoAnterior: oc.situacaoAnterior } : null,
      codigoConfirmacao: terminou(c.situacao) || c.paradaAtual > 0 || c.devolucao ? null : c.codigoConfirmacao,
      esperaMinutos: c.esperaMinutos,
      esperaCentavos: c.esperaCentavos,
      devolucao: (c.devolucao as unknown as DevolucaoChamada | null) ?? null,
      codigoDevolucao: c.devolucao && !terminou(c.situacao) ? c.codigoDevolucao : null,
      checklists: (c.checklists as unknown as ChecklistsDaChamada) ?? {},
      pedidoErp: c.pedidoErp,
      assinatura: c.assinatura as ModoAssinatura,
      codigoColeta: c.codigoColeta,
      etiquetaImpressaEm: c.etiquetaImpressaEm?.toISOString() ?? null,
      etiquetaLidaEm: c.etiquetaLidaEm?.toISOString() ?? null,
      volumes: c.volumes,
      volumesEntregues: c.volumesEntregues,
      agendadaPara: c.agendadaPara?.toISOString() ?? null,
      mensagensNaoLidas: naoLidas.get(c.id) ?? 0,
      historico: c.historico as unknown as EventoChamada[],
      criadoEm: c.criadoEm.toISOString(),
      concluidaEm: c.concluidaEm?.toISOString() ?? null,
      pedido: c.pedido,
      extraCentavos: c.extraCentavos,
      extraMotivo: c.extraMotivo,
      pagoEm: c.fechamento?.pagoEm.toISOString().slice(0, 10) ?? null,
      avaliacao: c.avaliadaEm && c.avaliacaoNota ? { nota: c.avaliacaoNota, comentario: c.avaliacaoComentario, em: c.avaliadaEm.toISOString() } : null,
      linkRastreio: caminhoDoRastreio(c.rastreioCifrado),
      paradasExtras: c.paradas.map(
        (p): ParadaExtraResumo => ({
          ordem: p.ordem,
          parada: p.parada as unknown as ParadaChamada,
          codigoConfirmacao: p.entregueEm || c.situacao === 'CANCELADA' ? null : p.codigoConfirmacao,
          entregueEm: p.entregueEm?.toISOString() ?? null,
          linkRastreio: caminhoDoRastreio(p.rastreioCifrado),
          pedido: p.pedidoId && numeros.has(p.pedidoId) ? { id: p.pedidoId, numero: numeros.get(p.pedidoId)! } : null,
          pedidoErp: p.pedidoErp,
        }),
      ),
      paradaAtual: c.paradaAtual,
      adicionais: (c.adicionais as unknown as AdicionalAplicado[]) ?? [],
      fotos: [...new Set(c.fotos.map((x) => x.etapa))],
      cancelamentoPago: c.cancelamentoPago,
      emergencia: (c.emergencia as unknown as EmergenciaChamada | null) ?? null,
      contestacao: c.contestacoes[0] ? { mensagem: c.contestacoes[0].mensagem, resposta: c.contestacoes[0].resposta, criadoEm: c.contestacoes[0].criadoEm.toISOString() } : null,
    };
  }

  async foto(empresaId: string, chamadaId: string, etapa: string): Promise<{ dados: string }> {
    const f = await this.prisma.fotoChamada.findFirst({ where: { chamadaId, etapa, chamada: { empresaId } }, orderBy: { criadoEm: 'desc' } });
    if (!f) throw new NotFoundException('Sem foto.');
    return { dados: dataUrl(f.mime, f.bytes) };
  }

  /**
   * Para a escolha manual: os mesmos filtros e a mesma ordem da distribuição automática, com o
   * raio de atendimento da empresa (e sem o "só preferidos", que é regra da distribuição).
   */
  async elegiveis(empresaId: string, chamadaId: string): Promise<ElegivelOferta[]> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    const origem = c.origem as unknown as ParadaChamada;
    const cfg = await this.empresas.config(empresaId);
    const candidatos = await this.direcionamento.candidatos(empresaId, origem, cfg.raioAtendimentoKm, chamadaId);
    const { classificados } = classificar(candidatos, { ...cfg.direcionamento, somentePreferidos: false }, c.tipo as TipoChamada, cfg.raioAtendimentoKm);
    return classificados.slice(0, 50).map((e) => ({ id: e.id, nome: e.nome, veiculo: e.veiculo, metrosAteColeta: e.metrosAteColeta, preferido: e.preferido, pontos: e.pontos, posicao: e.posicao }));
  }

  async oferecer(empresaId: string, chamadaId: string, entregadorId: string, autorId: string): Promise<ChamadaResumo> {
    const elegiveis = await this.elegiveis(empresaId, chamadaId);
    const escolhido = elegiveis.find((e) => e.id === entregadorId);
    if (!escolhido) throw new ConflictException('Este entregador não está disponível agora (offline, sem sinal, longe, ocupado ou bloqueado).');
    const cfg = await this.empresas.config(empresaId);
    await this.prisma.$transaction(async (tx) => {
      // Prende a chamada: duas ofertas ao mesmo tempo não passam.
      const [linha] = await tx.$queryRaw<{ situacao: string }[]>`SELECT situacao FROM chamadas_entrega WHERE id = ${chamadaId}::uuid AND empresa_id = ${empresaId}::uuid FOR UPDATE`;
      if (linha?.situacao !== 'ABERTA') throw new ConflictException('A chamada não está aguardando entregador.');
      if (await tx.ofertaChamada.count({ where: { chamadaId, resultado: 'PENDENTE' } })) throw new ConflictException('Já há uma oferta esperando resposta. Cancele-a antes.');
      await tx.ofertaChamada.create({ data: { chamadaId, entregadorId, metrosAteColeta: escolhido.metrosAteColeta, expiraEm: new Date(Date.now() + cfg.segundosParaAceitar * 1000) } });
      // A empresa escolheu: a distribuição automática para aqui.
      const parou = await tx.chamadaEntrega.updateMany({ where: { id: chamadaId, distribuicaoAtiva: true }, data: { distribuicaoAtiva: false, proximaTentativaEm: null } });
      await this.registrar(chamadaId, evento(`Oferecida a ${escolhido.nome}${parou.count ? ' (distribuição automática parada)' : ''}.`, 'empresa'), tx);
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.oferecer', entidade: 'ChamadaEntrega', entidadeId: chamadaId, detalhes: { entregadorId } }, tx);
    });
    return this.obter(empresaId, chamadaId);
  }

  async cancelarOferta(empresaId: string, chamadaId: string): Promise<ChamadaResumo> {
    const { count } = await this.prisma.ofertaChamada.updateMany({ where: { chamadaId, resultado: 'PENDENTE', chamada: { empresaId } }, data: { resultado: 'CANCELADA', respondidaEm: new Date() } });
    if (count) await this.registrar(chamadaId, evento('Oferta cancelada.', 'empresa'));
    return this.obter(empresaId, chamadaId);
  }

  /**
   * Cancelar depois que alguém aceitou paga a taxa de deslocamento da tabela: a chamada fica
   * CANCELADA com `cancelamento_pago`, o valor vira a taxa e ela entra no "a pagar" do entregador.
   */
  async cancelar(empresaId: string, chamadaId: string, motivo: string, autorId: string): Promise<ChamadaResumo> {
    const atual = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId }, select: { situacao: true, tipo: true, entregadorId: true, valorCentavos: true, esperaCentavos: true, atualizadoEm: true } });
    if (!atual) throw new NotFoundException('Chamada não encontrada.');
    const { precos } = await this.empresas.config(empresaId);
    const taxa = taxaDoCancelamento(atual.situacao as SituacaoChamada, !!atual.entregadorId, precos[atual.tipo as TipoChamada]?.taxaCancelamentoCentavos);
    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chamadaEntrega.updateMany({
        where: { id: chamadaId, empresaId, situacao: atual.situacao, atualizadoEm: atual.atualizadoEm },
        data: { situacao: 'CANCELADA', canceladaEm: agora, distribuicaoAtiva: false, proximaTentativaEm: null, ...(taxa ? { cancelamentoPago: true, valorCentavos: taxa + atual.esperaCentavos, concluidaEm: agora } : {}) },
      });
      if (!count) throw new ConflictException(['CONCLUIDA', 'CANCELADA'].includes(atual.situacao) ? 'A chamada já terminou.' : 'A chamada mudou. Recarregue.');
      await tx.ofertaChamada.updateMany({ where: { chamadaId, resultado: 'PENDENTE' }, data: { resultado: 'CANCELADA', respondidaEm: agora } });
      await this.registrar(chamadaId, evento(`Cancelada pela empresa: ${motivo.trim()}${taxa ? `. O entregador recebe a taxa de deslocamento de ${formatarCentavos(taxa)}${atual.esperaCentavos ? ` e a espera de ${formatarCentavos(atual.esperaCentavos)}` : ''} (o valor era ${formatarCentavos(atual.valorCentavos)}).` : ''}`, 'empresa'), tx);
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.cancelar', entidade: 'ChamadaEntrega', entidadeId: chamadaId, detalhes: { motivo: motivo.trim() } }, tx);
    });
    return this.obter(empresaId, chamadaId);
  }

  /** Ocorrência: seguir de onde parou, voltar para a fila (outro entregador) ou cancelar. */
  async resolverOcorrencia(empresaId: string, chamadaId: string, dto: ResolverOcorrenciaDto, autorId: string): Promise<ChamadaResumo> {
    if (dto.acao === 'CANCELAR') return this.cancelar(empresaId, chamadaId, dto.motivo?.trim() || 'ocorrência', autorId);
    if (dto.acao === 'DEVOLVER') return this.devolver(empresaId, chamadaId, dto.motivo ?? '', autorId);
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId, situacao: 'OCORRENCIA' } });
    if (!c) throw new ConflictException('A chamada não está em ocorrência.');
    const oc = c.ocorrencia as Ocorrencia;
    const { direcionamento } = await this.empresas.config(empresaId);
    const reaberta = { situacao: 'ABERTA', entregadorId: null, aceitaEm: null, distribuicaoAtiva: direcionamento.automatico, rodada: 0, tentativas: 0, proximaTentativaEm: direcionamento.automatico ? new Date() : null, semEntregadorEm: null };
    // Série diferente: seguir é aceitar a máquina que está lá.
    const aceitaSerie = dto.acao === 'CONTINUAR' && oc.motivo === 'SERIE_DIFERENTE' && oc.serieLida ? oc.serieLida : null;
    const serie = aceitaSerie ? (oc.situacaoAnterior === 'NA_COLETA' ? { serieEsperada: aceitaSerie } : { serieColetada: aceitaSerie }) : {};
    const data = dto.acao === 'CONTINUAR' ? { situacao: oc.situacaoAnterior, ...serie } : reaberta;
    const { count } = await this.prisma.chamadaEntrega.updateMany({ where: { id: chamadaId, situacao: 'OCORRENCIA', atualizadoEm: c.atualizadoEm }, data });
    if (!count) throw new ConflictException('A chamada mudou. Recarregue.');
    await this.registrar(chamadaId, evento(dto.acao === 'CONTINUAR' ? (aceitaSerie ? `Empresa aceitou a série ${aceitaSerie} e pediu para seguir.` : 'Empresa pediu para seguir.') : 'Empresa liberou o entregador e reabriu a chamada.', 'empresa'));
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.ocorrencia', entidade: 'ChamadaEntrega', entidadeId: chamadaId, detalhes: { acao: dto.acao } });
    return this.obter(empresaId, chamadaId);
  }

  /**
   * A entrega não deu certo: o entregador leva de volta à origem. O trecho de volta (metade da base
   * mais o km) soma ao valor, e a empresa passa um código novo ao receber de volta. As paradas que
   * faltavam voltam junto.
   */
  private async devolver(empresaId: string, chamadaId: string, motivo: string, autorId: string): Promise<ChamadaResumo> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId, situacao: 'OCORRENCIA' }, include: { paradas: { orderBy: { ordem: 'asc' } } } });
    if (!c) throw new ConflictException('A chamada não está em ocorrência.');
    if (c.devolucao) throw new ConflictException('A chamada já está voltando para a origem.');
    const oc = c.ocorrencia as Ocorrencia;
    if (!podeDevolver(oc.situacaoAnterior)) throw new ConflictException('Só dá para devolver o que já foi coletado. Libere o entregador ou cancele a chamada.');
    const origem = c.origem as unknown as ParadaChamada;
    const { precos } = await this.empresas.config(empresaId);
    const rota = await this.mapas.rota(destinoAtual(c, c.paradas).parada, origem);
    const valor = valorDaDevolucao(precos[c.tipo as TipoChamada], rota.metros);
    const dev: DevolucaoChamada = { em: new Date().toISOString(), metros: rota.metros, valorCentavos: valor, motivo: motivo.trim() || ROTULO_MOTIVO_OCORRENCIA[oc.motivo] };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chamadaEntrega.updateMany({
        where: { id: chamadaId, situacao: 'OCORRENCIA', atualizadoEm: c.atualizadoEm },
        data: { situacao: 'COLETADA', devolucao: dev as never, codigoDevolucao: novoCodigo(), valorCentavos: { increment: valor }, tentativasCodigo: 0, chegouNoPontoEm: null },
      });
      if (!count) throw new ConflictException('A chamada mudou. Recarregue.');
      await this.registrar(chamadaId, evento(`Empresa pediu a devolução à origem (${formatarKm(rota.metros)}): ${formatarCentavos(valor)} a mais para o entregador.`, 'empresa'), tx);
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.devolver', entidade: 'ChamadaEntrega', entidadeId: chamadaId, detalhes: { valorCentavos: valor, metros: rota.metros } }, tx);
    });
    return this.obter(empresaId, chamadaId);
  }

  /** Destinatário sem o código (ou código errado demais): a empresa confirma a entrega. */
  async concluirPelaEmpresa(empresaId: string, chamadaId: string, autorId: string): Promise<ChamadaResumo> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId, situacao: 'NO_DESTINO' }, include: { paradas: { orderBy: { ordem: 'asc' } } } });
    if (!c) throw new ConflictException('Só dá para concluir com o entregador no destino.');
    if (c.devolucao) {
      await this.concluirDevolucao(c, 'Devolução confirmada pela empresa, sem o código.', 'empresa', new Date());
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.concluir', entidade: 'ChamadaEntrega', entidadeId: chamadaId });
      return this.obter(empresaId, chamadaId);
    }
    const ultima = await this.entregarParada(c, 'Entrega confirmada pela empresa, sem o código.', 'empresa');
    await this.concluirPedidoDaParada(c, true);
    if (ultima) await this.andarPedido(chamadaId, 'CONCLUIDA', true);
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.concluir', entidade: 'ChamadaEntrega', entidadeId: chamadaId });
    return this.obter(empresaId, chamadaId);
  }

  /**
   * Entrega a parada atual. Com mais paradas, a chamada volta a "a caminho do destino" e passa
   * para a próxima (código e tentativas zerados); na última, conclui. Devolve se foi a última.
   */
  private async entregarParada(c: { id: string; situacao: string; paradaAtual: number; paradas: ParadaDoBanco[] }, texto: string, por: EventoChamada['por'], tx?: Prisma.TransactionClient, quando = new Date(), dados: Prisma.ChamadaEntregaUpdateManyMutationInput = {}): Promise<boolean> {
    const total = 1 + c.paradas.length;
    const { ultima, proxima } = aposEntregarParada(c.paradaAtual, total);
    const agora = quando;
    const feito = async (t: Prisma.TransactionClient) => {
      const { count } = await t.chamadaEntrega.updateMany({
        where: { id: c.id, situacao: c.situacao, paradaAtual: c.paradaAtual },
        data: { ...dados, chegouNoPontoEm: null, ...(ultima ? { situacao: 'CONCLUIDA', concluidaEm: agora } : { situacao: 'COLETADA', paradaAtual: proxima, tentativasCodigo: 0 }) },
      });
      if (!count) throw new ConflictException('A chamada mudou. Atualize a tela.');
      if (c.paradaAtual > 0) await t.paradaExtraChamada.updateMany({ where: { chamadaId: c.id, ordem: c.paradaAtual }, data: { entregueEm: agora } });
      await this.registrar(c.id, evento(total > 1 ? `${texto.replace(/\.$/, '')} (parada ${c.paradaAtual + 1} de ${total}).` : texto, por), t);
    };
    if (tx) await feito(tx);
    else await this.prisma.$transaction(feito);
    return ultima;
  }

  /** Devolvido na origem: a chamada termina inteira (as paradas que faltavam voltaram junto). */
  private async concluirDevolucao(c: { id: string; situacao: string }, texto: string, por: EventoChamada['por'], quando: Date, tx?: Prisma.TransactionClient, dados: Prisma.ChamadaEntregaUpdateManyMutationInput = {}) {
    const feito = async (t: Prisma.TransactionClient) => {
      const { count } = await t.chamadaEntrega.updateMany({ where: { id: c.id, situacao: c.situacao }, data: { ...dados, situacao: 'CONCLUIDA', concluidaEm: quando, chegouNoPontoEm: null } });
      if (!count) throw new ConflictException('A chamada mudou. Atualize a tela.');
      await this.registrar(c.id, evento(texto, por), t);
    };
    if (tx) await feito(tx);
    else await this.prisma.$transaction(feito);
  }

  /**
   * O pedido acompanha a entrega: coletado → "Saiu para entrega" (se ainda em separação);
   * entregue → concluído (se estava saindo). Só avança, nunca volta, e não mexe em pedido cancelado.
   */
  private async andarPedido(chamadaId: string, etapa: 'COLETADA' | 'CONCLUIDA', semCodigo = false) {
    const c = await this.prisma.chamadaEntrega.findUnique({ where: { id: chamadaId }, select: { pedidoId: true, numero: true, entregador: { select: { nome: true } } } });
    if (!c?.pedidoId) return;
    const nome = primeiroNome(c.entregador?.nome ?? '');
    const [de, para, texto] = etapa === 'COLETADA' ? ['EM_SEPARACAO', 'PRONTO', `Saiu para entrega com ${nome} (chamada nº ${c.numero})`] : ['PRONTO', 'CONCLUIDO', `Entregue por ${nome}${semCodigo ? ', confirmado pela loja' : ', com o código do cliente'} (chamada nº ${c.numero})`];
    const e = [{ em: new Date().toISOString(), texto, por: null }];
    await this.prisma.$executeRaw`UPDATE pedidos SET situacao = ${para}, historico = historico || ${JSON.stringify(e)}::jsonb, atualizado_em = now() WHERE id = ${c.pedidoId}::uuid AND situacao = ${de}`;
  }

  /** Pedidos juntos: os das paradas saem para entrega na coleta (o principal anda pelo `andarPedido`). */
  private async coletarPedidosDasParadas(chamadaId: string) {
    const c = await this.prisma.chamadaEntrega.findUnique({ where: { id: chamadaId }, select: { numero: true, entregador: { select: { nome: true } }, paradas: { where: { pedidoId: { not: null } }, select: { pedidoId: true } } } });
    for (const p of c?.paradas ?? []) {
      const e = [{ em: new Date().toISOString(), texto: `Saiu para entrega com ${primeiroNome(c!.entregador?.nome ?? '')} (chamada nº ${c!.numero})`, por: null }];
      await this.prisma.$executeRaw`UPDATE pedidos SET situacao = 'PRONTO', historico = historico || ${JSON.stringify(e)}::jsonb, atualizado_em = now() WHERE id = ${p.pedidoId}::uuid AND situacao = 'EM_SEPARACAO'`;
    }
  }

  /** A parada entregue (1…) que leva um pedido do Flow: ele conclui na hora, sem esperar o fim da chamada. */
  private async concluirPedidoDaParada(c: { id: string; paradaAtual: number; paradas: (ParadaDoBanco & { pedidoId?: string | null })[] }, semCodigo = false) {
    const p = c.paradaAtual > 0 ? c.paradas.find((x) => x.ordem === c.paradaAtual) : undefined;
    if (!p?.pedidoId) return;
    const ch = await this.prisma.chamadaEntrega.findUnique({ where: { id: c.id }, select: { numero: true, entregador: { select: { nome: true } } } });
    const e = [{ em: new Date().toISOString(), texto: `Entregue por ${primeiroNome(ch?.entregador?.nome ?? '')}${semCodigo ? ', confirmado pela loja' : ''} (chamada nº ${ch?.numero}, parada ${c.paradaAtual + 1})`, por: null }];
    await this.prisma.$executeRaw`UPDATE pedidos SET situacao = 'CONCLUIDO', historico = historico || ${JSON.stringify(e)}::jsonb, atualizado_em = now() WHERE id = ${p.pedidoId}::uuid AND situacao = 'PRONTO'`;
  }

  /** A empresa viu a emergência: o aviso para de repetir. */
  async cienteDaEmergencia(empresaId: string, chamadaId: string, usuario: UsuarioRequisicao): Promise<ChamadaResumo> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId }, select: { emergencia: true, atualizadoEm: true } });
    const e = c?.emergencia as unknown as EmergenciaChamada | null;
    if (!c || !e) throw new ConflictException('Não há emergência nesta chamada.');
    if (!e.vistaEm) {
      const nome = (await this.prisma.usuario.findUnique({ where: { id: usuario.id }, select: { nome: true } }))?.nome ?? 'Alguém';
      const vista: EmergenciaChamada = { ...e, vistaEm: new Date().toISOString(), vistaPor: nome };
      await this.prisma.chamadaEntrega.updateMany({ where: { id: chamadaId, empresaId, atualizadoEm: c.atualizadoEm }, data: { emergencia: vista as never } });
      await this.registrar(chamadaId, evento(`${nome} viu a emergência.`, 'empresa'));
      await this.auditoria.registrar({ empresaId, usuarioId: usuario.id, acao: 'entrega.chamada.emergencia_ciente', entidade: 'ChamadaEntrega', entidadeId: chamadaId });
    }
    return this.obter(empresaId, chamadaId);
  }

  /**
   * Pedido com entrega aceito: se a empresa ligou "chamar ao aceitar", abre a chamada já na
   * distribuição automática. Nunca atrapalha o pedido: sem ponto de partida ou sem o ponto do
   * cliente, só anota no histórico do pedido.
   */
  async chamarParaPedido(empresaId: string, pedidoId: string, autorId: string | null): Promise<void> {
    const cfg = await this.empresas.config(empresaId);
    if (!cfg.chamarAoAceitarPedido) return;
    const anotar = async (texto: string) => {
      const e = [{ em: new Date().toISOString(), texto, por: null }];
      await this.prisma.$executeRaw`UPDATE pedidos SET historico = historico || ${JSON.stringify(e)}::jsonb WHERE id = ${pedidoId}::uuid`;
    };
    try {
      if (!cfg.base) return await anotar('Entregador não chamado: marque o ponto de partida em Entregas > Configuração.');
      const r = await this.fechamento.rascunhoDoPedido(empresaId, pedidoId);
      if (r.chamadaAtiva) return;
      if (r.origemDoPonto === 'NENHUM') return await anotar('Entregador não chamado: o endereço do cliente não foi achado no mapa. Chame pela tela do pedido.');
      const origem: ParadaChamada = { lat: cfg.base.lat, lon: cfg.base.lon, endereco: cfg.base.endereco || 'Loja', contato: '', telefone: '', instrucoes: '' };
      const c = await this.criar(empresaId, { tipo: 'ENTREGA', origem, destino: r.destino, serieEsperada: null, observacao: r.observacao, distribuir: true, pedidoId } as NovaChamadaDto, autorId);
      await anotar(`Entregador chamado automaticamente (chamada nº ${c.numero})`);
    } catch (e) {
      this.log.warn(`Chamada automática do pedido ${pedidoId}: ${(e as Error).message}`);
      await anotar(`Entregador não chamado: ${(e as Error).message}`).catch(() => undefined);
    }
  }

  /** Pedido cancelado: a chamada que ainda procura entregador é cancelada junto (em andamento, a empresa decide). */
  async aoCancelarPedido(empresaId: string, pedidoId: string): Promise<void> {
    const emParadas = await this.prisma.paradaExtraChamada.findMany({ where: { pedidoId, entregueEm: null, chamada: { empresaId, situacao: { in: ['ABERTA', ...SITUACOES_EM_ANDAMENTO] } } }, select: { chamadaId: true, ordem: true } });
    for (const p of emParadas) await this.registrar(p.chamadaId, evento(`O pedido da parada ${p.ordem + 1} foi cancelado: combine com o entregador.`, 'sistema'));
    const abertas = await this.prisma.chamadaEntrega.findMany({ where: { empresaId, pedidoId, situacao: 'ABERTA' }, select: { id: true } });
    for (const c of abertas) {
      const { count } = await this.prisma.chamadaEntrega.updateMany({ where: { id: c.id, situacao: 'ABERTA' }, data: { situacao: 'CANCELADA', canceladaEm: new Date(), distribuicaoAtiva: false, proximaTentativaEm: null } });
      if (!count) continue;
      await this.prisma.ofertaChamada.updateMany({ where: { chamadaId: c.id, resultado: 'PENDENTE' }, data: { resultado: 'CANCELADA', respondidaEm: new Date() } });
      await this.registrar(c.id, evento('Cancelada porque o pedido foi cancelado.', 'sistema'));
    }
  }

  // Entregador ---------------------------------------------------------------------------------

  async ofertaPendente(entregadorId: string): Promise<OfertaResumo | null> {
    const o = await this.prisma.ofertaChamada.findFirst({
      where: { entregadorId, resultado: 'PENDENTE', expiraEm: { gt: new Date() } },
      include: { chamada: { include: { empresa: { select: { nomeFantasia: true, razaoSocial: true } }, _count: { select: { paradas: true } } } } },
    });
    if (!o) return null;
    const c = o.chamada;
    const origem = c.origem as unknown as ParadaChamada;
    const destino = c.destino as unknown as ParadaChamada;
    return {
      id: o.id,
      chamadaId: c.id,
      tipo: c.tipo as TipoChamada,
      empresa: c.empresa.nomeFantasia || c.empresa.razaoSocial,
      origemResumo: resumoDoEndereco(origem.endereco),
      destinoResumo: resumoDoEndereco(destino.endereco),
      origem: { lat: origem.lat, lon: origem.lon },
      destino: { lat: destino.lat, lon: destino.lon },
      metrosAteColeta: o.metrosAteColeta,
      metros: c.metros,
      estimada: c.estimada,
      valorCentavos: c.valorCentavos,
      expiraEm: o.expiraEm.toISOString(),
      entregas: 1 + c._count.paradas,
      agendadaPara: c.agendadaPara?.toISOString() ?? null,
      motivo: o.motivo ? motivoParaEntregador(o.motivo as unknown as MotivoOferta) : null,
    };
  }

  async chamadaAtivaId(entregadorId: string): Promise<string | null> {
    return (await this.chamadasAtivasIds(entregadorId))[0] ?? null;
  }

  /** Em andamento, a mais antiga primeiro (a empresa pode permitir mais de uma). */
  async chamadasAtivasIds(entregadorId: string): Promise<string[]> {
    const lista = await this.prisma.chamadaEntrega.findMany({ where: { entregadorId, situacao: { in: [...SITUACOES_EM_ANDAMENTO] } }, orderBy: { aceitaEm: 'asc' }, select: { id: true } });
    return lista.map((c) => c.id);
  }

  async aceitar(entregadorId: string, ofertaId: string): Promise<ChamadaEntregador> {
    const agora = new Date();
    const chamadaId = await this.prisma.$transaction(async (tx) => {
      const o = await tx.ofertaChamada.findFirst({ where: { id: ofertaId, entregadorId } });
      if (!o) throw new NotFoundException('Oferta não encontrada.');
      const { count } = await tx.ofertaChamada.updateMany({ where: { id: ofertaId, resultado: 'PENDENTE', expiraEm: { gt: agora } }, data: { resultado: 'ACEITA', respondidaEm: agora } });
      if (!count) throw new ConflictException('Esta oferta não vale mais.');
      const ativas = await tx.chamadaEntrega.findMany({ where: { entregadorId, situacao: { in: [...SITUACOES_EM_ANDAMENTO] } }, select: { empresaId: true } });
      if (ativas.length) {
        const nova = await tx.chamadaEntrega.findUniqueOrThrow({ where: { id: o.chamadaId }, select: { empresaId: true } });
        const limite = (await tx.configuracaoEntregas.findUnique({ where: { empresaId: nova.empresaId }, select: { chamadasSimultaneas: true } }))?.chamadasSimultaneas ?? 1;
        if (!podePegarOutra(ativas, nova.empresaId, limite)) throw new ConflictException('Termine a chamada em andamento antes.');
      }
      const aceita = await tx.chamadaEntrega.updateMany({ where: { id: o.chamadaId, situacao: 'ABERTA' }, data: { situacao: 'ACEITA', entregadorId, aceitaEm: agora, distribuicaoAtiva: false, proximaTentativaEm: null, semEntregadorEm: null } });
      if (!aceita.count) {
        const agoraEsta = await tx.chamadaEntrega.findUnique({ where: { id: o.chamadaId }, select: { situacao: true } });
        throw new ConflictException(agoraEsta?.situacao === 'CANCELADA' ? 'A chamada foi cancelada.' : 'Outro entregador aceitou primeiro.');
      }
      // No modo em grupo, as outras ofertas desta chamada deixam de valer.
      await tx.ofertaChamada.updateMany({ where: { chamadaId: o.chamadaId, resultado: 'PENDENTE', id: { not: ofertaId } }, data: { resultado: 'CANCELADA', respondidaEm: agora } });
      const e = await tx.entregador.findUniqueOrThrow({ where: { id: entregadorId }, select: { nome: true } });
      await this.registrar(o.chamadaId, evento(`${primeiroNome(e.nome)} aceitou.`, 'entregador'), tx);
      return o.chamadaId;
    });
    return this.daChamada(entregadorId, chamadaId);
  }

  async recusar(entregadorId: string, ofertaId: string): Promise<void> {
    const o = await this.prisma.ofertaChamada.findFirst({ where: { id: ofertaId, entregadorId }, include: { entregador: { select: { nome: true } } } });
    if (!o) throw new NotFoundException('Oferta não encontrada.');
    const { count } = await this.prisma.ofertaChamada.updateMany({ where: { id: ofertaId, resultado: 'PENDENTE' }, data: { resultado: 'RECUSADA', respondidaEm: new Date() } });
    if (!count) return;
    await this.registrar(o.chamadaId, evento(`${primeiroNome(o.entregador.nome)} recusou.`, 'entregador'));
    // Em distribuição: segue para o próximo sem esperar o prazo.
    await this.prisma.chamadaEntrega.updateMany({ where: { id: o.chamadaId, distribuicaoAtiva: true }, data: { proximaTentativaEm: new Date() } });
  }

  async daChamada(entregadorId: string, chamadaId: string): Promise<ChamadaEntregador> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId }, include: { empresa: { select: { nomeFantasia: true, razaoSocial: true } }, paradas: { orderBy: { ordem: 'asc' } } } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    const naoLidas = await this.prisma.mensagemChamadaEntrega.count({ where: { chamadaId, autor: 'empresa', ...(c.mensagensLidasEntregadorEm ? { criadoEm: { gt: c.mensagensLidasEntregadorEm } } : {}) } });
    return { ...this.paraEntregador(c), mensagensNaoLidas: naoLidas };
  }

  private paraEntregador(c: Prisma.ChamadaEntregaGetPayload<{ include: { empresa: { select: { nomeFantasia: true; razaoSocial: true } } } }> & { paradas?: ParadaDoBanco[] }): ChamadaEntregador {
    const oc = c.ocorrencia as Ocorrencia | null;
    const paradas = c.paradas ?? [];
    const concluida = c.situacao === 'CONCLUIDA';
    const destinos: DestinoDoEntregador[] = [
      { ordem: 0, parada: c.destino as unknown as ParadaChamada, entregue: concluida || c.paradaAtual > 0 },
      ...paradas.map((p) => ({ ordem: p.ordem, parada: p.parada as unknown as ParadaChamada, entregue: concluida || !!p.entregueEm })),
    ];
    return {
      id: c.id,
      numero: c.numero,
      tipo: c.tipo as TipoChamada,
      situacao: c.situacao as SituacaoChamada,
      empresa: c.empresa.nomeFantasia || c.empresa.razaoSocial,
      origem: c.origem as unknown as ParadaChamada,
      // O destino é sempre a parada atual (na devolução, a origem): o app antigo segue funcionando, uma de cada vez.
      destino: c.devolucao ? (c.origem as unknown as ParadaChamada) : destinoAtual(c, paradas).parada,
      devolvendo: !!c.devolucao,
      pedeChecklist: ehMaquina(c),
      chegouNoPontoEm: c.chegouNoPontoEm?.toISOString() ?? null,
      espera: { toleranciaMinutos: c.esperaToleranciaMinutos, porBlocoCentavos: c.esperaPorBlocoCentavos },
      esperaCentavos: c.esperaCentavos,
      assinatura: c.assinatura as ModoAssinatura,
      pedeEtiqueta: !!c.etiquetaImpressaEm && !c.etiquetaLidaEm,
      volumes: c.volumes,
      agendadaPara: c.agendadaPara?.toISOString() ?? null,
      destinos,
      paradaAtual: c.paradaAtual,
      pedeFotoColeta: c.fotoColeta,
      pedeFotoEntrega: c.fotoEntrega,
      metros: c.metros,
      estimada: c.estimada,
      valorCentavos: c.valorCentavos,
      pedeSerie: c.tipo === 'DEVOLUCAO_MAQUINA' || !!c.serieEsperada,
      serieColetada: c.serieColetada,
      observacao: c.observacao,
      ocorrencia: oc ? { motivo: oc.motivo, texto: oc.texto } : null,
      emergenciaEm: (c.emergencia as unknown as EmergenciaChamada | null)?.em ?? null,
      aceitaEm: c.aceitaEm?.toISOString() ?? null,
      concluidaEm: c.concluidaEm?.toISOString() ?? null,
    };
  }

  async minhasChamadas(entregadorId: string): Promise<ChamadaEntregador[]> {
    const ids = await this.chamadasAtivasIds(entregadorId);
    return Promise.all(ids.map((id) => this.daChamada(entregadorId, id)));
  }

  async minhaChamada(entregadorId: string): Promise<ChamadaEntregador | null> {
    const id = await this.chamadaAtivaId(entregadorId);
    return id ? this.daChamada(entregadorId, id) : null;
  }

  /** Cada etapa confere o lugar (chegadas), a série (coleta de máquina) e o código (entrega). */
  async avancar(entregadorId: string, chamadaId: string, dto: AvancarDto): Promise<ChamadaEntregador> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId }, include: { paradas: { orderBy: { ordem: 'asc' } } } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    const etapa = PROXIMA_ETAPA[c.situacao as SituacaoChamada];
    if (!etapa || etapa.para !== dto.para) throw new ConflictException(`A chamada está em "${ROTULO_SITUACAO_CHAMADA[c.situacao as SituacaoChamada]}". Atualize a tela.`);
    if (dto.simulada) throw new ForbiddenException('Desligue o aplicativo de localização falsa para continuar.');
    if (!coordenadaValida(dto)) throw new BadRequestException('Sem localização do celular.');
    const origem = c.origem as unknown as ParadaChamada;
    const atual = destinoAtual(c, c.paradas);
    const destino = c.devolucao ? origem : atual.parada;
    const codigoEsperado = c.devolucao ? (c.codigoDevolucao ?? '') : atual.codigo;
    const maquina = ehMaquina(c) && !c.devolucao;
    const agora = new Date();
    const quando = momentoDaEtapa(dto.em, agora);
    const atrasada = etapaAtrasada(quando, agora);
    const data: Prisma.ChamadaEntregaUpdateManyMutationInput = { situacao: dto.para };
    let texto = ROTULO_SITUACAO_CHAMADA[dto.para];

    if (dto.para === 'NA_COLETA' && !chegouPerto(dto, origem, dto.precisao ?? null)) throw new BadRequestException('Você ainda não está no local da coleta.');
    if (dto.para === 'NO_DESTINO' && !chegouPerto(dto, destino, dto.precisao ?? null)) throw new BadRequestException('Você ainda não está no destino.');
    if (dto.para === 'COLETADA' && c.fotoColeta && !dto.foto) throw new BadRequestException('Tire a foto da coleta para continuar.');
    if (dto.para === 'CONCLUIDA' && c.fotoEntrega && !dto.foto) throw new BadRequestException('Tire a foto da entrega para continuar.');
    if (dto.para === 'NA_COLETA' || dto.para === 'NO_DESTINO') data.chegouNoPontoEm = quando;
    // Espera: do "cheguei" até coletar ou entregar, em blocos além da tolerância (copiada da tabela ao abrir).
    let espera = { minutos: 0, centavos: 0 };
    if (dto.para === 'COLETADA' || dto.para === 'CONCLUIDA') {
      const minutos = minutosNoPonto(c.chegouNoPontoEm, quando);
      const v = valorDaEspera(minutos, { toleranciaMinutos: c.esperaToleranciaMinutos, porBlocoCentavos: c.esperaPorBlocoCentavos });
      if (v.centavos) espera = { minutos, centavos: v.centavos };
      if (v.centavos) Object.assign(data, { esperaMinutos: { increment: v.blocos * ESPERA_BLOCO_MINUTOS }, esperaCentavos: { increment: v.centavos }, valorCentavos: { increment: v.centavos } });
    }
    const comEspera = (x: string) => (espera.centavos ? `${x.replace(/\.$/, '')}. Espera de ${espera.minutos} min no local: ${formatarCentavos(espera.centavos)}.` : x);
    // Maquininha: série, checklist e foto na coleta e na entrega (do destino principal).
    const conferirMaquina = maquina && (dto.para === 'COLETADA' || (dto.para === 'CONCLUIDA' && c.paradaAtual === 0));
    let serieDiferente: string | null = null;
    if (conferirMaquina) {
      const serie = normalizarSerie(dto.serie ?? '');
      if (serie.length < 4) throw new BadRequestException('Leia ou digite o número de série da máquina.');
      const problema = problemaNoChecklist(dto.checklist);
      if (problema) throw new BadRequestException(problema);
      const esperada = dto.para === 'COLETADA' ? c.serieEsperada : (c.serieColetada ?? c.serieEsperada);
      if (esperada && serie !== esperada) {
        if (!dto.foto) throw new BadRequestException('O número de série não confere com o da chamada. Confira a máquina ou registre uma ocorrência.');
        serieDiferente = serie;
      } else {
        const lista = checklistLimpo(dto.checklist!);
        data.checklists = { ...((c.checklists as object) ?? {}), [dto.para === 'COLETADA' ? 'COLETA' : 'ENTREGA']: lista } as never;
        if (dto.para === 'COLETADA') data.serieColetada = serie;
        texto = `${dto.para === 'COLETADA' ? 'Coletado' : 'Entregue'} (série ${serie}; ${textoDoChecklist(lista)}).`;
      }
    } else if (dto.para === 'COLETADA' && !c.devolucao) {
      // Chamada antiga (sem checklist): só a série, como antes.
      const serie = normalizarSerie(dto.serie ?? '');
      if (serie) {
        data.serieColetada = serie;
        texto = `Coletado (série ${serie}).`;
      }
    }
    if (dto.para === 'COLETADA') data.coletadaEm = quando;
    if (dto.para === 'COLETADA' && !c.devolucao) {
      // Etiqueta impressa e ainda não lida (não pegou no balcão): a coleta confere o pacote.
      if (c.etiquetaImpressaEm && !c.etiquetaLidaEm) {
        if (!dto.etiqueta) throw new BadRequestException('Leia a etiqueta de coleta do pacote.');
        if (normalizarCodigoColeta(dto.etiqueta) !== c.codigoColeta) throw new BadRequestException('Esta etiqueta não é desta chamada. Confira o pacote.');
        data.etiquetaLidaEm = quando;
      }
      // Volumes: o app novo sempre manda; o antigo não, e a chamada segue sem a contagem.
      if (dto.volumes !== undefined) {
        const problema = problemaNosVolumes(dto.volumes);
        if (problema) throw new BadRequestException(problema);
        data.volumes = dto.volumes;
        texto = `${texto.replace(/\.$/, '')} (${textoVolumes(dto.volumes)}).`;
      }
    }
    if (dto.para === 'CONCLUIDA' && c.volumes && !c.devolucao && c.paradaAtual === 0 && c.paradas.length === 0) {
      if (dto.volumesEntregues !== undefined && dto.volumesEntregues !== c.volumes) throw new BadRequestException(`Saíram ${textoVolumes(c.volumes)} na coleta. Entregue todos ou registre uma ocorrência.`);
      if (dto.volumesEntregues !== undefined) data.volumesEntregues = dto.volumesEntregues;
    }
    if (serieDiferente) return this.ocorrenciaDeSerie(c, entregadorId, serieDiferente, dto, quando);
    // Assinatura de quem recebe: junto ao código ou no lugar dele (na devolução à origem, vale o código da empresa).
    const modo = (c.devolucao ? 'NAO' : c.assinatura) as ModoAssinatura;
    if (dto.para === 'CONCLUIDA' && modo !== 'NAO') {
      const problema = problemaNaAssinatura(dto.assinatura);
      if (problema) throw new BadRequestException(problema);
    }
    const assinada = dto.para === 'CONCLUIDA' && modo !== 'NAO' ? { png: pngCinza(rasterizarAssinatura(dto.assinatura!.tracos)), recebedor: dto.assinatura!.recebedor.trim() } : null;
    if (dto.para === 'CONCLUIDA') {
      if (c.tentativasCodigo >= TENTATIVAS_CODIGO) throw new ForbiddenException(c.devolucao ? 'Código errado vezes demais. Peça para a empresa confirmar a devolução.' : 'Código errado vezes demais. Peça para a empresa confirmar a entrega.');
      if (modo !== 'NO_LUGAR_DO_CODIGO' && (dto.codigo ?? '').trim() !== codigoEsperado) {
        await this.prisma.chamadaEntrega.update({ where: { id: c.id }, data: { tentativasCodigo: { increment: 1 } } });
        throw new BadRequestException(`Código errado. Restam ${TENTATIVAS_CODIGO - c.tentativasCodigo - 1} tentativas.`);
      }
      data.concluidaEm = agora;
      if (c.devolucao) texto = 'Devolvido na origem, com o código da empresa.';
      else if (modo === 'NO_LUGAR_DO_CODIGO') texto = 'Entregue, com a assinatura de quem recebeu.';
      else if (!conferirMaquina) texto = 'Entregue, com o código do destinatário.';
      if (assinada) texto = `${texto.replace(/\.$/, '')}. Recebido por ${assinada.recebedor}${modo === 'JUNTO_AO_CODIGO' ? ' (assinou)' : ''}.`;
    }
    texto = comEspera(texto);
    const foto = dto.foto ? imagemDoDataUrl(dto.foto, 'A foto') : null;

    let ultima = true;
    await this.prisma.$transaction(async (tx) => {
      if (atrasada) texto = `${texto.replace(/\.$/, '')} (feito às ${new Intl.DateTimeFormat('pt-BR', { timeZone: config().fusoHorario, hour: '2-digit', minute: '2-digit' }).format(quando)}, enviado depois por falta de internet).`;
      if (dto.para === 'CONCLUIDA' && c.devolucao) await this.concluirDevolucao(c, texto, 'entregador', quando, tx, data);
      else if (dto.para === 'CONCLUIDA') {
        const { situacao: _s, concluidaEm: _c, ...dados } = data;
        ultima = await this.entregarParada(c, texto, 'entregador', tx, quando, dados);
      } else {
        const { count } = await tx.chamadaEntrega.updateMany({ where: { id: c.id, situacao: c.situacao, entregadorId }, data });
        if (!count) throw new ConflictException('A chamada mudou. Atualize a tela.');
      }
      if (assinada) await tx.fotoChamada.create({ data: { chamadaId: c.id, etapa: etapaDaFoto('ASSINATURA', c.paradaAtual), mime: 'image/png', bytes: new Uint8Array(assinada.png) } });
      if (foto) await tx.fotoChamada.create({ data: { chamadaId: c.id, etapa: dto.para === 'CONCLUIDA' ? etapaDaFoto('ENTREGA', c.paradaAtual) : 'COLETA', mime: foto.mime, bytes: foto.bytes } });
      // Etapa guardada sem internet: a posição dela é antiga, não vira a posição atual do entregador.
      if (!atrasada) await tx.entregador.update({ where: { id: entregadorId }, data: { lat: dto.lat, lon: dto.lon, precisaoMetros: dto.precisao ?? null, posicaoEm: agora, avisoEm: agora } });
      await tx.rastroChamada.create({ data: { chamadaId: c.id, lat: dto.lat, lon: dto.lon, em: quando } });
      if (dto.para !== 'CONCLUIDA') await this.registrar(c.id, evento(texto, 'entregador'), tx);
    });
    // O pedido (do destino principal) só conclui quando a chamada inteira termina.
    if (!c.devolucao && dto.para === 'COLETADA') await this.coletarPedidosDasParadas(c.id);
    if (!c.devolucao && dto.para === 'CONCLUIDA') await this.concluirPedidoDaParada(c);
    if (!c.devolucao && (dto.para === 'COLETADA' || (dto.para === 'CONCLUIDA' && ultima))) await this.andarPedido(c.id, dto.para);
    return this.daChamada(entregadorId, c.id);
  }

  /**
   * A máquina lida não é a esperada: em vez de só recusar, vira ocorrência (com a foto e a série lida)
   * e a empresa decide: aceitar a máquina que está lá (seguir), reabrir ou cancelar.
   */
  private async ocorrenciaDeSerie(c: { id: string; situacao: string; serieEsperada: string | null; serieColetada: string | null }, entregadorId: string, serieLida: string, dto: AvancarDto, quando: Date): Promise<ChamadaEntregador> {
    const esperada = dto.para === 'COLETADA' ? c.serieEsperada : (c.serieColetada ?? c.serieEsperada);
    const foto = imagemDoDataUrl(dto.foto!, 'A foto');
    const oc: Ocorrencia = { motivo: 'SERIE_DIFERENTE', texto: `Lida ${serieLida}, esperada ${esperada}`, em: quando.toISOString(), situacaoAnterior: c.situacao as SituacaoChamada, serieLida };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chamadaEntrega.updateMany({ where: { id: c.id, situacao: c.situacao, entregadorId }, data: { situacao: 'OCORRENCIA', ocorrencia: oc as never } });
      if (!count) throw new ConflictException('A chamada mudou. Atualize a tela.');
      await tx.fotoChamada.create({ data: { chamadaId: c.id, etapa: 'OCORRENCIA', mime: foto.mime, bytes: foto.bytes } });
      await this.registrar(c.id, evento(`Ocorrência: série diferente (lida ${serieLida}, esperada ${esperada}). A empresa decide se segue.`, 'entregador'), tx);
    });
    return this.daChamada(entregadorId, c.id);
  }

  /**
   * Pegar no balcão: o entregador lê a etiqueta de coleta impressa pela empresa e a chamada fica com
   * ele na hora, sem oferta. Valem as mesmas regras da oferta: aprovado e online, não bloqueado pela
   * empresa, termo de custódia para máquina e o limite de chamadas ao mesmo tempo.
   */
  async pegarNoBalcao(entregadorId: string, dto: BalcaoDto): Promise<ChamadaEntregador> {
    const codigo = normalizarCodigoColeta(dto.codigo);
    if (!codigo) throw new BadRequestException('Este código não é uma etiqueta de coleta do Flow.');
    if (!coordenadaValida(dto)) throw new BadRequestException('Sem localização do celular.');
    const c = await this.prisma.chamadaEntrega.findUnique({ where: { codigoColeta: codigo }, select: { id: true, empresaId: true, situacao: true, tipo: true, serieEsperada: true, origem: true, entregadorId: true } });
    if (!c) throw new NotFoundException('Etiqueta não encontrada. Confira com a empresa.');
    if (c.entregadorId === entregadorId && SITUACOES_EM_ANDAMENTO.includes(c.situacao as SituacaoChamada)) return this.daChamada(entregadorId, c.id);
    if (c.situacao !== 'ABERTA') throw new ConflictException(c.situacao === 'CANCELADA' ? 'Esta chamada foi cancelada.' : 'Esta chamada já está com outro entregador.');
    const e = await this.prisma.entregador.findUniqueOrThrow({ where: { id: entregadorId }, select: { nome: true, situacao: true, online: true, termoCustodiaVersao: true, empresas: { where: { empresaId: c.empresaId }, select: { bloqueado: true } } } });
    if (e.situacao !== 'APROVADO') throw new ForbiddenException('Seu cadastro não está liberado para pegar chamadas.');
    if (!e.online) throw new ConflictException('Fique online para pegar a chamada.');
    if (e.empresas[0]?.bloqueado) throw new ForbiddenException('Esta empresa não trabalha com você no momento.');
    if (exigeTermoCustodia(c.tipo as TipoChamada, c.serieEsperada) && !temTermoVigente(e.termoCustodiaVersao)) throw new ForbiddenException('Para levar máquina, aceite o termo de custódia na guia Avisos.');
    const origem = c.origem as unknown as ParadaChamada;
    const agora = new Date();
    const perto = chegouPerto(dto, origem, dto.precisao ?? null);
    await this.prisma.$transaction(async (tx) => {
      const ativas = await tx.chamadaEntrega.findMany({ where: { entregadorId, situacao: { in: [...SITUACOES_EM_ANDAMENTO] } }, select: { empresaId: true } });
      const limite = (await tx.configuracaoEntregas.findUnique({ where: { empresaId: c.empresaId }, select: { chamadasSimultaneas: true } }))?.chamadasSimultaneas ?? 1;
      if (!podePegarOutra(ativas, c.empresaId, limite)) throw new ConflictException('Termine a chamada em andamento antes (ou peça à empresa para permitir mais de uma).');
      const { count } = await tx.chamadaEntrega.updateMany({
        where: { id: c.id, situacao: 'ABERTA' },
        data: { situacao: perto ? 'NA_COLETA' : 'ACEITA', entregadorId, aceitaEm: agora, etiquetaLidaEm: agora, distribuicaoAtiva: false, proximaTentativaEm: null, semEntregadorEm: null, ...(perto ? { chegouNoPontoEm: agora } : {}) },
      });
      if (!count) throw new ConflictException('Outro entregador pegou esta chamada primeiro.');
      // A oferta que estava esperando outro entregador deixa de valer; a dele conta como aceita.
      await tx.ofertaChamada.updateMany({ where: { chamadaId: c.id, resultado: 'PENDENTE' }, data: { resultado: 'CANCELADA', respondidaEm: agora } });
      await tx.ofertaChamada.create({ data: { chamadaId: c.id, entregadorId, metrosAteColeta: Math.round(distanciaMetros(dto, origem)), expiraEm: agora, resultado: 'ACEITA', respondidaEm: agora } });
      await this.registrar(c.id, evento(`${primeiroNome(e.nome)} pegou no balcão (etiqueta lida)${perto ? ' e já está no local da coleta' : ''}.`, 'entregador'), tx);
    });
    return this.daChamada(entregadorId, c.id);
  }

  /** Etiqueta impressa: a coleta passa a pedir a leitura (gera o código das chamadas antigas). */
  async marcarEtiquetaImpressa(empresaId: string, chamadaId: string): Promise<{ codigo: string; numero: number; tipo: TipoChamada; empresa: string; origem: ParadaChamada; destino: ParadaChamada; agendadaPara: Date | null; paradas: number }> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId }, include: { empresa: { select: { nomeFantasia: true, razaoSocial: true } }, _count: { select: { paradas: true } } } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    let codigo = c.codigoColeta;
    if (!codigo) {
      codigo = gerarCodigoColeta((n) => randomInt(0, n));
      await this.prisma.chamadaEntrega.updateMany({ where: { id: c.id, codigoColeta: null }, data: { codigoColeta: codigo } });
      codigo = (await this.prisma.chamadaEntrega.findUniqueOrThrow({ where: { id: c.id }, select: { codigoColeta: true } })).codigoColeta!;
    }
    if (!c.etiquetaImpressaEm && !terminou(c.situacao)) {
      await this.prisma.chamadaEntrega.updateMany({ where: { id: c.id, etiquetaImpressaEm: null }, data: { etiquetaImpressaEm: new Date() } });
      await this.registrar(c.id, evento('Etiqueta de coleta impressa.', 'empresa'));
    }
    return { codigo, numero: c.numero, tipo: c.tipo as TipoChamada, empresa: c.empresa.nomeFantasia || c.empresa.razaoSocial, origem: c.origem as unknown as ParadaChamada, destino: c.destino as unknown as ParadaChamada, agendadaPara: c.agendadaPara, paradas: c._count.paradas };
  }

  /**
   * O entregador desiste antes de pegar a mercadoria: a chamada volta a esperar entregador (e à
   * distribuição, se a regra está ligada), a oferta dele vira DESISTIU e conta como não aceita.
   * Não bloqueia ninguém (docs/ENTREGAS.md, vínculo trabalhista).
   */
  async desistir(entregadorId: string, chamadaId: string, motivo: string): Promise<void> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId }, select: { id: true, empresaId: true, situacao: true, atualizadoEm: true, entregador: { select: { nome: true } } } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    if (!podeDesistir(c.situacao as SituacaoChamada)) throw new ConflictException('Depois de coletar, não dá para desistir: registre uma ocorrência.');
    const { direcionamento } = await this.empresas.config(c.empresaId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chamadaEntrega.updateMany({
        where: { id: c.id, entregadorId, situacao: c.situacao, atualizadoEm: c.atualizadoEm },
        data: { situacao: 'ABERTA', entregadorId: null, aceitaEm: null, distribuicaoAtiva: direcionamento.automatico, rodada: 0, tentativas: 0, proximaTentativaEm: direcionamento.automatico ? new Date() : null, semEntregadorEm: null },
      });
      if (!count) throw new ConflictException('A chamada mudou. Atualize a tela.');
      await tx.ofertaChamada.updateMany({ where: { chamadaId: c.id, entregadorId, resultado: 'ACEITA' }, data: { resultado: 'DESISTIU' } });
      await this.registrar(c.id, evento(`${primeiroNome(c.entregador?.nome ?? '')} desistiu${motivo.trim() ? `: ${motivo.trim()}` : ''}. A chamada voltou a esperar entregador${direcionamento.automatico ? ' (distribuição automática ligada)' : ''}.`, 'entregador'), tx);
    });
  }

  /** Posição do entregador durante a chamada, guardada para o mapa da empresa (30 dias). */
  async gravarRastro(chamadaId: string, p: { lat: number; lon: number }, agora = new Date()): Promise<void> {
    const ultimo = await this.prisma.rastroChamada.findFirst({ where: { chamadaId }, orderBy: { em: 'desc' }, select: { lat: true, lon: true, em: true } });
    if (vaiProRastro(ultimo, p, agora)) await this.prisma.rastroChamada.create({ data: { chamadaId, lat: p.lat, lon: p.lon, em: agora } });
  }

  async rastro(empresaId: string, chamadaId: string): Promise<PontoRastro[]> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, empresaId }, select: { id: true } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    const pontos = await this.prisma.rastroChamada.findMany({ where: { chamadaId }, orderBy: { em: 'asc' }, take: 5000, select: { lat: true, lon: true, em: true } });
    return pontos.map((p) => ({ lat: p.lat, lon: p.lon, em: p.em.toISOString() }));
  }

  async ocorrencia(entregadorId: string, chamadaId: string, dto: OcorrenciaDto): Promise<ChamadaEntregador> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId, situacao: { in: ['ACEITA', 'NA_COLETA', 'COLETADA', 'NO_DESTINO'] } } });
    if (!c) throw new ConflictException('Não há chamada em andamento para registrar a ocorrência.');
    const foto = imagemDoDataUrl(dto.foto, 'A foto');
    const oc: Ocorrencia = { motivo: dto.motivo, texto: dto.texto.trim(), em: new Date().toISOString(), situacaoAnterior: c.situacao as SituacaoChamada };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chamadaEntrega.updateMany({ where: { id: c.id, situacao: c.situacao }, data: { situacao: 'OCORRENCIA', ocorrencia: oc as never } });
      if (!count) throw new ConflictException('A chamada mudou. Atualize a tela.');
      await tx.fotoChamada.create({ data: { chamadaId: c.id, etapa: 'OCORRENCIA', mime: foto.mime, bytes: foto.bytes } });
      await this.registrar(c.id, evento(`Ocorrência: ${ROTULO_MOTIVO_OCORRENCIA[dto.motivo]}${oc.texto ? ` (${oc.texto})` : ''}.`, 'entregador'), tx);
    });
    return this.daChamada(entregadorId, c.id);
  }

  /** Botão de emergência: grava com a posição, entra no histórico e o aviso da empresa repete até alguém ver. */
  async emergencia(entregadorId: string, chamadaId: string, dto: EmergenciaDto): Promise<ChamadaEntregador> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId, situacao: { in: [...SITUACOES_EM_ANDAMENTO] } }, select: { id: true } });
    if (!c) throw new ConflictException('Não há chamada em andamento.');
    const posicao = dto.lat != null && dto.lon != null && coordenadaValida({ lat: dto.lat, lon: dto.lon }) ? { lat: dto.lat, lon: dto.lon } : null;
    const e: EmergenciaChamada = { em: new Date().toISOString(), posicao, texto: dto.texto.trim(), vistaEm: null, vistaPor: null };
    await this.prisma.chamadaEntrega.update({ where: { id: c.id }, data: { emergencia: e as never } });
    if (posicao) await this.prisma.entregador.update({ where: { id: entregadorId }, data: { lat: posicao.lat, lon: posicao.lon, posicaoEm: new Date(), avisoEm: new Date() } });
    await this.registrar(c.id, evento(`EMERGÊNCIA${e.texto ? `: ${e.texto}` : ''}${posicao ? ` (${posicao.lat.toFixed(5)}, ${posicao.lon.toFixed(5)})` : ''}.`, 'entregador'));
    return this.daChamada(entregadorId, c.id);
  }

  async ganhos(entregadorId: string): Promise<GanhosEntregador> {
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { entregadorId, situacao: 'CONCLUIDA' },
      orderBy: { concluidaEm: 'desc' },
      take: 100,
      include: { empresa: { select: { nomeFantasia: true, razaoSocial: true } } },
    });
    const fuso = config().fusoHorario;
    const agora = new Date();
    const hoje = diaNoFuso(agora, fuso);
    const semana = agora.getTime() - 7 * DIA_MS;
    let hojeCentavos = 0;
    let semanaCentavos = 0;
    for (const c of lista) {
      if (!c.concluidaEm) continue;
      if (diaNoFuso(c.concluidaEm, fuso) === hoje) hojeCentavos += c.valorCentavos;
      if (c.concluidaEm.getTime() >= semana) semanaCentavos += c.valorCentavos;
    }
    const aReceber = await this.prisma.chamadaEntrega.aggregate({ where: { entregadorId, situacao: 'CONCLUIDA', fechamentoId: null }, _sum: { valorCentavos: true, extraCentavos: true } });
    return { hojeCentavos, semanaCentavos, aReceberCentavos: (aReceber._sum.valorCentavos ?? 0) + (aReceber._sum.extraCentavos ?? 0), chamadas: lista.map((c) => this.paraEntregador(c)) };
  }
}

// Rotas da empresa ---------------------------------------------------------------------------

@Controller('entregas/chamadas')
export class ChamadasEmpresaController {
  constructor(
    private readonly chamadas: ChamadasService,
    private readonly direcionamento: DirecionamentoService,
  ) {}

  @Post('previa')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  previa(@EmpresaAtual() empresaId: string, @Body() dto: NovaChamadaDto): Promise<PreviaChamada> {
    return this.chamadas.previa(empresaId, { ...dto, serieEsperada: dto.serieEsperada ?? null });
  }

  @Post()
  @RequerPermissao('entrega.gerenciar')
  criar(@EmpresaAtual() empresaId: string, @Body() dto: NovaChamadaDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    return this.chamadas.criar(empresaId, dto, u.id);
  }

  @Get()
  @RequerPermissao('entrega.ver')
  listar(@EmpresaAtual() empresaId: string, @Query() f: FiltroChamadasDto): Promise<ChamadaResumo[]> {
    return this.chamadas.listar(empresaId, f.filtro ?? (f.pedidoId ? 'TODAS' : 'ATIVAS'), f.pedidoId);
  }

  @Get(':id')
  @RequerPermissao('entrega.ver')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadaResumo> {
    return this.chamadas.obter(empresaId, id);
  }

  @Get(':id/rastro')
  @RequerPermissao('entrega.ver')
  rastro(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<PontoRastro[]> {
    return this.chamadas.rastro(empresaId, id);
  }

  @Get(':id/fotos/:etapa')
  @RequerPermissao('entrega.ver')
  foto(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Param('etapa') etapa: string): Promise<{ dados: string }> {
    return this.chamadas.foto(empresaId, id, etapa);
  }

  @Get(':id/elegiveis')
  @RequerPermissao('entrega.gerenciar')
  elegiveis(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ElegivelOferta[]> {
    return this.chamadas.elegiveis(empresaId, id);
  }

  @Post(':id/oferecer')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  oferecer(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OferecerDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    return this.chamadas.oferecer(empresaId, id, dto.entregadorId, u.id);
  }

  @Post(':id/distribuir')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  async distribuir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    await this.direcionamento.ligar(empresaId, id, u.id);
    return this.chamadas.obter(empresaId, id);
  }

  @Post(':id/parar-distribuicao')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  async parar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    await this.direcionamento.parar(empresaId, id, u.id);
    return this.chamadas.obter(empresaId, id);
  }

  @Post(':id/emergencia/ciente')
  @HttpCode(200)
  @RequerPermissao('entrega.ver')
  ciente(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    return this.chamadas.cienteDaEmergencia(empresaId, id, u);
  }

  @Post(':id/cancelar-oferta')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  cancelarOferta(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadaResumo> {
    return this.chamadas.cancelarOferta(empresaId, id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  cancelar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    return this.chamadas.cancelar(empresaId, id, dto.motivo, u.id);
  }

  @Post(':id/ocorrencia')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  resolver(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolverOcorrenciaDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    return this.chamadas.resolverOcorrencia(empresaId, id, dto, u.id);
  }

  @Post(':id/concluir')
  @HttpCode(200)
  @RequerPermissao('entrega.gerenciar')
  concluir(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<ChamadaResumo> {
    return this.chamadas.concluirPelaEmpresa(empresaId, id, u.id);
  }
}

// Rotas do app do entregador ----------------------------------------------------------------

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador')
export class ChamadasEntregadorController {
  constructor(private readonly chamadas: ChamadasService) {}

  @Get('oferta')
  oferta(@EntregadorAtual() e: { id: string }): Promise<OfertaResumo | null> {
    return this.chamadas.ofertaPendente(e.id);
  }

  @Post('ofertas/:id/aceitar')
  @HttpCode(200)
  aceitar(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<ChamadaEntregador> {
    return this.chamadas.aceitar(e.id, id);
  }

  @Post('ofertas/:id/recusar')
  @HttpCode(204)
  recusar(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.chamadas.recusar(e.id, id);
  }

  @Get('chamada')
  chamada(@EntregadorAtual() e: { id: string }): Promise<ChamadaEntregador | null> {
    return this.chamadas.minhaChamada(e.id);
  }

  /** Pegar no balcão: lê a etiqueta de coleta e a chamada fica com ele. */
  @Post('balcao')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  balcao(@EntregadorAtual() e: { id: string }, @Body() dto: BalcaoDto): Promise<ChamadaEntregador> {
    return this.chamadas.pegarNoBalcao(e.id, dto);
  }

  /** Todas as em andamento (app novo; o antigo usa só a primeira, em /chamada). */
  @Get('chamadas')
  todasAsChamadas(@EntregadorAtual() e: { id: string }): Promise<ChamadaEntregador[]> {
    return this.chamadas.minhasChamadas(e.id);
  }

  @Post('chamadas/:id/avancar')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  avancar(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AvancarDto): Promise<ChamadaEntregador> {
    return this.chamadas.avancar(e.id, id, dto);
  }

  @Post('chamadas/:id/ocorrencia')
  @HttpCode(200)
  ocorrencia(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OcorrenciaDto): Promise<ChamadaEntregador> {
    return this.chamadas.ocorrencia(e.id, id, dto);
  }

  @Post('chamadas/:id/desistir')
  @HttpCode(204)
  desistir(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DesistenciaDto): Promise<void> {
    return this.chamadas.desistir(e.id, id, dto.motivo);
  }

  @Post('chamadas/:id/emergencia')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  emergencia(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmergenciaDto): Promise<ChamadaEntregador> {
    return this.chamadas.emergencia(e.id, id, dto);
  }

  @Get('ganhos')
  ganhos(@EntregadorAtual() e: { id: string }): Promise<GanhosEntregador> {
    return this.chamadas.ganhos(e.id);
  }
}
