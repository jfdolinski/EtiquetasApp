import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  DIAS_MEDIA_AVALIACAO,
  diaNoFuso,
  destinoDoPedido,
  inicioDoPeriodo,
  LIMITE_COMENTARIO_AVALIACAO,
  LIMITE_TEXTO_CONTESTACAO,
  minutosDoFuso,
  pedidoPodeChamarEntregador,
  PERIODOS_EXTRATO,
  podeContestar,
  primeiroNome,
  problemaNaAvaliacao,
  problemaNoExtra,
  resumoDoEndereco,
  SITUACOES_EM_ANDAMENTO,
  totalDaChamada,
  type APagarEntregador,
  type ContestacaoEmpresa,
  type EnderecoPedido,
  type ExtratoEntregador,
  type FechamentoResumo,
  type LinhaExtrato,
  type LinhaFechamento,
  type ModalidadeEntrega,
  type ParadaChamada,
  type PeriodoExtrato,
  type RascunhoDoPedido,
  type ReputacaoEntregador,
  type SituacaoPedido,
  type TipoChamada,
  type TipoVeiculo,
} from '@etiquetas/shared';
import { Prisma } from '@prisma/client';
import { EmpresaAtual, Publico, RequerPermissao, UsuarioAtual } from '../auth/decorators';
import type { UsuarioRequisicao } from '../auth/usuario-requisicao';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { EntregadorAtual, EntregadorGuard } from './guarda';
import { dataUrl, imagemDoDataUrl } from './imagens';
import { MapasService } from './mapas';

const DIA_MS = 86_400_000;

class NovoFechamentoDto {
  @IsUUID('all', { message: 'Entregador inválido.' }) entregadorId: string;
  @IsArray() @ArrayMinSize(1, { message: 'Escolha ao menos uma chamada.' }) @ArrayMaxSize(1000) @IsUUID('all', { each: true }) chamadaIds: string[];
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Informe a data do pagamento.' }) pagoEm: string;
  @IsString() @MaxLength(300) observacao: string;
  @IsOptional() @IsString() @MaxLength(7_200_000) comprovante?: string | null;
}

class ExtraDto {
  @IsInt() @Min(0) @Max(100_000) extraCentavos: number;
  @IsString() @MaxLength(200) motivo: string;
}

class AvaliacaoDto {
  @IsInt() @Min(1, { message: 'A nota vai de 1 a 5.' }) @Max(5, { message: 'A nota vai de 1 a 5.' }) nota: number;
  @IsString() @MaxLength(LIMITE_COMENTARIO_AVALIACAO) comentario: string;
}

class RespostaDto {
  @IsString() @MinLength(2, { message: 'Escreva a resposta.' }) @MaxLength(LIMITE_TEXTO_CONTESTACAO) resposta: string;
}

class ContestarDto {
  @IsString() @MinLength(5, { message: 'Explique o que está errado.' }) @MaxLength(LIMITE_TEXTO_CONTESTACAO) mensagem: string;
}

class FiltroContestacoesDto {
  @IsOptional() @IsIn(['ABERTAS', 'TODAS']) filtro?: 'ABERTAS' | 'TODAS';
}

class ExtratoDto {
  @IsOptional() @IsIn(PERIODOS_EXTRATO) periodo?: PeriodoExtrato;
}

const destinoCurto = (d: unknown) => resumoDoEndereco((d as ParadaChamada).endereco) || (d as ParadaChamada).endereco.slice(0, 60);

/**
 * Entregas, etapa 4 (docs/ENTREGAS.md): o que cada empresa deve a cada entregador e o registro do
 * pagamento feito fora do sistema, extras, contestações, avaliações e a chamada criada de um Pedido.
 */
@Injectable()
export class FechamentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly mapas: MapasService,
  ) {}

  // A pagar ------------------------------------------------------------------------------------

  async aPagar(empresaId: string): Promise<APagarEntregador[]> {
    const grupos = await this.prisma.chamadaEntrega.groupBy({
      by: ['entregadorId'],
      where: { empresaId, situacao: 'CONCLUIDA', fechamentoId: null, entregadorId: { not: null } },
      _sum: { valorCentavos: true, extraCentavos: true },
      _count: { _all: true },
      _min: { concluidaEm: true },
    });
    if (!grupos.length) return [];
    const ids = grupos.map((g) => g.entregadorId!);
    const [entregadores, abertas] = await Promise.all([
      this.prisma.entregador.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, veiculo: true, chavePix: true } }),
      this.prisma.contestacaoEntrega.groupBy({ by: ['entregadorId'], where: { empresaId, entregadorId: { in: ids }, respondidaEm: null }, _count: { _all: true } }),
    ]);
    const porId = new Map(entregadores.map((e) => [e.id, e]));
    const contestacoes = new Map(abertas.map((a) => [a.entregadorId, a._count._all]));
    return grupos
      .map((g) => {
        const e = porId.get(g.entregadorId!)!;
        return {
          // A chave Pix é para a empresa pagar; o CPF continua fora.
          entregador: { id: e.id, nome: primeiroNome(e.nome), veiculo: e.veiculo as TipoVeiculo, chavePix: e.chavePix },
          quantidade: g._count._all,
          totalCentavos: (g._sum.valorCentavos ?? 0) + (g._sum.extraCentavos ?? 0),
          maisAntiga: g._min.concluidaEm!.toISOString(),
          contestacoesAbertas: contestacoes.get(g.entregadorId!) ?? 0,
        };
      })
      .sort((a, b) => a.maisAntiga.localeCompare(b.maisAntiga));
  }

  async pendentes(empresaId: string, entregadorId: string): Promise<LinhaFechamento[]> {
    const lista = await this.prisma.chamadaEntrega.findMany({
      where: { empresaId, entregadorId, situacao: 'CONCLUIDA', fechamentoId: null },
      orderBy: { concluidaEm: 'asc' },
      take: 1000,
      include: { contestacoes: { where: { respondidaEm: null }, select: { id: true } } },
    });
    return lista.map((c) => this.linha(c));
  }

  private linha(c: Prisma.ChamadaEntregaGetPayload<{ include: { contestacoes: { select: { id: true } } } }>): LinhaFechamento {
    return {
      chamadaId: c.id,
      numero: c.numero,
      tipo: c.tipo as TipoChamada,
      concluidaEm: c.concluidaEm!.toISOString(),
      destino: destinoCurto(c.destino),
      valorCentavos: c.valorCentavos,
      extraCentavos: c.extraCentavos,
      extraMotivo: c.extraMotivo,
      contestacaoAberta: c.contestacoes.length > 0,
    };
  }

  // Fechamentos --------------------------------------------------------------------------------

  async fechar(empresaId: string, dto: NovoFechamentoDto, autorId: string): Promise<FechamentoResumo> {
    const pagoEm = new Date(`${dto.pagoEm}T00:00:00Z`);
    const hoje = diaNoFuso(new Date(), config().fusoHorario);
    if (Number.isNaN(pagoEm.getTime()) || dto.pagoEm > hoje) throw new BadRequestException('A data do pagamento não pode ser no futuro.');
    const comprovante = dto.comprovante ? imagemDoDataUrl(dto.comprovante, 'O comprovante') : null;
    const ids = [...new Set(dto.chamadaIds)];
    const id = await this.prisma.$transaction(async (tx) => {
      const chamadas = await tx.chamadaEntrega.findMany({ where: { id: { in: ids }, empresaId, entregadorId: dto.entregadorId, situacao: 'CONCLUIDA', fechamentoId: null }, select: { id: true, valorCentavos: true, extraCentavos: true } });
      if (chamadas.length !== ids.length) throw new ConflictException('Alguma chamada já foi paga ou não é deste entregador. Recarregue a lista.');
      const total = chamadas.reduce((s, c) => s + totalDaChamada(c), 0);
      const f = await tx.fechamentoEntrega.create({
        data: { empresaId, entregadorId: dto.entregadorId, pagoEm, quantidade: chamadas.length, totalCentavos: total, observacao: dto.observacao.trim(), comprovanteMime: comprovante?.mime ?? null, comprovante: comprovante?.bytes ?? null, criadoPorId: autorId },
      });
      // Reivindica: duas abas pagando a mesma chamada não passam.
      const { count } = await tx.chamadaEntrega.updateMany({ where: { id: { in: ids }, fechamentoId: null }, data: { fechamentoId: f.id } });
      if (count !== ids.length) throw new ConflictException('Alguma chamada foi paga agora mesmo. Recarregue a lista.');
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.fechamento.registrar', entidade: 'FechamentoEntrega', entidadeId: f.id, detalhes: { entregadorId: dto.entregadorId, quantidade: chamadas.length, totalCentavos: total, pagoEm: dto.pagoEm } }, tx);
      return f.id;
    });
    return this.obterFechamento(empresaId, id);
  }

  async fechamentos(empresaId: string): Promise<FechamentoResumo[]> {
    const lista = await this.prisma.fechamentoEntrega.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 200,
      select: { id: true, entregadorId: true, pagoEm: true, quantidade: true, totalCentavos: true, observacao: true, comprovanteMime: true, criadoEm: true, entregador: { select: { nome: true } }, criadoPor: { select: { nome: true } } },
    });
    return lista.map((f) => this.resumoFechamento(f));
  }

  private resumoFechamento(f: { id: string; entregadorId: string; pagoEm: Date; quantidade: number; totalCentavos: number; observacao: string; comprovanteMime: string | null; criadoEm: Date; entregador: { nome: string }; criadoPor: { nome: string } | null }): FechamentoResumo {
    return {
      id: f.id,
      entregadorId: f.entregadorId,
      entregadorNome: primeiroNome(f.entregador.nome),
      pagoEm: f.pagoEm.toISOString().slice(0, 10),
      quantidade: f.quantidade,
      totalCentavos: f.totalCentavos,
      observacao: f.observacao,
      temComprovante: !!f.comprovanteMime,
      criadoPorNome: f.criadoPor?.nome ?? null,
      criadoEm: f.criadoEm.toISOString(),
    };
  }

  async obterFechamento(empresaId: string, id: string): Promise<FechamentoResumo> {
    const f = await this.prisma.fechamentoEntrega.findFirst({
      where: { id, empresaId },
      select: {
        id: true,
        entregadorId: true,
        pagoEm: true,
        quantidade: true,
        totalCentavos: true,
        observacao: true,
        comprovanteMime: true,
        criadoEm: true,
        entregador: { select: { nome: true } },
        criadoPor: { select: { nome: true } },
        chamadas: { orderBy: { concluidaEm: 'asc' }, include: { contestacoes: { where: { respondidaEm: null }, select: { id: true } } } },
      },
    });
    if (!f) throw new NotFoundException('Pagamento não encontrado.');
    return { ...this.resumoFechamento(f), chamadas: f.chamadas.map((c) => this.linha(c)) };
  }

  async comprovante(empresaId: string, id: string): Promise<{ dados: string }> {
    const f = await this.prisma.fechamentoEntrega.findFirst({ where: { id, empresaId }, select: { comprovante: true, comprovanteMime: true } });
    if (!f?.comprovante || !f.comprovanteMime) throw new NotFoundException('Sem comprovante.');
    return { dados: dataUrl(f.comprovanteMime, f.comprovante) };
  }

  /** Registrou errado: as chamadas voltam para "a pagar". */
  async desfazer(empresaId: string, id: string, autorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const f = await tx.fechamentoEntrega.findFirst({ where: { id, empresaId }, select: { id: true, entregadorId: true, totalCentavos: true } });
      if (!f) throw new NotFoundException('Pagamento não encontrado.');
      await tx.chamadaEntrega.updateMany({ where: { fechamentoId: id, empresaId }, data: { fechamentoId: null } });
      await tx.fechamentoEntrega.delete({ where: { id } });
      await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.fechamento.desfazer', entidade: 'FechamentoEntrega', entidadeId: id, detalhes: { entregadorId: f.entregadorId, totalCentavos: f.totalCentavos } }, tx);
    });
  }

  // Extra, avaliação e contestação ---------------------------------------------------------------

  async extra(empresaId: string, chamadaId: string, dto: ExtraDto, autorId: string): Promise<void> {
    const problema = problemaNoExtra(dto.extraCentavos, dto.motivo);
    if (problema) throw new BadRequestException(problema);
    const { count } = await this.prisma.chamadaEntrega.updateMany({ where: { id: chamadaId, empresaId, situacao: 'CONCLUIDA', fechamentoId: null }, data: { extraCentavos: dto.extraCentavos, extraMotivo: dto.extraCentavos ? dto.motivo.trim() : '' } });
    if (!count) throw new ConflictException('Só dá para lançar extra em chamada concluída e ainda não paga.');
    await this.registrar(chamadaId, dto.extraCentavos ? `Extra de R$ ${(dto.extraCentavos / 100).toFixed(2).replace('.', ',')}: ${dto.motivo.trim()}.` : 'Extra retirado.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.extra', entidade: 'ChamadaEntrega', entidadeId: chamadaId, detalhes: { extraCentavos: dto.extraCentavos, motivo: dto.motivo.trim() } });
  }

  async avaliar(empresaId: string, chamadaId: string, dto: AvaliacaoDto, autorId: string): Promise<void> {
    const problema = problemaNaAvaliacao(dto.nota, dto.comentario);
    if (problema) throw new BadRequestException(problema);
    // Uma vez só: a nota entra na fila de todas as empresas.
    const { count } = await this.prisma.chamadaEntrega.updateMany({ where: { id: chamadaId, empresaId, situacao: 'CONCLUIDA', avaliadaEm: null, entregadorId: { not: null } }, data: { avaliacaoNota: dto.nota, avaliacaoComentario: dto.comentario.trim(), avaliadaEm: new Date() } });
    if (!count) throw new ConflictException('Só dá para avaliar chamada concluída, uma vez.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.chamada.avaliar', entidade: 'ChamadaEntrega', entidadeId: chamadaId, detalhes: { nota: dto.nota } });
  }

  async contestacoes(empresaId: string, filtro: 'ABERTAS' | 'TODAS'): Promise<ContestacaoEmpresa[]> {
    const lista = await this.prisma.contestacaoEntrega.findMany({
      where: { empresaId, ...(filtro === 'ABERTAS' ? { respondidaEm: null } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: 200,
      include: { entregador: { select: { nome: true } }, chamada: { select: { numero: true, valorCentavos: true, extraCentavos: true, fechamentoId: true } } },
    });
    return lista.map((c) => ({
      id: c.id,
      chamadaId: c.chamadaId,
      numero: c.chamada.numero,
      entregadorNome: primeiroNome(c.entregador.nome),
      totalCentavos: totalDaChamada(c.chamada),
      pago: !!c.chamada.fechamentoId,
      mensagem: c.mensagem,
      criadoEm: c.criadoEm.toISOString(),
      resposta: c.resposta,
      respondidaEm: c.respondidaEm?.toISOString() ?? null,
    }));
  }

  async responder(empresaId: string, id: string, resposta: string, autorId: string): Promise<void> {
    const c = await this.prisma.contestacaoEntrega.findFirst({ where: { id, empresaId }, select: { chamadaId: true } });
    if (!c) throw new NotFoundException('Contestação não encontrada.');
    const { count } = await this.prisma.contestacaoEntrega.updateMany({ where: { id, empresaId, respondidaEm: null }, data: { resposta: resposta.trim(), respondidaEm: new Date(), respondidaPorId: autorId } });
    if (!count) throw new ConflictException('Esta contestação já foi respondida.');
    await this.registrar(c.chamadaId, `Empresa respondeu à contestação: ${resposta.trim()}`, 'empresa');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'entrega.contestacao.responder', entidade: 'ContestacaoEntrega', entidadeId: id });
  }

  private async registrar(chamadaId: string, texto: string, por: 'empresa' | 'entregador' = 'empresa') {
    const e = [{ em: new Date().toISOString(), texto, por }];
    await this.prisma.$executeRaw`UPDATE chamadas_entrega SET historico = historico || ${JSON.stringify(e)}::jsonb WHERE id = ${chamadaId}::uuid`;
  }

  // Pedido → chamada -----------------------------------------------------------------------------

  /** O destino já preenchido a partir do pedido: ponto do celular do cliente ou, sem ele, a busca do endereço. */
  async rascunhoDoPedido(empresaId: string, pedidoId: string): Promise<RascunhoDoPedido> {
    const p = await this.prisma.pedido.findFirst({ where: { id: pedidoId, empresaId }, select: { id: true, numero: true, situacao: true, modalidade: true, endereco: true, clienteNome: true, clienteTelefone: true, observacao: true } });
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    const endereco = p.endereco as unknown as EnderecoPedido | null;
    if (!pedidoPodeChamarEntregador({ modalidade: p.modalidade as ModalidadeEntrega, situacao: p.situacao as SituacaoPedido, endereco })) throw new ConflictException('Só pedido com entrega, em separação ou saindo, chama entregador.');
    const destino = destinoDoPedido({ clienteNome: p.clienteNome, clienteTelefone: p.clienteTelefone, endereco: endereco!, observacao: p.observacao });
    let origemDoPonto: RascunhoDoPedido['origemDoPonto'] = endereco!.localizacao ? 'CLIENTE' : 'NENHUM';
    if (origemDoPonto === 'NENHUM') {
      const achados = await this.mapas.geocodificar(`${endereco!.rua}, ${endereco!.semNumero ? '' : endereco!.numero}, ${endereco!.cidade}, ${endereco!.uf}`).catch(() => []);
      if (achados[0]) {
        destino.lat = achados[0].lat;
        destino.lon = achados[0].lon;
        origemDoPonto = 'ENDERECO';
      }
    }
    const ativa = await this.prisma.chamadaEntrega.findFirst({ where: { empresaId, pedidoId, situacao: { in: ['ABERTA', ...SITUACOES_EM_ANDAMENTO] } }, select: { id: true, numero: true } });
    return { pedidoId: p.id, numero: p.numero, destino, origemDoPonto, observacao: `Pedido nº ${p.numero}`, chamadaAtiva: ativa };
  }

  // Entregador ---------------------------------------------------------------------------------

  async extrato(entregadorId: string, periodo: PeriodoExtrato, agora = new Date()): Promise<ExtratoEntregador> {
    const fuso = config().fusoHorario;
    const desde = inicioDoPeriodo(periodo, agora, diaNoFuso(agora, fuso), minutosDoFuso(agora, fuso));
    const [lista, aReceber, pagos] = await Promise.all([
      this.prisma.chamadaEntrega.findMany({
        where: { entregadorId, situacao: 'CONCLUIDA', ...(desde ? { concluidaEm: { gte: desde } } : {}) },
        orderBy: { concluidaEm: 'desc' },
        take: 300,
        include: {
          empresa: { select: { nomeFantasia: true, razaoSocial: true } },
          fechamento: { select: { pagoEm: true } },
          contestacoes: { orderBy: { criadoEm: 'desc' }, take: 1 },
        },
      }),
      this.prisma.chamadaEntrega.aggregate({ where: { entregadorId, situacao: 'CONCLUIDA', fechamentoId: null }, _sum: { valorCentavos: true, extraCentavos: true } }),
      this.prisma.fechamentoEntrega.aggregate({ where: { entregadorId, ...(desde ? { pagoEm: { gte: new Date(diaNoFuso(desde, fuso) + 'T00:00:00Z') } } : {}) }, _sum: { totalCentavos: true } }),
    ]);
    const linhas: LinhaExtrato[] = lista.map((c) => {
      const ct = c.contestacoes[0];
      return {
        chamadaId: c.id,
        numero: c.numero,
        empresa: c.empresa.nomeFantasia || c.empresa.razaoSocial,
        tipo: c.tipo as TipoChamada,
        concluidaEm: c.concluidaEm!.toISOString(),
        metros: c.metros,
        valorCentavos: c.valorCentavos,
        extraCentavos: c.extraCentavos,
        extraMotivo: c.extraMotivo,
        situacao: c.fechamento ? 'PAGO' : 'A_RECEBER',
        pagoEm: c.fechamento?.pagoEm.toISOString().slice(0, 10) ?? null,
        contestacao: ct ? { id: ct.id, mensagem: ct.mensagem, criadoEm: ct.criadoEm.toISOString(), resposta: ct.resposta, respondidaEm: ct.respondidaEm?.toISOString() ?? null } : null,
        podeContestar: podeContestar(c.concluidaEm, agora) && !(ct && !ct.respondidaEm),
      };
    });
    return {
      periodo,
      periodoCentavos: linhas.reduce((s, l) => s + l.valorCentavos + l.extraCentavos, 0),
      aReceberCentavos: (aReceber._sum.valorCentavos ?? 0) + (aReceber._sum.extraCentavos ?? 0),
      pagoCentavos: pagos._sum.totalCentavos ?? 0,
      empresas: [...new Set(linhas.map((l) => l.empresa))].sort(),
      linhas,
    };
  }

  async contestar(entregadorId: string, chamadaId: string, mensagem: string): Promise<void> {
    const c = await this.prisma.chamadaEntrega.findFirst({ where: { id: chamadaId, entregadorId, situacao: 'CONCLUIDA' }, select: { id: true, empresaId: true, concluidaEm: true } });
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    if (!podeContestar(c.concluidaEm, new Date())) throw new ConflictException('O prazo para contestar esta chamada acabou.');
    await this.prisma.$transaction(async (tx) => {
      // Uma aberta por chamada: trava a linha da chamada para duas não nascerem juntas.
      await tx.$queryRaw`SELECT id FROM chamadas_entrega WHERE id = ${chamadaId}::uuid FOR UPDATE`;
      if (await tx.contestacaoEntrega.count({ where: { chamadaId, respondidaEm: null } })) throw new ConflictException('Já há uma contestação esperando resposta da empresa.');
      await tx.contestacaoEntrega.create({ data: { chamadaId, empresaId: c.empresaId, entregadorId, mensagem: mensagem.trim() } });
    });
    await this.registrar(chamadaId, `Entregador contestou: ${mensagem.trim()}`, 'entregador');
  }

  async reputacao(entregadorId: string, agora = new Date()): Promise<ReputacaoEntregador> {
    const [media, respostas] = await Promise.all([
      this.prisma.chamadaEntrega.aggregate({ where: { entregadorId, avaliadaEm: { gte: new Date(agora.getTime() - DIAS_MEDIA_AVALIACAO * DIA_MS) } }, _avg: { avaliacaoNota: true }, _count: { avaliacaoNota: true } }),
      this.prisma.ofertaChamada.groupBy({ by: ['resultado'], where: { entregadorId, criadoEm: { gte: new Date(agora.getTime() - 30 * DIA_MS) }, resultado: { in: ['ACEITA', 'RECUSADA', 'EXPIRADA'] } }, _count: { _all: true } }),
    ]);
    const ofertas = respostas.reduce((s, r) => s + r._count._all, 0);
    const aceitas = respostas.find((r) => r.resultado === 'ACEITA')?._count._all ?? 0;
    return {
      avaliacaoMedia: media._avg.avaliacaoNota == null ? null : Math.round(media._avg.avaliacaoNota * 10) / 10,
      avaliacoes: media._count.avaliacaoNota,
      taxaAceite: ofertas ? aceitas / ofertas : null,
      ofertas30d: ofertas,
    };
  }
}

// Rotas da empresa ---------------------------------------------------------------------------

@Controller('entregas')
export class FechamentoController {
  constructor(private readonly fechamento: FechamentoService) {}

  @Get('financeiro/a-pagar')
  @RequerPermissao('entrega.financeiro')
  aPagar(@EmpresaAtual() empresaId: string): Promise<APagarEntregador[]> {
    return this.fechamento.aPagar(empresaId);
  }

  @Get('financeiro/a-pagar/:entregadorId')
  @RequerPermissao('entrega.financeiro')
  pendentes(@EmpresaAtual() empresaId: string, @Param('entregadorId', ParseUUIDPipe) id: string): Promise<LinhaFechamento[]> {
    return this.fechamento.pendentes(empresaId, id);
  }

  @Post('financeiro/fechamentos')
  @RequerPermissao('entrega.financeiro')
  fechar(@EmpresaAtual() empresaId: string, @Body() dto: NovoFechamentoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<FechamentoResumo> {
    return this.fechamento.fechar(empresaId, dto, u.id);
  }

  @Get('financeiro/fechamentos')
  @RequerPermissao('entrega.financeiro')
  fechamentos(@EmpresaAtual() empresaId: string): Promise<FechamentoResumo[]> {
    return this.fechamento.fechamentos(empresaId);
  }

  @Get('financeiro/fechamentos/:id')
  @RequerPermissao('entrega.financeiro')
  obter(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<FechamentoResumo> {
    return this.fechamento.obterFechamento(empresaId, id);
  }

  @Get('financeiro/fechamentos/:id/comprovante')
  @RequerPermissao('entrega.financeiro')
  comprovante(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string): Promise<{ dados: string }> {
    return this.fechamento.comprovante(empresaId, id);
  }

  @Delete('financeiro/fechamentos/:id')
  @HttpCode(204)
  @RequerPermissao('entrega.financeiro')
  desfazer(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.fechamento.desfazer(empresaId, id, u.id);
  }

  @Get('financeiro/contestacoes')
  @RequerPermissao('entrega.financeiro')
  contestacoes(@EmpresaAtual() empresaId: string, @Query() f: FiltroContestacoesDto): Promise<ContestacaoEmpresa[]> {
    return this.fechamento.contestacoes(empresaId, f.filtro ?? 'ABERTAS');
  }

  @Post('financeiro/contestacoes/:id/responder')
  @HttpCode(204)
  @RequerPermissao('entrega.financeiro')
  responder(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespostaDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.fechamento.responder(empresaId, id, dto.resposta, u.id);
  }

  @Post('chamadas/:id/extra')
  @HttpCode(204)
  @RequerPermissao('entrega.financeiro')
  extra(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtraDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.fechamento.extra(empresaId, id, dto, u.id);
  }

  @Post('chamadas/:id/avaliar')
  @HttpCode(204)
  @RequerPermissao('entrega.gerenciar')
  avaliar(@EmpresaAtual() empresaId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AvaliacaoDto, @UsuarioAtual() u: UsuarioRequisicao): Promise<void> {
    return this.fechamento.avaliar(empresaId, id, dto, u.id);
  }

  @Get('pedidos/:pedidoId/rascunho')
  @RequerPermissao('entrega.gerenciar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  rascunho(@EmpresaAtual() empresaId: string, @Param('pedidoId', ParseUUIDPipe) id: string): Promise<RascunhoDoPedido> {
    return this.fechamento.rascunhoDoPedido(empresaId, id);
  }
}

// Rotas do app do entregador ----------------------------------------------------------------

@Publico()
@UseGuards(EntregadorGuard)
@Controller('entregador')
export class FechamentoEntregadorController {
  constructor(private readonly fechamento: FechamentoService) {}

  @Get('extrato')
  extrato(@EntregadorAtual() e: { id: string }, @Query() dto: ExtratoDto): Promise<ExtratoEntregador> {
    return this.fechamento.extrato(e.id, dto.periodo ?? 'SEMANA');
  }

  @Post('chamadas/:id/contestar')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  contestar(@EntregadorAtual() e: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContestarDto): Promise<void> {
    return this.fechamento.contestar(e.id, id, dto.mensagem);
  }

  @Get('reputacao')
  reputacao(@EntregadorAtual() e: { id: string }): Promise<ReputacaoEntregador> {
    return this.fechamento.reputacao(e.id);
  }
}
