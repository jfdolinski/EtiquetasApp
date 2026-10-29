import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  avaliarAssinatura,
  diasEntre,
  mensagemDaEtapa,
  renderizarMensagem,
  type ExecucaoAvaliacaoResumo,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { PrismaService } from '../prisma/prisma.service';
import { dataIso, MensagensCobrancaService } from './mensagens-cobranca.service';

const INTERVALO_AGENDA_MS = 10 * 60_000;
/** Chave do pg_advisory_lock: impede duas avaliações ao mesmo tempo (agendada × manual, ou réplicas). */
const CHAVE_TRAVA = 727_001;

export interface ResultadoEmpresa {
  alterou: boolean;
  aviso: boolean;
  bloqueou: boolean;
  liberou: boolean;
}

type Resultado = NonNullable<ExecucaoAvaliacaoResumo['resultado']>;

/**
 * Avaliação diária de inadimplência: para cada assinatura, calcula a etapa (aviso prévio,
 * carência, pré-bloqueio, bloqueio), ajusta o status da empresa e emite avisos na
 * frequência configurada. Agendamento em processo, conferido a cada 10 minutos: roda uma
 * vez por dia depois da `horaAvaliacao` e recupera o dia se a API estava fora do ar.
 */
@Injectable()
export class AvaliacaoCobrancaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Cobranca');
  private agenda?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly mensagens: MensagensCobrancaService,
  ) {}

  onApplicationBootstrap() {
    this.agenda = setInterval(() => void this.verificarAgenda(), INTERVALO_AGENDA_MS);
    setTimeout(() => void this.verificarAgenda(), 20_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.agenda);
  }

  async verificarAgenda() {
    try {
      const agora = agoraNoFuso(new Date(), config().fusoHorario);
      const hora = Number(agora.dataHora.slice(11, 13));
      const { horaAvaliacao } = await this.mensagens.globais();
      if (hora < horaAvaliacao) return;
      const jaRodou = await this.prisma.execucaoAvaliacao.count({
        where: { data: new Date(`${agora.data}T00:00:00Z`), origem: 'AGENDADA', concluidoEm: { not: null } },
      });
      if (!jaRodou) await this.executar('AGENDADA');
    } catch (e) {
      this.log.error(`Falha ao verificar a agenda da cobrança: ${(e as Error).message}`);
    }
  }

  /**
   * Avalia todas as assinaturas. Devolve null se outra avaliação já estiver em andamento.
   * A trava é de transação (pg_try_advisory_xact_lock): fica presa à conexão da transação
   * aberta só para segurá-la, e se solta sozinha no fim, mesmo em erro. Uma trava de sessão
   * não serviria com o pool do Prisma (lock e unlock podem cair em conexões diferentes).
   */
  async executar(origem: 'AGENDADA' | 'MANUAL'): Promise<ExecucaoAvaliacaoResumo | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const [{ trava }] = await tx.$queryRaw<{ trava: boolean }[]>`SELECT pg_try_advisory_xact_lock(${CHAVE_TRAVA}) AS trava`;
        return trava ? this.executarComTrava(origem) : null;
      },
      { maxWait: 10_000, timeout: 30 * 60_000 },
    );
  }

  private async executarComTrava(origem: 'AGENDADA' | 'MANUAL'): Promise<ExecucaoAvaliacaoResumo> {
    const hoje = agoraNoFuso(new Date(), config().fusoHorario).data;
    const execucao = await this.prisma.execucaoAvaliacao.create({ data: { data: new Date(`${hoje}T00:00:00Z`), origem } });
    const resultado: Resultado = { avaliadas: 0, alteradas: 0, avisos: 0, bloqueadas: 0, liberadas: 0 };
    try {
      const assinaturas = await this.prisma.assinatura.findMany({
        where: { empresa: { statusAssinatura: { not: 'CANCELADA' } } },
        select: { empresaId: true },
      });
      for (const { empresaId } of assinaturas) {
        try {
          const r = await this.avaliarEmpresa(empresaId, hoje);
          resultado.avaliadas++;
          if (r.alterou) resultado.alteradas++;
          if (r.aviso) resultado.avisos++;
          if (r.bloqueou) resultado.bloqueadas++;
          if (r.liberou) resultado.liberadas++;
        } catch (e) {
          this.log.error(`Falha ao avaliar a empresa ${empresaId}: ${(e as Error).message}`);
        }
      }
      const fim = await this.prisma.execucaoAvaliacao.update({
        where: { id: execucao.id },
        data: { concluidoEm: new Date(), resultado: resultado as unknown as Prisma.InputJsonObject },
      });
      this.log.log(`Avaliação de cobrança (${origem}): ${JSON.stringify(resultado)}`);
      return resumoExecucao(fim);
    } catch (e) {
      await this.prisma.execucaoAvaliacao.update({ where: { id: execucao.id }, data: { erro: (e as Error).message } });
      throw e;
    }
  }

  /** Avalia uma empresa agora (também chamado ao registrar pagamento ou mudar a assinatura). */
  async avaliarEmpresa(empresaId: string, hoje = agoraNoFuso(new Date(), config().fusoHorario).data): Promise<ResultadoEmpresa> {
    const r: ResultadoEmpresa = { alterou: false, aviso: false, bloqueou: false, liberou: false };
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razaoSocial: true,
        nomeFantasia: true,
        statusAssinatura: true,
        assinatura: { select: { valorMensal: true, vencimentoAtual: true, controleManual: true } },
      },
    });
    if (!empresa?.assinatura || empresa.statusAssinatura === 'CANCELADA') return r;
    const { efetivos } = await this.mensagens.daEmpresa(empresaId);
    const vencimento = dataIso(empresa.assinatura.vencimentoAtual);
    const avaliacao = avaliarAssinatura(hoje, vencimento, efetivos);

    if (!empresa.assinatura.controleManual && avaliacao.status !== empresa.statusAssinatura) {
      await this.prisma.empresa.update({ where: { id: empresaId }, data: { statusAssinatura: avaliacao.status } });
      await this.auditoria.registrar({
        empresaId,
        usuarioId: null,
        acao: 'assinatura.status_automatico',
        entidade: 'Empresa',
        entidadeId: empresaId,
        detalhes: { de: empresa.statusAssinatura, para: avaliacao.status, diasAtraso: avaliacao.diasAtraso, vencimento },
      });
      r.alterou = true;
      r.bloqueou = avaliacao.status === 'BLOQUEADA';
      r.liberou = empresa.statusAssinatura === 'BLOQUEADA';
    }

    const modelo = mensagemDaEtapa(avaliacao.etapa, efetivos);
    if (avaliacao.etapa !== 'EM_DIA' && modelo) {
      const tipo = avaliacao.etapa;
      const ultimo = await this.prisma.avisoCobranca.findFirst({
        where: { empresaId, tipo, vencimento: empresa.assinatura.vencimentoAtual },
        orderBy: { criadoEm: 'desc' },
        select: { criadoEm: true },
      });
      const ultimoDia = ultimo ? agoraNoFuso(ultimo.criadoEm, config().fusoHorario).data : null;
      if (!ultimoDia || diasEntre(ultimoDia, hoje) >= efetivos.frequenciaAvisoDias) {
        await this.prisma.avisoCobranca.create({
          data: {
            empresaId,
            tipo,
            vencimento: empresa.assinatura.vencimentoAtual,
            mensagem: renderizarMensagem(modelo, {
              empresa: empresa.nomeFantasia || empresa.razaoSocial,
              valor: Number(empresa.assinatura.valorMensal),
              vencimento,
              avaliacao,
            }),
          },
        });
        r.aviso = true;
      }
    }
    return r;
  }

  async execucoes(limite = 30): Promise<ExecucaoAvaliacaoResumo[]> {
    const lista = await this.prisma.execucaoAvaliacao.findMany({ orderBy: { iniciadoEm: 'desc' }, take: limite });
    return lista.map(resumoExecucao);
  }
}

function resumoExecucao(e: Prisma.ExecucaoAvaliacaoGetPayload<object>): ExecucaoAvaliacaoResumo {
  return {
    id: e.id,
    data: dataIso(e.data),
    origem: e.origem,
    iniciadoEm: e.iniciadoEm.toISOString(),
    concluidoEm: e.concluidoEm?.toISOString() ?? null,
    resultado: e.resultado as ExecucaoAvaliacaoResumo['resultado'],
    erro: e.erro,
  };
}
