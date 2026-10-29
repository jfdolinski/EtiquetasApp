import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  avaliarAssinatura,
  PARAMETROS_COBRANCA_PADRAO,
  somarMeses,
  validarParametros,
  type AssinaturaResumo,
  type MinhaAssinatura,
  type PagamentoResumo,
  type ParametrosCobrancaGlobais,
  type SituacaoCobrancaEmpresa,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvaliacaoCobrancaService } from './avaliacao.service';
import type { AssinaturaDto, PagamentoDto, ParametrosEmpresaDto, ParametrosGlobaisDto } from './dto';
import { dataIso, hojeNoFuso, MensagensCobrancaService } from './mensagens-cobranca.service';

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

function resumoAssinatura(a: Prisma.AssinaturaGetPayload<object>): AssinaturaResumo {
  return {
    empresaId: a.empresaId,
    valorMensal: Number(a.valorMensal),
    diaVencimento: a.diaVencimento,
    vencimentoAtual: dataIso(a.vencimentoAtual),
    controleManual: a.controleManual,
    observacoes: a.observacoes,
  };
}

/** Administração da cobrança (super-admin) e a visão da própria empresa. */
@Injectable()
export class CobrancaService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensCobrancaService,
    private readonly avaliacao: AvaliacaoCobrancaService,
  ) {}

  /** Garante a linha de parâmetros globais com os valores padrão. */
  async onApplicationBootstrap() {
    const existe = await this.prisma.parametroCobranca.findFirst({ where: { empresaId: null }, select: { id: true } });
    if (!existe) await this.prisma.parametroCobranca.create({ data: { ...PARAMETROS_COBRANCA_PADRAO } });
  }

  parametrosGlobais(): Promise<ParametrosCobrancaGlobais> {
    return this.mensagens.globais();
  }

  async salvarParametrosGlobais(dto: ParametrosGlobaisDto, autorId: string): Promise<ParametrosCobrancaGlobais> {
    const erros = validarParametros(dto);
    if (erros.length) throw new BadRequestException(erros);
    const atual = await this.prisma.parametroCobranca.findFirst({ where: { empresaId: null }, select: { id: true } });
    if (atual) await this.prisma.parametroCobranca.update({ where: { id: atual.id }, data: dto });
    else await this.prisma.parametroCobranca.create({ data: dto });
    this.mensagens.invalidarCache();
    await this.auditoria.registrar({ empresaId: null, usuarioId: autorId, acao: 'cobranca.parametros', entidade: 'ParametroCobranca', detalhes: { ...dto } });
    return this.mensagens.globais();
  }

  async situacoes(): Promise<SituacaoCobrancaEmpresa[]> {
    const empresas = await this.prisma.empresa.findMany({
      orderBy: { razaoSocial: 'asc' },
      select: { id: true, razaoSocial: true, nomeFantasia: true, statusAssinatura: true, ativa: true, assinatura: true },
    });
    const hoje = hojeNoFuso();
    return Promise.all(
      empresas.map(async (e) => {
        const { efetivos, sobrescritos } = await this.mensagens.daEmpresa(e.id);
        return {
          empresa: { id: e.id, nome: e.nomeFantasia || e.razaoSocial, statusAssinatura: e.statusAssinatura, ativa: e.ativa },
          assinatura: e.assinatura ? resumoAssinatura(e.assinatura) : null,
          avaliacao: e.assinatura ? avaliarAssinatura(hoje, dataIso(e.assinatura.vencimentoAtual), efetivos) : null,
          parametros: sobrescritos,
        };
      }),
    );
  }

  async salvarAssinatura(empresaId: string, dto: AssinaturaDto, autorId: string): Promise<AssinaturaResumo> {
    await this.exigirEmpresa(empresaId);
    const dados = {
      valorMensal: dto.valorMensal,
      diaVencimento: dto.diaVencimento,
      vencimentoAtual: dia(dto.vencimentoAtual),
      controleManual: dto.controleManual ?? false,
      observacoes: dto.observacoes?.trim() || null,
    };
    const a = await this.prisma.assinatura.upsert({ where: { empresaId }, create: { empresaId, ...dados }, update: dados });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'assinatura.salvar', entidade: 'Assinatura', entidadeId: a.id, detalhes: { ...dto } });
    await this.avaliacao.avaliarEmpresa(empresaId);
    return resumoAssinatura(a);
  }

  /** Remove a cobrança da empresa (ex.: cortesia). O status passa a ser só manual. */
  async removerAssinatura(empresaId: string, autorId: string) {
    const { count } = await this.prisma.assinatura.deleteMany({ where: { empresaId } });
    if (!count) throw new NotFoundException('A empresa não tem assinatura.');
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'assinatura.remover', entidade: 'Assinatura' });
  }

  async salvarParametrosEmpresa(empresaId: string, dto: ParametrosEmpresaDto, autorId: string) {
    await this.exigirEmpresa(empresaId);
    const { efetivos } = await this.mensagens.daEmpresa(empresaId);
    const globais = await this.mensagens.globais();
    const erros = validarParametros({
      diasCarencia: dto.diasCarencia ?? globais.diasCarencia,
      diasAteBloqueio: dto.diasAteBloqueio ?? globais.diasAteBloqueio,
    });
    if (erros.length) throw new BadRequestException(erros);
    await this.prisma.parametroCobranca.upsert({ where: { empresaId }, create: { empresaId, ...dto }, update: dto });
    await this.auditoria.registrar({
      empresaId,
      usuarioId: autorId,
      acao: 'cobranca.parametros_empresa',
      entidade: 'ParametroCobranca',
      detalhes: { ...dto, antes: { diasCarencia: efetivos.diasCarencia, diasAteBloqueio: efetivos.diasAteBloqueio } },
    });
    await this.avaliacao.avaliarEmpresa(empresaId);
    return (await this.mensagens.daEmpresa(empresaId)).sobrescritos;
  }

  async pagamentos(empresaId: string): Promise<PagamentoResumo[]> {
    const lista = await this.prisma.pagamentoAssinatura.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 100,
      include: { registradoPor: { select: { nome: true } } },
    });
    return lista.map((p) => ({
      id: p.id,
      valor: Number(p.valor),
      meses: p.meses,
      vencimentoQuitado: dataIso(p.vencimentoQuitado),
      novoVencimento: dataIso(p.novoVencimento),
      pagoEm: dataIso(p.pagoEm),
      observacao: p.observacao,
      registradoPor: p.registradoPor?.nome ?? null,
      criadoEm: p.criadoEm.toISOString(),
    }));
  }

  /** Quita `meses` mensalidades a partir do vencimento em aberto e reavalia na hora (desbloqueia). */
  async registrarPagamento(empresaId: string, dto: PagamentoDto, autorId: string): Promise<PagamentoResumo[]> {
    const a = await this.prisma.assinatura.findUnique({ where: { empresaId } });
    if (!a) throw new BadRequestException('A empresa não tem assinatura.');
    const de = dataIso(a.vencimentoAtual);
    const para = somarMeses(de, dto.meses, a.diaVencimento);
    const valor = dto.valor ?? Number(a.valorMensal) * dto.meses;
    await this.prisma.$transaction(async (tx) => {
      // Condiciona ao vencimento lido: dois registros simultâneos não avançam duas vezes.
      const { count } = await tx.assinatura.updateMany({ where: { id: a.id, vencimentoAtual: a.vencimentoAtual }, data: { vencimentoAtual: dia(para) } });
      if (!count) throw new BadRequestException('A assinatura mudou enquanto o pagamento era registrado. Tente de novo.');
      const p = await tx.pagamentoAssinatura.create({
        data: {
          empresaId,
          assinaturaId: a.id,
          valor,
          meses: dto.meses,
          vencimentoQuitado: dia(de),
          novoVencimento: dia(para),
          pagoEm: dia(dto.pagoEm),
          observacao: dto.observacao?.trim() || null,
          registradoPorId: autorId,
        },
      });
      await this.auditoria.registrar(
        { empresaId, usuarioId: autorId, acao: 'assinatura.pagamento', entidade: 'PagamentoAssinatura', entidadeId: p.id, detalhes: { valor, meses: dto.meses, de, para } },
        tx,
      );
    });
    await this.avaliacao.avaliarEmpresa(empresaId);
    return this.pagamentos(empresaId);
  }

  /** Desfaz o último pagamento (lançado por engano): o vencimento volta ao que era. */
  async estornarPagamento(empresaId: string, pagamentoId: string, autorId: string): Promise<PagamentoResumo[]> {
    const ultimo = await this.prisma.pagamentoAssinatura.findFirst({ where: { empresaId }, orderBy: { criadoEm: 'desc' } });
    if (!ultimo || ultimo.id !== pagamentoId) throw new BadRequestException('Só o último pagamento pode ser estornado.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.assinatura.updateMany({
        where: { id: ultimo.assinaturaId, vencimentoAtual: ultimo.novoVencimento },
        data: { vencimentoAtual: ultimo.vencimentoQuitado },
      });
      if (!count) throw new BadRequestException('O vencimento foi alterado depois deste pagamento; ajuste a assinatura manualmente.');
      await tx.pagamentoAssinatura.delete({ where: { id: ultimo.id } });
      await this.auditoria.registrar(
        {
          empresaId,
          usuarioId: autorId,
          acao: 'assinatura.estorno',
          entidade: 'PagamentoAssinatura',
          entidadeId: ultimo.id,
          detalhes: { valor: Number(ultimo.valor), meses: ultimo.meses, vencimentoRestaurado: dataIso(ultimo.vencimentoQuitado) },
        },
        tx,
      );
    });
    await this.avaliacao.avaliarEmpresa(empresaId);
    return this.pagamentos(empresaId);
  }

  async minhaAssinatura(empresaId: string): Promise<MinhaAssinatura> {
    const e = await this.prisma.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { statusAssinatura: true, assinatura: true } });
    const { efetivos } = await this.mensagens.daEmpresa(empresaId);
    return {
      statusAssinatura: e.statusAssinatura,
      assinatura: e.assinatura
        ? { valorMensal: Number(e.assinatura.valorMensal), diaVencimento: e.assinatura.diaVencimento, vencimentoAtual: dataIso(e.assinatura.vencimentoAtual) }
        : null,
      avaliacao: e.assinatura ? avaliarAssinatura(hojeNoFuso(), dataIso(e.assinatura.vencimentoAtual), efetivos) : null,
      aviso: await this.mensagens.avisoAtual(empresaId),
    };
  }

  private async exigirEmpresa(id: string) {
    const e = await this.prisma.empresa.findUnique({ where: { id }, select: { id: true } });
    if (!e) throw new NotFoundException('Empresa não encontrada.');
  }
}
