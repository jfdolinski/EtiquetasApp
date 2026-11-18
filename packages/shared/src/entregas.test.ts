import { describe, expect, it } from 'vitest';
import {
  coordenadaValida,
  cpfValido,
  crc16Pix,
  diaNoFuso,
  distanciaMetros,
  documentosExigidos,
  loteParaConsumir,
  normalizarPlaca,
  pixCopiaECola,
  posicaoAproximada,
  primeiroNome,
  problemaNoCadastroEntregador,
  problemaNoPacote,
  problemaNosParametrosEntregas,
  PARAMETROS_ENTREGAS_PADRAO,
  saldoDeDiarias,
  situacaoNoMapa,
} from './entregas';

const cadastro = {
  nome: 'Maria da Silva',
  cpf: '529.982.247-25',
  celular: '(11) 98765-4321',
  email: 'maria@exemplo.com',
  senha: 'senha-forte',
  veiculo: 'MOTO' as const,
  placa: 'abc-1d23',
  chavePix: 'maria@exemplo.com',
  aceitaTermos: true,
};

describe('cadastro do entregador', () => {
  it('confere o CPF pelos dígitos', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });

  it('aceita placa antiga e Mercosul', () => {
    expect(normalizarPlaca('abc-1234')).toBe('ABC1234');
    expect(normalizarPlaca('ABC1D23')).toBe('ABC1D23');
    expect(normalizarPlaca('AB1234')).toBeNull();
  });

  it('pede só a foto de quem não tem motor', () => {
    expect(documentosExigidos('BICICLETA')).toEqual(['SELFIE']);
    expect(documentosExigidos('CARRO')).toEqual(['SELFIE', 'CNH', 'CRLV']);
  });

  it('aponta o primeiro problema', () => {
    expect(problemaNoCadastroEntregador(cadastro)).toBeNull();
    expect(problemaNoCadastroEntregador({ ...cadastro, nome: 'Maria' })).toBe('Informe o nome completo.');
    expect(problemaNoCadastroEntregador({ ...cadastro, placa: '' })).toBe('Placa inválida.');
    expect(problemaNoCadastroEntregador({ ...cadastro, veiculo: 'BICICLETA', placa: '' })).toBeNull();
    expect(problemaNoCadastroEntregador({ ...cadastro, aceitaTermos: false })).toMatch(/termos/);
    expect(problemaNoCadastroEntregador({ ...cadastro, celular: '1234' })).toMatch(/celular/);
  });

  it('mostra só o primeiro nome', () => {
    expect(primeiroNome('  Maria  da Silva ')).toBe('Maria');
  });
});

describe('diárias', () => {
  const agora = new Date('2026-11-17T12:00:00Z');
  const lotes = [
    { id: 'a', restante: 3, venceEm: '2026-12-30T00:00:00Z' },
    { id: 'b', restante: 2, venceEm: '2026-11-20T00:00:00Z' },
    { id: 'c', restante: 5, venceEm: '2026-11-10T00:00:00Z' },
    { id: 'd', restante: 0, venceEm: '2026-11-18T00:00:00Z' },
  ];

  it('soma só o que não venceu', () => {
    expect(saldoDeDiarias(lotes, agora)).toBe(5);
  });

  it('gasta primeiro o que vence antes', () => {
    expect(loteParaConsumir(lotes, agora)?.id).toBe('b');
    expect(loteParaConsumir([lotes[2]], agora)).toBeNull();
  });

  it('o dia é o do fuso, não o UTC', () => {
    expect(diaNoFuso(new Date('2026-11-18T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-11-17');
    expect(diaNoFuso(new Date('2026-11-18T03:00:00Z'), 'America/Sao_Paulo')).toBe('2026-11-18');
  });

  it('confere o pacote', () => {
    expect(problemaNoPacote({ nome: 'Semana', diarias: 7, precoCentavos: 3500, validadeDias: 30, ativo: true })).toBeNull();
    expect(problemaNoPacote({ nome: 'Semana', diarias: 7, precoCentavos: 3500, validadeDias: 5, ativo: true })).toMatch(/validade/);
    expect(problemaNoPacote({ nome: 'Semana', diarias: 0, precoCentavos: 3500, validadeDias: 5, ativo: true })).toMatch(/Diárias/);
  });
});

describe('Pix copia e cola', () => {
  it('CRC16-CCITT confere com o valor de referência', () => {
    expect(crc16Pix('123456789')).toBe('29B1');
  });

  it('monta o BR Code com valor, nome e txid limpos', () => {
    const codigo = pixCopiaECola({ chave: 'pix@flow.com.br', nome: 'Flow Plataforma de Entregas Ltda', cidade: 'São José dos Campos', valorCentavos: 3500, txid: 'ENT-ABC 123' });
    expect(codigo.startsWith('000201')).toBe(true);
    expect(codigo).toContain('0014br.gov.bcb.pix0115pix@flow.com.br');
    expect(codigo).toContain('540535.00');
    expect(codigo).toContain('5925FLOW PLATAFORMA DE ENTREG6015SAO JOSE DOS CA62');
    expect(codigo).toContain('62130509ENTABC123');
    expect(codigo.slice(-8, -4)).toBe('6304');
    expect(crc16Pix(codigo.slice(0, -4))).toBe(codigo.slice(-4));
  });

  it('exige nome e cidade junto da chave', () => {
    expect(problemaNosParametrosEntregas(PARAMETROS_ENTREGAS_PADRAO)).toBeNull();
    expect(problemaNosParametrosEntregas({ ...PARAMETROS_ENTREGAS_PADRAO, pixChave: 'x@y.com' })).toMatch(/Pix/);
  });
});

describe('localização', () => {
  it('recusa coordenada impossível ou zerada', () => {
    expect(coordenadaValida({ lat: -23.5, lon: -46.6 })).toBe(true);
    expect(coordenadaValida({ lat: 0, lon: 0 })).toBe(false);
    expect(coordenadaValida({ lat: 91, lon: 0 })).toBe(false);
    expect(coordenadaValida({ lat: Number.NaN, lon: 1 })).toBe(false);
    expect(coordenadaValida(null)).toBe(false);
  });

  it('mede a distância em linha reta', () => {
    // Praça da Sé → Av. Paulista (MASP): cerca de 2,9 km.
    const d = distanciaMetros({ lat: -23.5505, lon: -46.6333 }, { lat: -23.5614, lon: -46.6559 });
    expect(d).toBeGreaterThan(2500);
    expect(d).toBeLessThan(2800);
  });

  it('arredonda a posição sem fugir mais que a grade', () => {
    const p = { lat: -23.55052, lon: -46.63331 };
    const a = posicaoAproximada(p, 200);
    expect(distanciaMetros(p, a)).toBeLessThan(150);
    // Dois pontos próximos na mesma célula caem no mesmo lugar.
    expect(posicaoAproximada({ lat: a.lat + 0.0001, lon: a.lon + 0.0001 }, 200)).toEqual(a);
  });

  it('sem posição recente fica sem sinal', () => {
    const agora = new Date('2026-11-17T12:00:00Z');
    expect(situacaoNoMapa(new Date('2026-11-17T11:59:00Z'), agora)).toBe('LIVRE');
    expect(situacaoNoMapa(new Date('2026-11-17T11:57:00Z'), agora)).toBe('SEM_SINAL');
    expect(situacaoNoMapa(null, agora)).toBe('SEM_SINAL');
  });
});
