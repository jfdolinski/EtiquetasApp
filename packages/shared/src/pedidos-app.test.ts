import { describe, expect, it } from 'vitest';
import * as app from '../../../apps/mobile/src/regras';
import { buscarNoCatalogo, centavosDe, descontoMaximoCentavos, normalizarCelular, normalizarCep, textoDaMudanca, formatarCelular, formatarCentavos, ROTULO_MODALIDADE, ROTULO_PAGAMENTO, rotuloSituacaoPedido, linkMapa, PRECISAO_BOA_METROS, textoEndereco, textoFaixa } from './pedidos';
import { linkWhatsApp, mensagemWhatsApp, PROXIMA_SITUACAO, rotuloAvancar } from './pedidos-painel';

/** O aplicativo só importa tipos daqui: as regras de pedidos são copiadas em apps/mobile/src/regras.ts. */
describe('cópias do aplicativo', () => {
  it('dão o mesmo resultado que as regras daqui', () => {
    for (const c of [0, 5, 499, 123450, -250, 10_000_000]) expect(app.formatarCentavos(c)).toBe(formatarCentavos(c));
    expect(app.formatarCelular('11987654321')).toBe(formatarCelular('11987654321'));
    const situacoes = ['NOVO', 'EM_SEPARACAO', 'PRONTO', 'CONCLUIDO', 'CANCELADO'] as const;
    const modalidades = ['ENTREGA', 'AGENDADA', 'EXPRESSA', 'RETIRADA'] as const;
    for (const s of situacoes) {
      for (const m of modalidades) {
        expect(app.rotuloSituacaoPedido(s, m)).toBe(rotuloSituacaoPedido(s, m));
        expect(app.rotuloAvancar(s, m)).toBe(rotuloAvancar(s, m));
      }
      expect(app.PROXIMA_SITUACAO[s]).toBe(PROXIMA_SITUACAO[s]);
    }
    for (const m of modalidades) expect(app.TITULO_MODALIDADE[m]).toBe(ROTULO_MODALIDADE[m].titulo);
    for (const p of ['PIX', 'CARTAO', 'DINHEIRO'] as const) expect(app.TITULO_PAGAMENTO[p]).toBe(ROTULO_PAGAMENTO[p]);
    for (const data of ['2026-11-13', '2026-12-31', '2027-01-03']) {
      const f = { data, inicio: '09:00', fim: '11:00' };
      expect(app.textoFaixa(f)).toBe(textoFaixa(f, ''));
    }
    const e = { cep: '01001000', rua: 'Praça da Sé', numero: '10', semNumero: false, complemento: 'apto 2', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
    expect(app.textoEndereco(e)).toBe(textoEndereco(e));
    expect(app.linkMapa(e)).toBe(linkMapa(e));
    const comPonto = { ...e, localizacao: { latitude: -23.5, longitude: -46.6, precisaoMetros: 12 } };
    expect(app.linkMapa(comPonto)).toBe(linkMapa(comPonto));
    expect(app.PRECISAO_BOA_METROS).toBe(PRECISAO_BOA_METROS);
    expect(app.textoEndereco({ ...e, semNumero: true, numero: '', complemento: '' })).toBe(textoEndereco({ ...e, semNumero: true, numero: '', complemento: '' }));
    expect(app.linkWhatsApp('11987654321', 'Oi & tchau')).toBe(linkWhatsApp('11987654321', 'Oi & tchau'));
    for (const t of ['contato', 'proposta'] as const) expect(app.mensagemWhatsApp(t, { numero: 7, clienteNome: 'Maria Silva' }, 'Loja', 'https://x')).toBe(mensagemWhatsApp(t, { numero: 7, clienteNome: 'Maria Silva' }, 'Loja', 'https://x'));
  });

  it('venda pelo aplicativo: as cópias dão o mesmo resultado', () => {
    const cat = [
      { codigo: '10', nome: 'Feijão Carioca 1kg', precoCentavos: 849, codigoBarras: '07891234567895', categoria: 'Mercearia' },
      { codigo: '7891234567895', nome: 'Outro', precoCentavos: 100 },
      { codigo: '11', nome: 'Feijão Preto 1kg', precoCentavos: 900 },
    ];
    for (const t of ['7891234567895', '10', 'feijao preto', 'FEIJÃO', 'mercearia', '', '999']) expect(app.buscarNoCatalogo(cat, t)).toEqual(buscarNoCatalogo(cat, t));
    for (const [s, p] of [[2000, 10], [1999, 10], [0, 50], [12345, 7]]) expect(app.descontoMaximoCentavos(s, p)).toBe(descontoMaximoCentavos(s, p));
    for (const t of ['11987654321', '+55 (11) 98765-4321', '1187654321', '']) expect(app.normalizarCelular(t)).toBe(normalizarCelular(t));
    for (const t of ['01001-000', '00000000', '123']) expect(app.normalizarCep(t)).toBe(normalizarCep(t));
    for (const t of ['4,99', 'R$ 1.234,56', '4.99', '3', 'abc', '', '1,5']) expect(app.centavosDoTexto(t)).toBe(centavosDe(t));
    for (const m of [{ codigo: '1', nome: 'A', tipo: 'SUMIU' as const }, { codigo: '1', nome: 'A', tipo: 'ESTOQUE' as const, antes: 3, depois: 1 }, { codigo: '1', nome: 'A', tipo: 'PRECO' as const, antes: 100, depois: 150 }]) expect(app.textoDaMudanca(m)).toBe(textoDaMudanca(m));
  });

  it('carrinho do vendedor: estoque, máximo e a conferência do servidor', () => {
    const arroz = { codigo: '1', nome: 'Arroz', precoCentavos: 1000, estoque: 2 };
    let r = app.somarAoCarrinho([], arroz);
    expect(r.carrinho).toEqual([{ codigo: '1', nome: 'Arroz', precoCentavos: 1000, quantidade: 1, estoque: 2 }]);
    r = app.somarAoCarrinho(r.carrinho, arroz, 5);
    expect(r.carrinho[0].quantidade).toBe(2);
    expect(r.aviso).toBe('Arroz: só há 2 em estoque.');
    expect(app.somarAoCarrinho(r.carrinho, arroz, -2).carrinho).toEqual([]);
    expect(app.somarAoCarrinho([], { codigo: '2', nome: 'B', precoCentavos: 1 }, 1000).aviso).toBe('B: até 999 por pedido.');
    const conferido = app.carrinhoConferido([{ codigo: '1', nome: 'Arroz', precoCentavos: 1000, quantidade: 2, observacao: 'x' }, { codigo: '3', nome: 'Sumiu', precoCentavos: 5, quantidade: 1 }], [{ codigo: '1', quantidade: 1, precoCentavos: 1100 }]);
    expect(conferido).toEqual([{ codigo: '1', nome: 'Arroz', precoCentavos: 1100, quantidade: 1, observacao: 'x' }]);
  });
});
