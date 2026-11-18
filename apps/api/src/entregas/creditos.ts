import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  MAX_PEDIDOS_CREDITO_ABERTOS,
  PARAMETROS_ENTREGAS_PADRAO,
  pixConfigurado,
  pixCopiaECola,
  problemaNoPacote,
  problemaNosParametrosEntregas,
  saldoDeDiarias,
  type CreditosEntregador,
  type MovimentoDiarias,
  type PacoteCredito,
  type ParametrosEntregasPlataforma,
  type PedidoCreditoAdmin,
  type PedidoCreditoResumo,
  type SituacaoPedidoCredito,
} from '@etiquetas/shared';
import type { Prisma } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { imagemDoDataUrl } from './imagens';

const DIA_MS = 86_400_000;
const ALFABETO_TXID = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function gerarTxid(): string {
  return 'ENT' + [...randomBytes(10)].map((b) => ALFABETO_TXID[b % ALFABETO_TXID.length]).join('');
}

type PedidoDoBanco = {
  id: string;
  pacoteNome: string;
  diarias: number;
  precoCentavos: number;
  validadeDias: number;
  situacao: string;
  txid: string;
  pagamentoInformadoEm: Date | null;
  comprovanteMime: string | null;
  motivo: string | null;
  criadoEm: Date;
  decididoEm: Date | null;
};

const SELECAO_PEDIDO = {
  id: true,
  pacoteNome: true,
  diarias: true,
  precoCentavos: true,
  validadeDias: true,
  situacao: true,
  txid: true,
  pagamentoInformadoEm: true,
  comprovanteMime: true,
  motivo: true,
  criadoEm: true,
  decididoEm: true,
} as const;

/** Créditos do entregador: pacotes de diárias, compra por Pix confirmada à mão e extrato. */
@Injectable()
export class CreditosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Parâmetros e pacotes (super-admin) ------------------------------------------------------

  async parametros(): Promise<ParametrosEntregasPlataforma> {
    const p = await this.prisma.parametrosEntregas.findUnique({ where: { id: 1 } });
    if (!p) return { ...PARAMETROS_ENTREGAS_PADRAO };
    return { pixChave: p.pixChave, pixNome: p.pixNome, pixCidade: p.pixCidade, diariasBonusCadastro: p.diariasBonusCadastro, validadeBonusDias: p.validadeBonusDias };
  }

  async salvarParametros(dados: ParametrosEntregasPlataforma, autorId: string): Promise<ParametrosEntregasPlataforma> {
    const p: ParametrosEntregasPlataforma = {
      pixChave: dados.pixChave.trim(),
      pixNome: dados.pixNome.trim(),
      pixCidade: dados.pixCidade.trim(),
      diariasBonusCadastro: dados.diariasBonusCadastro,
      validadeBonusDias: dados.validadeBonusDias,
    };
    const problema = problemaNosParametrosEntregas(p);
    if (problema) throw new BadRequestException(problema);
    await this.prisma.parametrosEntregas.upsert({ where: { id: 1 }, create: { id: 1, ...p }, update: p });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'entregas.parametros', entidade: 'ParametrosEntregas', detalhes: { pix: pixConfigurado(p), diariasBonusCadastro: p.diariasBonusCadastro } });
    return p;
  }

  async pacotes(somenteAtivos: boolean): Promise<PacoteCredito[]> {
    return this.prisma.pacoteCredito.findMany({
      where: somenteAtivos ? { ativo: true } : {},
      orderBy: [{ ativo: 'desc' }, { diarias: 'asc' }],
      select: { id: true, nome: true, diarias: true, precoCentavos: true, validadeDias: true, ativo: true },
    });
  }

  async salvarPacote(id: string | null, dados: Omit<PacoteCredito, 'id'>, autorId: string): Promise<PacoteCredito> {
    const p = { nome: dados.nome.trim(), diarias: dados.diarias, precoCentavos: dados.precoCentavos, validadeDias: dados.validadeDias, ativo: dados.ativo };
    const problema = problemaNoPacote(p);
    if (problema) throw new BadRequestException(problema);
    const salvo = id
      ? await this.prisma.pacoteCredito.update({ where: { id }, data: p }).catch(() => {
          throw new NotFoundException('Pacote não encontrado.');
        })
      : await this.prisma.pacoteCredito.create({ data: p });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: id ? 'entregas.pacote.editar' : 'entregas.pacote.criar', entidade: 'PacoteCredito', entidadeId: salvo.id, detalhes: p });
    return { id: salvo.id, ...p };
  }

  /** Quem já comprou guarda a cópia do pacote: excluir não muda nada para eles. */
  async excluirPacote(id: string, autorId: string): Promise<void> {
    const { count } = await this.prisma.pacoteCredito.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Pacote não encontrado.');
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'entregas.pacote.excluir', entidade: 'PacoteCredito', entidadeId: id });
  }

  // Saldo e extrato ----------------------------------------------------------------------------

  async saldo(entregadorId: string, agora = new Date()): Promise<number> {
    const lotes = await this.prisma.loteCredito.findMany({ where: { entregadorId, restante: { gt: 0 }, venceEm: { gt: agora } }, select: { restante: true, venceEm: true } });
    return saldoDeDiarias(lotes.map((l) => ({ restante: l.restante, venceEm: l.venceEm.toISOString() })), agora);
  }

  async doEntregador(entregadorId: string): Promise<CreditosEntregador> {
    const [saldo, pacotes, parametros, pedidos, lotes, diarias] = await Promise.all([
      this.saldo(entregadorId),
      this.pacotes(true),
      this.parametros(),
      this.prisma.pedidoCredito.findMany({ where: { entregadorId }, orderBy: { criadoEm: 'desc' }, take: 20, select: SELECAO_PEDIDO }),
      this.prisma.loteCredito.findMany({ where: { entregadorId }, orderBy: { criadoEm: 'desc' }, take: 40 }),
      this.prisma.diariaEntregador.findMany({ where: { entregadorId }, orderBy: { dia: 'desc' }, take: 60 }),
    ]);
    const extrato: MovimentoDiarias[] = [
      ...lotes.map((l) => ({
        tipo: l.origem === 'BONUS' ? ('BONUS' as const) : ('COMPRA' as const),
        quantidade: l.quantidade,
        descricao: l.origem === 'BONUS' ? (l.motivo ?? 'Diárias de bônus') : `Compra confirmada (${l.quantidade} diária${l.quantidade === 1 ? '' : 's'})`,
        em: l.criadoEm.toISOString(),
        venceEm: l.venceEm.toISOString(),
      })),
      ...diarias.map((d) => ({
        tipo: 'CONSUMO' as const,
        quantidade: -1,
        descricao: `Diária de ${d.dia.toISOString().slice(8, 10)}/${d.dia.toISOString().slice(5, 7)}`,
        em: d.criadoEm.toISOString(),
        venceEm: null,
      })),
    ].sort((a, b) => b.em.localeCompare(a.em));
    return { saldo, pacotes, pixDisponivel: pixConfigurado(parametros), pedidos: pedidos.map((p) => this.resumo(p, parametros)), extrato };
  }

  private resumo(p: PedidoDoBanco, parametros: ParametrosEntregasPlataforma | null): PedidoCreditoResumo {
    const aguardando = p.situacao === 'AGUARDANDO';
    return {
      id: p.id,
      pacote: p.pacoteNome,
      diarias: p.diarias,
      precoCentavos: p.precoCentavos,
      validadeDias: p.validadeDias,
      situacao: p.situacao as SituacaoPedidoCredito,
      txid: p.txid,
      pixCopiaECola:
        aguardando && parametros && pixConfigurado(parametros)
          ? pixCopiaECola({ chave: parametros.pixChave, nome: parametros.pixNome, cidade: parametros.pixCidade, valorCentavos: p.precoCentavos, txid: p.txid })
          : null,
      pagamentoInformadoEm: p.pagamentoInformadoEm?.toISOString() ?? null,
      temComprovante: !!p.comprovanteMime,
      motivo: p.motivo,
      criadoEm: p.criadoEm.toISOString(),
      decididoEm: p.decididoEm?.toISOString() ?? null,
    };
  }

  // Compra pelo entregador -------------------------------------------------------------------

  async pedir(entregadorId: string, pacoteId: string): Promise<PedidoCreditoResumo> {
    const [pacote, parametros, abertos] = await Promise.all([
      this.prisma.pacoteCredito.findFirst({ where: { id: pacoteId, ativo: true } }),
      this.parametros(),
      this.prisma.pedidoCredito.count({ where: { entregadorId, situacao: 'AGUARDANDO' } }),
    ]);
    if (!pacote) throw new NotFoundException('Pacote não encontrado.');
    if (!pixConfigurado(parametros)) throw new ConflictException('A compra de créditos ainda não está disponível. Tente mais tarde.');
    if (abertos >= MAX_PEDIDOS_CREDITO_ABERTOS) throw new ConflictException('Você já tem compras aguardando confirmação. Conclua ou cancele uma delas antes.');
    const pedido = await this.prisma.pedidoCredito.create({
      data: { entregadorId, pacoteNome: pacote.nome, diarias: pacote.diarias, precoCentavos: pacote.precoCentavos, validadeDias: pacote.validadeDias, txid: gerarTxid() },
      select: SELECAO_PEDIDO,
    });
    return this.resumo(pedido, parametros);
  }

  /** "Já paguei", com o comprovante se houver: vai para a conferência do super-admin. */
  async informarPagamento(entregadorId: string, id: string, comprovante: string | null): Promise<PedidoCreditoResumo> {
    const imagem = comprovante ? imagemDoDataUrl(comprovante, 'O comprovante') : null;
    const { count } = await this.prisma.pedidoCredito.updateMany({
      where: { id, entregadorId, situacao: 'AGUARDANDO' },
      data: { pagamentoInformadoEm: new Date(), ...(imagem ? { comprovante: imagem.bytes, comprovanteMime: imagem.mime } : {}) },
    });
    if (!count) throw new NotFoundException('Compra não encontrada ou já decidida.');
    const p = await this.prisma.pedidoCredito.findUniqueOrThrow({ where: { id }, select: SELECAO_PEDIDO });
    return this.resumo(p, await this.parametros());
  }

  async cancelar(entregadorId: string, id: string): Promise<void> {
    const { count } = await this.prisma.pedidoCredito.updateMany({ where: { id, entregadorId, situacao: 'AGUARDANDO' }, data: { situacao: 'CANCELADO', decididoEm: new Date() } });
    if (!count) throw new NotFoundException('Compra não encontrada ou já decidida.');
  }

  // Conferência (super-admin) ------------------------------------------------------------------

  async listarPedidos(situacao: SituacaoPedidoCredito | null): Promise<PedidoCreditoAdmin[]> {
    const lista = await this.prisma.pedidoCredito.findMany({
      where: situacao ? { situacao } : {},
      // Quem disse que pagou vem primeiro.
      orderBy: [{ pagamentoInformadoEm: { sort: 'desc', nulls: 'last' } }, { criadoEm: 'desc' }],
      take: 200,
      select: { ...SELECAO_PEDIDO, entregador: { select: { id: true, nome: true, cpf: true } } },
    });
    return lista.map((p) => ({ ...this.resumo(p, null), entregador: p.entregador }));
  }

  async comprovante(id: string): Promise<{ dados: string }> {
    const p = await this.prisma.pedidoCredito.findUnique({ where: { id }, select: { comprovante: true, comprovanteMime: true } });
    if (!p?.comprovante || !p.comprovanteMime) throw new NotFoundException('Sem comprovante.');
    return { dados: `data:${p.comprovanteMime};base64,${Buffer.from(p.comprovante).toString('base64')}` };
  }

  async confirmar(id: string, autorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const agora = new Date();
      const { count } = await tx.pedidoCredito.updateMany({ where: { id, situacao: 'AGUARDANDO' }, data: { situacao: 'CONFIRMADO', decididoEm: agora, decididoPorId: autorId } });
      if (!count) throw new ConflictException('Esta compra já foi decidida.');
      const p = await tx.pedidoCredito.findUniqueOrThrow({ where: { id } });
      await tx.loteCredito.create({
        data: { entregadorId: p.entregadorId, origem: 'COMPRA', quantidade: p.diarias, restante: p.diarias, venceEm: new Date(agora.getTime() + p.validadeDias * DIA_MS), pedidoId: p.id, criadoPorId: autorId },
      });
      await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'entregas.credito.confirmar', entidade: 'PedidoCredito', entidadeId: id, detalhes: { entregadorId: p.entregadorId, diarias: p.diarias, precoCentavos: p.precoCentavos, txid: p.txid } }, tx);
    });
  }

  async recusar(id: string, motivo: string, autorId: string): Promise<void> {
    const texto = motivo.trim();
    if (texto.length < 3) throw new BadRequestException('Informe o motivo.');
    const { count } = await this.prisma.pedidoCredito.updateMany({ where: { id, situacao: 'AGUARDANDO' }, data: { situacao: 'RECUSADO', motivo: texto, decididoEm: new Date(), decididoPorId: autorId } });
    if (!count) throw new ConflictException('Esta compra já foi decidida.');
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'entregas.credito.recusar', entidade: 'PedidoCredito', entidadeId: id, detalhes: { motivo: texto } });
  }

  async bonus(entregadorId: string, diarias: number, validadeDias: number, motivo: string, autorId: string | null, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    if (!Number.isInteger(diarias) || diarias < 1 || diarias > 60) throw new BadRequestException('Diárias de bônus de 1 a 60.');
    if (!Number.isInteger(validadeDias) || validadeDias < 1 || validadeDias > 365) throw new BadRequestException('Validade de 1 a 365 dias.');
    const texto = motivo.trim();
    if (texto.length < 3) throw new BadRequestException('Informe o motivo.');
    const existe = await tx.entregador.count({ where: { id: entregadorId } });
    if (!existe) throw new NotFoundException('Entregador não encontrado.');
    await tx.loteCredito.create({
      data: { entregadorId, origem: 'BONUS', quantidade: diarias, restante: diarias, venceEm: new Date(Date.now() + validadeDias * DIA_MS), motivo: texto, criadoPorId: autorId },
    });
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'entregas.credito.bonus', entidade: 'Entregador', entidadeId: entregadorId, detalhes: { diarias, validadeDias, motivo: texto } }, tx);
  }
}
