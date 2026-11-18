import { describe, expect, it } from 'vitest';
import {
  destinoDoPedido,
  inicioDoPeriodo,
  minutosDoFuso,
  pedidoPodeChamarEntregador,
  podeContestar,
  problemaNaAvaliacao,
  problemaNoExtra,
  somaDasLinhas,
  totalDaChamada,
} from './entregas-fechamento';
import type { EnderecoPedido } from './pedidos';

const endereco: EnderecoPedido = { cep: '01310100', rua: 'Avenida Paulista', numero: '1578', semNumero: false, complemento: 'apto 12', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' };

describe('fechamento', () => {
  it('total = valor + extra, e a soma das linhas', () => {
    expect(totalDaChamada({ valorCentavos: 1200, extraCentavos: 350 })).toBe(1550);
    expect(somaDasLinhas([{ valorCentavos: 1000, extraCentavos: 0 }, { valorCentavos: 800, extraCentavos: 200 }])).toBe(2000);
  });

  it('extra precisa de motivo e tem limite', () => {
    expect(problemaNoExtra(0, '')).toBeNull();
    expect(problemaNoExtra(500, '')).toMatch(/motivo/);
    expect(problemaNoExtra(500, 'Espera de 20 min')).toBeNull();
    expect(problemaNoExtra(-1, 'x')).toMatch(/R\$ 0,00/);
    expect(problemaNoExtra(100_001, 'muito')).toMatch(/1\.000,00/);
  });

  it('avaliação de 1 a 5', () => {
    expect(problemaNaAvaliacao(5, '')).toBeNull();
    expect(problemaNaAvaliacao(0, '')).toBe('A nota vai de 1 a 5.');
    expect(problemaNaAvaliacao(3.5, '')).toBe('A nota vai de 1 a 5.');
    expect(problemaNaAvaliacao(4, 'x'.repeat(301))).toMatch(/300/);
  });

  it('contesta até 60 dias depois de concluir', () => {
    const agora = new Date('2026-11-18T12:00:00Z');
    expect(podeContestar('2026-10-01T12:00:00Z', agora)).toBe(true);
    expect(podeContestar('2026-09-18T11:00:00Z', agora)).toBe(false);
    expect(podeContestar(null, agora)).toBe(false);
  });

  it('o fuso em minutos', () => {
    expect(minutosDoFuso(new Date('2026-11-18T12:00:30Z'), 'America/Sao_Paulo')).toBe(-180);
    expect(minutosDoFuso(new Date('2026-11-18T12:00:00Z'), 'UTC')).toBe(0);
  });

  it('o período "hoje" começa à meia-noite do fuso', () => {
    const agora = new Date('2026-11-18T12:00:00Z');
    // São Paulo: UTC−3 → meia-noite local = 03:00 UTC.
    expect(inicioDoPeriodo('HOJE', agora, '2026-11-18', -180)?.toISOString()).toBe('2026-11-18T03:00:00.000Z');
    expect(inicioDoPeriodo('SEMANA', agora, '2026-11-18', -180)?.toISOString()).toBe('2026-11-11T12:00:00.000Z');
    expect(inicioDoPeriodo('TUDO', agora, '2026-11-18', -180)).toBeNull();
  });
});

describe('pedido → chamada', () => {
  it('só pedido com endereço e em andamento', () => {
    expect(pedidoPodeChamarEntregador({ modalidade: 'ENTREGA', situacao: 'PRONTO', endereco })).toBe(true);
    expect(pedidoPodeChamarEntregador({ modalidade: 'RETIRADA', situacao: 'PRONTO', endereco })).toBe(false);
    expect(pedidoPodeChamarEntregador({ modalidade: 'ENTREGA', situacao: 'NOVO', endereco })).toBe(false);
    expect(pedidoPodeChamarEntregador({ modalidade: 'AGENDADA', situacao: 'EM_SEPARACAO', endereco: null })).toBe(false);
  });

  it('o destino leva o endereço, o cliente e o ponto do celular quando houver', () => {
    const d = destinoDoPedido({ clienteNome: 'Maria', clienteTelefone: '(11) 91234-5678', endereco: { ...endereco, localizacao: { latitude: -23.56, longitude: -46.65, precisaoMetros: 12 } }, observacao: ' Portão azul ' });
    expect(d).toEqual({ lat: -23.56, lon: -46.65, endereco: 'Avenida Paulista, 1578 – apto 12 – Bela Vista, São Paulo/SP – CEP 01310-100', contato: 'Maria', telefone: '11912345678', instrucoes: 'Portão azul' });
    expect(destinoDoPedido({ clienteNome: 'Ana', clienteTelefone: '11', endereco })).toMatchObject({ lat: 0, lon: 0, instrucoes: '' });
  });
});
