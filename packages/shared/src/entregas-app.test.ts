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
  });
});
