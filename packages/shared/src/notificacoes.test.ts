import { describe, expect, it } from 'vitest';
import { deveRepetir, dentroDaJanela, diaDaSemana, EVENTOS_NOTIFICACAO, horaValida, regrasComPadrao, textoDuracao } from './notificacoes';

describe('notificações', () => {
  it('regras nunca salvas ficam desligadas; a salva prevalece', () => {
    const regras = regrasComPadrao([{ evento: 'fila_parada', ativo: true, limite: 3, canalAgente: false, canalSistema: true, repetirMinutos: 0, agenteIds: [] }]);
    expect(regras).toHaveLength(EVENTOS_NOTIFICACAO.length);
    expect(regras.filter((r) => r.ativo).map((r) => r.evento)).toEqual(['fila_parada']);
    expect(regras.find((r) => r.evento === 'fila_parada')?.limite).toBe(3);
  });

  it('janela no mesmo dia', () => {
    const j = { horaInicio: '08:00', horaFim: '18:00', diasSemana: [1] };
    expect(dentroDaJanela(j, 1, '08:00')).toBe(true);
    expect(dentroDaJanela(j, 1, '17:59')).toBe(true);
    expect(dentroDaJanela(j, 1, '18:00')).toBe(false);
    expect(dentroDaJanela(j, 2, '10:00')).toBe(false);
  });

  it('janela que atravessa a meia-noite: a madrugada é do dia em que abriu', () => {
    const j = { horaInicio: '22:00', horaFim: '06:00', diasSemana: [5] };
    expect(dentroDaJanela(j, 5, '23:00')).toBe(true);
    expect(dentroDaJanela(j, 6, '05:00')).toBe(true);
    expect(dentroDaJanela(j, 5, '05:00')).toBe(false);
    expect(dentroDaJanela(j, 6, '23:00')).toBe(false);
  });

  it('início igual ao fim vale o dia todo', () => {
    const j = { horaInicio: '00:00', horaFim: '00:00', diasSemana: [0] };
    expect(dentroDaJanela(j, 0, '13:00')).toBe(true);
    expect(dentroDaJanela(j, 1, '13:00')).toBe(false);
  });

  it('hora, dia da semana, repetição e texto de duração', () => {
    expect(horaValida('23:59')).toBe(true);
    expect(horaValida('24:00')).toBe(false);
    expect(diaDaSemana('2026-11-01')).toBe(0);
    const t = new Date('2026-11-01T10:00:00Z');
    expect(deveRepetir(0, t, new Date('2026-11-09T10:00:00Z'))).toBe(false);
    expect(deveRepetir(60, t, new Date('2026-11-01T10:59:00Z'))).toBe(false);
    expect(deveRepetir(60, t, new Date('2026-11-01T11:00:00Z'))).toBe(true);
    expect(textoDuracao(30_000)).toBe('menos de 1 minuto');
    expect(textoDuracao(90 * 60_000)).toBe('1 hora');
    expect(textoDuracao(50 * 3_600_000)).toBe('2 dias e 2 h');
  });
});
