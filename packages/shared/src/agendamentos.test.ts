import { describe, expect, it } from 'vitest';
import { decomporIntervalo, formatarIntervalo, proximaExecucao, proximasExecucoes } from './agendamentos';

describe('ciclo dos agendamentos', () => {
  it('mostra o intervalo na maior unidade exata', () => {
    expect(decomporIntervalo(86_400)).toEqual({ valor: 1, unidade: 'dias' });
    expect(decomporIntervalo(7_200)).toEqual({ valor: 2, unidade: 'horas' });
    expect(decomporIntervalo(90)).toEqual({ valor: 90, unidade: 'segundos' });
    expect(decomporIntervalo(300)).toEqual({ valor: 5, unidade: 'minutos' });
    expect(formatarIntervalo(3600)).toBe('a cada hora');
    expect(formatarIntervalo(45)).toBe('a cada 45 segundos');
    expect(formatarIntervalo(2 * 86_400)).toBe('a cada 2 dias');
  });

  it('próxima execução fica alinhada ao início, mesmo com atraso', () => {
    const inicio = new Date('2026-10-30T09:00:00Z'); // 06:00 em Brasília
    const dia = 86_400;
    expect(proximaExecucao(inicio, dia, new Date('2026-10-29T12:00:00Z')).toISOString()).toBe('2026-10-30T09:00:00.000Z');
    expect(proximaExecucao(inicio, dia, new Date('2026-10-30T09:00:00Z')).toISOString()).toBe('2026-10-31T09:00:00.000Z');
    expect(proximaExecucao(inicio, dia, new Date('2026-11-02T15:37:00Z')).toISOString()).toBe('2026-11-03T09:00:00.000Z');
    expect(proximaExecucao(inicio, 90, new Date('2026-10-30T09:02:00Z')).toISOString()).toBe('2026-10-30T09:03:00.000Z');
  });

  it('lista as próximas execuções para a tela', () => {
    const r = proximasExecucoes(new Date('2026-10-30T09:00:00Z'), 3600, new Date('2026-10-30T10:30:00Z'), 3);
    expect(r.map((d) => d.toISOString())).toEqual(['2026-10-30T11:00:00.000Z', '2026-10-30T12:00:00.000Z', '2026-10-30T13:00:00.000Z']);
  });
});
