import { describe, expect, it } from 'vitest';
import {
  comMinimo,
  mapaDeColunas,
  minutosNoPonto,
  pedidosDasLinhas,
  podeDevolver,
  problemaNasColunasErp,
  problemaNaConfigPedidosErp,
  problemaNoChecklist,
  problemaNoPadraoDaPlataforma,
  regraDeEspera,
  TABELA_PRECOS_PADRAO,
  textoDoChecklist,
  tipoDoTexto,
  valorDaDevolucao,
  valorDaEspera,
  CONFIG_PEDIDOS_ERP_PADRAO,
} from './index';

describe('espera paga', () => {
  it('cobra só blocos inteiros de 10 min além da tolerância', () => {
    const r = { toleranciaMinutos: 10, porBlocoCentavos: 300 };
    expect(valorDaEspera(9, r)).toEqual({ blocos: 0, centavos: 0 });
    expect(valorDaEspera(19, r)).toEqual({ blocos: 0, centavos: 0 });
    expect(valorDaEspera(20, r)).toEqual({ blocos: 1, centavos: 300 });
    expect(valorDaEspera(45, r)).toEqual({ blocos: 3, centavos: 900 });
    expect(valorDaEspera(45, { toleranciaMinutos: 10, porBlocoCentavos: 0 })).toEqual({ blocos: 0, centavos: 0 });
  });
  it('tabela antiga sem os campos: 10 min de tolerância e espera não cobrada', () => {
    expect(regraDeEspera(TABELA_PRECOS_PADRAO.ENTREGA)).toEqual({ toleranciaMinutos: 10, porBlocoCentavos: 0 });
  });
  it('minutos no ponto', () => {
    expect(minutosNoPonto(null, new Date())).toBe(0);
    expect(minutosNoPonto('2026-11-18T10:00:00Z', new Date('2026-11-18T10:25:59Z'))).toBe(25);
    expect(minutosNoPonto('2026-11-18T10:00:00Z', new Date('2026-11-18T09:00:00Z'))).toBe(0);
  });
});

describe('devolução à origem', () => {
  it('metade da base mais todo o km da volta', () => {
    expect(valorDaDevolucao({ baseCentavos: 800, porKmCentavos: 150, kmIncluso: 3 }, 4000)).toBe(400 + 600);
  });
  it('só depois de coletar', () => {
    expect(podeDevolver('ACEITA')).toBe(false);
    expect(podeDevolver('NA_COLETA')).toBe(false);
    expect(podeDevolver('COLETADA')).toBe(true);
    expect(podeDevolver('NO_DESTINO')).toBe(true);
  });
});

describe('checklist da maquininha', () => {
  const ok = { carregador: true, bobina: false, chip: true, estado: 'BOA' as const, observacao: '' };
  it('confere cada item', () => {
    expect(problemaNoChecklist(null)).toMatch(/checklist/);
    expect(problemaNoChecklist({ ...ok, chip: undefined })).toMatch(/chip/);
    expect(problemaNoChecklist({ ...ok, estado: 'AVARIADA' })).toMatch(/avaria/);
    expect(problemaNoChecklist(ok)).toBeNull();
  });
  it('texto do histórico', () => {
    expect(textoDoChecklist(ok)).toBe('com carregador, chip; sem bobina; em bom estado');
    expect(textoDoChecklist({ ...ok, bobina: true, estado: 'AVARIADA', observacao: 'tela trincada' })).toBe('com carregador, bobina, chip; com avaria (tela trincada)');
  });
});

describe('padrões da plataforma', () => {
  it('valor mínimo', () => {
    expect(comMinimo(700, 1000)).toBe(1000);
    expect(comMinimo(1500, 1000)).toBe(1500);
    expect(comMinimo(700, 0)).toBe(700);
  });
  it('confere a tabela e o mínimo', () => {
    expect(problemaNoPadraoDaPlataforma(null, 0)).toBeNull();
    expect(problemaNoPadraoDaPlataforma(TABELA_PRECOS_PADRAO, 500)).toBeNull();
    expect(problemaNoPadraoDaPlataforma(TABELA_PRECOS_PADRAO, -1)).toMatch(/mínimo/);
    expect(problemaNoPadraoDaPlataforma({ ...TABELA_PRECOS_PADRAO, COLETA: { ...TABELA_PRECOS_PADRAO.COLETA, esperaToleranciaMinutos: 500 } }, 0)).toMatch(/Tolerância/);
  });
});

describe('pedidos do ERP', () => {
  it('acha as colunas pelos nomes aceitos, sem usar uma coluna duas vezes', () => {
    const m = mapaDeColunas(['NUMERO', 'Nome', 'Fone', 'Logradouro', 'num', 'Bairro', 'Cidade', 'UF', 'Obs']);
    expect(m).toMatchObject({ pedido: 'NUMERO', cliente: 'Nome', telefone: 'Fone', rua: 'Logradouro', numero: 'num', cidade: 'Cidade', observacao: 'Obs', endereco: null, lat: null });
    expect(problemaNasColunasErp(m)).toBeNull();
    expect(problemaNasColunasErp(mapaDeColunas(['pedido', 'cliente']))).toMatch(/endereço/);
    expect(problemaNasColunasErp(mapaDeColunas(['cliente', 'endereco']))).toMatch(/número do pedido/);
    expect(problemaNasColunasErp(mapaDeColunas(['pedido', 'lat', 'lon']))).toBeNull();
  });
  it('monta o pedido de cada linha: endereço pelas partes, ponto com vírgula, repetido fica o primeiro', () => {
    const m = mapaDeColunas(['pedido', 'cliente', 'telefone', 'rua', 'numero_endereco', 'bairro', 'cidade', 'uf', 'lat', 'lon', 'tipo']);
    const linhas = [
      { pedido: 1234, cliente: ' Ana ', telefone: '(11) 99999-0000', rua: 'Rua A', numero_endereco: 10, bairro: 'Centro', cidade: 'Santos', uf: 'SP', lat: '-23,95', lon: '-46,33', tipo: 'Coleta' },
      { pedido: '1234', cliente: 'Outro' },
      { pedido: '', cliente: 'Sem número' },
      { pedido: 'B-7', cliente: 'Bia', rua: 'Rua B', cidade: 'Santos', lat: 0, lon: 0, tipo: 'devolução de máquina' },
    ];
    const p = pedidosDasLinhas(linhas, m);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ codigo: '1234', cliente: 'Ana', telefone: '11999990000', endereco: 'Rua A, 10, Centro, Santos - SP', ponto: { lat: -23.95, lon: -46.33 }, tipo: 'COLETA' });
    expect(p[1]).toMatchObject({ codigo: 'B-7', ponto: null, tipo: 'DEVOLUCAO_MAQUINA', endereco: 'Rua B, Santos' });
  });
  it('tipo pelo texto', () => {
    expect(tipoDoTexto('ENTREGA')).toBe('ENTREGA');
    expect(tipoDoTexto(null)).toBe('ENTREGA');
    expect(tipoDoTexto('Devolução')).toBe('DEVOLUCAO_MAQUINA');
  });
  it('configuração', () => {
    expect(problemaNaConfigPedidosErp(CONFIG_PEDIDOS_ERP_PADRAO)).toBeNull();
    expect(problemaNaConfigPedidosErp({ ...CONFIG_PEDIDOS_ERP_PADRAO, ativo: true })).toMatch(/consulta/);
    expect(problemaNaConfigPedidosErp({ ...CONFIG_PEDIDOS_ERP_PADRAO, intervaloMinutos: 0 })).toMatch(/intervalo/);
  });
});
