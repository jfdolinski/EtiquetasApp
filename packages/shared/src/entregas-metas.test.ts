import { describe, expect, it } from 'vitest';
import { contaNaMeta, metrosEstimados, problemaNaMeta, problemaNaRoteirizacao, roteirizar, situacaoDaMeta, textoDaFaixa, type NovaMeta } from './entregas-metas';
import { esperaDoWebhook, ipPrivado, MAX_TENTATIVAS_WEBHOOK, problemaNoWebhook, referenciaLimpa } from './entregas-integracao';
import { problemaNoChamado, situacaoDepoisDaMensagem } from './suporte';
import { distanciaMetros } from './entregas';

const agora = new Date('2026-11-26T15:00:00Z');
const meta = (m: Partial<NovaMeta> = {}): NovaMeta => ({ nome: 'Semana cheia', inicio: '2026-11-26T03:00:00Z', fim: '2026-12-03T03:00:00Z', minimoChamadas: 20, valorCentavos: 5000, faixa: null, ...m });

describe('metas', () => {
  it('confere a meta', () => {
    expect(problemaNaMeta(meta(), agora)).toBeNull();
    expect(problemaNaMeta(meta({ nome: 'ab' }), agora)).toMatch(/nome/);
    expect(problemaNaMeta(meta({ fim: '2026-11-25T00:00:00Z' }), agora)).toMatch(/depois do início/);
    expect(problemaNaMeta(meta({ inicio: '2026-11-20T00:00:00Z', fim: '2026-11-26T14:00:00Z' }), agora)).toMatch(/já passou/);
    expect(problemaNaMeta(meta({ inicio: '2026-11-24T00:00:00Z' }), agora)).toMatch(/ontem/);
    expect(problemaNaMeta(meta({ fim: '2027-01-10T00:00:00Z' }), agora)).toMatch(/31 dias/);
    expect(problemaNaMeta(meta({ minimoChamadas: 0 }), agora)).toMatch(/1 a 500/);
    expect(problemaNaMeta(meta({ valorCentavos: 50 }), agora)).toMatch(/bônus/);
    expect(problemaNaMeta(meta({ faixa: { dias: [], inicio: '11:00', fim: '14:00' } }), agora)).toMatch(/dias/);
    expect(problemaNaMeta(meta({ faixa: { dias: [1], inicio: '11h', fim: '14:00' } }), agora)).toMatch(/formato/);
    expect(problemaNaMeta(meta({ faixa: { dias: [1, 2], inicio: '22:00', fim: '02:00' } }), agora)).toBeNull();
  });

  it('conta só no período e no horário de pico (fuso do sistema)', () => {
    const m = { inicio: new Date('2026-11-26T03:00:00Z'), fim: new Date('2026-12-03T03:00:00Z'), faixa: null };
    expect(contaNaMeta(new Date('2026-11-27T12:00:00Z'), m, 'America/Sao_Paulo')).toBe(true);
    expect(contaNaMeta(new Date('2026-11-26T02:59:00Z'), m, 'America/Sao_Paulo')).toBe(false);
    expect(contaNaMeta(new Date('2026-12-03T03:00:00Z'), m, 'America/Sao_Paulo')).toBe(false);
    // Quinta 26/11: pico de seg a sex, 11:00 às 14:00 em São Paulo (14:00 às 17:00 UTC).
    const pico = { ...m, faixa: { dias: [1, 2, 3, 4, 5], inicio: '11:00', fim: '14:00' } };
    expect(contaNaMeta(new Date('2026-11-26T15:30:00Z'), pico, 'America/Sao_Paulo')).toBe(true);
    expect(contaNaMeta(new Date('2026-11-26T17:30:00Z'), pico, 'America/Sao_Paulo')).toBe(false);
    // Sábado 28/11, mesmo horário: fora dos dias.
    expect(contaNaMeta(new Date('2026-11-28T15:30:00Z'), pico, 'America/Sao_Paulo')).toBe(false);
  });

  it('situação e texto do horário', () => {
    expect(situacaoDaMeta({ inicio: '2026-11-27T00:00:00Z', fim: '2026-11-28T00:00:00Z', canceladaEm: null }, agora)).toBe('AGENDADA');
    expect(situacaoDaMeta({ inicio: '2026-11-26T00:00:00Z', fim: '2026-11-28T00:00:00Z', canceladaEm: null }, agora)).toBe('EM_ANDAMENTO');
    expect(situacaoDaMeta({ inicio: '2026-11-20T00:00:00Z', fim: '2026-11-26T00:00:00Z', canceladaEm: null }, agora)).toBe('ENCERRADA');
    expect(situacaoDaMeta({ inicio: '2026-11-26T00:00:00Z', fim: '2026-11-28T00:00:00Z', canceladaEm: agora }, agora)).toBe('CANCELADA');
    expect(textoDaFaixa(null)).toBe('qualquer horário');
    expect(textoDaFaixa({ dias: [1, 2, 3, 4, 5], inicio: '11:00', fim: '14:00' })).toBe('seg a sex, 11:00 às 14:00');
    expect(textoDaFaixa({ dias: [0, 6], inicio: '18:00', fim: '23:00' })).toBe('sáb e dom, 18:00 às 23:00');
    expect(textoDaFaixa({ dias: [1, 3, 5], inicio: '18:00', fim: '23:00' })).toBe('seg, qua e sex, 18:00 às 23:00');
    expect(textoDaFaixa({ dias: [0, 1, 2, 3, 4, 5, 6], inicio: '18:00', fim: '23:00' })).toBe('todos os dias, 18:00 às 23:00');
  });
});

describe('roteirização', () => {
  const base = { lat: -23.55, lon: -46.63 };
  // Norte, leste, sul e oeste da base, três pontos de cada lado.
  const lado = (dLat: number, dLon: number) => [1, 2, 3].map((k) => ({ lat: base.lat + dLat * k * 0.01, lon: base.lon + dLon * k * 0.01 }));
  const pontos = [...lado(1, 0.1), ...lado(0.1, 1), ...lado(-1, -0.1), ...lado(-0.1, -1)];

  it('confere a quantidade', () => {
    expect(problemaNaRoteirizacao(0, 5)).toMatch(/Escolha/);
    expect(problemaNaRoteirizacao(101, 5)).toMatch(/100/);
    expect(problemaNaRoteirizacao(10, 0)).toMatch(/1 a 10/);
    expect(problemaNaRoteirizacao(10, 11)).toMatch(/1 a 10/);
    expect(problemaNaRoteirizacao(10, 3)).toBeNull();
  });

  it('junta quem fica do mesmo lado e usa todos os pontos uma vez', () => {
    const grupos = roteirizar(base, pontos, 3);
    expect(grupos).toHaveLength(4);
    expect(grupos.flat().sort((a, b) => a - b)).toEqual(pontos.map((_, i) => i));
    for (const g of grupos) {
      // Cada grupo tem os três pontos de um mesmo lado (índices seguidos de 3 em 3).
      const lados = new Set(g.map((i) => Math.floor(i / 3)));
      expect(lados.size).toBe(1);
      // E sai do mais perto da base para o mais longe.
      const d = g.map((i) => distanciaMetros(base, pontos[i]));
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
  });

  it('divide em tamanhos parecidos', () => {
    expect(roteirizar(base, pontos, 5).map((g) => g.length)).toEqual([4, 4, 4]);
    expect(roteirizar(base, pontos.slice(0, 7), 10).map((g) => g.length)).toEqual([7]);
    expect(roteirizar(base, pontos.slice(0, 3), 1)).toHaveLength(3);
    expect(roteirizar(base, [], 5)).toEqual([]);
  });

  it('estima os metros pela linha reta × 1,4', () => {
    const p = [{ lat: base.lat + 0.01, lon: base.lon }];
    expect(metrosEstimados(base, p)).toBe(Math.round(distanciaMetros(base, p[0]) * 1.4));
    expect(metrosEstimados(base, [])).toBe(0);
  });
});

describe('integração', () => {
  it('só aceita webhook público em HTTPS', () => {
    expect(problemaNoWebhook('')).toBeNull();
    expect(problemaNoWebhook(null)).toBeNull();
    expect(problemaNoWebhook('https://loja.exemplo.com.br/flow')).toBeNull();
    expect(problemaNoWebhook('http://loja.exemplo.com.br/flow')).toMatch(/https/);
    expect(problemaNoWebhook('https://usuario:senha@loja.exemplo.com.br')).toMatch(/usuário e senha/);
    expect(problemaNoWebhook('https://localhost:3000/x')).toMatch(/público/);
    expect(problemaNoWebhook('https://192.168.0.10/x')).toMatch(/público/);
    expect(problemaNoWebhook('https://[::1]/x')).toMatch(/público/);
    expect(problemaNoWebhook('https://servidor.internal/x')).toMatch(/público/);
    expect(problemaNoWebhook('isso não é endereço')).toMatch(/inválido/);
  });

  it('reconhece IP de rede interna', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(ipPrivado(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '200.160.2.3', '2001:4860:4860::8888']) expect(ipPrivado(ip)).toBe(false);
  });

  it('espera cada vez mais e desiste depois de 6 tentativas', () => {
    expect(esperaDoWebhook(0)).toBe(0);
    expect(esperaDoWebhook(1)).toBe(60_000);
    expect(esperaDoWebhook(MAX_TENTATIVAS_WEBHOOK - 1)).toBe(6 * 3_600_000);
    expect(esperaDoWebhook(MAX_TENTATIVAS_WEBHOOK)).toBeNull();
  });

  it('limpa a referência', () => {
    expect(referenciaLimpa('  PED-123 ')).toBe('PED-123');
    expect(referenciaLimpa('')).toBeNull();
    expect(referenciaLimpa(null)).toBeNull();
    expect(referenciaLimpa('x'.repeat(80))).toHaveLength(60);
  });
});

describe('suporte', () => {
  it('confere o chamado', () => {
    expect(problemaNoChamado({ categoria: 'APP', assunto: 'Não abre o app', texto: 'Fica na tela branca' })).toBeNull();
    expect(problemaNoChamado({ categoria: 'NADA', assunto: 'Não abre o app', texto: 'Fica na tela branca' })).toMatch(/assunto/);
    expect(problemaNoChamado({ categoria: 'APP', assunto: 'oi', texto: 'Fica na tela branca' })).toMatch(/título/);
    expect(problemaNoChamado({ categoria: 'APP', assunto: 'Não abre o app', texto: 'oi' })).toMatch(/mensagem/);
  });

  it('a resposta muda a situação', () => {
    expect(situacaoDepoisDaMensagem(true)).toBe('RESPONDIDO');
    expect(situacaoDepoisDaMensagem(false)).toBe('ABERTO');
  });
});
