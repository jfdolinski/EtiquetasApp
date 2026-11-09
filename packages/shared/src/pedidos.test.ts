import { describe, expect, it } from 'vitest';
import {
  categoriasDoCatalogo,
  centavosDe,
  colunasSugeridasPedidos,
  CONFIG_PEDIDOS_PADRAO,
  conferirCarrinho,
  faltaParaMinimo,
  formatarCelular,
  formatarCentavos,
  horarioVazio,
  itensDoCatalogo,
  lojaAberta,
  MAX_ITENS_CATALOGO,
  modalidadesPermitidas,
  normalizarCelular,
  normalizarCep,
  problemaNaConfigPedidos,
  problemaNoHorario,
  problemaNosPrazosPedidos,
  subtotalDe,
  textoDaMudanca,
  textoProximaAbertura,
  trocoPara,
  unidadesDe,
  faixasDeAgendamento,
  problemaNoEndereco,
  problemaNoPedido,
  rotuloSituacaoPedido,

  textoDataAgendamento,
  textoEndereco,
  textoFaixa,
  totaisDoPedido,
  type ColunasCatalogo,
  type ContextoPedido,
  type EnderecoPedido,
  type NovoPedido,
  type ConfigPedidos,
  type HorarioFuncionamento,
} from './pedidos';
import { somarDias } from './etiquetas/valores';

const colunas: ColunasCatalogo = { colunaCodigo: 'codigo', colunaNome: 'descricao', colunaPreco: 'preco', colunaPrecoDe: 'preco_de', colunaUnidade: 'un', colunaCategoria: 'grupo', colunaEstoque: null, colunaCodigoBarras: 'ean' };

describe('valores', () => {
  it('lê o preço em qualquer formato e guarda em centavos', () => {
    expect(centavosDe('4,99')).toBe(499);
    expect(centavosDe('1.234,50')).toBe(123450);
    expect(centavosDe(4.995)).toBe(500);
    expect(centavosDe('R$ 0,10')).toBe(10);
    expect(centavosDe('abc')).toBeNull();
    expect(centavosDe(null)).toBeNull();
  });

  it('formata em reais', () => {
    expect(formatarCentavos(123450)).toBe('R$ 1.234,50');
    expect(formatarCentavos(5)).toBe('R$ 0,05');
    expect(formatarCentavos(0)).toBe('R$ 0,00');
    expect(formatarCentavos(-250)).toBe('-R$ 2,50');
  });
});

describe('catálogo', () => {
  it('monta os produtos, procura a coluna sem diferenciar maiúsculas e só mostra preço anterior maior', () => {
    const { itens } = itensDoCatalogo(
      [
        { CODIGO: 10, DESCRICAO: 'Arroz 5kg', PRECO: '24,90', PRECO_DE: '29,90', UN: 'PCT', GRUPO: 'Mercearia', EAN: '7891234567895' },
        { CODIGO: 11, DESCRICAO: 'Feijão', PRECO: 8.49, PRECO_DE: 5, UN: null, GRUPO: '', EAN: null },
      ],
      colunas,
    );
    expect(itens).toEqual([
      { codigo: '10', nome: 'Arroz 5kg', precoCentavos: 2490, precoDeCentavos: 2990, unidade: 'PCT', categoria: 'Mercearia', codigoBarras: '7891234567895' },
      { codigo: '11', nome: 'Feijão', precoCentavos: 849 },
    ]);
  });

  it('deixa de fora sem código, nome ou preço, preço zerado e código repetido', () => {
    const r = itensDoCatalogo(
      [
        { codigo: '', descricao: 'Sem código', preco: 1 },
        { codigo: 1, descricao: '', preco: 1 },
        { codigo: 2, descricao: 'Grátis', preco: 0 },
        { codigo: 3, descricao: 'Texto', preco: 'consulte' },
        { codigo: 4, descricao: 'Bom', preco: 1 },
        { codigo: 4, descricao: 'Repetido', preco: 2 },
      ],
      colunas,
    );
    expect(r.itens.map((i) => i.nome)).toEqual(['Bom']);
    expect(r.descartados).toBe(4);
    expect(r.repetidos).toBe(1);
  });

  it('com coluna de estoque: só entra quem tem, inteiro, e estoque ilegível conta como zero', () => {
    const r = itensDoCatalogo(
      [
        { codigo: 1, descricao: 'Tem', preco: 1, estoque: '3,7' },
        { codigo: 2, descricao: 'Zerado', preco: 1, estoque: 0 },
        { codigo: 3, descricao: 'Negativo', preco: 1, estoque: -2 },
        { codigo: 4, descricao: 'Vazio', preco: 1, estoque: null },
        { codigo: 5, descricao: 'Fração', preco: 1, estoque: 0.5 },
      ],
      { ...colunas, colunaEstoque: 'estoque' },
    );
    expect(r.itens).toEqual([{ codigo: '1', nome: 'Tem', precoCentavos: 100, estoque: 3 }]);
    expect(r.semEstoque).toBe(4);
  });

  it('corta no limite', () => {
    const linhas = Array.from({ length: MAX_ITENS_CATALOGO + 3 }, (_, i) => ({ codigo: i, descricao: `P${i}`, preco: 1 }));
    const r = itensDoCatalogo(linhas, colunas);
    expect(r.itens).toHaveLength(MAX_ITENS_CATALOGO);
    expect(r.cortados).toBe(3);
  });

  it('lista as categorias em ordem, sem repetir', () => {
    expect(categoriasDoCatalogo([{ codigo: '1', nome: 'a', precoCentavos: 1, categoria: 'Limpeza' }, { codigo: '2', nome: 'b', precoCentavos: 1, categoria: 'Bebidas' }, { codigo: '3', nome: 'c', precoCentavos: 1, categoria: 'Limpeza' }, { codigo: '4', nome: 'd', precoCentavos: 1 }])).toEqual(['Bebidas', 'Limpeza']);
  });

  it('sugere as colunas pelos nomes conhecidos', () => {
    expect(colunasSugeridasPedidos(['codigo', 'descricao', 'preco_venda', 'preco_custo', 'estoque', 'ean', 'grupo', 'unidade'])).toEqual({
      colunaCodigo: 'codigo',
      colunaNome: 'descricao',
      colunaPreco: 'preco_venda',
      colunaPrecoDe: null,
      colunaUnidade: 'unidade',
      colunaCategoria: 'grupo',
      colunaEstoque: 'estoque',
      colunaCodigoBarras: 'ean',
    });
  });
});

describe('carrinho', () => {
  const catalogo = [
    { codigo: '1', nome: 'Arroz', precoCentavos: 2490, estoque: 5, codigoBarras: '789' },
    { codigo: '2', nome: 'Feijão', precoCentavos: 849, unidade: 'KG' },
  ];

  it('sem mudança: confere e usa o preço do catálogo', () => {
    const r = conferirCarrinho([{ codigo: '1', quantidade: 2, precoCentavos: 2490 }, { codigo: '2', quantidade: 1, precoCentavos: 849 }], catalogo);
    expect(r.mudancas).toEqual([]);
    expect(r.itens).toEqual([
      { codigo: '1', nome: 'Arroz', quantidade: 2, precoCentavos: 2490, codigoBarras: '789' },
      { codigo: '2', nome: 'Feijão', quantidade: 1, precoCentavos: 849, unidade: 'KG' },
    ]);
    expect(subtotalDe(r.itens)).toBe(5829);
    expect(unidadesDe(r.itens)).toBe(3);
  });

  it('preço mudado, estoque menor e produto que sumiu voltam para o cliente confirmar', () => {
    const r = conferirCarrinho(
      [
        { codigo: '1', quantidade: 4, precoCentavos: 2490 },
        { codigo: '1', quantidade: 3, precoCentavos: 2490 },
        { codigo: '2', quantidade: 1, precoCentavos: 100 },
        { codigo: '9', quantidade: 1, precoCentavos: 100 },
      ],
      catalogo,
    );
    expect(r.mudancas).toEqual([
      { codigo: '1', nome: 'Arroz', tipo: 'ESTOQUE', antes: 7, depois: 5 },
      { codigo: '2', nome: 'Feijão', tipo: 'PRECO', antes: 100, depois: 849 },
      { codigo: '9', nome: '9', tipo: 'SUMIU' },
    ]);
    expect(r.itens.map((i) => [i.codigo, i.quantidade, i.precoCentavos])).toEqual([['1', 5, 2490], ['2', 1, 849]]);
    expect(r.mudancas.map(textoDaMudanca)).toEqual(['Arroz: só restam 5.', 'Feijão: o preço mudou de R$ 1,00 para R$ 8,49.', 'Um produto do carrinho (9) não está mais disponível.']);
  });

  it('mínimo conta só os produtos; troco só quando o dinheiro cobre o total', () => {
    expect(faltaParaMinimo(3000, 5000)).toBe(2000);
    expect(faltaParaMinimo(6000, 5000)).toBe(0);
    expect(faltaParaMinimo(10, null)).toBe(0);
    expect(trocoPara(7650, 10000)).toBe(2350);
    expect(trocoPara(7650, 7650)).toBe(0);
    expect(trocoPara(7650, 5000)).toBeNull();
  });
});

describe('horário de funcionamento', () => {
  const h: HorarioFuncionamento = horarioVazio();
  h[1] = [{ inicio: '08:00', fim: '12:00' }, { inicio: '14:00', fim: '18:30' }];
  h[2] = [{ inicio: '08:00', fim: '18:00' }];

  it('aberta dentro dos períodos; o fim já é fechado', () => {
    expect(lojaAberta(h, 1, '08:00')).toBe(true);
    expect(lojaAberta(h, 1, '12:00')).toBe(false);
    expect(lojaAberta(h, 1, '13:59')).toBe(false);
    expect(lojaAberta(h, 1, '18:29')).toBe(true);
    expect(lojaAberta(h, 0, '10:00')).toBe(false);
  });

  it('diz quando abre', () => {
    expect(textoProximaAbertura(h, 1, '12:30')).toBe('hoje às 14h');
    expect(textoProximaAbertura(h, 1, '19:00')).toBe('amanhã às 8h');
    expect(textoProximaAbertura(h, 3, '10:00')).toBe('segunda às 8h');
    expect(textoProximaAbertura(horarioVazio(), 1, '10:00')).toBeNull();
  });

  it('valida o formato, a ordem e a sobreposição', () => {
    expect(problemaNoHorario(h)).toBeNull();
    expect(problemaNoHorario([[]])).toMatch(/inválido/);
    const errado = (dia: unknown) => {
      const x = horarioVazio() as unknown[];
      x[1] = dia;
      return problemaNoHorario(x);
    };
    expect(errado([{ inicio: '8:00', fim: '12:00' }])).toMatch(/formato/);
    expect(errado([{ inicio: '12:00', fim: '08:00' }])).toMatch(/depois/);
    expect(errado([{ inicio: '08:00', fim: '12:00' }, { inicio: '11:00', fim: '13:00' }])).toMatch(/sobrepor/);
    expect(errado([{ inicio: '08:00', fim: '09:00' }, { inicio: '10:00', fim: '11:00' }, { inicio: '12:00', fim: '13:00' }])).toMatch(/2 períodos/);
  });

  it('fechada, só a entrega agendada continua', () => {
    const m = { ...CONFIG_PEDIDOS_PADRAO.modalidades, AGENDADA: { ativa: true, precoCentavos: 500 }, EXPRESSA: { ativa: true, precoCentavos: 1500 } };
    expect(modalidadesPermitidas(m, true)).toEqual(['ENTREGA', 'AGENDADA', 'EXPRESSA', 'RETIRADA']);
    expect(modalidadesPermitidas(m, false)).toEqual(['AGENDADA']);
    expect(modalidadesPermitidas(CONFIG_PEDIDOS_PADRAO.modalidades, false)).toEqual([]);
  });
});

describe('configuração', () => {
  const boa: ConfigPedidos = { ...CONFIG_PEDIDOS_PADRAO, ...colunas, enderecoRetirada: 'Rua A, 10' };

  it('aceita a configuração completa e recusa o que falta', () => {
    expect(problemaNaConfigPedidos(boa)).toBeNull();
    expect(problemaNaConfigPedidos({ ...boa, colunaCodigo: '' })).toMatch(/código/);
    expect(problemaNaConfigPedidos({ ...boa, comFotos: true, colunaCodigoBarras: null })).toMatch(/fotos/);
    expect(problemaNaConfigPedidos({ ...boa, pedidoMinimoCentavos: 0 })).toMatch(/mínimo/);
    expect(problemaNaConfigPedidos({ ...boa, pedidoMinimoCentavos: 1.5 })).toMatch(/mínimo/);
    expect(problemaNaConfigPedidos({ ...boa, enderecoRetirada: '' })).toMatch(/retirar/);
    const nenhuma = Object.fromEntries(Object.entries(boa.modalidades).map(([k, v]) => [k, { ...v, ativa: false }])) as ConfigPedidos['modalidades'];
    expect(problemaNaConfigPedidos({ ...boa, modalidades: nenhuma })).toMatch(/ao menos uma/);
    expect(problemaNaConfigPedidos({ ...boa, modalidades: { ...boa.modalidades, ENTREGA: { ativa: true, precoCentavos: -1 } } })).toMatch(/Entrega: preço/);
  });

  it('prazos da cópia', () => {
    expect(problemaNosPrazosPedidos(15, 120)).toBeNull();
    expect(problemaNosPrazosPedidos(15, 20)).toMatch(/30/);
    expect(problemaNosPrazosPedidos(60, 90)).toMatch(/duas atualizações/);
  });
});

describe('dados do cliente', () => {
  it('celular com DDD, com ou sem +55 e máscara', () => {
    expect(normalizarCelular('(11) 98765-4321')).toBe('11987654321');
    expect(normalizarCelular('+55 11 98765 4321')).toBe('11987654321');
    expect(normalizarCelular('1187654321')).toBeNull();
    expect(normalizarCelular('01987654321')).toBeNull();
    expect(normalizarCelular('11887654321')).toBeNull();
    expect(formatarCelular('11987654321')).toBe('(11) 98765-4321');
  });

  it('CEP com 8 dígitos', () => {
    expect(normalizarCep('01001-000')).toBe('01001000');
    expect(normalizarCep('0100100')).toBeNull();
    expect(normalizarCep('00000-000')).toBeNull();
  });
});

describe('entrega agendada', () => {
  const h = horarioVazio();
  h[1] = [{ inicio: '08:00', fim: '12:00' }, { inicio: '14:00', fim: '17:00' }];
  h[2] = [{ inicio: '09:00', fim: '10:15' }];

  it('corta o horário em faixas, com antecedência hoje e a sobra pequena de fora', () => {
    // 2026-11-09 é segunda; 9h30: só a partir das 10h30.
    const faixas = faixasDeAgendamento(h, '2026-11-09', '09:30', { dias: 1, duracaoMinutos: 120 });
    expect(faixas).toEqual([
      { data: '2026-11-09', inicio: '14:00', fim: '16:00' },
      { data: '2026-11-09', inicio: '16:00', fim: '17:00' },
      { data: '2026-11-10', inicio: '09:00', fim: '10:15' },
    ]);
    const meiaHora = faixasDeAgendamento(h, '2026-11-10', '06:00', { dias: 0, duracaoMinutos: 60 });
    expect(meiaHora).toEqual([{ data: '2026-11-10', inicio: '09:00', fim: '10:00' }]);
    expect(faixasDeAgendamento(horarioVazio(), '2026-11-09', '08:00', { dias: 7, duracaoMinutos: 60 })).toEqual([]);
  });

  it('escreve a data como o cliente fala', () => {
    expect(textoDataAgendamento('2026-11-09', '2026-11-09')).toBe('Hoje');
    expect(textoDataAgendamento('2026-11-10', '2026-11-09')).toBe('Amanhã');
    expect(textoDataAgendamento('2026-11-13', '2026-11-09')).toBe('Sex, 13 nov');
    expect(textoFaixa({ data: '2026-11-10', inicio: '09:00', fim: '11:00' }, '2026-11-09')).toBe('Amanhã, 09:00 às 11:00');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('valida o tamanho das faixas e os dias à frente', () => {
    const boa: ConfigPedidos = { ...CONFIG_PEDIDOS_PADRAO, ...colunas, enderecoRetirada: 'Rua A' };
    expect(problemaNaConfigPedidos({ ...boa, agendamento: { dias: 0, duracaoMinutos: 60 } })).toMatch(/1 a 30/);
    expect(problemaNaConfigPedidos({ ...boa, agendamento: { dias: 7, duracaoMinutos: 45 } })).toMatch(/faixas/);
  });
});

describe('pedido do cliente', () => {
  const endereco: EnderecoPedido = { cep: '01001-000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: '', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
  const faixa = { data: '2026-11-10', inicio: '09:00', fim: '11:00' };
  const ctx: ContextoPedido = {
    modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: true, precoCentavos: 300 }, EXPRESSA: { ativa: true, precoCentavos: 1500 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
    aberta: true,
    faixas: [faixa],
    pedidoMinimoCentavos: 3000,
  };
  const itens = [{ codigo: '1', nome: 'Arroz', quantidade: 2, precoCentavos: 2490 }];
  const p: NovoPedido = { itens: [{ codigo: '1', quantidade: 2, precoCentavos: 2490 }], nome: 'Maria', telefone: '(11) 98765-4321', modalidade: 'ENTREGA', endereco, agendamento: null, pagamento: 'PIX', trocoParaCentavos: null, observacao: '' };

  it('aceita o pedido completo e calcula os totais e o troco', () => {
    expect(problemaNoPedido(p, itens, ctx)).toBeNull();
    expect(totaisDoPedido(itens, 500, 10000)).toEqual({ subtotalCentavos: 4980, taxaCentavos: 500, descontoCentavos: 0, totalCentavos: 5480, trocoCentavos: 4520 });
    expect(totaisDoPedido(itens, 0, null).trocoCentavos).toBeNull();
  });

  it('confere dados, endereço, modalidade, faixa, mínimo e troco', () => {
    const erro = (x: Partial<NovoPedido>, c: Partial<ContextoPedido> = {}, i = itens) => problemaNoPedido({ ...p, ...x }, i, { ...ctx, ...c });
    expect(erro({ nome: ' ' })).toMatch(/nome/);
    expect(erro({ telefone: '1133334444' })).toMatch(/celular/);
    expect(erro({ endereco: null })).toMatch(/endereço/);
    expect(erro({ endereco: { ...endereco, numero: '' } })).toMatch(/sem número/);
    expect(erro({ endereco: { ...endereco, numero: '', semNumero: true } })).toBeNull();
    expect(erro({ endereco: { ...endereco, uf: 'XX' } })).toMatch(/estado/);
    expect(erro({ modalidade: 'RETIRADA', endereco: null })).toBeNull();
    expect(erro({ modalidade: 'AGENDADA' })).toMatch(/dia e o horário/);
    expect(erro({ modalidade: 'AGENDADA', agendamento: faixa })).toBeNull();
    expect(erro({ modalidade: 'AGENDADA', agendamento: { ...faixa, inicio: '08:00' } })).toMatch(/dia e o horário/);
    // Fechada: só a agendada.
    expect(erro({}, { aberta: false })).toMatch(/fechada/);
    expect(erro({ modalidade: 'AGENDADA', agendamento: faixa }, { aberta: false })).toBeNull();
    expect(erro({ modalidade: 'EXPRESSA' }, { modalidades: { ...ctx.modalidades, EXPRESSA: { ativa: false, precoCentavos: 0 } } })).toMatch(/não está disponível/);
    expect(erro({}, {}, [{ ...itens[0], quantidade: 1 }])).toBe('Faltam R$ 5,10 para o pedido mínimo de R$ 30,00.');
    expect(erro({ pagamento: 'DINHEIRO', trocoParaCentavos: 5000 })).toBe('O troco precisa ser para um valor igual ou maior que o total, R$ 54,80.');
    expect(erro({ pagamento: 'DINHEIRO', trocoParaCentavos: 5480 })).toBeNull();
    expect(erro({ pagamento: 'DINHEIRO', trocoParaCentavos: null })).toBeNull();
    expect(erro({ pagamento: 'BOLETO' as never })).toMatch(/pagamento/);
    expect(erro({ itens: [{ codigo: '1', quantidade: 1.5, precoCentavos: 2490 }] })).toMatch(/Quantidade/);
    expect(erro({ itens: [] })).toMatch(/vazio/);
  });

  it('situação diz "pronto" do jeito de cada entrega, e o endereço vira uma linha', () => {
    expect(rotuloSituacaoPedido('PRONTO', 'RETIRADA')).toBe('Pronto para retirar');
    expect(rotuloSituacaoPedido('PRONTO', 'ENTREGA')).toBe('Saiu para entrega');
    expect(textoEndereco({ ...endereco, cep: '01001000', complemento: 'apto 2' })).toBe('Praça da Sé, 10 – apto 2 – Sé, São Paulo/SP – CEP 01001-000');
    expect(problemaNoEndereco(endereco)).toBeNull();
  });
});
