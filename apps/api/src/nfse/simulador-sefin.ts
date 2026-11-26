import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { X509Certificate, randomInt } from 'node:crypto';
import * as forge from 'node-forge';
import { generateKeyPairSync } from 'node:crypto';

/** Par RSA pelo crypto nativo (o do node-forge, em JavaScript puro, leva segundos e trava os testes). */
function chavesRsa() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const privada = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;
  return { privateKey: privada, publicKey: forge.pki.setRsaPublicKey(privada.n, privada.e) };
}
import { conferirAssinatura } from './certificado';
import { comprimir, descomprimir } from './sefin';

/**
 * Simulador da Sefin Nacional para os testes (jest e e2e). Fala HTTPS com certificado do
 * cliente (mTLS), recebe a DPS em gzip+base64, confere a assinatura e se o certificado é do
 * prestador, e devolve uma NFS-e com chave de 50 dígitos. Repete as recusas que importam: DPS já
 * enviada (E0014), ambiente errado, certificado de outro CNPJ e cancelamento repetido.
 */
export interface NotaSimulada {
  chave: string;
  idDps: string;
  numero: number;
  cnpj: string;
  xml: string;
  cancelada: boolean;
  motivo?: string;
}

export interface SimuladorSefin {
  url: string;
  notas: Map<string, NotaSimulada>;
  /** As próximas N chamadas de emissão respondem 503 (Sefin fora do ar). */
  falhar(n: number): void;
  /** As próximas N emissões são recusadas por regra de negócio (400, como um código de serviço que não existe). */
  recusar(n: number): void;
  /** Recebidas (para conferir o que foi enviado). */
  recebidas: { caminho: string; corpo: unknown }[];
  parar(): Promise<void>;
}

function certificadoDoServidor(): { key: string; cert: string } {
  const chaves = chavesRsa();
  const c = forge.pki.createCertificate();
  c.publicKey = chaves.publicKey;
  c.serialNumber = '02';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  const s = [{ name: 'commonName', value: 'localhost' }];
  c.setSubject(s);
  c.setIssuer(s);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]);
  c.sign(chaves.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(chaves.privateKey), cert: forge.pki.certificateToPem(c) };
}

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? null;

function cnpjDoCertificado(der: Buffer | undefined): string | null {
  if (!der?.length) return null;
  const x = new X509Certificate(der);
  return x.subject.match(/CN=[^\n]*:(\d{14})/)?.[1] ?? null;
}

export async function iniciarSimuladorSefin(porta = 0): Promise<SimuladorSefin> {
  const notas = new Map<string, NotaSimulada>();
  const porDps = new Map<string, string>();
  const recebidas: SimuladorSefin['recebidas'] = [];
  let falhas = 0;
  let recusas = 0;
  let numero = 0;

  const responder = (res: ServerResponse, status: number, corpo: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(corpo));
  };
  const erro = (res: ServerResponse, status: number, codigo: string, descricao: string) => responder(res, status, { tipoAmbiente: 2, erros: [{ codigo, descricao }] });

  const lerCorpo = (req: IncomingMessage) =>
    new Promise<unknown>((ok) => {
      const partes: Buffer[] = [];
      req.on('data', (p: Buffer) => partes.push(p));
      req.on('end', () => {
        try {
          ok(JSON.parse(Buffer.concat(partes).toString('utf8') || 'null'));
        } catch {
          ok(null);
        }
      });
    });

  async function tratar(req: IncomingMessage, res: ServerResponse) {
    const caminho = (req.url ?? '').replace(/^\/SefinNacional/, '');
    const cnpjCert = cnpjDoCertificado((req.socket as TLSSocket).getPeerCertificate?.()?.raw);
    if (!cnpjCert) return erro(res, 403, 'E9001', 'Certificado digital do cliente ausente.');
    const corpo = req.method === 'POST' ? await lerCorpo(req) : null;
    recebidas.push({ caminho, corpo });

    if (req.method === 'POST' && caminho === '/nfse') {
      if (falhas > 0) {
        falhas--;
        return erro(res, 503, 'E9999', 'Serviço indisponível (simulação).');
      }
      if (recusas > 0) {
        recusas--;
        return erro(res, 400, 'E0310', 'Código de tributação nacional inexistente (simulação).');
      }
      const b64 = (corpo as { dpsXmlGZipB64?: string } | null)?.dpsXmlGZipB64;
      if (!b64) return erro(res, 400, 'E0001', 'dpsXmlGZipB64 não informado.');
      const xml = descomprimir(b64);
      const assinatura = conferirAssinatura(xml, 'infDPS');
      if (!assinatura.ok) return erro(res, 400, 'E0714', assinatura.motivo);
      const idDps = xml.match(/<infDPS Id="(DPS\d{42})">/)?.[1];
      if (!idDps) return erro(res, 400, 'E0004', 'Id da DPS inválido.');
      const cnpj = tag(xml.match(/<prest>.*<\/prest>/)?.[0] ?? '', 'CNPJ');
      if (cnpj !== cnpjCert) return erro(res, 403, 'E0716', 'O certificado não é do prestador da DPS.');
      if (tag(xml, 'tpAmb') !== '2') return erro(res, 400, 'E0002', 'Ambiente da DPS diferente do ambiente de produção restrita.');
      const valor = Number(tag(xml, 'vServ'));
      if (!(valor > 0)) return erro(res, 400, 'E0424', 'Valor do serviço deve ser maior que zero.');
      if (porDps.has(idDps)) return erro(res, 400, 'E0014', 'DPS já utilizada para emissão de NFS-e.');
      numero++;
      const cMun = idDps.slice(3, 10);
      const dh = tag(xml, 'dhEmi') ?? '';
      const chave = `${cMun}2${'2'}${cnpj}${String(numero).padStart(13, '0')}${dh.slice(2, 4)}${dh.slice(5, 7)}${String(randomInt(1e9)).padStart(9, '0')}0`;
      const nfse = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS${chave}"><nNFSe>${numero}</nNFSe><cStat>100</cStat>${xml}</infNFSe></NFSe>`;
      notas.set(chave, { chave, idDps, numero, cnpj, xml: nfse, cancelada: false });
      porDps.set(idDps, chave);
      return responder(res, 201, { tipoAmbiente: 2, versaoAplicativo: 'Simulador', dataHoraProcessamento: new Date().toISOString(), idDps, chaveAcesso: chave, nfseXmlGZipB64: comprimir(nfse) });
    }
    const dps = caminho.match(/^\/dps\/(DPS\d{42})$/);
    if (req.method === 'GET' && dps) {
      const chave = porDps.get(dps[1]);
      if (!chave) return erro(res, 404, 'E2001', 'DPS não encontrada.');
      if (notas.get(chave)!.cnpj !== cnpjCert) return erro(res, 403, 'E2002', 'Certificado sem acesso a esta DPS.');
      return responder(res, 200, { idDps: dps[1], chaveAcesso: chave });
    }
    const evento = caminho.match(/^\/nfse\/(\d{50})\/eventos$/);
    if (req.method === 'POST' && evento) {
      const n = notas.get(evento[1]);
      if (!n) return erro(res, 404, 'E1001', 'NFS-e não encontrada.');
      const b64 = (corpo as { pedidoRegistroEventoXmlGZipB64?: string } | null)?.pedidoRegistroEventoXmlGZipB64;
      if (!b64) return erro(res, 400, 'E0001', 'pedidoRegistroEventoXmlGZipB64 não informado.');
      const xml = descomprimir(b64);
      const assinatura = conferirAssinatura(xml, 'infPedReg');
      if (!assinatura.ok) return erro(res, 400, 'E0714', assinatura.motivo);
      if (tag(xml, 'chNFSe') !== n.chave || n.cnpj !== cnpjCert) return erro(res, 403, 'E1235', 'Autor do evento não é o prestador da NFS-e.');
      if (n.cancelada) return erro(res, 400, 'E0840', 'NFS-e já cancelada.');
      n.cancelada = true;
      n.motivo = tag(xml, 'xMotivo') ?? '';
      return responder(res, 201, { eventoXmlGZipB64: comprimir(`<evento>${xml}</evento>`) });
    }
    const nota = caminho.match(/^\/nfse\/(\d{50})$/);
    if (req.method === 'GET' && nota) {
      const n = notas.get(nota[1]);
      if (!n) return erro(res, 404, 'E1001', 'NFS-e não encontrada.');
      return responder(res, 200, { chaveAcesso: n.chave, nfseXmlGZipB64: comprimir(n.xml) });
    }
    return erro(res, 404, 'E9404', `Caminho desconhecido: ${req.method} ${caminho}`);
  }

  const { key, cert } = certificadoDoServidor();
  const servidor: Server = createServer({ key, cert, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    tratar(req, res).catch((e) => erro(res, 500, 'E9500', String(e)));
  });
  await new Promise<void>((ok) => servidor.listen(porta, '127.0.0.1', ok));
  const endereco = servidor.address();
  const p = typeof endereco === 'object' && endereco ? endereco.port : porta;
  return {
    url: `https://localhost:${p}`,
    notas,
    recebidas,
    falhar: (n) => {
      falhas = n;
    },
    recusar: (n) => {
      recusas = n;
    },
    parar: () => new Promise((ok) => servidor.close(() => ok())),
  };
}
