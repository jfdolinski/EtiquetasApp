import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AgentesGateway } from '../agentes/agentes.gateway';
import type { DadosImprimir } from '../agentes/protocolo';
import { AgenteDesconectado, ErroDoAgente, TempoEsgotadoAgente } from '../agentes/sessao-agente';
import { PrismaService } from '../prisma/prisma.service';

const INTERVALO_VARREDURA_MS = 30_000;
const TEMPO_LIMITE_IMPRESSAO_MS = 60_000;
/** ENVIANDO há mais tempo que isso: a API caiu no meio do envio. */
const ENVIO_TRAVADO_MS = 3 * 60_000;
const MAXIMO_TENTATIVAS_DESCONEXAO = 5;

/**
 * Entrega os trabalhos de impressão aos agentes. A fila é a própria tabela
 * `trabalhos_impressao` (durável, sem Redis): trabalhos PENDENTES são enviados quando
 * criados, quando o agente conecta e numa varredura periódica. Um trabalho por vez por
 * agente, na ordem de criação.
 */
@Injectable()
export class DespachoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Impressao');
  private readonly cadeias = new Map<string, Promise<void>>();
  private readonly agendados = new Set<string>();
  private varredura?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AgentesGateway,
  ) {}

  async onApplicationBootstrap() {
    this.gateway.quandoConectar((agenteId) => void this.despacharPendentes(agenteId));
    // Envio interrompido por reinício: não dá para saber se imprimiu. Não reenvia sozinho.
    await this.marcarTravados(new Date());
    this.varredura = setInterval(() => void this.varrer(), INTERVALO_VARREDURA_MS);
  }

  onModuleDestroy() {
    clearInterval(this.varredura);
  }

  /** Agenda um trabalho recém-criado ou reenviado. */
  despachar(trabalhoId: string) {
    void this.prisma.trabalhoImpressao
      .findUnique({ where: { id: trabalhoId }, select: { impressora: { select: { agenteId: true } } } })
      .then((t) => this.agendar(t?.impressora?.agenteId ?? 'sem-agente', trabalhoId))
      .catch((e) => this.log.error(`Falha ao agendar ${trabalhoId}: ${(e as Error).message}`));
  }

  async despacharPendentes(agenteId?: string) {
    const pendentes = await this.prisma.trabalhoImpressao.findMany({
      where: { status: 'PENDENTE', linguagem: { not: 'PDF' }, ...(agenteId ? { impressora: { agenteId } } : {}) },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, impressora: { select: { agenteId: true } } },
      take: 500,
    });
    for (const t of pendentes) this.agendar(t.impressora?.agenteId ?? 'sem-agente', t.id);
  }

  private async varrer() {
    try {
      await this.marcarTravados(new Date(Date.now() - ENVIO_TRAVADO_MS));
      await this.despacharPendentes();
    } catch (e) {
      this.log.error(`Falha na varredura da fila: ${(e as Error).message}`);
    }
  }

  private async marcarTravados(antesDe: Date) {
    const travados = await this.prisma.trabalhoImpressao.findMany({
      where: { status: 'ENVIANDO', enviadoEm: { lt: antesDe } },
      select: { id: true },
    });
    for (const t of travados) {
      if (this.agendados.has(t.id)) continue;
      await this.falhar(t.id, 'Envio interrompido sem confirmação. Confira a impressora antes de reenviar.');
    }
  }

  private agendar(agenteId: string, trabalhoId: string) {
    if (this.agendados.has(trabalhoId)) return;
    this.agendados.add(trabalhoId);
    const anterior = this.cadeias.get(agenteId) ?? Promise.resolve();
    const proxima = anterior
      .then(() => this.enviar(trabalhoId))
      .catch((e) => this.log.error(`Falha ao enviar ${trabalhoId}: ${(e as Error).message}`))
      .finally(() => this.agendados.delete(trabalhoId));
    this.cadeias.set(agenteId, proxima);
    void proxima.finally(() => {
      if (this.cadeias.get(agenteId) === proxima) this.cadeias.delete(agenteId);
    });
  }

  /** Envia um trabalho PENDENTE. Agente offline: continua pendente para a próxima chance. */
  async enviar(trabalhoId: string) {
    const t = await this.prisma.trabalhoImpressao.findUnique({
      where: { id: trabalhoId },
      select: {
        id: true,
        status: true,
        conteudo: true,
        modeloNome: true,
        tentativas: true,
        impressora: { select: { ativo: true, agenteId: true, metodo: true, endereco: true } },
      },
    });
    if (!t || t.status !== 'PENDENTE') return;
    const imp = t.impressora;
    if (!imp) return this.falhar(t.id, 'A impressora deste trabalho foi excluída.');
    if (!imp.ativo) return this.falhar(t.id, 'A impressora está desativada.');
    if (!imp.agenteId) return this.falhar(t.id, 'A impressora não tem agente configurado.');
    if (!this.gateway.estaOnline(imp.agenteId)) return;

    // Reivindica o trabalho: só um envio por vez, mesmo com varredura e criação simultâneas.
    const { count } = await this.prisma.trabalhoImpressao.updateMany({
      where: { id: t.id, status: 'PENDENTE' },
      data: { status: 'ENVIANDO', enviadoEm: new Date(), tentativas: { increment: 1 }, erro: null },
    });
    if (count === 0) return;

    const dados: DadosImprimir = {
      trabalhoId: t.id,
      metodo: imp.metodo,
      endereco: imp.endereco,
      nome: `Etiquetas - ${t.modeloNome}`.slice(0, 100),
      dados: Buffer.from(t.conteudo).toString('base64'),
    };
    try {
      await this.gateway.sessao(imp.agenteId).requisitar('imprimir', dados, TEMPO_LIMITE_IMPRESSAO_MS);
    } catch (erro) {
      if (erro instanceof AgenteDesconectado) {
        // Caiu com o trabalho já enviado: pode ter impresso, então não repete sozinho.
        if (erro.duranteOperacao) {
          return this.falhar(t.id, 'O agente desconectou durante a impressão. Confira a impressora antes de reenviar.');
        }
        // Nem chegou a enviar: tenta de novo quando o agente voltar.
        if (t.tentativas + 1 >= MAXIMO_TENTATIVAS_DESCONEXAO) {
          return this.falhar(t.id, 'O agente desconectou durante o envio várias vezes. Confira a impressora antes de reenviar.');
        }
        await this.prisma.trabalhoImpressao.update({ where: { id: t.id }, data: { status: 'PENDENTE', erro: 'Agente desconectou; aguardando reconexão.' } });
        return;
      }
      if (erro instanceof TempoEsgotadoAgente) {
        return this.falhar(t.id, 'O agente não confirmou a impressão a tempo. Confira a impressora antes de reenviar.');
      }
      return this.falhar(t.id, erro instanceof ErroDoAgente ? erro.message : 'Erro inesperado ao enviar para o agente.');
    }

    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.trabalhoImpressao.update({ where: { id: t.id }, data: { status: 'CONCLUIDO', concluidoEm: agora, erro: null } }),
      this.prisma.itemLista.updateMany({ where: { trabalhoId: t.id, status: 'NA_FILA' }, data: { status: 'IMPRESSO', impressoEm: agora } }),
    ]);
  }

  /** Marca erro; os itens voltam para a lista (ligados ao trabalho, para um eventual reenvio). */
  private async falhar(trabalhoId: string, mensagem: string) {
    await this.prisma.$transaction([
      this.prisma.trabalhoImpressao.update({ where: { id: trabalhoId }, data: { status: 'ERRO', erro: mensagem } }),
      this.prisma.itemLista.updateMany({ where: { trabalhoId, status: 'NA_FILA' }, data: { status: 'PENDENTE' } }),
    ]);
    this.log.warn(`Trabalho ${trabalhoId}: ${mensagem}`);
  }
}
