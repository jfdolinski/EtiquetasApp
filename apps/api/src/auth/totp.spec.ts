import { codigoDoPasso, conferirTotp, deBase32, gerarCodigosRecuperacao, gerarSegredoTotp, hashDoCodigo, paraBase32, uriTotp } from './totp';

describe('TOTP', () => {
  const segredo = Buffer.from('12345678901234567890');

  it('segue os vetores da RFC 6238 (SHA-1)', () => {
    // A RFC traz 8 dígitos: 94287082, 07081804, 14050471, 89005924; os 6 finais são o código.
    expect(codigoDoPasso(segredo, Math.floor(59 / 30))).toBe('287082');
    expect(codigoDoPasso(segredo, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codigoDoPasso(segredo, Math.floor(1111111111 / 30))).toBe('050471');
    expect(codigoDoPasso(segredo, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('base32 vai e volta', () => {
    expect(paraBase32(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(deBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString()).toBe('12345678901234567890');
    const s = gerarSegredoTotp();
    expect(paraBase32(deBase32(s))).toBe(s);
  });

  it('aceita o passo vizinho e recusa os mais distantes', () => {
    const b32 = paraBase32(segredo);
    const agora = 1_700_000_000_000;
    const passo = Math.floor(agora / 30_000);
    expect(conferirTotp(b32, codigoDoPasso(segredo, passo), agora)).toBe(passo);
    expect(conferirTotp(b32, codigoDoPasso(segredo, passo - 1), agora)).toBe(passo - 1);
    expect(conferirTotp(b32, codigoDoPasso(segredo, passo + 1), agora)).toBe(passo + 1);
    expect(conferirTotp(b32, codigoDoPasso(segredo, passo - 5), agora)).toBeNull();
    expect(conferirTotp(b32, 'abcdef', agora)).toBeNull();
    expect(conferirTotp(b32, '12345', agora)).toBeNull();
  });

  it('códigos de recuperação são únicos e o hash ignora caixa e espaços', () => {
    const codigos = gerarCodigosRecuperacao();
    expect(new Set(codigos).size).toBe(8);
    expect(codigos[0]).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(hashDoCodigo(` ${codigos[0].toLowerCase()} `)).toBe(hashDoCodigo(codigos[0]));
  });

  it('URI no formato dos aplicativos autenticadores', () => {
    expect(uriTotp('ABC', 'ana@x.com')).toBe('otpauth://totp/Flow%3Aana%40x.com?secret=ABC&issuer=Flow&algorithm=SHA1&digits=6&period=30');
  });
});
