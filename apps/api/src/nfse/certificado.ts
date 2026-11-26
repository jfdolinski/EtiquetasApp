import { createHash, createSign, createVerify } from 'node:crypto';
import * as forge from 'node-forge';

/** Certificado A1 aberto: a chave nunca sai da memória da API. */
export interface CertificadoA1 {
  chavePem: string;
  certificadoPem: string;
  /** DER do certificado em base64, para o X509Certificate da assinatura. */
  certificadoBase64: string;
  titular: string;
  /** CNPJ ou CPF do titular (ICP-Brasil), quando o certificado traz. */
  documento: string | null;
  validoDe: Date;
  validoAte: Date;
}

/** OIDs da ICP-Brasil: CNPJ da pessoa jurídica e dados da pessoa física (CPF depois da data de nascimento). */
const OID_CNPJ = '2.16.76.1.3.3';
const OID_PF = '2.16.76.1.3.1';

function textoDoOutro(valor: forge.asn1.Asn1): string | null {
  // otherName: [0] EXPLICIT { OCTET STRING | UTF8String | PrintableString }
  let v: forge.asn1.Asn1 | undefined = valor;
  while (v && Array.isArray(v.value)) v = (v.value as forge.asn1.Asn1[])[0];
  return v && typeof v.value === 'string' ? v.value : null;
}

/** Lê o CNPJ/CPF do subjectAltName (otherName ICP-Brasil); senão, procura no CN ("NOME:CNPJ"). */
function documentoDoCertificado(cert: forge.pki.Certificate, cn: string): string | null {
  const ext = cert.getExtension('subjectAltName') as { altNames?: { type: number; value: unknown }[] } | undefined;
  for (const n of ext?.altNames ?? []) {
    if (n.type !== 0 || !Array.isArray(n.value)) continue;
    const partes = n.value as forge.asn1.Asn1[];
    const oid = partes[0] ? forge.asn1.derToOid(partes[0].value as string) : '';
    const texto = partes[1] ? textoDoOutro(partes[1]) : null;
    if (!texto) continue;
    if (oid === OID_CNPJ && /^\d{14}$/.test(texto.trim())) return texto.trim();
    if (oid === OID_PF && texto.length >= 19 && /^\d{11}$/.test(texto.slice(8, 19))) return texto.slice(8, 19);
  }
  const m = cn.match(/:(\d{14}|\d{11})\s*$/);
  return m ? m[1] : null;
}

export class CertificadoInvalido extends Error {}

/** Abre o .pfx (base64) com a senha. Erro de senha ou arquivo vira CertificadoInvalido com texto para o usuário. */
export function lerCertificado(pfxBase64: string, senha: string): CertificadoA1 {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.decode64(pfxBase64);
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha);
  } catch (e) {
    const msg = String((e as Error).message ?? '');
    if (/mac|password|invalid/i.test(msg)) throw new CertificadoInvalido('Senha do certificado incorreta ou arquivo inválido.');
    throw new CertificadoInvalido('O arquivo não é um certificado A1 (.pfx ou .p12).');
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new CertificadoInvalido('O certificado não traz a chave privada.');
  // O certificado do titular é o que casa com a chave (os outros são da cadeia).
  const publica = forge.pki.setRsaPublicKey(chave.n, chave.e);
  const doTitular = certs.map((b) => b.cert).find((c): c is forge.pki.Certificate => !!c && forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(publica));
  if (!doTitular) throw new CertificadoInvalido('O certificado não traz o certificado do titular.');
  const cn = String(doTitular.subject.getField('CN')?.value ?? '');
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(doTitular)).getBytes();
  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(doTitular),
    certificadoBase64: forge.util.encode64(der),
    titular: cn.replace(/:\d+$/, '').trim() || cn,
    documento: documentoDoCertificado(doTitular, cn),
    validoDe: doTitular.validity.notBefore,
    validoAte: doTitular.validity.notAfter,
  };
}

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

/**
 * Assina com XMLDSig envelopada o elemento `tag` (com atributo Id) de um XML gerado em forma canônica
 * por `montarDps`/`montarPedidoCancelamento`. Como o XML já é canônico, a C14N do elemento é o próprio
 * trecho com o namespace herdado da raiz declarado nele. A assinatura vai logo depois do elemento.
 */
export function assinarXml(xml: string, tag: string, cert: Pick<CertificadoA1, 'chavePem' | 'certificadoBase64'>): string {
  const ns = xml.match(/^<[^ >]+ xmlns="([^"]+)"/)?.[1];
  const inicio = xml.indexOf(`<${tag} `);
  const fimTag = `</${tag}>`;
  const fim = xml.indexOf(fimTag);
  if (!ns || inicio < 0 || fim < 0) throw new Error(`Elemento ${tag} não encontrado para assinar.`);
  const trecho = xml.slice(inicio, fim + fimTag.length);
  const id = trecho.match(/^<[^ ]+ Id="([^"]+)"/)?.[1];
  if (!id) throw new Error(`O elemento ${tag} não tem Id.`);
  // C14N exclusiva: o xmlns usado pelo elemento entra nele, antes dos atributos (os filhos já o herdam).
  const canonico = trecho.replace(`<${tag} `, `<${tag} xmlns="${ns}" `);
  const digest = createHash('sha256').update(canonico, 'utf8').digest('base64');
  const signedInfo =
    `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod><SignatureMethod Algorithm="${RSA_SHA256}"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms><Transform Algorithm="${ENVELOPED}"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${SHA256}"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const signedInfoCanonico = signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${DSIG}">`);
  const assinatura = createSign('RSA-SHA256').update(signedInfoCanonico, 'utf8').sign(cert.chavePem, 'base64');
  const signature =
    `<Signature xmlns="${DSIG}">${signedInfo}<SignatureValue>${assinatura}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${cert.certificadoBase64}</X509Certificate></X509Data></KeyInfo></Signature>`;
  const pos = fim + fimTag.length;
  return xml.slice(0, pos) + signature + xml.slice(pos);
}

/**
 * Confere a assinatura de um XML gerado e assinado por este módulo (forma canônica conhecida).
 * Serve ao simulador da Sefin nos testes; não é um verificador XMLDSig geral.
 */
export function conferirAssinatura(xml: string, tag: string): { ok: true; certificadoBase64: string } | { ok: false; motivo: string } {
  const ns = xml.match(/^<[^ >]+ xmlns="([^"]+)"/)?.[1];
  const fimTag = `</${tag}>`;
  const inicio = xml.indexOf(`<${tag} `);
  const fim = xml.indexOf(fimTag);
  const sig = xml.slice(fim + fimTag.length).match(/^<Signature xmlns="[^"]+">(<SignedInfo>.*<\/SignedInfo>)<SignatureValue>([^<]+)<\/SignatureValue><KeyInfo><X509Data><X509Certificate>([^<]+)<\/X509Certificate>/);
  if (!ns || inicio < 0 || fim < 0 || !sig) return { ok: false, motivo: 'Assinatura ausente ou fora do lugar.' };
  const [, signedInfo, valor, certB64] = sig;
  const trecho = xml.slice(inicio, fim + fimTag.length).replace(`<${tag} `, `<${tag} xmlns="${ns}" `);
  const digest = createHash('sha256').update(trecho, 'utf8').digest('base64');
  if (!signedInfo.includes(`<DigestValue>${digest}</DigestValue>`)) return { ok: false, motivo: 'O conteúdo não confere com a assinatura (digest).' };
  const id = trecho.match(/ Id="([^"]+)"/)?.[1];
  if (!signedInfo.includes(`URI="#${id}"`)) return { ok: false, motivo: 'A assinatura não aponta para o elemento assinado.' };
  const pem = `-----BEGIN CERTIFICATE-----\n${certB64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  const ok = createVerify('RSA-SHA256').update(signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${DSIG}">`), 'utf8').verify(pem, valor, 'base64');
  return ok ? { ok: true, certificadoBase64: certB64 } : { ok: false, motivo: 'Assinatura inválida.' };
}
