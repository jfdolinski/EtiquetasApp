import { describe, expect, it } from 'vitest';
import {
  buscarNoCatalogo,
  CONFIG_PEDIDOS_PADRAO,
  CONFIG_VENDAS_PADRAO,
  contextoDaVenda,
  descontoMaximoCentavos,
  problemaNaConfigPedidos,
  problemaNaConfigVendas,
  problemaNaVenda,
  type ContextoPedido,
  type ItemCatalogo,
  type ItemConferido,
  type NovaVenda,
} from './pedidos';

const ctx: ContextoPedido = {
  modalidades: { ENTREGA: { ativa: true, precoCentavos: 500 }, AGENDADA: { ativa: false, precoCentavos: 0 }, EXPRESSA: { ativa: true, precoCentavos: 1000 }, RETIRADA: { ativa: true, precoCentavos: 0 } },
  aberta: false,
  faixas: [],
  pedidoMinimoCentavos: 5000,
};
const itens: ItemConferido[] = [{ codigo: '1', nome: 'Arroz', quantidade: 2, precoCentavos: 1000 }];
const venda: NovaVenda = { itens: [{ codigo: '1', quantidade: 2, precoCentavos: 1000 }], nome: 'Maria', telefone: '11987654321', modalidade: 'RETIRADA', endereco: null, agendamento: null, pagamento: 'PIX', trocoParaCentavos: null, observacao: '', descontoCentavos: 0 };

describe('vendas pelo aplicativo', () => {
  it('fora do horário e sem o mínimo, conforme a configuração', () => {
    const livre = contextoDaVenda(ctx, CONFIG_VENDAS_PADRAO);
    expect(livre.aberta).toBe(true);
    expect(livre.pedidoMinimoCentavos).toBeNull();
    expect(problemaNaVenda(venda, itens, livre, CONFIG_VENDAS_PADRAO)).toBeNull();
    // Expressa só com a loja aberta: liberada para o vendedor fora do horário.
    expect(problemaNaVenda({ ...venda, modalidade: 'EXPRESSA', endereco: { cep: '01001000', rua: 'R', numero: '1', semNumero: false, complemento: '', bairro: 'B', cidade: 'C', uf: 'SP' } }, itens, livre, CONFIG_VENDAS_PADRAO)).toBeNull();

    const rigida = { ...CONFIG_VENDAS_PADRAO, foraDoHorario: false, exigirMinimo: true };
    const r = contextoDaVenda(ctx, rigida);
    expect(problemaNaVenda({ ...venda, modalidade: 'ENTREGA' }, itens, r, rigida)).toMatch(/fechada/);
    expect(problemaNaVenda(venda, itens, { ...r, aberta: true }, rigida)).toMatch(/pedido mínimo/);
  });

  it('desconto dentro da porcentagem, e o troco com o desconto', () => {
    const v = { ...CONFIG_VENDAS_PADRAO, descontoMaximoPercentual: 10 };
    const c = contextoDaVenda(ctx, v);
    expect(descontoMaximoCentavos(2000, 10)).toBe(200);
    expect(descontoMaximoCentavos(1999, 10)).toBe(199);
    expect(problemaNaVenda({ ...venda, descontoCentavos: 200 }, itens, c, v)).toBeNull();
    expect(problemaNaVenda({ ...venda, descontoCentavos: 201 }, itens, c, v)).toMatch(/até R\$ 2,00 \(10%/);
    expect(problemaNaVenda({ ...venda, descontoCentavos: 1 }, itens, c, CONFIG_VENDAS_PADRAO)).toMatch(/não permite desconto/);
    expect(problemaNaVenda({ ...venda, descontoCentavos: -1 }, itens, c, v)).toBe('Desconto inválido.');
    // Total 20,00 - 2,00 = 18,00: troco para 18 serve, para 17 não.
    expect(problemaNaVenda({ ...venda, pagamento: 'DINHEIRO', trocoParaCentavos: 1800, descontoCentavos: 200 }, itens, c, v)).toBeNull();
    expect(problemaNaVenda({ ...venda, pagamento: 'DINHEIRO', trocoParaCentavos: 1700, descontoCentavos: 200 }, itens, c, v)).toMatch(/R\$ 18,00/);
  });

  it('fala do cliente, não do vendedor', () => {
    expect(problemaNaVenda({ ...venda, nome: '' }, itens, contextoDaVenda(ctx, CONFIG_VENDAS_PADRAO), CONFIG_VENDAS_PADRAO)).toBe('Informe o nome do cliente.');
  });

  it('configuração', () => {
    expect(problemaNaConfigVendas(CONFIG_VENDAS_PADRAO)).toBeNull();
    expect(problemaNaConfigVendas({ ...CONFIG_VENDAS_PADRAO, descontoMaximoPercentual: 51 })).toMatch(/0 a 50%/);
    expect(problemaNaConfigVendas({ ...CONFIG_VENDAS_PADRAO, descontoMaximoPercentual: 2.5 })).toMatch(/inteiros/);
    const cfg = { ...CONFIG_PEDIDOS_PADRAO, colunaCodigo: 'c', colunaNome: 'n', colunaPreco: 'p', enderecoRetirada: 'Rua 1' };
    expect(problemaNaConfigPedidos(cfg)).toBeNull();
    expect(problemaNaConfigPedidos({ ...cfg, vendas: { ...CONFIG_VENDAS_PADRAO, descontoMaximoPercentual: 90 } })).toMatch(/desconto do vendedor/);
  });

  it('busca: código lido pela câmera primeiro, depois as palavras sem acento', () => {
    const cat: ItemCatalogo[] = [
      { codigo: '10', nome: 'Feijão Carioca 1kg', precoCentavos: 849, codigoBarras: '07891234567895', categoria: 'Mercearia' },
      { codigo: '7891234567895', nome: 'Outro', precoCentavos: 100 },
      { codigo: '11', nome: 'Feijão Preto 1kg', precoCentavos: 900 },
    ];
    expect(buscarNoCatalogo(cat, '7891234567895').map((i) => i.codigo)).toEqual(['10', '7891234567895']);
    expect(buscarNoCatalogo(cat, '10').map((i) => i.codigo)).toEqual(['10']);
    expect(buscarNoCatalogo(cat, 'feijao preto').map((i) => i.codigo)).toEqual(['11']);
    expect(buscarNoCatalogo(cat, 'mercearia').map((i) => i.codigo)).toEqual(['10']);
    expect(buscarNoCatalogo(cat, '  ')).toEqual([]);
    expect(buscarNoCatalogo(cat, 'feijão', 1)).toHaveLength(1);
  });
});
