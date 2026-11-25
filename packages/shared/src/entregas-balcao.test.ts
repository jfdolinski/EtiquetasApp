import { describe, expect, it } from 'vitest';
import { celulaCsv, csvDoRelatorio, gerarCodigoColeta, inicioDaDistribuicao, normalizarCodigoColeta, podeConversar, problemaNaMensagem, problemaNoAgendamento, problemaNosVolumes, resumoDoRelatorio, ROTULO_SITUACAO_CHAMADA, ROTULO_TIPO_CHAMADA, temTermoVigente, type LinhaRelatorio } from './index';

describe('etiqueta de coleta', () => {
  it('gera FC + 10 sem letras que se confundem e entende o que o leitor devolve', () => {
    let i = 0;
    const c = gerarCodigoColeta((n) => i++ % n);
    expect(c).toMatch(/^FC[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
    expect(normalizarCodigoColeta(` ${c.toLowerCase()}\n`)).toBe(c);
    expect(normalizarCodigoColeta(`]C1${c}`)).toBe(c);
    expect(normalizarCodigoColeta('7891000100103')).toBeNull();
    expect(normalizarCodigoColeta('FC0000000000')).toBeNull();
  });
  it('volumes de 1 a 99', () => {
    expect(problemaNosVolumes(0)).toMatch(/volumes/);
    expect(problemaNosVolumes(2.5)).toMatch(/volumes/);
    expect(problemaNosVolumes(3)).toBeNull();
  });
  it('termo vigente', () => {
    expect(temTermoVigente(null)).toBe(false);
    expect(temTermoVigente(1)).toBe(true);
  });
});

describe('chamada agendada', () => {
  const agora = new Date('2026-11-26T12:00:00Z');
  it('ao menos 15 min à frente e no máximo 30 dias', () => {
    expect(problemaNoAgendamento(null, agora)).toBeNull();
    expect(problemaNoAgendamento('2026-11-26T12:10:00Z', agora)).toMatch(/15 minutos/);
    expect(problemaNoAgendamento('2027-01-10T12:00:00Z', agora)).toMatch(/30 dias/);
    expect(problemaNoAgendamento('2026-11-27T09:00:00Z', agora)).toBeNull();
    expect(inicioDaDistribuicao('2026-11-27T09:00:00Z').toISOString()).toBe('2026-11-27T08:30:00.000Z');
  });
});

describe('conversa', () => {
  const agora = new Date('2026-11-26T12:00:00Z');
  it('só com entregador, e até 24 h depois de terminar', () => {
    expect(podeConversar({ situacao: 'ABERTA', temEntregador: false, concluidaEm: null, canceladaEm: null }, agora)).toBe(false);
    expect(podeConversar({ situacao: 'COLETADA', temEntregador: true, concluidaEm: null, canceladaEm: null }, agora)).toBe(true);
    expect(podeConversar({ situacao: 'CONCLUIDA', temEntregador: true, concluidaEm: '2026-11-26T08:00:00Z', canceladaEm: null }, agora)).toBe(true);
    expect(podeConversar({ situacao: 'CONCLUIDA', temEntregador: true, concluidaEm: '2026-11-24T08:00:00Z', canceladaEm: null }, agora)).toBe(false);
    expect(problemaNaMensagem('  ')).toMatch(/Escreva/);
    expect(problemaNaMensagem('x'.repeat(501))).toMatch(/500/);
  });
});

describe('relatório', () => {
  const base: LinhaRelatorio = { numero: 1, tipo: 'ENTREGA', situacao: 'CONCLUIDA', criadoEm: '2026-11-26T10:00:00Z', aceitaEm: '2026-11-26T10:04:00Z', concluidaEm: '2026-11-26T10:34:00Z', entregador: 'Ana Souza', destino: 'Rua A, 1', volumes: 2, valorCentavos: 1200, ocorrencia: false, devolvida: false, avaliacao: 5 };
  it('soma, médias e grupos', () => {
    const r = resumoDoRelatorio([
      { ...base, dia: '2026-11-26' },
      { ...base, numero: 2, aceitaEm: '2026-11-26T10:10:00Z', concluidaEm: '2026-11-26T10:30:00Z', avaliacao: 4, dia: '2026-11-26' },
      { ...base, numero: 3, situacao: 'CANCELADA', aceitaEm: null, concluidaEm: null, entregador: null, valorCentavos: 0, avaliacao: null, dia: '2026-11-27' },
    ]);
    expect(r).toMatchObject({ total: 3, concluidas: 2, canceladas: 1, valorCentavos: 2400, minutosAteAceite: 7, minutosAteConcluir: 25 });
    expect(r.porEntregador).toEqual([{ nome: 'Ana Souza', chamadas: 2, concluidas: 2, valorCentavos: 2400, minutosAteConcluir: 25, avaliacao: 4.5 }]);
    expect(r.porDia).toEqual([{ dia: '2026-11-26', chamadas: 2, concluidas: 2 }, { dia: '2026-11-27', chamadas: 1, concluidas: 0 }]);
  });
  it('CSV com ponto e vírgula, vírgula decimal e sem fórmula', () => {
    expect(celulaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celulaCsv('Rua A; 1')).toBe('"Rua A; 1"');
    const csv = csvDoRelatorio([base], ROTULO_TIPO_CHAMADA, ROTULO_SITUACAO_CHAMADA, (iso) => iso.slice(0, 10));
    expect(csv.startsWith('﻿Nº;Serviço;')).toBe(true);
    expect(csv).toContain('1;Entrega;Concluída;2026-11-26;2026-11-26;2026-11-26;Ana Souza;Rua A, 1;2;12,00;não;não;5');
  });
});
