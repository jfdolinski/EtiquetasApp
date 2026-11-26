import { describe, expect, it } from 'vitest';
import {
  aposColetar,
  coletaDaVez,
  coletasDoEntregador,
  mediaDaEmpresa,
  podeAvaliarEmpresa,
  podeMarcarPresenca,
  podeRegistrarAvaria,
  podeSairDoTurno,
  problemaNaAvaria,
  problemaNasColetas,
  problemaNoTotalDoPagamento,
  problemaNoTurno,
  problemaNoValorDeclarado,
  turnoPerto,
  turnoVigente,
  type NovaAvaria,
} from './entregas-escala';
import { classificar, REGRAS_DIRECIONAMENTO_PADRAO, type CandidatoDirecionamento } from './entregas-direcionamento';
import { etapaDaFoto, rotuloDaFoto } from './entregas-operacao';

const p = (lat: number, lon: number, endereco = 'Rua das Flores, 10') => ({ lat, lon, endereco, contato: '', telefone: '', instrucoes: '' });
const H = 3_600_000;

describe('várias coletas', () => {
  it('só na entrega, até 4, com endereço e ponto', () => {
    expect(problemaNasColetas('ENTREGA', [])).toBeNull();
    expect(problemaNasColetas('COLETA', [p(-23.5, -46.6)])).toMatch(/só na entrega/);
    expect(problemaNasColetas('ENTREGA', Array.from({ length: 5 }, () => p(-23.5, -46.6)))).toMatch(/No máximo 4/);
    expect(problemaNasColetas('ENTREGA', [p(0, 0)])).toMatch(/Marque a coleta 2/);
    expect(problemaNasColetas('ENTREGA', [p(-23.5, -46.6, 'abc')])).toMatch(/endereço da coleta 2/);
  });
  it('volta para a próxima coleta até a última', () => {
    expect(aposColetar(0, 3)).toEqual({ ultima: false, proxima: 1 });
    expect(aposColetar(2, 3)).toEqual({ ultima: true, proxima: 2 });
    expect(aposColetar(0, 1)).toEqual({ ultima: true, proxima: 0 });
  });
  it('a coleta da vez e a lista do app', () => {
    const origem = p(1, 1, 'Loja A, 1');
    const extras = [{ parada: p(2, 2, 'Loja B, 2'), coletadaEm: '2026-11-26T10:00:00Z', volumes: 1 }, { parada: p(3, 3, 'Loja C, 3'), coletadaEm: null, volumes: null }];
    expect(coletaDaVez(origem, extras, 0).endereco).toBe('Loja A, 1');
    expect(coletaDaVez(origem, extras, 2).endereco).toBe('Loja C, 3');
    expect(coletasDoEntregador(origem, extras, 2, false).map((c) => c.coletada)).toEqual([true, true, false]);
    expect(coletasDoEntregador(origem, extras, 2, true).every((c) => c.coletada)).toBe(true);
  });
  it('foto de cada coleta tem nome próprio', () => {
    expect(etapaDaFoto('COLETA')).toBe('COLETA');
    expect(etapaDaFoto('COLETA', 2)).toBe('COLETA_2');
    expect(rotuloDaFoto('COLETA_2')).toBe('Foto da coleta 3');
    expect(etapaDaFoto('ENTREGA', 1)).toBe('ENTREGA_1');
  });
});

describe('turnos', () => {
  const agora = new Date('2026-11-26T12:00:00Z');
  const turno = (iniH: number, fimH: number, extra: Partial<{ vagas: number; valorCentavos: number }> = {}) => ({ inicio: new Date(agora.getTime() + iniH * H).toISOString(), fim: new Date(agora.getTime() + fimH * H).toISOString(), vagas: 2, valorCentavos: 0, observacao: '', ...extra });
  it('confere horário, duração, vagas e valor', () => {
    expect(problemaNoTurno(turno(1, 5), agora)).toBeNull();
    expect(problemaNoTurno(turno(-2, 3), agora)).toMatch(/passado/);
    expect(problemaNoTurno(turno(1, 1.5), agora)).toMatch(/1 hora/);
    expect(problemaNoTurno(turno(1, 14), agora)).toMatch(/12 horas/);
    expect(problemaNoTurno(turno(1, 5, { vagas: 0 }), agora)).toMatch(/vagas/);
    expect(problemaNoTurno(turno(1, 5, { valorCentavos: 100_001 }), agora)).toMatch(/valor/);
    expect(problemaNoTurno(turno(24 * 31, 24 * 31 + 2), agora)).toMatch(/30 dias/);
  });
  it('vigente, sair até 2 h antes e presença depois do fim', () => {
    expect(turnoVigente({ inicio: new Date(agora.getTime() - H), fim: new Date(agora.getTime() + H) }, agora)).toBe(true);
    expect(turnoVigente({ inicio: new Date(agora.getTime() - H), fim: new Date(agora.getTime() + H), canceladoEm: agora }, agora)).toBe(false);
    expect(podeSairDoTurno(new Date(agora.getTime() + 3 * H), agora)).toBe(true);
    expect(podeSairDoTurno(new Date(agora.getTime() + H), agora)).toBe(false);
    expect(podeMarcarPresenca(new Date(agora.getTime() + 1), agora)).toBe(false);
    expect(podeMarcarPresenca(agora, agora)).toBe(true);
  });
  it('perto da base (sem base ou sem posição, aparece)', () => {
    expect(turnoPerto(null, { lat: 1, lon: 1 }).perto).toBe(true);
    expect(turnoPerto({ lat: -23.55, lon: -46.63 }, { lat: -23.56, lon: -46.64 }).perto).toBe(true);
    expect(turnoPerto({ lat: -23.55, lon: -46.63 }, { lat: -22.9, lon: -43.2 }).perto).toBe(false);
  });
  it('quem está no turno vem antes de todos no direcionamento', () => {
    const base: CandidatoDirecionamento = { id: 'a', nome: 'Ana', veiculo: 'MOTO', metrosAteColeta: 300, minutosLivre: 60, ofertadas30d: 10, aceitas30d: 10, avaliacao: 5, preferido: true, bloqueado: false, jaOfertado: false };
    const r = classificar([base, { ...base, id: 'b', nome: 'Beto', metrosAteColeta: 4000, minutosLivre: 1, avaliacao: 3, preferido: false, emTurno: true }], { ...REGRAS_DIRECIONAMENTO_PADRAO, preferidosPrimeiro: true }, 'ENTREGA', 5);
    expect(r.classificados.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('avaliação da empresa', () => {
  it('até 7 dias depois de terminar', () => {
    const agora = new Date('2026-11-26T12:00:00Z');
    expect(podeAvaliarEmpresa(null, agora)).toBe(false);
    expect(podeAvaliarEmpresa(new Date(agora.getTime() - 6 * 24 * H), agora)).toBe(true);
    expect(podeAvaliarEmpresa(new Date(agora.getTime() - 8 * 24 * H), agora)).toBe(false);
  });
  it('média só com 3 ou mais', () => {
    expect(mediaDaEmpresa(9, 2)).toBeNull();
    expect(mediaDaEmpresa(13, 3)).toBe(4.3);
  });
});

describe('valor declarado e avaria', () => {
  const a = (x: Partial<NovaAvaria> = {}): NovaAvaria => ({ tipo: 'AVARIA', descricao: 'Caixa amassada', prejuizoCentavos: 5000, responsavel: 'ENTREGADOR', descontoCentavos: 2000, fotos: ['data:image/png;base64,AA'], ...x });
  it('confere o valor declarado', () => {
    expect(problemaNoValorDeclarado(null)).toBeNull();
    expect(problemaNoValorDeclarado(5_000_001)).toMatch(/50\.000/);
  });
  it('desconto só do entregador, até o prejuízo e o valor declarado, com foto', () => {
    expect(problemaNaAvaria(a(), null)).toBeNull();
    expect(problemaNaAvaria(a({ responsavel: 'CLIENTE' }), null)).toMatch(/responsável/);
    expect(problemaNaAvaria(a({ responsavel: 'CLIENTE', descontoCentavos: 0 }), null)).toBeNull();
    expect(problemaNaAvaria(a({ descontoCentavos: 6000 }), null)).toMatch(/prejuízo/);
    expect(problemaNaAvaria(a(), 1500)).toMatch(/valor declarado/);
    expect(problemaNaAvaria(a({ fotos: [] }), null)).toMatch(/foto/);
    expect(problemaNaAvaria(a({ descricao: 'x' }), null)).toMatch(/Descreva/);
  });
  it('registra depois da coleta, até 30 dias depois de terminar', () => {
    const agora = new Date('2026-11-26T12:00:00Z');
    expect(podeRegistrarAvaria({ entregadorId: 'e', coletadaEm: null, concluidaEm: null }, agora)).toBe(false);
    expect(podeRegistrarAvaria({ entregadorId: 'e', coletadaEm: agora, concluidaEm: null }, agora)).toBe(true);
    expect(podeRegistrarAvaria({ entregadorId: 'e', coletadaEm: agora, concluidaEm: new Date(agora.getTime() - 31 * 24 * H) }, agora)).toBe(false);
  });
  it('pagamento nunca fica negativo', () => {
    expect(problemaNoTotalDoPagamento(0, 0, 0)).toMatch(/ao menos/);
    expect(problemaNoTotalDoPagamento(1000, -1500, 2)).toMatch(/desconto passa/);
    expect(problemaNoTotalDoPagamento(1000, -500, 2)).toBeNull();
  });
});
