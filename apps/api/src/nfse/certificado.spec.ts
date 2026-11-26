import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { montarDps, montarPedidoCancelamento } from '@etiquetas/shared';
import { assinarXml, CertificadoInvalido, lerCertificado } from './certificado';
import { gerarPfxDeTeste } from './certificado-de-teste';

const CNPJ = '11222333000181';
const teste = gerarPfxDeTeste(CNPJ, 'segredo');

function confere(xml: string, certificadoPem: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const sig = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const v = new SignedXml({ publicCert: certificadoPem });
  v.loadSignature(sig as unknown as Node);
  return v.checkSignature(xml);
}

const dps = () =>
  montarDps({
    emissor: { ambiente: 'PRODUCAO_RESTRITA', cnpj: CNPJ, inscricaoMunicipal: '12345', codigoMunicipio: '3550308', regime: 'SIMPLES', regimeEspecial: 0, email: 'a@b.com', telefone: null },
    serie: '1',
    numero: 7,
    emitidaEm: '2026-11-26T10:00:00-03:00',
    competencia: '2026-11-26',
    tomador: { documento: '11444777000161', nome: 'Cliente & Filhos <Ltda>', email: null },
    servico: { codigoTributacaoNacional: '010501', descricao: 'Licença de uso de software "Flow"', aliquotaIss: 2, issRetido: false },
    valorCentavos: 12345,
    versaoAplicativo: 'Flow 1.0',
  });

describe('certificado A1', () => {
  it('lê titular, CNPJ e validade', () => {
    const c = lerCertificado(teste.pfxBase64, 'segredo');
    expect(c.titular).toBe('EMPRESA DE TESTE LTDA');
    expect(c.documento).toBe(CNPJ);
    expect(c.validoAte.getTime()).toBeGreaterThan(Date.now());
  });

  it('recusa senha errada e arquivo que não é pfx', () => {
    expect(() => lerCertificado(teste.pfxBase64, 'errada')).toThrow(CertificadoInvalido);
    expect(() => lerCertificado(Buffer.from('nada').toString('base64'), 'x')).toThrow(CertificadoInvalido);
  });

  it('assina a DPS e a assinatura confere numa biblioteca independente', () => {
    const c = lerCertificado(teste.pfxBase64, 'segredo');
    const xml = assinarXml(dps(), 'infDPS', c);
    expect(xml).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
    expect(confere(xml, teste.certificadoPem)).toBe(true);
    // Mudar um byte do conteúdo assinado quebra a assinatura.
    expect(confere(xml.replace('123.45', '999.99'), teste.certificadoPem)).toBe(false);
  });

  it('assina o pedido de cancelamento', () => {
    const c = lerCertificado(teste.pfxBase64, 'segredo');
    const chave = '3'.repeat(50);
    const xml = assinarXml(
      montarPedidoCancelamento({ ambiente: 'PRODUCAO_RESTRITA', cnpjAutor: CNPJ, chaveAcesso: chave, emitidoEm: '2026-11-26T10:00:00-03:00', motivo: 1, texto: 'Valor digitado errado na nota', versaoAplicativo: 'Flow 1.0' }),
      'infPedReg',
      c,
    );
    expect(confere(xml, teste.certificadoPem)).toBe(true);
  });
});
