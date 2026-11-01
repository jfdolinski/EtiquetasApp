import { Injectable } from '@nestjs/common';
import type { PainelEmpresa, PainelPlataformaLinha } from '@etiquetas/shared';
import { AgentesGateway } from '../agentes/agentes.gateway';
import { config } from '../config';
import { agoraNoFuso } from '../consultas/consultas.service';
import { PrismaService } from '../prisma/prisma.service';

const DIA_MS = 86_400_000;

/** Meia-noite no fuso da plataforma, `dias - 1` dias atrás (1 = hoje). */
export function inicioDoPeriodo(dias: number, agora: Date, fuso: string): Date {
  const { data, dataHora } = agoraNoFuso(agora, fuso);
  const deslocamento = Date.parse(`${dataHora.replace(' ', 'T')}Z`) - Math.floor(agora.getTime() / 1000) * 1000;
  return new Date(Date.parse(`${data}T00:00:00Z`) - deslocamento - (dias - 1) * DIA_MS);
}

/** Dias do período na ordem, com os sem etiqueta zerados (o gráfico não pode pular dia). */
export function completarDias(linhas: { dia: string; etiquetas: number }[], dias: number, hoje: string) {
  const mapa = new Map(linhas.map((l) => [l.dia, l.etiquetas]));
  const fim = Date.parse(`${hoje}T00:00:00Z`);
  return Array.from({ length: dias }, (_, i) => {
    const dia = new Date(fim - (dias - 1 - i) * DIA_MS).toISOString().slice(0, 10);
    return { dia, etiquetas: mapa.get(dia) ?? 0 };
  });
}

/** Números do dashboard. Todo `where` filtra por empresa; nada lê o conteúdo dos trabalhos. */
@Injectable()
export class PainelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AgentesGateway,
  ) {}

  async empresa(empresaId: string, dias: number): Promise<PainelEmpresa> {
    const agora = new Date();
    const fuso = config().fusoHorario;
    const hoje = agoraNoFuso(agora, fuso).data;
    const inicio = inicioDoPeriodo(dias, agora, fuso);
    const inicioHoje = inicioDoPeriodo(1, agora, fuso);
    const noPeriodo = { empresaId, criadoEm: { gte: inicio } };

    const [uso, impressao, agentes, consultas, cadastros, listaHoje, notificacoesAbertas, usuarios] = await Promise.all([
      this.uso(empresaId),
      this.impressao(empresaId, noPeriodo, inicio, inicioHoje, dias, hoje, fuso),
      this.agentes(empresaId),
      this.consultas(empresaId, noPeriodo),
      this.cadastros(empresaId, noPeriodo),
      this.listaHoje(empresaId, hoje),
      this.prisma.notificacao.count({ where: { empresaId, resolvidaEm: null } }),
      this.usuarios(empresaId, noPeriodo),
    ]);
    return { dias, geradoEm: agora.toISOString(), uso, impressao, agentes, consultas, cadastros, listaHoje, notificacoesAbertas, usuarios };
  }

  private async uso(empresaId: string): Promise<PainelEmpresa['uso']> {
    const validos = { empresaId, status: { not: 'CANCELADO' as const } };
    const [ultimo, manual] = await Promise.all([
      this.prisma.trabalhoImpressao.findFirst({ where: validos, orderBy: { criadoEm: 'desc' }, select: { criadoEm: true, modeloNome: true, criadoPor: { select: { nome: true } } } }),
      this.prisma.trabalhoImpressao.findFirst({ where: { ...validos, origem: { not: 'AGENDAMENTO' } }, orderBy: { criadoEm: 'desc' }, select: { criadoEm: true } }),
    ]);
    return {
      ultimaEm: ultimo?.criadoEm.toISOString() ?? null,
      ultimoModelo: ultimo?.modeloNome ?? null,
      ultimoAutor: ultimo?.criadoPor?.nome ?? null,
      ultimaManualEm: manual?.criadoEm.toISOString() ?? null,
    };
  }

  private async impressao(
    empresaId: string,
    noPeriodo: { empresaId: string; criadoEm: { gte: Date } },
    inicio: Date,
    inicioHoje: Date,
    dias: number,
    hoje: string,
    fuso: string,
  ): Promise<PainelEmpresa['impressao']> {
    const concluidos = { ...noPeriodo, status: 'CONCLUIDO' as const };
    const [porStatus, pendentes, deHoje, porOrigem, porModelo, porImpressora, porDia] = await Promise.all([
      this.prisma.trabalhoImpressao.groupBy({ by: ['status'], where: noPeriodo, _count: { _all: true }, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.trabalhoImpressao.aggregate({ where: { empresaId, status: { in: ['PENDENTE', 'ENVIANDO'] } }, _count: { _all: true }, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.trabalhoImpressao.aggregate({ where: { empresaId, status: 'CONCLUIDO', criadoEm: { gte: inicioHoje } }, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['origem'], where: concluidos, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['modeloNome'], where: concluidos, _sum: { quantidadeEtiquetas: true }, orderBy: { _sum: { quantidadeEtiquetas: 'desc' } }, take: 5 }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['impressoraNome', 'status'], where: noPeriodo, _count: { _all: true }, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.$queryRaw<{ dia: string; etiquetas: number }[]>`
        SELECT to_char(criado_em AT TIME ZONE 'UTC' AT TIME ZONE ${fuso}, 'YYYY-MM-DD') AS dia, SUM(quantidade_etiquetas)::int AS etiquetas
        FROM trabalhos_impressao
        WHERE empresa_id = ${empresaId}::uuid AND criado_em >= ${inicio} AND status = 'CONCLUIDO'
        GROUP BY 1`,
    ]);
    const status = (s: string) => porStatus.find((p) => p.status === s);
    const impressoras = new Map<string, { nome: string; etiquetas: number; erros: number }>();
    for (const p of porImpressora) {
      const g = impressoras.get(p.impressoraNome) ?? { nome: p.impressoraNome, etiquetas: 0, erros: 0 };
      if (p.status === 'CONCLUIDO') g.etiquetas += p._sum.quantidadeEtiquetas ?? 0;
      if (p.status === 'ERRO') g.erros += p._count._all;
      impressoras.set(p.impressoraNome, g);
    }
    return {
      etiquetasConcluidas: status('CONCLUIDO')?._sum.quantidadeEtiquetas ?? 0,
      trabalhosConcluidos: status('CONCLUIDO')?._count._all ?? 0,
      etiquetasHoje: deHoje._sum.quantidadeEtiquetas ?? 0,
      trabalhosPendentes: pendentes._count._all,
      etiquetasPendentes: pendentes._sum.quantidadeEtiquetas ?? 0,
      trabalhosComErro: status('ERRO')?._count._all ?? 0,
      trabalhosCancelados: status('CANCELADO')?._count._all ?? 0,
      porOrigem: porOrigem.map((p) => ({ origem: p.origem, etiquetas: p._sum.quantidadeEtiquetas ?? 0 })).sort((a, b) => b.etiquetas - a.etiquetas),
      porDia: completarDias(porDia, dias, hoje),
      porModelo: porModelo.map((p) => ({ nome: p.modeloNome, etiquetas: p._sum.quantidadeEtiquetas ?? 0 })),
      porImpressora: [...impressoras.values()].sort((a, b) => b.etiquetas - a.etiquetas).slice(0, 5),
    };
  }

  private async agentes(empresaId: string): Promise<PainelEmpresa['agentes']> {
    const agentes = await this.prisma.agente.findMany({
      where: { empresaId, ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, versao: true, hostname: true, ultimoContatoEm: true, tokenHash: true },
    });
    const ativados = agentes.filter((a) => a.tokenHash);
    const lista = ativados.map((a) => ({
      id: a.id,
      nome: a.nome,
      online: this.gateway.estaOnline(a.id),
      versao: a.versao,
      hostname: a.hostname,
      ultimoContatoEm: a.ultimoContatoEm?.toISOString() ?? null,
    }));
    const online = lista.filter((a) => a.online).length;
    return { online, offline: lista.length - online, aguardandoAtivacao: agentes.length - ativados.length, lista };
  }

  private async consultas(empresaId: string, noPeriodo: { empresaId: string; criadoEm: { gte: Date } }): Promise<PainelEmpresa['consultas']> {
    const [cadastradas, resumo, falhas, p95, porConsulta, ultimaFalha] = await Promise.all([
      this.prisma.consultaSql.count({ where: { empresaId, ativo: true } }),
      this.prisma.execucaoConsulta.aggregate({ where: { ...noPeriodo, ok: true }, _count: { _all: true }, _avg: { duracaoMs: true }, _max: { duracaoMs: true } }),
      this.prisma.execucaoConsulta.count({ where: { ...noPeriodo, ok: false } }),
      this.prisma.$queryRaw<{ p95: number | null }[]>`
        SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY duracao_ms)::int AS p95
        FROM execucoes_consulta
        WHERE empresa_id = ${empresaId}::uuid AND criado_em >= ${noPeriodo.criadoEm.gte} AND ok`,
      this.prisma.execucaoConsulta.groupBy({ by: ['consultaNome', 'ok'], where: noPeriodo, _count: { _all: true }, _avg: { duracaoMs: true }, _max: { duracaoMs: true } }),
      this.prisma.execucaoConsulta.findFirst({ where: { ...noPeriodo, ok: false }, orderBy: { criadoEm: 'desc' }, select: { consultaNome: true, erro: true, criadoEm: true } }),
    ]);
    const nomes = new Map<string, { nome: string; execucoes: number; mediaMs: number; maximoMs: number; falhas: number }>();
    for (const c of porConsulta) {
      const g = nomes.get(c.consultaNome) ?? { nome: c.consultaNome, execucoes: 0, mediaMs: 0, maximoMs: 0, falhas: 0 };
      if (c.ok) {
        g.execucoes = c._count._all;
        g.mediaMs = Math.round(c._avg.duracaoMs ?? 0);
        g.maximoMs = c._max.duracaoMs ?? 0;
      } else g.falhas = c._count._all;
      nomes.set(c.consultaNome, g);
    }
    return {
      cadastradas,
      execucoes: resumo._count._all + falhas,
      falhas,
      mediaMs: resumo._avg.duracaoMs === null ? null : Math.round(resumo._avg.duracaoMs),
      p95Ms: p95[0]?.p95 ?? null,
      maximoMs: resumo._max.duracaoMs,
      maisLentas: [...nomes.values()].sort((a, b) => b.mediaMs - a.mediaMs || b.falhas - a.falhas).slice(0, 5),
      ultimaFalha: ultimaFalha ? { nome: ultimaFalha.consultaNome, erro: ultimaFalha.erro ?? '', em: ultimaFalha.criadoEm.toISOString() } : null,
    };
  }

  private async cadastros(empresaId: string, noPeriodo: { empresaId: string; criadoEm: { gte: Date } }): Promise<PainelEmpresa['cadastros']> {
    const [modelos, conexoes, impressoras, usadas, agendamentos, banidos] = await Promise.all([
      this.prisma.modeloEtiqueta.findMany({ where: { empresaId }, select: { ativo: true, naListaDiaria: true, impressoraId: true, consultaId: true } }),
      this.prisma.conexaoBanco.groupBy({ by: ['tipo', 'ativo'], where: { empresaId }, _count: { _all: true } }),
      this.prisma.impressora.findMany({ where: { empresaId }, select: { id: true, ativo: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['impressoraId'], where: { ...noPeriodo, status: { not: 'CANCELADO' } } }),
      this.prisma.agendamentoModelo.findMany({ where: { empresaId }, select: { ativo: true, imprimirAutomatico: true, historico: true } }),
      this.prisma.produtoBanido.count({ where: { empresaId } }),
    ]);
    const ativos = modelos.filter((m) => m.ativo);
    const tipos = new Map<string, number>();
    for (const c of conexoes.filter((x) => x.ativo)) tipos.set(c.tipo, (tipos.get(c.tipo) ?? 0) + c._count._all);
    const contarConexoes = (ativo: boolean) => conexoes.filter((c) => c.ativo === ativo).reduce((s, c) => s + c._count._all, 0);
    const idsUsados = new Set(usadas.map((u) => u.impressoraId));
    const impressorasAtivas = impressoras.filter((i) => i.ativo);
    const agendaAtiva = agendamentos.filter((a) => a.ativo);
    return {
      modelos: {
        ativos: ativos.length,
        inativos: modelos.length - ativos.length,
        naLista: ativos.filter((m) => m.naListaDiaria).length,
        semImpressora: ativos.filter((m) => !m.impressoraId).length,
        semConsulta: ativos.filter((m) => !m.consultaId).length,
      },
      conexoes: { ativas: contarConexoes(true), inativas: contarConexoes(false), porTipo: [...tipos].map(([tipo, quantidade]) => ({ tipo, quantidade })) },
      impressoras: { ativas: impressorasAtivas.length, inativas: impressoras.length - impressorasAtivas.length, semUso: impressorasAtivas.filter((i) => !idsUsados.has(i.id)).length },
      agendamentos: {
        automaticos: agendaAtiva.filter((a) => a.imprimirAutomatico).length,
        manuais: agendaAtiva.filter((a) => !a.imprimirAutomatico).length,
        inativos: agendamentos.length - agendaAtiva.length,
        comFalha: agendaAtiva.filter((a) => (a.historico as { erro?: string }[] | null)?.[0]?.erro).length,
      },
      banidos,
    };
  }

  private async listaHoje(empresaId: string, hoje: string): Promise<PainelEmpresa['listaHoje']> {
    const grupos = await this.prisma.itemLista.groupBy({ by: ['status'], where: { empresaId, lista: { data: new Date(`${hoje}T00:00:00Z`) } }, _count: { _all: true } });
    const n = (s: string) => grupos.find((g) => g.status === s)?._count._all ?? 0;
    return { pendentes: n('PENDENTE'), naFila: n('NA_FILA'), impressos: n('IMPRESSO'), descartados: n('DESCARTADO') };
  }

  /** Só o que a pessoa pediu: agendamento roda em nome do responsável e esconderia a falta de uso. */
  private async usuarios(empresaId: string, noPeriodo: { empresaId: string; criadoEm: { gte: Date } }): Promise<PainelEmpresa['usuarios']> {
    const manuais = { status: { not: 'CANCELADO' as const }, origem: { not: 'AGENDAMENTO' as const } };
    const [usuarios, periodo, sempre] = await Promise.all([
      this.prisma.usuario.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, ultimoLoginEm: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['criadoPorId'], where: { ...noPeriodo, ...manuais }, _count: { _all: true }, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['criadoPorId'], where: { empresaId, ...manuais }, _max: { criadoEm: true } }),
    ]);
    return usuarios
      .map((u) => {
        const p = periodo.find((x) => x.criadoPorId === u.id);
        return {
          id: u.id,
          nome: u.nome,
          etiquetas: p?._sum.quantidadeEtiquetas ?? 0,
          trabalhos: p?._count._all ?? 0,
          ultimaImpressaoEm: sempre.find((x) => x.criadoPorId === u.id)?._max.criadoEm?.toISOString() ?? null,
          ultimoLoginEm: u.ultimoLoginEm?.toISOString() ?? null,
        };
      })
      .sort((a, b) => (a.ultimaImpressaoEm ?? '').localeCompare(b.ultimaImpressaoEm ?? '') || a.nome.localeCompare(b.nome));
  }

  /** Super-admin: uma linha por empresa, de quem está há mais tempo sem gerar. */
  async plataforma(dias: number): Promise<PainelPlataformaLinha[]> {
    const inicio = inicioDoPeriodo(dias, new Date(), config().fusoHorario);
    const [empresas, etiquetas, erros, ultimas, agentes, logins] = await Promise.all([
      this.prisma.empresa.findMany({ where: { ativa: true }, select: { id: true, razaoSocial: true, nomeFantasia: true, statusAssinatura: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['empresaId'], where: { status: 'CONCLUIDO', criadoEm: { gte: inicio } }, _sum: { quantidadeEtiquetas: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['empresaId'], where: { status: 'ERRO', criadoEm: { gte: inicio } }, _count: { _all: true } }),
      this.prisma.trabalhoImpressao.groupBy({ by: ['empresaId'], where: { status: { not: 'CANCELADO' } }, _max: { criadoEm: true } }),
      this.prisma.agente.findMany({ where: { ativo: true, tokenHash: { not: null } }, select: { id: true, empresaId: true } }),
      this.prisma.usuario.groupBy({ by: ['empresaId'], where: { empresaId: { not: null } }, _max: { ultimoLoginEm: true } }),
    ]);
    return empresas
      .map((e) => {
        const seus = agentes.filter((a) => a.empresaId === e.id);
        return {
          id: e.id,
          nome: e.nomeFantasia || e.razaoSocial,
          statusAssinatura: e.statusAssinatura,
          agentesOnline: seus.filter((a) => this.gateway.estaOnline(a.id)).length,
          agentesTotal: seus.length,
          etiquetas: etiquetas.find((x) => x.empresaId === e.id)?._sum.quantidadeEtiquetas ?? 0,
          trabalhosComErro: erros.find((x) => x.empresaId === e.id)?._count._all ?? 0,
          ultimaEtiquetaEm: ultimas.find((x) => x.empresaId === e.id)?._max.criadoEm?.toISOString() ?? null,
          ultimoLoginEm: logins.find((x) => x.empresaId === e.id)?._max.ultimoLoginEm?.toISOString() ?? null,
        };
      })
      .sort((a, b) => (a.ultimaEtiquetaEm ?? '').localeCompare(b.ultimaEtiquetaEm ?? '') || a.nome.localeCompare(b.nome));
  }
}
