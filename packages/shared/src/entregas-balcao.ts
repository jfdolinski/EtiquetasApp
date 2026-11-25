// Entregas, etapa 12: etiqueta de coleta (pegar no balcão), volumes, termo de custódia, chamada
// agendada, relatório e conversa na chamada. Regras puras; o app do entregador tem cópias conferidas
// em entregas-app.test.ts.

import type { SituacaoChamada, TipoChamada } from './entregas-chamadas';

// Etiqueta de coleta -------------------------------------------------------------------------

/** "FC" (Flow coleta) + 10 letras e números sem os que se confundem (0/O, 1/I): cabe num Code 128 curto. */
export const ALFABETO_COLETA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODIGO_COLETA = /^FC[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/;

export function gerarCodigoColeta(aleatorio: (n: number) => number): string {
  let s = 'FC';
  for (let i = 0; i < 10; i++) s += ALFABETO_COLETA[aleatorio(ALFABETO_COLETA.length)];
  return s;
}

/** O que a câmera ou o leitor devolve (com espaço, minúscula, prefixo do leitor) vira o código. */
export function normalizarCodigoColeta(lido: string): string | null {
  const t = (lido ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /FC[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}/.exec(t);
  return m ? m[0] : null;
}

// Volumes ------------------------------------------------------------------------------------

export const LIMITES_VOLUMES = { minimo: 1, maximo: 99 };

export function problemaNosVolumes(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < LIMITES_VOLUMES.minimo || v > LIMITES_VOLUMES.maximo) return `Informe quantos volumes (de ${LIMITES_VOLUMES.minimo} a ${LIMITES_VOLUMES.maximo}).`;
  return null;
}

export const textoVolumes = (n: number) => (n === 1 ? '1 volume' : `${n} volumes`);

// Termo de custódia --------------------------------------------------------------------------

/** Mudou o texto, sobe o número: todos aceitam de novo antes da próxima máquina. */
export const VERSAO_TERMO_CUSTODIA = 1;

export const TEXTO_TERMO_CUSTODIA = [
  'Ao coletar uma máquina de cartão (maquininha) ou outro equipamento de uma empresa, eu fico responsável por ele até a entrega no destino da chamada.',
  'Confiro o número de série e o checklist na coleta e na entrega, e registro no aplicativo qualquer diferença, avaria ou falta de item.',
  'Não uso, não abro e não entrego o equipamento a outra pessoa. Em caso de perda, roubo ou acidente, aviso a empresa pelo aplicativo na mesma hora.',
  'Sei que a empresa vê no sistema quais máquinas estão comigo enquanto a chamada está em andamento.',
];

export const exigeTermoCustodia = (tipo: TipoChamada, serieEsperada: string | null | undefined) => tipo === 'DEVOLUCAO_MAQUINA' || !!serieEsperada;

export const temTermoVigente = (versao: number | null | undefined) => (versao ?? 0) >= VERSAO_TERMO_CUSTODIA;

// Chamada agendada ---------------------------------------------------------------------------

/** A distribuição começa esse tempo antes do horário da coleta. */
export const MINUTOS_ANTES_DA_AGENDADA = 30;
export const DIAS_MAXIMOS_AGENDADA = 30;

export function problemaNoAgendamento(agendadaPara: Date | string | null | undefined, agora: Date): string | null {
  if (!agendadaPara) return null;
  const t = new Date(agendadaPara).getTime();
  if (!Number.isFinite(t)) return 'Data do agendamento inválida.';
  if (t < agora.getTime() + 15 * 60_000) return 'Agende com ao menos 15 minutos de antecedência (ou abra a chamada para agora).';
  if (t > agora.getTime() + DIAS_MAXIMOS_AGENDADA * 86_400_000) return `Agende para no máximo ${DIAS_MAXIMOS_AGENDADA} dias à frente.`;
  return null;
}

export const inicioDaDistribuicao = (agendadaPara: Date | string) => new Date(new Date(agendadaPara).getTime() - MINUTOS_ANTES_DA_AGENDADA * 60_000);

// Conversa -----------------------------------------------------------------------------------

export const LIMITE_MENSAGEM = 500;
/** Depois de terminar, a conversa fica aberta por esse tempo (combinar acerto, achado). */
export const HORAS_CONVERSA_DEPOIS_DE_TERMINAR = 24;

export interface MensagemChamada {
  id: string;
  autor: 'empresa' | 'entregador';
  /** Primeiro nome de quem escreveu. */
  nome: string;
  texto: string;
  em: string;
}

export function podeConversar(c: { situacao: SituacaoChamada; temEntregador: boolean; concluidaEm: string | Date | null; canceladaEm: string | Date | null }, agora: Date): boolean {
  if (!c.temEntregador) return false;
  const fim = c.concluidaEm ?? c.canceladaEm;
  if (c.situacao !== 'CONCLUIDA' && c.situacao !== 'CANCELADA') return true;
  return !!fim && agora.getTime() - new Date(fim).getTime() <= HORAS_CONVERSA_DEPOIS_DE_TERMINAR * 3_600_000;
}

export function problemaNaMensagem(texto: string): string | null {
  const t = (texto ?? '').trim();
  if (!t) return 'Escreva a mensagem.';
  if (t.length > LIMITE_MENSAGEM) return `A mensagem pode ter até ${LIMITE_MENSAGEM} letras.`;
  return null;
}

// Relatório ----------------------------------------------------------------------------------

export interface LinhaRelatorio {
  numero: number;
  tipo: TipoChamada;
  situacao: SituacaoChamada;
  criadoEm: string;
  aceitaEm: string | null;
  concluidaEm: string | null;
  entregador: string | null;
  destino: string;
  volumes: number | null;
  /** Valor final para o entregador (com espera, volta e extra). */
  valorCentavos: number;
  ocorrencia: boolean;
  devolvida: boolean;
  avaliacao: number | null;
}

export interface ResumoRelatorio {
  total: number;
  concluidas: number;
  canceladas: number;
  comOcorrencia: number;
  devolvidas: number;
  valorCentavos: number;
  /** Da abertura ao aceite e do aceite à conclusão, em minutos (só as que têm os dois horários). */
  minutosAteAceite: number | null;
  minutosAteConcluir: number | null;
  porEntregador: { nome: string; chamadas: number; concluidas: number; valorCentavos: number; minutosAteConcluir: number | null; avaliacao: number | null }[];
  porTipo: { tipo: TipoChamada; chamadas: number; valorCentavos: number }[];
  porDia: { dia: string; chamadas: number; concluidas: number }[];
}

const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const minutos = (de: string | null, ate: string | null) => (de && ate ? Math.max(0, (new Date(ate).getTime() - new Date(de).getTime()) / 60_000) : null);

/** `dia` de cada linha vem pronto (no fuso), para o resumo não depender do relógio do computador. */
export function resumoDoRelatorio(linhas: (LinhaRelatorio & { dia: string })[]): ResumoRelatorio {
  const conclusao = (l: LinhaRelatorio) => (l.situacao === 'CONCLUIDA' ? minutos(l.aceitaEm, l.concluidaEm) : null);
  const porEntregador = new Map<string, (LinhaRelatorio & { dia: string })[]>();
  for (const l of linhas) if (l.entregador) porEntregador.set(l.entregador, [...(porEntregador.get(l.entregador) ?? []), l]);
  const porTipo = new Map<TipoChamada, { chamadas: number; valorCentavos: number }>();
  const porDia = new Map<string, { chamadas: number; concluidas: number }>();
  for (const l of linhas) {
    const t = porTipo.get(l.tipo) ?? { chamadas: 0, valorCentavos: 0 };
    porTipo.set(l.tipo, { chamadas: t.chamadas + 1, valorCentavos: t.valorCentavos + (l.situacao === 'CANCELADA' && !l.valorCentavos ? 0 : l.valorCentavos) });
    const d = porDia.get(l.dia) ?? { chamadas: 0, concluidas: 0 };
    porDia.set(l.dia, { chamadas: d.chamadas + 1, concluidas: d.concluidas + (l.situacao === 'CONCLUIDA' ? 1 : 0) });
  }
  return {
    total: linhas.length,
    concluidas: linhas.filter((l) => l.situacao === 'CONCLUIDA').length,
    canceladas: linhas.filter((l) => l.situacao === 'CANCELADA').length,
    comOcorrencia: linhas.filter((l) => l.ocorrencia).length,
    devolvidas: linhas.filter((l) => l.devolvida).length,
    valorCentavos: linhas.reduce((s, l) => s + l.valorCentavos, 0),
    minutosAteAceite: media(linhas.flatMap((l) => (l.aceitaEm ? [minutos(l.criadoEm, l.aceitaEm)!] : []))),
    minutosAteConcluir: media(linhas.flatMap((l) => (conclusao(l) !== null ? [conclusao(l)!] : []))),
    porEntregador: [...porEntregador.entries()]
      .map(([nome, ls]) => ({
        nome,
        chamadas: ls.length,
        concluidas: ls.filter((l) => l.situacao === 'CONCLUIDA').length,
        valorCentavos: ls.reduce((s, l) => s + l.valorCentavos, 0),
        minutosAteConcluir: media(ls.flatMap((l) => (conclusao(l) !== null ? [conclusao(l)!] : []))),
        avaliacao: (() => {
          const notas = ls.flatMap((l) => (l.avaliacao ? [l.avaliacao] : []));
          return notas.length ? Math.round((notas.reduce((s, x) => s + x, 0) / notas.length) * 10) / 10 : null;
        })(),
      }))
      .sort((a, b) => b.chamadas - a.chamadas || a.nome.localeCompare(b.nome)),
    porTipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, ...v })),
    porDia: [...porDia.entries()].map(([dia, v]) => ({ dia, ...v })).sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

/** Célula de planilha: aspas dobradas e, se começar com = + - @, um apóstrofo (a planilha não executa como fórmula). */
export function celulaCsv(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t) && typeof v !== 'number') t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Separado por ponto e vírgula e com vírgula decimal: abre direto no Excel em português. */
export function csvDoRelatorio(linhas: LinhaRelatorio[], rotuloTipo: Record<TipoChamada, string>, rotuloSituacao: Record<SituacaoChamada, string>, formatarData: (iso: string) => string): string {
  const cab = ['Nº', 'Serviço', 'Situação', 'Aberta em', 'Aceita em', 'Concluída em', 'Entregador', 'Destino', 'Volumes', 'Valor (R$)', 'Ocorrência', 'Devolvida', 'Avaliação'];
  const corpo = linhas.map((l) =>
    [
      l.numero,
      rotuloTipo[l.tipo],
      rotuloSituacao[l.situacao],
      formatarData(l.criadoEm),
      l.aceitaEm ? formatarData(l.aceitaEm) : '',
      l.concluidaEm ? formatarData(l.concluidaEm) : '',
      l.entregador ?? '',
      l.destino,
      l.volumes,
      (l.valorCentavos / 100).toFixed(2).replace('.', ','),
      l.ocorrencia ? 'sim' : 'não',
      l.devolvida ? 'sim' : 'não',
      l.avaliacao,
    ]
      .map(celulaCsv)
      .join(';'),
  );
  // BOM: o Excel reconhece os acentos.
  return '﻿' + [cab.map(celulaCsv).join(';'), ...corpo].join('\r\n') + '\r\n';
}
