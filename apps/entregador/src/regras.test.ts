import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, formatarCentavos, normalizarPlaca, problemaNoCadastroEntregador, servidorValido, versaoMaisNova } from './regras.ts';

test('CPF e placa', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('529.982.247-24'), false);
  assert.equal(normalizarPlaca('abc-1d23'), 'ABC1D23');
  assert.equal(normalizarPlaca('ab1'), null);
});

test('cadastro', () => {
  const ok = { nome: 'Ana Souza', cpf: '52998224725', celular: '11987654321', email: 'ana@x.com', senha: '12345678', veiculo: 'BICICLETA' as const, placa: null, chavePix: 'ana@x.com', aceitaTermos: true };
  assert.equal(problemaNoCadastroEntregador(ok), null);
  assert.equal(problemaNoCadastroEntregador({ ...ok, veiculo: 'MOTO' }), 'Placa inválida.');
});

test('servidor, versão e dinheiro', () => {
  assert.equal(servidorValido('https://flow.exemplo.com.br/', false), 'https://flow.exemplo.com.br');
  assert.equal(servidorValido('http://10.0.2.2:3000', false), null);
  assert.equal(servidorValido('http://10.0.2.2:3000', true), 'http://10.0.2.2:3000');
  assert.equal(versaoMaisNova('1.0.10', '1.0.9'), true);
  assert.equal(formatarCentavos(350000), 'R$ 3.500,00');
});
