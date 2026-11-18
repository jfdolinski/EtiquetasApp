import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  deveRepetir,
  dentroDaJanela,
  diaDaSemana,
  EVENTOS_NOTIFICACAO,
  JANELA_PADRAO,
  regrasComPadrao,
  dentroDoHorarioDaTela,
  formatarCentavos,
  ROTULO_MOTIVO_OCORRENCIA,
  ROTULO_TIPO_CHAMADA,
  type MotivoOcorrencia,
  textoDuracao,
  type TipoChamada,
  type ConfiguracaoNotificacoes,
  type EventoNotificacao,
  type ExecucaoAgendamento,
  type JanelaNotificacao,
  type NivelNotificacao,
  type NotificacaoResumo,
  type RegraNotificacaoDados,
  type TesteNotificacaoResposta,
} from '@etiquetas/shared';
import { AgentesGateway } from '../agentes/agentes.gateway';
import { DispositivosService } from '../app-movel/app-movel.module';
import { EmailService } from '../email/email.service';
import type { DadosNotificar } from '../agentes/protocolo';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { horaLocal } from '../telas/telas.module';
import type { SalvarNotificacoesDto } from './dto';

const INTERVALO_AVALIACAO_MS = 60_000;
const INTERVALO_LIMPEZA_MS = 3_600_000;
const TEMPO_ENTREGA_MS = 10_000;
/** Aviso que o agente offline ainda recebe ao voltar. */
const VALIDADE_ENTREGA_MS = 12 * 3_600_000;
const HORA_MS = 3_600_000;
const RETENCAO_EXECUCOES_DIAS = 35;
const RETENCAO_NOTIFICACOES_DIAS = 60;

/** Um problema encontrado agora: (evento, chave) identifica o mesmo problema entre avaliações. */
export interface Ocorrencia {
  chave: string;
  titulo: string;
  mensagem: string;
}

/** Aviso sobre um agente não vai para ele mesmo. */
const chaveDoAgente = (agenteId: string) => `agente:${agenteId}`;

const comoLista = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/**
 * Avalia as regras ligadas a cada minuto, em processo (API com uma réplica). Um problema gera uma
 * notificação aberta até a condição acabar; fora da janela da empresa nada é enviado, e o que
 * continuar valendo sai quando a janela abrir.
 */
@Injectable()
export class NotificacoesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Notificacoes');
  private relogio?: NodeJS.Timeout;
  private limpeza?: NodeJS.Timeout;
  private avaliando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: AgentesGateway,
    private readonly email: EmailService,
    private readonly dispositivos: DispositivosService,
  ) {}

  onApplicationBootstrap() {
    this.gateway.quandoConectar((agenteId) => void this.entregarPendentes(agenteId).catch((e) => this.log.warn(`Entrega ao agente ${agenteId}: ${(e as Error).message}`)));
    this.relogio = setInterval(() => void this.avaliarTodas(), INTERVALO_AVALIACAO_MS);
    this.limpeza = setInterval(() => void this.limpar(), INTERVALO_LIMPEZA_MS);
    this.relogio.unref();
    this.limpeza.unref();
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
    clearInterval(this.limpeza);
  }

  // ---- Configuração ----

  async configuracao(empresaId: string): Promise<ConfiguracaoNotificacoes & { agentes: { id: string; nome: string }[] }> {
    const [regras, janela, agentes] = await Promise.all([
      this.regrasSalvas(empresaId),
      this.janela(empresaId),
      this.prisma.agente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    ]);
    return { janela, regras: regrasComPadrao(regras), agentes, emailDisponivel: this.email.disponivel, pushDisponivel: config().fcm !== null };
  }

  async salvar(empresaId: string, dto: SalvarNotificacoesDto, autorId: string) {
    const agentes = await this.prisma.agente.findMany({ where: { empresaId }, select: { id: true } });
    const validos = new Set(agentes.map((a) => a.id));
    for (const r of dto.regras) {
      const evento = EVENTOS_NOTIFICACAO.find((e) => e.codigo === r.evento)!;
      if (r.ativo && !r.canalAgente && !r.canalSistema && !r.canalEmail && !r.canalCelular) throw new BadRequestException(`${evento.titulo}: escolha ao menos um jeito de avisar.`);
      if (evento.unidade && r.limite < 1) throw new BadRequestException(`${evento.titulo}: informe o limite em ${evento.unidade}.`);
      if (r.ativo && r.canalEmail && !this.email.disponivel) throw new BadRequestException(`${evento.titulo}: o envio de e-mail não está configurado no servidor.`);
      if (r.agenteIds.some((id) => !validos.has(id))) throw new BadRequestException(`${evento.titulo}: agente não encontrado.`);
    }
    const janela = { horaInicio: dto.janela.horaInicio, horaFim: dto.janela.horaFim, diasSemana: [...new Set(dto.janela.diasSemana)].sort() };
    await this.prisma.$transaction(async (tx) => {
      await tx.janelaNotificacao.upsert({ where: { empresaId }, create: { empresaId, ...janela }, update: janela });
      for (const r of dto.regras) {
        const dados = { ativo: r.ativo, limite: r.limite, canalAgente: r.canalAgente, canalSistema: r.canalSistema, canalEmail: r.canalEmail ?? false, canalCelular: r.canalCelular ?? false, repetirMinutos: r.repetirMinutos, agenteIds: r.agenteIds };
        await tx.regraNotificacao.upsert({ where: { empresaId_evento: { empresaId, evento: r.evento } }, create: { empresaId, evento: r.evento, ...dados }, update: dados });
      }
      await this.auditoria.registrar(
        { empresaId, usuarioId: autorId, acao: 'notificacao.configurar', entidade: 'RegraNotificacao', detalhes: { ligadas: dto.regras.filter((r) => r.ativo).map((r) => r.evento), janela } },
        tx,
      );
    });
    void this.avaliarEmpresa(empresaId).catch((e) => this.log.warn(`Avaliação após salvar: ${(e as Error).message}`));
    return this.configuracao(empresaId);
  }

  // ---- Central ----

  async listar(empresaId: string): Promise<NotificacaoResumo[]> {
    const lista = await this.prisma.notificacao.findMany({ where: { empresaId, canalSistema: true }, orderBy: { ultimoEnvioEm: 'desc' }, take: 100 });
    return lista.map((n) => ({
      id: n.id,
      evento: n.evento,
      titulo: n.titulo,
      mensagem: n.mensagem,
      nivel: n.nivel as NivelNotificacao,
      vezes: n.vezes,
      canalAgente: n.canalAgente,
      canalSistema: n.canalSistema,
      entregues: comoLista(n.entregueAgentes).length,
      criadoEm: n.criadoEm.toISOString(),
      ultimoEnvioEm: n.ultimoEnvioEm.toISOString(),
      lidaEm: n.lidaEm?.toISOString() ?? null,
      resolvidaEm: n.resolvidaEm?.toISOString() ?? null,
    }));
  }

  /** Para o sino: problemas ainda abertos que ninguém leu. */
  async naoLidas(empresaId: string) {
    return { quantidade: await this.prisma.notificacao.count({ where: { empresaId, canalSistema: true, lidaEm: null, resolvidaEm: null } }) };
  }

  async marcarLida(empresaId: string, id: string) {
    const { count } = await this.prisma.notificacao.updateMany({ where: { id, empresaId, lidaEm: null }, data: { lidaEm: new Date() } });
    if (count === 0 && !(await this.prisma.notificacao.findFirst({ where: { id, empresaId }, select: { id: true } }))) throw new NotFoundException('Notificação não encontrada.');
  }

  async marcarTodasLidas(empresaId: string) {
    await this.prisma.notificacao.updateMany({ where: { empresaId, lidaEm: null }, data: { lidaEm: new Date() } });
  }

  /** Manda um balão de teste agora, sem olhar regra nem horário, e diz quem confirmou. */
  async testar(empresaId: string, autorId: string): Promise<TesteNotificacaoResposta> {
    const agentes = await this.prisma.agente.findMany({ where: { empresaId, ativo: true, tokenHash: { not: null } }, select: { id: true } });
    const dados: DadosNotificar = {
      id: `teste:${randomUUID()}`,
      titulo: 'Teste de notificação',
      mensagem: 'Se este aviso apareceu, as notificações estão chegando a este computador.',
      nivel: 'info',
      em: new Date().toISOString(),
    };
    const online = agentes.filter((a) => this.gateway.estaOnline(a.id));
    const r = await Promise.all(online.map((a) => this.entregar(a.id, dados)));
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'notificacao.testar', entidade: 'RegraNotificacao', detalhes: { online: online.length } });
    const celulares = await this.dispositivos.avisarEmpresa(empresaId, { titulo: dados.titulo, mensagem: 'Se este aviso apareceu, as notificações estão chegando a este celular.' });
    const autor = await this.prisma.usuario.findUnique({ where: { id: autorId }, select: { email: true } });
    const emailEnviado = autor ? await this.email.enviar(autor.email, dados.titulo, 'Se este e-mail chegou, os avisos por e-mail do Flow estão funcionando.') : false;
    return {
      agentes: agentes.length,
      online: online.length,
      entregues: r.filter((x) => x === 'ok').length,
      desatualizados: r.filter((x) => x === 'desatualizado').length,
      celulares,
      emailEnviado,
      emailDisponivel: this.email.disponivel,
      pushDisponivel: config().fcm !== null,
    };
  }

  // ---- Avaliação ----

  async avaliarTodas() {
    if (this.avaliando) return;
    this.avaliando = true;
    try {
      const empresas = await this.prisma.regraNotificacao.findMany({
        where: { ativo: true },
        distinct: ['empresaId'],
        select: { empresaId: true, empresa: { select: { ativa: true, statusAssinatura: true } } },
      });
      for (const e of empresas) {
        if (empresaBloqueada(e.empresa)) continue;
        await this.avaliarEmpresa(e.empresaId).catch((erro) => this.log.error(`Avaliação da empresa ${e.empresaId}: ${(erro as Error).message}`));
      }
      // Regra desligada não pode deixar aviso aberto para sempre (empresa sem nenhuma ligada sai da lista acima).
      await this.fecharOrfas();
    } catch (erro) {
      this.log.error(`Avaliação das notificações: ${(erro as Error).message}`);
    } finally {
      this.avaliando = false;
    }
  }

  async avaliarEmpresa(empresaId: string, agora = new Date()) {
    const [regras, janela, abertas] = await Promise.all([
      this.regrasSalvas(empresaId),
      this.janela(empresaId),
      this.prisma.notificacao.findMany({ where: { empresaId, resolvidaEm: null } }),
    ]);
    const { data, dataHora } = agoraNoFuso(agora, config().fusoHorario);
    const pode = dentroDaJanela(janela, diaDaSemana(data), dataHora.slice(11, 16));
    const vigentes = new Set<string>();

    for (const regra of regras.filter((r) => r.ativo)) {
      const evento = EVENTOS_NOTIFICACAO.find((e) => e.codigo === regra.evento);
      if (!evento) continue;
      for (const o of await this.ocorrencias(empresaId, regra, agora, data)) {
        vigentes.add(`${regra.evento}|${o.chave}`);
        const aberta = abertas.find((n) => n.evento === regra.evento && n.chave === o.chave);
        if (!pode) continue;
        if (!aberta) {
          const nova = await this.prisma.notificacao.create({
            data: { empresaId, evento: regra.evento, chave: o.chave, titulo: o.titulo, mensagem: o.mensagem, nivel: evento.nivel, canalAgente: regra.canalAgente, canalSistema: regra.canalSistema, canalEmail: regra.canalEmail, canalCelular: regra.canalCelular, agenteIds: regra.agenteIds, ultimoEnvioEm: agora },
          });
          await this.enviarAosCanais(nova);
        } else if (deveRepetir(regra.repetirMinutos, aberta.ultimoEnvioEm, agora)) {
          const repetida = await this.prisma.notificacao.update({
            where: { id: aberta.id },
            data: { titulo: o.titulo, mensagem: o.mensagem, vezes: { increment: 1 }, ultimoEnvioEm: agora, entregueAgentes: [], lidaEm: null, canalAgente: regra.canalAgente, canalSistema: regra.canalSistema, canalEmail: regra.canalEmail, canalCelular: regra.canalCelular, agenteIds: regra.agenteIds },
          });
          await this.enviarAosCanais(repetida);
        }
      }
    }

    const resolvidas = abertas.filter((n) => !vigentes.has(`${n.evento}|${n.chave}`)).map((n) => n.id);
    if (resolvidas.length) await this.prisma.notificacao.updateMany({ where: { id: { in: resolvidas }, empresaId }, data: { resolvidaEm: agora } });
  }

  /** O que a regra encontra agora. Nada aqui lê o conteúdo dos trabalhos nem SQL do cliente. */
  async ocorrencias(empresaId: string, regra: RegraNotificacaoDados, agora: Date, hoje: string): Promise<Ocorrencia[]> {
    const atras = (ms: number) => new Date(agora.getTime() - ms);
    switch (regra.evento as EventoNotificacao) {
      case 'sem_etiquetas': {
        const ultimo = await this.prisma.trabalhoImpressao.findFirst({ where: { empresaId, status: { not: 'CANCELADO' } }, orderBy: { criadoEm: 'desc' }, select: { criadoEm: true, modeloNome: true } });
        const referencia = ultimo?.criadoEm ?? (await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { criadoEm: true } }))?.criadoEm;
        if (!referencia || agora.getTime() - referencia.getTime() < regra.limite * HORA_MS) return [];
        const tempo = textoDuracao(agora.getTime() - referencia.getTime());
        return [{ chave: 'empresa', titulo: 'Sem gerar etiquetas', mensagem: ultimo ? `Nenhuma etiqueta gerada há ${tempo}. A última foi do modelo “${ultimo.modeloNome}”.` : `Nenhuma etiqueta gerada desde o cadastro, há ${tempo}.` }];
      }
      case 'lista_pendente': {
        const pendentes = await this.prisma.itemLista.count({ where: { empresaId, status: 'PENDENTE', lista: { data: new Date(`${hoje}T00:00:00Z`) } } });
        if (pendentes < Math.max(1, regra.limite)) return [];
        return [{ chave: hoje, titulo: 'Lista do dia parada', mensagem: `A lista de hoje tem ${pendentes} produto(s) esperando impressão.` }];
      }
      case 'agente_offline': {
        const agentes = await this.prisma.agente.findMany({ where: { empresaId, ativo: true, tokenHash: { not: null }, ultimoContatoEm: { lte: atras(regra.limite * 60_000) } }, select: { id: true, nome: true, hostname: true, ultimoContatoEm: true } });
        return agentes
          .filter((a) => !this.gateway.estaOnline(a.id))
          .map((a) => ({
            chave: chaveDoAgente(a.id),
            titulo: 'Agente fora do ar',
            mensagem: `O agente “${a.nome}”${a.hostname ? ` (${a.hostname})` : ''} está sem conexão há ${textoDuracao(agora.getTime() - a.ultimoContatoEm!.getTime())}.`,
          }));
      }
      case 'tela_offline': {
        const telas = await this.prisma.tela.findMany({ where: { empresaId, tokenHash: { not: null }, ultimoContatoEm: { lte: atras(regra.limite * 60_000) } }, select: { id: true, nome: true, local: true, ultimoContatoEm: true, horarioInicio: true, horarioFim: true } });
        const hora = horaLocal(agora, config().fusoHorario);
        return telas
          .filter((t) => dentroDoHorarioDaTela(t.horarioInicio, t.horarioFim, hora))
          .map((t) => ({
            chave: `tela:${t.id}`,
            titulo: 'Tela fora do ar',
            mensagem: `A tela “${t.nome}”${t.local ? ` (${t.local})` : ''} está sem aviso há ${textoDuracao(agora.getTime() - t.ultimoContatoEm!.getTime())}.`,
          }));
      }
      case 'pedido_novo': {
        // O problema é o pedido sem ninguém aceitar: some sozinho quando alguém aceita ou cancela.
        const pedidos = await this.prisma.pedido.findMany({ where: { empresaId, situacao: 'NOVO', criadoEm: { lte: atras(regra.limite * 60_000) } }, orderBy: { criadoEm: 'asc' }, take: 50, select: { id: true, numero: true, clienteNome: true, totalCentavos: true, criadoEm: true } });
        return pedidos.map((p) => ({
          chave: `pedido:${p.id}`,
          titulo: `Pedido nº ${p.numero}`,
          mensagem: `${p.clienteNome} fez um pedido de ${formatarCentavos(p.totalCentavos)} há ${textoDuracao(agora.getTime() - p.criadoEm.getTime())}. Aceite em Pedidos.`,
        }));
      }
      case 'entrega_sem_entregador': {
        // Some sozinho quando alguém aceita, a empresa escolhe à mão, para a distribuição ou cancela.
        const chamadas = await this.prisma.chamadaEntrega.findMany({ where: { empresaId, situacao: 'ABERTA', distribuicaoAtiva: true, semEntregadorEm: { lte: atras(regra.limite * 60_000) } }, orderBy: { criadoEm: 'asc' }, take: 50, select: { id: true, numero: true, tipo: true, criadoEm: true } });
        return chamadas.map((c) => ({
          chave: `chamada:${c.id}`,
          titulo: `Chamada nº ${c.numero} sem entregador`,
          mensagem: `${ROTULO_TIPO_CHAMADA[c.tipo as TipoChamada]} aberta há ${textoDuracao(agora.getTime() - c.criadoEm.getTime())} e ninguém aceitou. O sistema segue tentando; você pode escolher um entregador em Entregas.`,
        }));
      }
      case 'entrega_emergencia': {
        // Some quando alguém marca "Ciente" na chamada.
        const chamadas = await this.prisma.chamadaEntrega.findMany({ where: { empresaId, NOT: { emergencia: { equals: Prisma.DbNull } }, atualizadoEm: { gte: atras(24 * HORA_MS) } }, take: 50, select: { id: true, numero: true, emergencia: true, entregador: { select: { nome: true } } } });
        return chamadas
          .filter((c) => !(c.emergencia as { vistaEm?: string | null }).vistaEm)
          .map((c) => {
            const e = c.emergencia as { em: string; texto: string; posicao: { lat: number; lon: number } | null };
            return {
              chave: `emergencia:${c.id}:${e.em}`,
              titulo: `EMERGÊNCIA na chamada nº ${c.numero}`,
              mensagem: `${c.entregador?.nome.split(' ')[0] ?? 'O entregador'} pediu ajuda${e.texto ? `: ${e.texto}` : ''}.${e.posicao ? ` Posição: https://www.google.com/maps/search/?api=1&query=${e.posicao.lat},${e.posicao.lon}` : ''} Marque "Ciente" na chamada, em Entregas.`,
            };
          });
      }
      case 'entrega_custodia': {
        // Máquina coletada (série lida) e ainda não entregue, com o entregador sem mandar posição.
        const chamadas = await this.prisma.chamadaEntrega.findMany({
          where: { empresaId, serieColetada: { not: null }, situacao: { in: ['COLETADA', 'NO_DESTINO', 'OCORRENCIA'] }, entregador: { posicaoEm: { lte: atras(regra.limite * 60_000) } } },
          take: 50,
          select: { id: true, numero: true, serieColetada: true, entregador: { select: { nome: true, posicaoEm: true } } },
        });
        return chamadas.map((c) => ({
          chave: `custodia:${c.id}`,
          titulo: 'Máquina com entregador sem sinal',
          mensagem: `${c.entregador?.nome.split(' ')[0] ?? 'O entregador'} está com a máquina ${c.serieColetada} (chamada nº ${c.numero}) e não manda posição há ${textoDuracao(agora.getTime() - (c.entregador?.posicaoEm?.getTime() ?? agora.getTime()))}.`,
        }));
      }
      case 'entrega_ocorrencia': {
        const chamadas = await this.prisma.chamadaEntrega.findMany({ where: { empresaId, situacao: 'OCORRENCIA', atualizadoEm: { lte: atras(regra.limite * 60_000) } }, take: 50, select: { id: true, numero: true, ocorrencia: true, atualizadoEm: true } });
        return chamadas.map((c) => {
          const oc = c.ocorrencia as { motivo?: MotivoOcorrencia } | null;
          return {
            chave: `ocorrencia:${c.id}`,
            titulo: `Ocorrência na chamada nº ${c.numero}`,
            mensagem: `${oc?.motivo ? ROTULO_MOTIVO_OCORRENCIA[oc.motivo] : 'Ocorrência'} há ${textoDuracao(agora.getTime() - c.atualizadoEm.getTime())}. Decida em Entregas: seguir, chamar outro ou cancelar.`,
          };
        });
      }
      case 'entrega_atrasada': {
        // Tempo estimado do percurso (coleta → destino) a partir do aceite, mais o limite.
        const chamadas = await this.prisma.chamadaEntrega.findMany({ where: { empresaId, situacao: { in: ['ACEITA', 'NA_COLETA', 'COLETADA', 'NO_DESTINO'] }, aceitaEm: { not: null } }, take: 200, select: { id: true, numero: true, segundos: true, aceitaEm: true, entregador: { select: { nome: true } } } });
        return chamadas
          .filter((c) => c.aceitaEm!.getTime() + c.segundos * 1000 + regra.limite * 60_000 <= agora.getTime())
          .map((c) => ({
            chave: `atraso:${c.id}`,
            titulo: `Chamada nº ${c.numero} atrasada`,
            mensagem: `Aceita por ${c.entregador?.nome.split(' ')[0] ?? 'o entregador'} há ${textoDuracao(agora.getTime() - c.aceitaEm!.getTime())} e ainda não concluída (o percurso estimado é de ${Math.max(1, Math.round(c.segundos / 60))} min).`,
          }));
      }
      case 'entrega_contestacao': {
        const abertas = await this.prisma.contestacaoEntrega.findMany({ where: { empresaId, respondidaEm: null, criadoEm: { lte: atras(regra.limite * HORA_MS) } }, take: 50, select: { id: true, criadoEm: true, chamada: { select: { numero: true } }, entregador: { select: { nome: true } } } });
        return abertas.map((c) => ({
          chave: `contestacao:${c.id}`,
          titulo: 'Contestação de entregador',
          mensagem: `${c.entregador.nome.split(' ')[0]} contestou a chamada nº ${c.chamada.numero} há ${textoDuracao(agora.getTime() - c.criadoEm.getTime())}. Responda em Entregas > Financeiro.`,
        }));
      }
      case 'tela_aprovacao': {
        const pedidos = await this.prisma.conteudoTela.findMany({ where: { empresaId, aprovacaoSituacao: 'PENDENTE', aprovacaoPedidaEm: { lte: atras(regra.limite * 60_000) } }, select: { id: true, nome: true, aprovacaoPedidaEm: true } });
        return pedidos.map((c) => ({
          // Reenviar é outro pedido, mas o problema é o mesmo: a chave fica no conteúdo.
          chave: `aprovacao:${c.id}`,
          titulo: 'Conteúdo esperando aprovação',
          mensagem: `“${c.nome}” espera aprovação há ${textoDuracao(agora.getTime() - c.aprovacaoPedidaEm!.getTime())}.`,
        }));
      }
      case 'impressao_erro': {
        const trabalhos = await this.prisma.trabalhoImpressao.findMany({ where: { empresaId, status: 'ERRO', atualizadoEm: { gte: atras(24 * HORA_MS) } }, orderBy: { atualizadoEm: 'desc' }, select: { impressoraNome: true, erro: true }, take: 500 });
        const porImpressora = new Map<string, { quantidade: number; erro: string | null }>();
        for (const t of trabalhos) {
          const g = porImpressora.get(t.impressoraNome);
          if (g) g.quantidade++;
          else porImpressora.set(t.impressoraNome, { quantidade: 1, erro: t.erro });
        }
        return [...porImpressora].map(([nome, g]) => ({
          chave: `impressora:${nome}`,
          titulo: 'Impressão com erro',
          mensagem: `${g.quantidade} trabalho(s) com erro em “${nome}”.${g.erro ? ` Último: ${g.erro.slice(0, 120)}` : ''}`,
        }));
      }
      case 'fila_parada': {
        const fila = await this.prisma.trabalhoImpressao.aggregate({ where: { empresaId, status: { in: ['PENDENTE', 'ENVIANDO'] }, criadoEm: { lte: atras(regra.limite * 60_000) } }, _count: { _all: true }, _min: { criadoEm: true } });
        if (!fila._count._all) return [];
        return [{ chave: 'fila', titulo: 'Fila de impressão parada', mensagem: `${fila._count._all} trabalho(s) esperando na fila, o mais antigo há ${textoDuracao(agora.getTime() - fila._min.criadoEm!.getTime())}.` }];
      }
      case 'consulta_lenta': {
        const lentas = await this.prisma.execucaoConsulta.findMany({ where: { empresaId, ok: true, criadoEm: { gte: atras(HORA_MS) }, duracaoMs: { gt: regra.limite * 1000 } }, orderBy: { duracaoMs: 'desc' }, select: { consultaId: true, consultaNome: true, duracaoMs: true }, take: 200 });
        const vistas = new Set<string>();
        return lentas
          .filter((e) => !vistas.has(e.consultaId) && vistas.add(e.consultaId))
          .map((e) => ({ chave: `consulta:${e.consultaId}`, titulo: 'Consulta SQL lenta', mensagem: `“${e.consultaNome}” demorou ${(e.duracaoMs / 1000).toFixed(1).replace('.', ',')} s.` }));
      }
      case 'consulta_erro': {
        const execucoes = await this.prisma.execucaoConsulta.findMany({ where: { empresaId, criadoEm: { gte: atras(HORA_MS) } }, orderBy: { criadoEm: 'desc' }, select: { consultaId: true, consultaNome: true, ok: true, erro: true }, take: 1000 });
        const vistas = new Set<string>();
        return execucoes
          .filter((e) => !vistas.has(e.consultaId) && vistas.add(e.consultaId) && !e.ok)
          .map((e) => ({ chave: `consulta:${e.consultaId}`, titulo: 'Consulta SQL com erro', mensagem: `“${e.consultaNome}” falhou${e.erro ? `: ${e.erro.slice(0, 140)}` : '.'}` }));
      }
      case 'agendamento_falha': {
        const agendamentos = await this.prisma.agendamentoModelo.findMany({ where: { empresaId, ativo: true }, select: { id: true, historico: true, modelo: { select: { nome: true } } } });
        return agendamentos.flatMap((a) => {
          const erro = (a.historico as unknown as ExecucaoAgendamento[] | null)?.[0]?.erro;
          return erro ? [{ chave: `agendamento:${a.id}`, titulo: 'Agendamento com falha', mensagem: `“${a.modelo.nome}”: ${erro.slice(0, 160)}` }] : [];
        });
      }
    }
    return [];
  }

  // ---- Entrega ----

  private dadosDoAviso(n: { id: string; vezes: number; titulo: string; mensagem: string; nivel: string; ultimoEnvioEm: Date }): DadosNotificar {
    return { id: `${n.id}:${n.vezes}`, titulo: n.titulo, mensagem: n.mensagem, nivel: n.nivel as NivelNotificacao, em: n.ultimoEnvioEm.toISOString() };
  }

  private paraEsteAgente(n: { chave: string; agenteIds: unknown }, agenteId: string) {
    const alvo = comoLista(n.agenteIds);
    return n.chave !== chaveDoAgente(agenteId) && (alvo.length === 0 || alvo.includes(agenteId));
  }

  private async entregar(agenteId: string, dados: DadosNotificar): Promise<'ok' | 'desatualizado' | 'falhou'> {
    try {
      await this.gateway.sessao(agenteId).requisitar('notificar', dados, TEMPO_ENTREGA_MS);
      return 'ok';
    } catch (erro) {
      return (erro as Error).message.includes('não suportado por esta versão') ? 'desatualizado' : 'falhou';
    }
  }

  /** Um canal fora do ar não atrapalha os outros nem a avaliação das regras seguintes. */
  private async enviarAosCanais(n: Parameters<NotificacoesService['enviarAosAgentes']>[0] & { canalEmail: boolean; canalCelular: boolean }) {
    await this.enviarAosAgentes(n).catch((e) => this.log.warn(`Envio aos agentes: ${(e as Error).message}`));
    if (n.canalCelular) {
      const pedido = n.evento === 'pedido_novo';
      const entrega = n.evento.startsWith('entrega_');
      await this.dispositivos.avisarEmpresa(n.empresaId, { titulo: n.titulo, mensagem: n.mensagem, tela: n.evento === 'lista_pendente' ? 'lista' : pedido ? 'pedidos' : 'avisos' }, pedido ? 'pedido.ver' : entrega ? 'entrega.ver' : 'notificacao.ver').catch((e) => this.log.warn(`Envio aos celulares: ${(e as Error).message}`));
    }
    if (n.canalEmail) {
      const enderecos = await this.email.enderecosComPermissao(n.empresaId, 'notificacao.ver');
      await this.email.enviar(enderecos, `${n.titulo} - Flow`, n.mensagem);
    }
  }

  private async enviarAosAgentes(n: { id: string; empresaId: string; evento: string; chave: string; agenteIds: unknown; canalAgente: boolean; vezes: number; titulo: string; mensagem: string; nivel: string; ultimoEnvioEm: Date }) {
    if (!n.canalAgente) return;
    const agentes = await this.prisma.agente.findMany({ where: { empresaId: n.empresaId, ativo: true, tokenHash: { not: null } }, select: { id: true } });
    const alvos = agentes.filter((a) => this.gateway.estaOnline(a.id) && this.paraEsteAgente(n, a.id));
    const dados = this.dadosDoAviso(n);
    const entregues: string[] = [];
    await Promise.all(alvos.map(async (a) => (await this.entregar(a.id, dados)) === 'ok' && entregues.push(a.id)));
    if (entregues.length) await this.prisma.notificacao.update({ where: { id: n.id }, data: { entregueAgentes: entregues } });
  }

  /** Agente que voltou recebe o que ainda vale e não chegou até ele. */
  async entregarPendentes(agenteId: string) {
    const agente = await this.prisma.agente.findUnique({ where: { id: agenteId }, select: { empresaId: true } });
    if (!agente) return;
    const abertas = await this.prisma.notificacao.findMany({
      where: { empresaId: agente.empresaId, canalAgente: true, resolvidaEm: null, ultimoEnvioEm: { gte: new Date(Date.now() - VALIDADE_ENTREGA_MS) } },
      orderBy: { ultimoEnvioEm: 'asc' },
      take: 20,
    });
    for (const n of abertas) {
      if (!this.paraEsteAgente(n, agenteId) || comoLista(n.entregueAgentes).includes(agenteId)) continue;
      if ((await this.entregar(agenteId, this.dadosDoAviso(n))) === 'ok') {
        const atual = await this.prisma.notificacao.findUnique({ where: { id: n.id }, select: { entregueAgentes: true } });
        await this.prisma.notificacao.update({ where: { id: n.id }, data: { entregueAgentes: [...comoLista(atual?.entregueAgentes), agenteId] } });
      }
    }
  }

  // ---- Apoio ----

  private async regrasSalvas(empresaId: string): Promise<RegraNotificacaoDados[]> {
    const regras = await this.prisma.regraNotificacao.findMany({ where: { empresaId } });
    return regras.map((r) => ({ evento: r.evento as EventoNotificacao, ativo: r.ativo, limite: r.limite, canalAgente: r.canalAgente, canalSistema: r.canalSistema, canalEmail: r.canalEmail, canalCelular: r.canalCelular, repetirMinutos: r.repetirMinutos, agenteIds: comoLista(r.agenteIds) }));
  }

  private async janela(empresaId: string): Promise<JanelaNotificacao> {
    const j = await this.prisma.janelaNotificacao.findUnique({ where: { empresaId } });
    return j ? { horaInicio: j.horaInicio, horaFim: j.horaFim, diasSemana: j.diasSemana as number[] } : JANELA_PADRAO;
  }

  private async fecharOrfas() {
    const ligadas = await this.prisma.regraNotificacao.findMany({ where: { ativo: true }, distinct: ['empresaId'], select: { empresaId: true } });
    await this.prisma.notificacao.updateMany({ where: { resolvidaEm: null, empresaId: { notIn: ligadas.map((l) => l.empresaId) } }, data: { resolvidaEm: new Date() } });
  }

  private async limpar() {
    const antes = (dias: number) => new Date(Date.now() - dias * 24 * HORA_MS);
    await this.prisma.execucaoConsulta.deleteMany({ where: { criadoEm: { lt: antes(RETENCAO_EXECUCOES_DIAS) } } }).catch((e) => this.log.warn(`Limpeza das execuções: ${(e as Error).message}`));
    await this.prisma.notificacao.deleteMany({ where: { criadoEm: { lt: antes(RETENCAO_NOTIFICACOES_DIAS) }, resolvidaEm: { not: null } } }).catch((e) => this.log.warn(`Limpeza das notificações: ${(e as Error).message}`));
  }
}
