import * as forge from 'node-forge';
import { generateKeyPairSync } from 'node:crypto';

/** Par RSA pelo crypto nativo (o do node-forge, em JavaScript puro, leva segundos e trava os testes). */
function chavesRsa() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const privada = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;
  return { privateKey: privada, publicKey: forge.pki.setRsaPublicKey(privada.n, privada.e) };
}

/**
 * Certificado A1 de mentira para os testes e o simulador: autoassinado, com o CNPJ no CN e no
 * subjectAltName como na ICP-Brasil. Não vale em nenhum ambiente da Sefin.
 */
export function gerarPfxDeTeste(cnpj: string, senha: string, opcoes: { dias?: number; nome?: string } = {}): { pfxBase64: string; chavePem: string; certificadoPem: string } {
  const chaves = chavesRsa();
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + (opcoes.dias ?? 365) * 86_400_000);
  const nome = opcoes.nome ?? 'EMPRESA DE TESTE LTDA';
  const sujeito = [{ name: 'commonName', value: `${nome}:${cnpj}` }, { name: 'countryName', value: 'BR' }, { name: 'organizationName', value: 'ICP-Brasil (teste)' }];
  cert.setSubject(sujeito);
  cert.setIssuer(sujeito);
  const outro = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer('2.16.76.1.3.3').getBytes()),
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, cnpj)]),
  ]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, nonRepudiation: true },
    { name: 'extKeyUsage', clientAuth: true, emailProtection: true },
    { name: 'subjectAltName', altNames: [{ type: 0, value: outro.value }] },
  ]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: '3des' });
  return {
    pfxBase64: forge.util.encode64(forge.asn1.toDer(p12).getBytes()),
    chavePem: forge.pki.privateKeyToPem(chaves.privateKey),
    certificadoPem: forge.pki.certificateToPem(cert),
  };
}
