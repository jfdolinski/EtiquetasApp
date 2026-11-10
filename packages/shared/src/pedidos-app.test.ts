import { describe, expect, it } from 'vitest';
import * as app from '../../../apps/mobile/src/regras';
import { formatarCelular, formatarCentavos, ROTULO_MODALIDADE, ROTULO_PAGAMENTO, rotuloSituacaoPedido, linkMapa, PRECISAO_BOA_METROS, textoEndereco, textoFaixa } from './pedidos';
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
});
