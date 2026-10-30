import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ehParametro,
  extrairPlaceholders,
  proximaExecucao,
  type AgendamentoResumo,
  type ExecucaoAgendamento,
  type OpcoesAgendamento,
  type TipoBanco,
} from '@etiquetas/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { empresaBloqueada } from '../auth/acesso-empresa';
import { PrismaService } from '../prisma/prisma.service';
import type { AtualizarAgendamentoDto, CriarAgendamentoDto } from './dto';
import { ListasService } from './listas.service';

/** O relógio confere os agendamentos vencidos a cada 5 s (ciclo mínimo: 30 s). */
const INTERVALO_VERIFICACAO_MS = 5_000;
const POR_RODADA = 20;
const MAXIMO_HISTORICO = 20;
const MAXIMO_POR_EMPRESA = 50;

const SELECAO = {
  id: true,
  empresaId: true,
  modeloId: true,
  impressoraId: true,
  responsavelId: true,
  intervaloSegundos: true,
  inicioEm: true,
  imprimirAutomatico: true,
  ativo: true,
  proximaExecucaoEm: true,
  ultimaExecucaoEm: true,
  historico: true,
  modelo: { select: { id: true, nome: true, consultaId: true, impressoraId: true, ativo: true, impressora: { select: { nome: true } } } },
  impressora: { select: { nome: true } },
  responsavel: { select: { nome: true, ativo: true } },
} satisfies Prisma.AgendamentoModeloSelect;

type Agendamento = Prisma.AgendamentoModeloGetPayload<{ select: typeof SELECAO }>;

/** Consulta com `{param.*}` é de busca (alguém digita o valor): não roda sozinha. */
function pedeParametros(consulta: { sql: string; conexao: { tipo: string } } | null): boolean {
  if (!consulta) return false;
  try {
    return extrairPlaceholders(consulta.sql, consulta.conexao.tipo as TipoBanco).some(ehParametro);
  } catch {
    return false; // SQL inválido aparece como erro na execução
  }
}

/**
 * Agendamentos de modelos: a cada ciclo executa a consulta do modelo e atualiza os itens dele
 * na lista do dia (o que já foi impresso, enviado ou descartado hoje não volta). Com impressão
 * automática, imprime os pendentes na hora. Relógio em processo, como a avaliação da cobrança:
 * a API roda com uma réplica, e a reivindicação por `updateMany` impede rodar o mesmo ciclo duas vezes.
 */
@Injectable()
export class AgendamentosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Agendamentos');
  private relogio?: NodeJS.Timeout;
  private verificando = false;
  /** Agendamentos rodando agora (uma execução por vez de cada um). */
  private readonly emExecucao = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly listas: ListasService,
  ) {}

  onApplicationBootstrap() {
    this.relogio = setInterval(() => void this.verificar(), INTERVALO_VERIFICACAO_MS);
  }

  onModuleDestroy() {
    clearInterval(this.relogio);
  }

  async listar(empresaId: string): Promise<AgendamentoResumo[]> {
    const lista = await this.prisma.agendamentoModelo.findMany({ where: { empresaId }, orderBy: [{ ativo: 'desc' }, { proximaExecucaoEm: 'asc' }], select: SELECAO });
    return lista.map((a) => this.resumo(a));
  }

  /** Para o formulário: quem só tem `agendamento.*` não precisa ver modelos nem impressoras. */
  async opcoes(empresaId: string): Promise<OpcoesAgendamento> {
    const [modelos, impressoras] = await Promise.all([
      this.prisma.modeloEtiqueta.findMany({
        where: { empresaId, ativo: true, consultaId: { not: null } },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, impressoraId: true, naListaDiaria: true, consulta: { select: { sql: true, conexao: { select: { tipo: true } } } } },
      }),
      this.prisma.impressora.findMany({ where: { empresaId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, linguagem: true, ativo: true } }),
    ]);
    return {
      modelos: modelos.filter((m) => !pedeParametros(m.consulta)).map(({ consulta: _, ...m }) => m),
      impressoras,
    };
  }

  async criar(empresaId: string, dto: CriarAgendamentoDto, autorId: string): Promise<AgendamentoResumo> {
    if ((await this.prisma.agendamentoModelo.count({ where: { empresaId } })) >= MAXIMO_POR_EMPRESA) {
      throw new BadRequestException(`No máximo ${MAXIMO_POR_EMPRESA} agendamentos por empresa.`);
    }
    await this.validar(empresaId, dto.modeloId, dto.impressoraId ?? null, dto.imprimirAutomatico);
    const inicioEm = new Date(dto.inicioEm);
    const ativo = dto.ativo ?? true;
    const a = await this.prisma.agendamentoModelo.create({
      data: {
        empresaId,
        modeloId: dto.modeloId,
        impressoraId: dto.impressoraId ?? null,
        responsavelId: autorId,
        intervaloSegundos: dto.intervaloSegundos,
        inicioEm,
        imprimirAutomatico: dto.imprimirAutomatico,
        ativo,
        proximaExecucaoEm: ativo ? proximaExecucao(inicioEm, dto.intervaloSegundos, new Date()) : null,
      },
      select: SELECAO,
    });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'agendamento.criar', entidade: 'AgendamentoModelo', entidadeId: a.id, detalhes: { ...dto } });
    return this.resumo(a);
  }

  /** Quem edita vira o responsável: o agendamento passa a rodar com o usuário dele. */
  async atualizar(empresaId: string, id: string, dto: AtualizarAgendamentoDto, autorId: string): Promise<AgendamentoResumo> {
    const atual = await this.buscar(empresaId, id);
    const impressoraId = dto.impressoraId === undefined ? atual.impressoraId : dto.impressoraId;
    const imprimirAutomatico = dto.imprimirAutomatico ?? atual.imprimirAutomatico;
    const ativo = dto.ativo ?? atual.ativo;
    // Pausado não roda: pausar sempre é possível, mesmo com o modelo ou a impressora com problema.
    if (ativo) await this.validar(empresaId, atual.modeloId, impressoraId, imprimirAutomatico);
    const intervaloSegundos = dto.intervaloSegundos ?? atual.intervaloSegundos;
    const inicioEm = dto.inicioEm ? new Date(dto.inicioEm) : atual.inicioEm;
    const a = await this.prisma.agendamentoModelo.update({
      where: { id },
      data: {
        impressoraId,
        imprimirAutomatico,
        intervaloSegundos,
        inicioEm,
        ativo,
        responsavelId: autorId,
        proximaExecucaoEm: ativo ? proximaExecucao(inicioEm, intervaloSegundos, new Date()) : null,
      },
      select: SELECAO,
    });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'agendamento.editar', entidade: 'AgendamentoModelo', entidadeId: id, detalhes: { ...dto } });
    return this.resumo(a);
  }

  async excluir(empresaId: string, id: string, autorId: string) {
    const atual = await this.buscar(empresaId, id);
    await this.prisma.agendamentoModelo.delete({ where: { id } });
    await this.auditoria.registrar({ empresaId, usuarioId: autorId, acao: 'agendamento.excluir', entidade: 'AgendamentoModelo', entidadeId: id, detalhes: { modelo: atual.modelo.nome } });
  }

  /** Botão "Executar agora": roda com o usuário que clicou e não mexe no próximo horário. */
  async executarAgora(empresaId: string, id: string, autorId: string): Promise<AgendamentoResumo> {
    await this.buscar(empresaId, id);
    if (this.emExecucao.has(id)) throw new ConflictException('Este agendamento já está em execução.');
    await this.executar(id, 'manual', autorId);
    return this.resumo(await this.buscar(empresaId, id));
  }

  /** Relógio: reivindica os vencidos (próximo horário avança antes de rodar) e executa. */
  async verificar() {
    if (this.verificando) return;
    this.verificando = true;
    try {
      const agora = new Date();
      const vencidos = await this.prisma.agendamentoModelo.findMany({
        where: { ativo: true, proximaExecucaoEm: { lte: agora } },
        orderBy: { proximaExecucaoEm: 'asc' },
        take: POR_RODADA,
        select: { id: true, proximaExecucaoEm: true, inicioEm: true, intervaloSegundos: true },
      });
      for (const v of vencidos) {
        if (this.emExecucao.has(v.id)) continue; // ciclo menor que a execução: pula este
        const reivindicado = await this.prisma.agendamentoModelo.updateMany({
          where: { id: v.id, proximaExecucaoEm: v.proximaExecucaoEm },
          data: { proximaExecucaoEm: proximaExecucao(v.inicioEm, v.intervaloSegundos, agora) },
        });
        if (reivindicado.count === 1) void this.executar(v.id, 'agendada');
      }
    } catch (e) {
      this.log.error(`Falha ao verificar os agendamentos: ${(e as Error).message}`);
    } finally {
      this.verificando = false;
    }
  }

  /** Uma execução: atualiza a lista do dia e, se for o caso, imprime. Nunca lança. */
  async executar(id: string, origem: ExecucaoAgendamento['origem'], usuarioManual?: string): Promise<ExecucaoAgendamento | null> {
    if (this.emExecucao.has(id)) return null;
    this.emExecucao.add(id);
    const inicio = Date.now();
    const r: ExecucaoAgendamento = { em: new Date(inicio).toISOString(), duracaoMs: 0, itensNovos: 0, etiquetas: 0, trabalhos: 0, origem };
    let empresaId: string | null = null;
    let usuarioId: string | null = null;
    try {
      const a = await this.prisma.agendamentoModelo.findUnique({
        where: { id },
        select: { ...SELECAO, empresa: { select: { ativa: true, statusAssinatura: true } } },
      });
      if (!a) return null;
      empresaId = a.empresaId;
      usuarioId = usuarioManual ?? (a.responsavel?.ativo ? a.responsavelId : null);
      if (empresaBloqueada(a.empresa)) r.erro = 'A empresa está bloqueada.';
      else if (!a.modelo.ativo) r.erro = 'O modelo está desativado.';
      else if (!a.modelo.consultaId) r.erro = 'O modelo não tem consulta vinculada.';
      else if (!usuarioId) r.erro = 'O usuário responsável foi removido ou desativado: edite e salve o agendamento.';
      else {
        const lista = await this.listas.atualizarModeloNaLista(a.empresaId, usuarioId, a.modelo, a.impressoraId);
        if (lista.erro) r.erro = lista.erro;
        else {
          r.itensNovos = lista.pendentes;
          if (lista.aviso) r.avisos = [lista.aviso];
          if (a.imprimirAutomatico && lista.pendentes > 0) {
            const impressao = await this.listas.imprimirPendentesDoModelo(a.empresaId, usuarioId, a.modelo.id);
            r.trabalhos = impressao.trabalhos.length;
            r.etiquetas = impressao.trabalhos.reduce((s, t) => s + t.quantidadeEtiquetas, 0);
            if (impressao.avisos.length) r.avisos = [...(r.avisos ?? []), ...impressao.avisos].slice(0, 5);
          }
        }
      }
    } catch (e) {
      r.erro = (e as Error).message || 'Erro inesperado.';
    } finally {
      r.duracaoMs = Date.now() - inicio;
      try {
        const atual = await this.prisma.agendamentoModelo.findUnique({ where: { id }, select: { historico: true } });
        if (atual) {
          const historico = [r, ...((atual.historico as unknown as ExecucaoAgendamento[]) ?? [])].slice(0, MAXIMO_HISTORICO);
          await this.prisma.agendamentoModelo.update({ where: { id }, data: { ultimaExecucaoEm: new Date(inicio), historico: historico as unknown as Prisma.InputJsonArray } });
        }
        // Auditoria só do que importa: execução manual ou que imprimiu (ciclos de 30 s encheriam o registro).
        if (empresaId && (origem === 'manual' || r.trabalhos > 0)) {
          await this.auditoria.registrar({
            empresaId,
            usuarioId,
            acao: 'agendamento.executar',
            entidade: 'AgendamentoModelo',
            entidadeId: id,
            detalhes: { origem, itensNovos: r.itensNovos, etiquetas: r.etiquetas, erro: r.erro ?? null },
          });
        }
      } catch (e) {
        this.log.error(`Falha ao registrar a execução do agendamento ${id}: ${(e as Error).message}`);
      }
      this.emExecucao.delete(id);
    }
    if (r.erro) this.log.warn(`Agendamento ${id} (${origem}): ${r.erro}`);
    return r;
  }

  /** Modelo da empresa com consulta; impressão automática exige impressora térmica ativa. */
  private async validar(empresaId: string, modeloId: string, impressoraId: string | null, imprimirAutomatico: boolean) {
    const modelo = await this.prisma.modeloEtiqueta.findFirst({
      where: { id: modeloId, empresaId },
      select: {
        consultaId: true,
        consulta: { select: { sql: true, conexao: { select: { tipo: true } } } },
        impressora: { select: { ativo: true, linguagem: true, nome: true } },
      },
    });
    if (!modelo) throw new BadRequestException('Modelo inválido para esta empresa.');
    if (!modelo.consultaId) throw new BadRequestException('O modelo precisa de uma consulta: é ela que traz os produtos a cada ciclo.');
    if (pedeParametros(modelo.consulta)) {
      throw new BadRequestException('A consulta deste modelo pede valores digitados ({param.*}), como uma busca: use um modelo com consulta de lista.');
    }
    let impressora = modelo.impressora;
    if (impressoraId) {
      impressora = await this.prisma.impressora.findFirst({ where: { id: impressoraId, empresaId }, select: { ativo: true, linguagem: true, nome: true } });
      if (!impressora) throw new BadRequestException('Impressora inválida para esta empresa.');
    }
    if (imprimirAutomatico) {
      if (!impressora) throw new BadRequestException('Impressão automática precisa de impressora: escolha uma aqui ou defina a padrão do modelo.');
      if (!impressora.ativo) throw new BadRequestException(`A impressora ${impressora.nome} está desativada.`);
      if (impressora.linguagem === 'PDF') {
        throw new BadRequestException('Impressão automática não funciona com impressora comum (PDF): o PDF é impresso pelo navegador. Use uma impressora térmica.');
      }
    }
  }

  private async buscar(empresaId: string, id: string): Promise<Agendamento> {
    const a = await this.prisma.agendamentoModelo.findFirst({ where: { id, empresaId }, select: SELECAO });
    if (!a) throw new NotFoundException('Agendamento não encontrado.');
    return a;
  }

  private resumo(a: Agendamento): AgendamentoResumo {
    return {
      id: a.id,
      modeloId: a.modeloId,
      modeloNome: a.modelo.nome,
      impressoraId: a.impressoraId,
      impressoraNome: a.impressora?.nome ?? a.modelo.impressora?.nome ?? null,
      responsavelNome: a.responsavel?.nome ?? null,
      intervaloSegundos: a.intervaloSegundos,
      inicioEm: a.inicioEm.toISOString(),
      imprimirAutomatico: a.imprimirAutomatico,
      ativo: a.ativo,
      proximaExecucaoEm: a.proximaExecucaoEm?.toISOString() ?? null,
      ultimaExecucaoEm: a.ultimaExecucaoEm?.toISOString() ?? null,
      historico: (a.historico as unknown as ExecucaoAgendamento[]) ?? [],
      emExecucao: this.emExecucao.has(a.id),
    };
  }
}
