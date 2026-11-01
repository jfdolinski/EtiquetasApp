// Gera a chave que assina o APK de produção. Rode UMA vez e guarde o arquivo e a senha em lugar seguro:
// sem a mesma chave, o Android não atualiza o aplicativo por cima, e todos têm de desinstalar e instalar de novo.
//   node scripts/gerar-chave.mjs <pasta-fora-do-repositorio>
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import forge from 'node-forge';

const pasta = process.argv[2];
if (!pasta) {
  console.error('Uso: node scripts/gerar-chave.mjs <pasta-fora-do-repositorio>');
  process.exit(1);
}
const arquivo = join(pasta, 'etiquetas-app.p12');
if (existsSync(arquivo)) {
  console.error(`Já existe ${arquivo}: não vou sobrescrever uma chave que pode estar em uso.`);
  process.exit(1);
}

const senha = randomBytes(24).toString('base64url');
const chaves = forge.pki.rsa.generateKeyPair(2048);
const certificado = forge.pki.createCertificate();
certificado.publicKey = chaves.publicKey;
certificado.serialNumber = randomBytes(8).toString('hex').replace(/^[89a-f]/, '1');
certificado.validity.notBefore = new Date();
certificado.validity.notAfter = new Date();
// O Android exige validade longa: a chave precisa durar toda a vida do aplicativo.
certificado.validity.notAfter.setFullYear(certificado.validity.notBefore.getFullYear() + 50);
const nome = [{ name: 'commonName', value: 'Etiquetas' }, { name: 'countryName', value: 'BR' }];
certificado.setSubject(nome);
certificado.setIssuer(nome);
certificado.sign(chaves.privateKey, forge.md.sha256.create());

const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha, { algorithm: '3des', friendlyName: 'etiquetas' });
const bytes = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
writeFileSync(arquivo, bytes, { mode: 0o600 });
writeFileSync(join(pasta, 'etiquetas-app-keystore-base64.txt'), bytes.toString('base64'), { mode: 0o600 });
writeFileSync(join(pasta, 'etiquetas-app-senha.txt'), senha, { mode: 0o600 });

console.log(`Chave criada em ${pasta}. Agora, no GitHub (Settings > Secrets and variables > Actions):`);
console.log('  APP_KEYSTORE_BASE64 = conteúdo de etiquetas-app-keystore-base64.txt');
console.log('  APP_KEYSTORE_SENHA  = conteúdo de etiquetas-app-senha.txt');
console.log('Guarde os três arquivos num cofre: eles não podem ser recriados.');
