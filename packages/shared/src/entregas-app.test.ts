import { describe, expect, it } from 'vitest';
import * as app from '../../../apps/entregador/src/regras';
import {
  cpfValido,
  INTERVALO_POSICAO_SEGUNDOS,
  normalizarPlaca,
  problemaNoCadastroEntregador,
  ROTULO_DOCUMENTO,
  ROTULO_PEDIDO_CREDITO,
  ROTULO_SITUACAO_ENTREGADOR,
  ROTULO_VEICULO,
  SENHA_ENTREGADOR_MINIMO,
  TIPOS_VEICULO,
} from './entregas';
import { formatarCelular, formatarCentavos, normalizarCelular } from './pedidos';
import { formatarKm, linkNavegacao, MOTIVOS_OCORRENCIA, normalizarSerie, PROXIMA_ETAPA, ROTULO_MOTIVO_OCORRENCIA, ROTULO_SITUACAO_CHAMADA, ROTULO_TIPO_CHAMADA } from './entregas-chamadas';
import { LIMITE_MENSAGEM, LIMITES_VOLUMES, normalizarCodigoColeta, problemaNosVolumes, textoVolumes } from './entregas-balcao';
import { comprimentoDaAssinatura, LIMITES_ASSINATURA, problemaNaAssinatura, PROPORCAO_ASSINATURA } from './entregas-comprovacao';
import { ROTULO_RESPONSAVEL_AVARIA, ROTULO_SITUACAO_AVARIA, ROTULO_TIPO_AVARIA } from './entregas-escala';
import { ROTULO_SITUACAO_META } from './entregas-metas';
import { CATEGORIAS_SUPORTE, problemaNaMensagemDeSuporte, problemaNoChamado, ROTULO_CATEGORIA_SUPORTE, ROTULO_SITUACAO_SUPORTE } from './suporte';
import { ESPERA_BLOCO_MINUTOS, ESTADOS_MAQUINA, ITENS_CHECKLIST, LIMITE_OBSERVACAO_CHECKLIST, problemaNoChecklist, ROTULO_ESTADO_MAQUINA } from './entregas-servico';

/** O app do entregador só importa tipos daqui: as regras são copiadas em apps/entregador/src/regras.ts. */
describe('cópias do app do entregador', () => {
  it('dão o mesmo resultado que as regras daqui', () => {
    expect(app.TIPOS_VEICULO).toEqual([...TIPOS_VEICULO]);
    expect(app.ROTULO_VEICULO).toEqual(ROTULO_VEICULO);
    expect(app.ROTULO_SITUACAO_ENTREGADOR).toEqual(ROTULO_SITUACAO_ENTREGADOR);
    expect(app.ROTULO_DOCUMENTO).toEqual(ROTULO_DOCUMENTO);
    expect(app.ROTULO_PEDIDO_CREDITO).toEqual(ROTULO_PEDIDO_CREDITO);
    expect(app.SENHA_ENTREGADOR_MINIMO).toBe(SENHA_ENTREGADOR_MINIMO);
    expect(app.INTERVALO_POSICAO_SEGUNDOS).toBe(INTERVALO_POSICAO_SEGUNDOS);
    for (const c of ['529.982.247-25', '52998224724', '111.111.111-11', '', '123']) expect(app.cpfValido(c)).toBe(cpfValido(c));
    for (const p of ['abc-1d23', 'ABC1234', 'AB1234', '']) expect(app.normalizarPlaca(p)).toBe(normalizarPlaca(p));
    for (const c of ['(11) 98765-4321', '5511987654321', '1187654321', '']) expect(app.normalizarCelular(c)).toBe(normalizarCelular(c));
    expect(app.formatarCelular('11987654321')).toBe(formatarCelular('11987654321'));
    for (const c of [0, 5, 3500, 123456789, -250]) expect(app.formatarCentavos(c)).toBe(formatarCentavos(c));

    const base = { nome: 'Ana Souza', cpf: '52998224725', celular: '11987654321', email: 'ana@x.com', senha: '12345678', veiculo: 'MOTO' as const, placa: 'ABC1D23', chavePix: 'ana@x.com', aceitaTermos: true };
    const casos = [base, { ...base, nome: 'Ana' }, { ...base, placa: '' }, { ...base, veiculo: 'A_PE' as const, placa: '' }, { ...base, senha: '123' }, { ...base, email: 'x' }, { ...base, chavePix: '' }, { ...base, aceitaTermos: false }];
    for (const c of casos) expect(app.problemaNoCadastroEntregador(c)).toBe(problemaNoCadastroEntregador(c));

    expect(app.ROTULO_TIPO_CHAMADA).toEqual(ROTULO_TIPO_CHAMADA);
    expect(app.ROTULO_SITUACAO_CHAMADA).toEqual(ROTULO_SITUACAO_CHAMADA);
    expect(app.PROXIMA_ETAPA).toEqual(PROXIMA_ETAPA);
    expect(app.MOTIVOS_OCORRENCIA).toEqual([...MOTIVOS_OCORRENCIA]);
    expect(app.ROTULO_MOTIVO_OCORRENCIA).toEqual(ROTULO_MOTIVO_OCORRENCIA);
    for (const v of [' ab-12.34 ', '', 'x']) expect(app.normalizarSerie(v)).toBe(normalizarSerie(v));
    for (const m of [0, 950, 3500, 12_345, 250_000]) expect(app.formatarKm(m)).toBe(formatarKm(m));
    expect(app.linkNavegacao({ lat: -23.5, lon: -46.6 })).toBe(linkNavegacao({ lat: -23.5, lon: -46.6 }));

    expect(app.ESPERA_BLOCO_MINUTOS).toBe(ESPERA_BLOCO_MINUTOS);
    expect(app.ESTADOS_MAQUINA).toEqual([...ESTADOS_MAQUINA]);
    expect(app.ROTULO_ESTADO_MAQUINA).toEqual(ROTULO_ESTADO_MAQUINA);
    expect(app.ITENS_CHECKLIST).toEqual(ITENS_CHECKLIST);
    expect(app.LIMITE_OBSERVACAO_CHECKLIST).toBe(LIMITE_OBSERVACAO_CHECKLIST);
    const lista = { carregador: true, bobina: false, chip: true, estado: 'BOA' as const, observacao: '' };
    for (const c of [null, lista, { ...lista, chip: undefined }, { ...lista, estado: 'AVARIADA' as const }, { ...lista, estado: 'X' as never }, { ...lista, observacao: 'x'.repeat(301) }]) expect(app.problemaNoChecklist(c)).toBe(problemaNoChecklist(c));

    expect(app.LIMITES_ASSINATURA).toEqual(LIMITES_ASSINATURA);
    expect(app.PROPORCAO_ASSINATURA).toBe(PROPORCAO_ASSINATURA);
    const rabisco: [number, number][] = [[0.1, 0.5], [0.3, 0.2], [0.5, 0.8], [0.7, 0.3]];
    expect(app.comprimentoDaAssinatura([rabisco])).toBe(comprimentoDaAssinatura([rabisco]));
    for (const a of [null, { tracos: [rabisco], recebedor: '' }, { tracos: [rabisco], recebedor: 'Ana' }, { tracos: [[[0.5, 0.5]]] as [number, number][][], recebedor: 'Ana' }, { tracos: [[[2, 0.5]]] as [number, number][][], recebedor: 'Ana' }, { tracos: Array.from({ length: 61 }, () => rabisco), recebedor: 'Ana' }])
      expect(app.problemaNaAssinatura(a)).toBe(problemaNaAssinatura(a));

    expect(app.LIMITE_MENSAGEM).toBe(LIMITE_MENSAGEM);
    expect(app.LIMITES_VOLUMES).toEqual(LIMITES_VOLUMES);
    expect(app.ROTULO_TIPO_AVARIA).toEqual(ROTULO_TIPO_AVARIA);
    expect(app.ROTULO_RESPONSAVEL_AVARIA).toEqual(ROTULO_RESPONSAVEL_AVARIA);
    expect(app.ROTULO_SITUACAO_AVARIA).toEqual(ROTULO_SITUACAO_AVARIA);
    for (const c of [" fc23456789ab ", "]C1FC23456789AB", "7891000100103", "FC0000000000", ""]) expect(app.normalizarCodigoColeta(c)).toBe(normalizarCodigoColeta(c));
    for (const v of [0, 1, 2.5, 99, 100, "3"]) expect(app.problemaNosVolumes(v)).toBe(problemaNosVolumes(v));
    for (const n of [1, 2]) expect(app.textoVolumes(n)).toBe(textoVolumes(n));
    expect(app.ROTULO_SITUACAO_META).toEqual(ROTULO_SITUACAO_META);
    expect(app.CATEGORIAS_SUPORTE).toEqual([...CATEGORIAS_SUPORTE]);
    expect(app.ROTULO_CATEGORIA_SUPORTE).toEqual(ROTULO_CATEGORIA_SUPORTE);
    expect(app.ROTULO_SITUACAO_SUPORTE).toEqual(ROTULO_SITUACAO_SUPORTE);
    for (const t of ['', 'oi', 'Não consigo entrar', 'x'.repeat(2001)]) expect(app.problemaNaMensagemDeSuporte(t)).toBe(problemaNaMensagemDeSuporte(t));
    for (const c of [{ categoria: 'APP', assunto: 'Erro', texto: 'Não abre o app' }, { categoria: 'X', assunto: 'Erro no app', texto: 'Não abre o app' }, { categoria: 'PAGAMENTO', assunto: 'Diária não caiu', texto: 'Paguei ontem' }, { categoria: 'OUTRO', assunto: 'y'.repeat(121), texto: 'texto longo' }])
      expect(app.problemaNoChamado(c)).toBe(problemaNoChamado(c));
  });
});
