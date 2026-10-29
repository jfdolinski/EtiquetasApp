import { randomBytes } from 'node:crypto';
import { cifrar, decifrar, gerarCodigoAtivacao, gerarTokenAgente, normalizarCodigoAtivacao } from './cripto';

describe('cripto', () => {
  const chave = randomBytes(32);

  it('cifra e decifra com IV diferente a cada vez', () => {
    const a = cifrar('senha secreta ç', chave);
    const b = cifrar('senha secreta ç', chave);
    expect(a).not.toBe(b);
    expect(a).not.toContain('senha');
    expect(decifrar(a, chave)).toBe('senha secreta ç');
  });

  it('recusa valor adulterado ou chave errada', () => {
    const valor = cifrar('x', chave);
    const partes = valor.split(':');
    // Inverte um bit do byte cifrado: trocar por um valor fixo coincidiria com o original 1 vez em 256.
    const cifrado = Buffer.from(partes[3], 'base64');
    cifrado[0] ^= 0x01;
    partes[3] = cifrado.toString('base64');
    expect(() => decifrar(partes.join(':'), chave)).toThrow();
    expect(() => decifrar(valor, randomBytes(32))).toThrow();
  });

  it('gera código de ativação legível e normaliza o que o técnico digita', () => {
    const codigo = gerarCodigoAtivacao();
    expect(codigo).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(normalizarCodigoAtivacao(codigo.toLowerCase().replace('-', ' '))).toBe(codigo);
  });

  it('gera tokens longos e únicos', () => {
    const t = gerarTokenAgente();
    expect(t).toMatch(/^agt_[A-Za-z0-9_-]{43}$/);
    expect(gerarTokenAgente()).not.toBe(t);
  });
});
