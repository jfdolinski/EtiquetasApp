import { Controller, Get, Injectable, NotFoundException, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import {
  caminhoRastreio,
  HORAS_RASTREIO_DEPOIS_DE_TERMINAR,
  mostraCodigoAoCliente,
  mostraPosicaoAoCliente,
  pontoDoCliente,
  previsaoMinutos,
  primeiroNome,
  SITUACOES_EM_ANDAMENTO,
  textoParaCliente,
  type EntregaDoPedidoPublica,
  type ParadaChamada,
  type RastreioPublico,
  type SituacaoChamada,
  type TipoChamada,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { Publico } from '../auth/decorators';
import { config } from '../config';
import { cifrar, decifrar, sha256 } from '../cripto';
import { PrismaService } from '../prisma/prisma.service';
import { dataUrl } from './imagens';
import { MapasService } from './mapas';

const CODIGO = /^[A-Za-z0-9_-]{16,64}$/;

/** Código novo do link do destinatário: só o hash (busca) e o cifrado (a empresa manda de novo) ficam no banco. */
export function novoRastreio(): { codigo: string; rastreioHash: string; rastreioCifrado: string } {
  const codigo = randomBytes(16).toString('base64url');
  return { codigo, rastreioHash: sha256(codigo), rastreioCifrado: cifrar(codigo, config().chaveCriptografia) };
}

export function caminhoDoRastreio(cifrado: string | null): string | null {
  if (!cifrado) return null;
  try {
    return caminhoRastreio(decifrar(cifrado, config().chaveCriptografia));
  } catch {
    return null;
  }
}

/**
 * Página pública do destinatário (docs/ENTREGAS.md, "Link de acompanhamento"): situação, entregador
 * (primeiro nome, veículo, placa, foto), posição só no trecho até ele e o código de confirmação.
 * Some depois de `HORAS_RASTREIO_DEPOIS_DE_TERMINAR` da conclusão ou do cancelamento.
 */
@Injectable()
export class RastreioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapas: MapasService,
  ) {}

  private async achar(codigo: string, agora: Date) {
    if (!CODIGO.test(codigo)) throw new NotFoundException('Acompanhamento não encontrado. Confira o link.');
    const c = await this.prisma.chamadaEntrega.findUnique({
      where: { rastreioHash: sha256(codigo) },
      include: { empresa: { select: { nomeFantasia: true, razaoSocial: true } }, entregador: { select: { id: true, nome: true, veiculo: true, placa: true, lat: true, lon: true, posicaoEm: true, documentos: { where: { tipo: 'SELFIE' }, select: { id: true }, take: 1 } } } },
    });
    if (!c) throw new NotFoundException('Acompanhamento não encontrado. Confira o link.');
    const fim = c.concluidaEm ?? c.canceladaEm;
    if (fim && agora.getTime() - fim.getTime() > HORAS_RASTREIO_DEPOIS_DE_TERMINAR * 3_600_000) throw new NotFoundException('Este acompanhamento já terminou.');
    return c;
  }

  async publico(codigo: string, agora = new Date()): Promise<RastreioPublico> {
    const c = await this.achar(codigo, agora);
    const tipo = c.tipo as TipoChamada;
    const situacao = c.situacao as SituacaoChamada;
    const cliente = pontoDoCliente(tipo, c.origem as unknown as ParadaChamada, c.destino as unknown as ParadaChamada);
    const e = c.entregador;
    const andamento = SITUACOES_EM_ANDAMENTO.includes(situacao);
    const posicao = e && andamento && mostraPosicaoAoCliente(tipo, situacao) && e.lat != null && e.lon != null && e.posicaoEm ? { lat: e.lat, lon: e.lon, em: e.posicaoEm.toISOString() } : null;
    return {
      numero: c.numero,
      tipo,
      situacao,
      texto: textoParaCliente(tipo, situacao),
      empresa: c.empresa.nomeFantasia || c.empresa.razaoSocial,
      entregador: e && andamento ? { nome: primeiroNome(e.nome), veiculo: e.veiculo as TipoVeiculo, placa: e.placa, temFoto: e.documentos.length > 0 } : e && situacao === 'CONCLUIDA' ? { nome: primeiroNome(e.nome), veiculo: e.veiculo as TipoVeiculo, placa: null, temFoto: false } : null,
      pontoCliente: { lat: cliente.lat, lon: cliente.lon },
      posicao,
      previsaoMinutos: posicao && e ? previsaoMinutos(posicao, cliente, e.veiculo as TipoVeiculo) : null,
      codigoConfirmacao: mostraCodigoAoCliente(tipo, situacao) ? c.codigoConfirmacao : null,
      concluidaEm: c.concluidaEm?.toISOString() ?? null,
      atualizadoEm: agora.toISOString(),
      mapa: this.mapas.configuracaoDoMapa(),
    };
  }

  /** A selfie do cadastro, só enquanto a chamada está em andamento. */
  async foto(codigo: string): Promise<{ dados: string }> {
    const c = await this.achar(codigo, new Date());
    if (!c.entregador || !SITUACOES_EM_ANDAMENTO.includes(c.situacao as SituacaoChamada)) throw new NotFoundException('Sem foto.');
    const d = await this.prisma.documentoEntregador.findFirst({ where: { entregadorId: c.entregador.id, tipo: 'SELFIE' }, select: { mime: true, bytes: true } });
    if (!d) throw new NotFoundException('Sem foto.');
    return { dados: dataUrl(d.mime, d.bytes) };
  }

  /** Para o acompanhamento do pedido: a chamada mais recente que o leva, se não foi cancelada. */
  async doPedido(pedidoId: string): Promise<EntregaDoPedidoPublica | null> {
    const c = await this.prisma.chamadaEntrega.findFirst({
      where: { pedidoId, situacao: { not: 'CANCELADA' }, rastreioCifrado: { not: null } },
      orderBy: { criadoEm: 'desc' },
      select: { tipo: true, situacao: true, rastreioCifrado: true, entregador: { select: { nome: true } } },
    });
    const caminho = caminhoDoRastreio(c?.rastreioCifrado ?? null);
    if (!c || !caminho) return null;
    return { caminho, texto: textoParaCliente(c.tipo as TipoChamada, c.situacao as SituacaoChamada), entregadorNome: c.entregador ? primeiroNome(c.entregador.nome) : null };
  }
}

@Publico()
@Controller('rastreio')
export class RastreioController {
  constructor(private readonly rastreio: RastreioService) {}

  @Get(':codigo')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  publico(@Param('codigo') codigo: string): Promise<RastreioPublico> {
    return this.rastreio.publico(codigo);
  }

  @Get(':codigo/foto')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  foto(@Param('codigo') codigo: string): Promise<{ dados: string }> {
    return this.rastreio.foto(codigo);
  }
}
