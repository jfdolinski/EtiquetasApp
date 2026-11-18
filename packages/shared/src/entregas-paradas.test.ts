import { describe, expect, it } from 'vitest';
import {
  adicionaisQueValem,
  aposEntregarParada,
  gradeDeDemanda,
  horarioVale,
  momentoNoFuso,
  problemaNasParadas,
  problemaNosAdicionais,
  textoDaParada,
  totalDosAdicionais,
  type Adicionais,
} from './entregas-paradas';

const p = (lat: number, lon: number, endereco = 'Rua X, 1') => ({ lat, lon, endereco, contato: '', telefone: '', instrucoes: '' });

describe('várias paradas', () => {
  it('só na entrega, até 9, todas marcadas', () => {
    expect(problemaNasParadas('ENTREGA', [])).toBeNull();
    expect(problemaNasParadas('COLETA', [p(1, 1)])).toBe('Várias paradas só na entrega.');
    expect(problemaNasParadas('ENTREGA', Array.from({ length: 10 }, () => p(1, 1)))).toMatch(/No máximo 9/);
    expect(problemaNasParadas('ENTREGA', [p(1, 1), p(0, 0)])).toBe('Marque a parada 3 no mapa.');
    expect(problemaNasParadas('ENTREGA', [p(1, 1, ' ')])).toBe('Informe o endereço da parada 2.');
  });

  it('entregar uma parada passa para a próxima; a última conclui', () => {
    expect(aposEntregarParada(0, 3)).toEqual({ ultima: false, proxima: 1 });
    expect(aposEntregarParada(2, 3)).toEqual({ ultima: true, proxima: 2 });
    expect(aposEntregarParada(0, 1)).toEqual({ ultima: true, proxima: 0 });
  });

  it('o destinatário sabe quantas entregas faltam antes da dele', () => {
    expect(textoDaParada(2, 0, 'COLETADA', false)).toBe('Saiu para entrega: 2 entregas antes da sua');
    expect(textoDaParada(1, 0, 'NO_DESTINO', false)).toBe('Saiu para entrega: uma entrega antes da sua');
    expect(textoDaParada(1, 1, 'COLETADA', false)).toBeNull();
    expect(textoDaParada(0, 1, 'COLETADA', true)).toBe('Entregue');
    expect(textoDaParada(2, 0, 'ACEITA', false)).toBeNull();
  });
});

describe('adicionais', () => {
  const noturno = { nome: 'Noturno', dias: [5, 6], inicio: '22:00', fim: '06:00', percentual: 20, fixoCentavos: 0 };
  const a: Adicionais = {
    horarios: [noturno, { nome: 'Almoço', dias: [1, 2, 3, 4, 5], inicio: '11:30', fim: '14:00', percentual: 0, fixoCentavos: 200 }],
    regioes: [{ nome: 'Morro', centro: { lat: -23.6, lon: -46.7 }, raioKm: 1, percentual: 10, fixoCentavos: 100 }],
  };

  it('valida', () => {
    expect(problemaNosAdicionais(a)).toBeNull();
    expect(problemaNosAdicionais({ horarios: [{ ...noturno, percentual: 0 }], regioes: [] })).toMatch(/não soma nada/);
    expect(problemaNosAdicionais({ horarios: [{ ...noturno, dias: [] }], regioes: [] })).toMatch(/dias/);
    expect(problemaNosAdicionais({ horarios: [{ ...noturno, inicio: '25:00' }], regioes: [] })).toMatch(/Horário inválido/);
  });

  it('faixa que passa da meia-noite conta o dia em que começou', () => {
    expect(horarioVale(noturno, { dia: 5, hhmm: '23:10' })).toBe(true);
    expect(horarioVale(noturno, { dia: 6, hhmm: '03:00' })).toBe(true); // começou sexta
    expect(horarioVale(noturno, { dia: 5, hhmm: '03:00' })).toBe(false); // quinta à noite não vale
    expect(horarioVale(noturno, { dia: 0, hhmm: '05:59' })).toBe(true); // começou sábado
    expect(horarioVale(noturno, { dia: 6, hhmm: '06:00' })).toBe(false);
  });

  it('soma por horário e por região, com o nome', () => {
    const l = adicionaisQueValem(a, 1000, { dia: 6, hhmm: '23:00' }, [{ lat: -23.6, lon: -46.705 }]);
    expect(l).toEqual([
      { nome: 'Noturno', centavos: 200 },
      { nome: 'Morro', centavos: 200 },
    ]);
    expect(totalDosAdicionais(l)).toBe(400);
    expect(adicionaisQueValem(a, 1000, { dia: 3, hhmm: '12:00' }, [{ lat: 0, lon: 0 }])).toEqual([{ nome: 'Almoço', centavos: 200 }]);
  });

  it('momento no fuso', () => {
    expect(momentoNoFuso(new Date('2026-11-18T02:30:00Z'), 'America/Sao_Paulo')).toEqual({ dia: 2, hhmm: '23:30' });
  });
});

describe('demanda', () => {
  it('junta pontos próximos na mesma célula', () => {
    const g = gradeDeDemanda([
      { lat: -23.5501, lon: -46.6331 },
      { lat: -23.5502, lon: -46.6332 },
      { lat: -23.6, lon: -46.7 },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].quantidade).toBe(2);
  });
});
