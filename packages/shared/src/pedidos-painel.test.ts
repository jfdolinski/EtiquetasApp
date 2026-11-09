import { describe, expect, it } from 'vitest';
import {
  blocosDaFolha,
  codigoDaFolha,
  COLUNAS_FOLHA,
  diferencasDaPropostaPedido,
  folhaEscPos,
  itensDaProposta,
  linhaDoProduto,
  linkWhatsApp,
  mensagemWhatsApp,
  podeMudarSituacao,
  problemaNaProposta,
  rotuloAvancar,
  totaisDaProposta,
  type DadosFolha,
  type EstadoPedido,
  type PropostaPedido,
} from './pedidos-painel';

const ATUAL: EstadoPedido = {
  itens: [
    { codigo: '10', nome: 'Arroz Tipo 1 5kg', quantidade: 2, precoCentavos: 2490, codigoBarras: '7891234567895' },
    { codigo: '11', nome: 'Feijão Carioca 1kg', quantidade: 1, precoCentavos: 849 },
  ],
  modalidade: 'ENTREGA',
  taxaCentavos: 500,
  descontoCentavos: 0,
  agendamento: null,
  temEndereco: true,
  trocoParaCentavos: 10000,
};
const SEM_MUDAR: PropostaPedido = { itens: [], modalidade: 'ENTREGA', taxaCentavos: 500, descontoCentavos: 0, agendamento: null, mensagem: '' };

describe('situação', () => {
  it('segue o caminho, cancela de qualquer ponto aberto e não sai de concluído ou cancelado', () => {
    expect(podeMudarSituacao('NOVO', 'EM_SEPARACAO')).toBe(true);
    expect(podeMudarSituacao('NOVO', 'PRONTO')).toBe(false);
    expect(podeMudarSituacao('PRONTO', 'CANCELADO')).toBe(true);
    expect(podeMudarSituacao('CONCLUIDO', 'CANCELADO')).toBe(false);
    expect(podeMudarSituacao('CANCELADO', 'NOVO')).toBe(false);
    expect(rotuloAvancar('NOVO', 'ENTREGA')).toBe('Aceitar pedido');
    expect(rotuloAvancar('EM_SEPARACAO', 'RETIRADA')).toBe('Avisar que está pronto');
    expect(rotuloAvancar('PRONTO', 'ENTREGA')).toBe('Entregue');
    expect(rotuloAvancar('CONCLUIDO', 'ENTREGA')).toBeNull();
  });
});

describe('proposta de alteração', () => {
  it('muda quantidade, tira produto, troca a entrega e dá desconto, e diz o que mudou', () => {
    const p: PropostaPedido = { itens: [{ codigo: '10', quantidade: 1 }, { codigo: '11', quantidade: 0 }], modalidade: 'RETIRADA', taxaCentavos: 0, descontoCentavos: 190, agendamento: null, mensagem: 'Acabou o feijão' };
    expect(problemaNaProposta(ATUAL, p, [])).toBeNull();
    expect(itensDaProposta(ATUAL.itens, p).map((i) => [i.codigo, i.quantidade])).toEqual([['10', 1]]);
    expect(totaisDaProposta(ATUAL, p)).toEqual({ subtotalCentavos: 2490, taxaCentavos: 0, descontoCentavos: 190, totalCentavos: 2300, trocoCentavos: 7700 });
    expect(diferencasDaPropostaPedido(ATUAL, p)).toEqual(['Arroz Tipo 1 5kg: de 2 para 1', 'Feijão Carioca 1kg: retirado do pedido', 'Entrega: de Entrega para Retirar no local', 'Taxa de entrega: de R$ 5,00 para R$ 0,00', 'Desconto: R$ 1,90']);
  });

  it('recusa o que não dá', () => {
    const erro = (x: Partial<PropostaPedido>, a: Partial<EstadoPedido> = {}, faixas = [] as { data: string; inicio: string; fim: string }[]) => problemaNaProposta({ ...ATUAL, ...a }, { ...SEM_MUDAR, ...x }, faixas);
    expect(erro({})).toMatch(/não muda nada/);
    expect(erro({ itens: [{ codigo: '99', quantidade: 1 }] })).toMatch(/já estão no pedido/);
    expect(erro({ itens: [{ codigo: '10', quantidade: 1.5 }] })).toMatch(/Quantidade/);
    expect(erro({ itens: [{ codigo: '10', quantidade: 0 }, { codigo: '11', quantidade: 0 }] })).toMatch(/cancele/);
    expect(erro({ modalidade: 'ENTREGA' }, { modalidade: 'RETIRADA', temEndereco: false, taxaCentavos: 0 })).toMatch(/não informou endereço/);
    expect(erro({ modalidade: 'AGENDADA' })).toMatch(/dia e o horário/);
    const faixa = { data: '2026-11-10', inicio: '09:00', fim: '11:00' };
    expect(erro({ modalidade: 'AGENDADA', agendamento: faixa })).toMatch(/não está disponível/);
    expect(erro({ modalidade: 'AGENDADA', agendamento: faixa }, {}, [faixa])).toBeNull();
    expect(erro({ descontoCentavos: 999_999 })).toMatch(/passar do total/);
    expect(erro({ taxaCentavos: -1 })).toMatch(/Taxa/);
  });

  it('o troco que não cobre mais o total fica nulo, para avisar', () => {
    expect(totaisDaProposta({ ...ATUAL, trocoParaCentavos: 5000 }, { ...SEM_MUDAR, taxaCentavos: 2000 }).trocoCentavos).toBeNull();
  });
});

describe('WhatsApp', () => {
  it('monta o link com o DDI e a mensagem codificada', () => {
    const m = mensagemWhatsApp('proposta', { numero: 7, clienteNome: 'Maria Silva' }, 'Mercadinho', 'https://x/loja/pedido/abc');
    expect(m).toBe('Olá, Maria! Aqui é da Mercadinho. Precisamos mudar uma coisa no seu pedido nº 7. Confira e confirme por aqui: https://x/loja/pedido/abc');
    expect(linkWhatsApp('11987654321', 'Oi & tchau')).toBe('https://wa.me/5511987654321?text=Oi%20%26%20tchau');
  });
});

describe('folha de lançamento', () => {
  const dados: DadosFolha = {
    empresa: 'Mercadinho',
    numero: 7,
    quando: '10/11/2026 14:32',
    clienteNome: 'Maria Silva',
    clienteTelefone: '11987654321',
    modalidade: 'ENTREGA',
    agendamento: null,
    endereco: null,
    pagamento: 'DINHEIRO',
    trocoParaCentavos: 10000,
    observacao: '',
    atendente: { codigo: '0457', nome: 'João' },
    itens: ATUAL.itens,
    totais: { subtotalCentavos: 5829, taxaCentavos: 500, descontoCentavos: 0, totalCentavos: 6329, trocoCentavos: 3671 },
  };

  it('EAN de verdade sai como EAN; o resto em Code 128; acento não vira código', () => {
    expect(codigoDaFolha('7891234567895')).toEqual({ simbologia: 'EAN13', dados: '7891234567895' });
    expect(codigoDaFolha('7891234567890')).toEqual({ simbologia: 'CODE128', dados: '7891234567890' });
    expect(codigoDaFolha('96385074')).toEqual({ simbologia: 'EAN8', dados: '96385074' });
    expect(codigoDaFolha('ABC-1')).toEqual({ simbologia: 'CODE128', dados: 'ABC-1' });
    expect(codigoDaFolha('AÇÚCAR')).toBeNull();
  });

  it('linha do produto: tudo numa linha, nome cortado, preço e contagem inteiros', () => {
    const l = linhaDoProduto('Arroz Tipo 1 Camil Parboilizado Pacote Grande 5kg', 'R$ 24,90', '1/3');
    expect(l).toHaveLength(COLUNAS_FOLHA);
    expect(l.startsWith('[ ] Arroz Tipo 1 Camil')).toBe(true);
    expect(l).toContain('…');
    expect(l.endsWith('R$ 24,90  1/3')).toBe(true);
    expect(linhaDoProduto('Feijão', 'R$ 8,49', '1/1')).toBe(`[ ] Feijão${' '.repeat(COLUNAS_FOLHA - 4 - 6 - 12)}R$ 8,49  1/1`);
  });

  it('na ordem do ERP: atendente, telefone e um código por unidade', () => {
    const { blocos, avisos } = blocosDaFolha(dados);
    expect(avisos).toEqual([]);
    const barras = blocos.filter((b) => b.tipo === 'barras');
    expect(barras.map((b) => b.tipo === 'barras' && [b.simbologia, b.dados])).toEqual([
      ['CODE128', '0457'],
      ['CODE128', '11987654321'],
      ['EAN13', '7891234567895'],
      ['EAN13', '7891234567895'],
      ['CODE128', '11'],
    ]);
    const titulos = blocos.filter((b) => b.tipo === 'titulo').map((b) => b.tipo === 'titulo' && b.texto);
    expect(titulos).toEqual(['1. CÓDIGO DO ATENDENTE', '2. TELEFONE DO CLIENTE', '3. AGORA PASSE OS PRODUTOS']);
    const legendas = barras.slice(2).map((b) => b.tipo === 'barras' && b.legenda);
    expect(legendas[0]).toMatch(/^\[ \] Arroz Tipo 1 5kg +R\$ 24,90 {2}1\/2$/);
    expect(legendas[1]).toMatch(/1\/2$|2\/2$/);
    expect(blocos.some((b) => b.tipo === 'texto' && b.texto === 'Pagamento: Dinheiro · troco para R$ 100,00 = R$ 36,71')).toBe(true);
  });

  it('ESC/POS: comando de código de barras da impressora, EAN sem o dígito, acento e reticências em uma coluna', () => {
    const bytes = folhaEscPos([
      { tipo: 'texto', texto: 'Feijão' },
      { tipo: 'barras', simbologia: 'EAN13', dados: '7891234567895', legenda: 'Arroz…' },
      { tipo: 'barras', simbologia: 'CODE128', dados: '0457', legenda: '0457' },
    ]);
    const bin = Array.from(bytes);
    const achar = (seq: number[]) => bin.findIndex((_, i) => seq.every((v, k) => bin[i + k] === v));
    expect(achar([0x1b, 0x40, 0x1b, 0x74, 16])).toBe(0);
    expect(achar([0x1d, 0x6b, 67, 12, ...Array.from('789123456789', (c) => c.charCodeAt(0))])).toBeGreaterThan(0);
    expect(achar([0x1d, 0x6b, 73, 6, ...Array.from('{B0457', (c) => c.charCodeAt(0))])).toBeGreaterThan(0);
    expect(achar([0x46, 0x65, 0x69, 0x6a, 0xe3, 0x6f])).toBeGreaterThan(0);
    expect(achar([0x41, 0x72, 0x72, 0x6f, 0x7a, 0x85, 0x0a])).toBeGreaterThan(0);
    expect(achar([0x1d, 0x56, 66, 0])).toBe(bin.length - 4);
  });
});
