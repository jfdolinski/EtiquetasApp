import { request } from 'node:https';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AmbienteNfse } from '@etiquetas/shared';

/**
 * Endereços oficiais (manual da API do Sistema Nacional NFS-e). Nos testes, NFSE_SEFIN_URL troca os dois.
 * O DANFSe não vem mais do ADN (API desligada em produção em 03/08/2026, NT 008): o Flow gera o PDF.
 */
export const URLS_NFSE: Record<AmbienteNfse, string> = {
  PRODUCAO_RESTRITA: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  PRODUCAO: 'https://sefin.nfse.gov.br/SefinNacional',
};

export interface CredencialNfse {
  pfx: Buffer;
  senha: string;
}

export interface NotaAutorizada {
  chaveAcesso: string;
  numeroNfse: string | null;
  xmlNfse: string;
}

export type ResultadoEmissao =
  | ({ ok: true } & NotaAutorizada)
  | { ok: false; temporaria: boolean; status: number | null; mensagem: string; duplicada: boolean };

export type ResultadoEvento = { ok: true } | { ok: false; temporaria: boolean; status: number | null; mensagem: string };

/** O que a API precisa da Sefin/ADN. A implementação real fala HTTPS com o certificado; o simulador responde em memória. */
export interface ProvedorNfse {
  emitir(cred: CredencialNfse, ambiente: AmbienteNfse, dpsAssinada: string): Promise<ResultadoEmissao>;
  /** A nota que nasceu de uma DPS já enviada (recupera quando a resposta se perdeu ou a DPS é repetida). */
  consultarPorDps(cred: CredencialNfse, ambiente: AmbienteNfse, idDps: string): Promise<NotaAutorizada | null>;
  registrarEvento(cred: CredencialNfse, ambiente: AmbienteNfse, chaveAcesso: string, pedidoAssinado: string): Promise<ResultadoEvento>;
}

export const comprimir = (xml: string) => gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
export const descomprimir = (b64: string) => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');

/** Número da NFS-e dentro do XML autorizado (`<nNFSe>`). */
export function numeroDoXml(xml: string): string | null {
  return xml.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null;
}

interface Resposta {
  status: number;
  corpo: Buffer;
  tipo: string;
}

interface ErroSefin {
  Codigo?: string;
  codigo?: string;
  Descricao?: string;
  descricao?: string;
  Complemento?: string;
  complemento?: string;
}

/** Junta os erros da resposta (`erros`, `erro` ou `mensagem`) num texto para o usuário. */
export function mensagemDosErros(corpo: unknown): { texto: string; codigos: string[] } {
  const c = (corpo ?? {}) as { erros?: ErroSefin[]; erro?: ErroSefin | ErroSefin[]; mensagem?: string; message?: string };
  const lista: ErroSefin[] = [...(Array.isArray(c.erros) ? c.erros : []), ...(Array.isArray(c.erro) ? c.erro : c.erro ? [c.erro] : [])];
  const codigos = lista.map((e) => String(e.Codigo ?? e.codigo ?? '')).filter(Boolean);
  const texto = lista
    .map((e) => [e.Codigo ?? e.codigo, e.Descricao ?? e.descricao, e.Complemento ?? e.complemento].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join('; ');
  return { texto: texto || c.mensagem || c.message || '', codigos };
}

/** Códigos de rejeição que dizem que esta DPS já virou nota (a resposta anterior se perdeu). */
const CODIGOS_DPS_REPETIDA = ['E0014', 'E0015'];

/** Cliente HTTPS da Sefin Nacional e do ADN, com o certificado A1 na conexão (mTLS). */
export class SefinNacional implements ProvedorNfse {
  constructor(
    private readonly urls: Record<AmbienteNfse, string> = URLS_NFSE,
    /** Falso só nos testes, com o simulador de certificado próprio (NFSE_TESTE_SEM_VERIFICAR_SERVIDOR). */
    private readonly verificarServidor = true,
    private readonly tempoMs = 60_000,
  ) {}

  private chamar(cred: CredencialNfse, url: string, metodo: 'GET' | 'POST', corpo?: unknown): Promise<Resposta> {
    const dados = corpo === undefined ? undefined : Buffer.from(JSON.stringify(corpo), 'utf8');
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: metodo,
          pfx: cred.pfx,
          passphrase: cred.senha,
          rejectUnauthorized: this.verificarServidor,
          headers: { Accept: 'application/json, application/pdf', ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}) },
          timeout: this.tempoMs,
        },
        (res) => {
          const partes: Buffer[] = [];
          let total = 0;
          res.on('data', (p: Buffer) => {
            total += p.length;
            if (total > 20 * 1024 * 1024) req.destroy(new Error('Resposta grande demais.'));
            else partes.push(p);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes), tipo: String(res.headers['content-type'] ?? '') }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('A Sefin não respondeu a tempo.')));
      req.on('error', reject);
      if (dados) req.write(dados);
      req.end();
    });
  }

  private json(r: Resposta): unknown {
    try {
      return JSON.parse(r.corpo.toString('utf8'));
    } catch {
      return null;
    }
  }

  private falhaDeRede(e: unknown): string {
    const msg = String((e as Error)?.message ?? e);
    if (/mac verify|pkcs12|unsupported/i.test(msg)) return 'Não foi possível usar o certificado na conexão.';
    return `Sem resposta da Sefin Nacional (${msg}).`;
  }

  async emitir(cred: CredencialNfse, ambiente: AmbienteNfse, dps: string): Promise<ResultadoEmissao> {
    let r: Resposta;
    try {
      r = await this.chamar(cred, `${this.urls[ambiente]}/nfse`, 'POST', { dpsXmlGZipB64: comprimir(dps) });
    } catch (e) {
      return { ok: false, temporaria: true, status: null, mensagem: this.falhaDeRede(e), duplicada: false };
    }
    const corpo = this.json(r) as { chaveAcesso?: string; nfseXmlGZipB64?: string } | null;
    if (r.status >= 200 && r.status < 300 && corpo?.chaveAcesso && corpo.nfseXmlGZipB64) {
      const xml = descomprimir(corpo.nfseXmlGZipB64);
      return { ok: true, chaveAcesso: corpo.chaveAcesso, numeroNfse: numeroDoXml(xml), xmlNfse: xml };
    }
    const { texto, codigos } = mensagemDosErros(corpo);
    return {
      ok: false,
      temporaria: r.status >= 500 || r.status === 429 || r.status === 408,
      status: r.status,
      mensagem: texto || `A Sefin recusou a DPS (HTTP ${r.status}).`,
      duplicada: codigos.some((c) => CODIGOS_DPS_REPETIDA.includes(c)),
    };
  }

  async consultarPorDps(cred: CredencialNfse, ambiente: AmbienteNfse, idDps: string): Promise<NotaAutorizada | null> {
    const r = await this.chamar(cred, `${this.urls[ambiente]}/dps/${encodeURIComponent(idDps)}`, 'GET');
    if (r.status === 404) return null;
    const corpo = this.json(r) as { chaveAcesso?: string } | null;
    if (r.status !== 200 || !corpo?.chaveAcesso) throw new Error(mensagemDosErros(corpo).texto || `Consulta da DPS falhou (HTTP ${r.status}).`);
    const n = await this.chamar(cred, `${this.urls[ambiente]}/nfse/${encodeURIComponent(corpo.chaveAcesso)}`, 'GET');
    const nota = this.json(n) as { nfseXmlGZipB64?: string } | null;
    if (n.status !== 200 || !nota?.nfseXmlGZipB64) throw new Error(`Consulta da NFS-e falhou (HTTP ${n.status}).`);
    const xml = descomprimir(nota.nfseXmlGZipB64);
    return { chaveAcesso: corpo.chaveAcesso, numeroNfse: numeroDoXml(xml), xmlNfse: xml };
  }

  async registrarEvento(cred: CredencialNfse, ambiente: AmbienteNfse, chave: string, pedido: string): Promise<ResultadoEvento> {
    let r: Resposta;
    try {
      r = await this.chamar(cred, `${this.urls[ambiente]}/nfse/${encodeURIComponent(chave)}/eventos`, 'POST', { pedidoRegistroEventoXmlGZipB64: comprimir(pedido) });
    } catch (e) {
      return { ok: false, temporaria: true, status: null, mensagem: this.falhaDeRede(e) };
    }
    if (r.status >= 200 && r.status < 300) return { ok: true };
    const { texto } = mensagemDosErros(this.json(r));
    return { ok: false, temporaria: r.status >= 500, status: r.status, mensagem: texto || `A Sefin recusou o cancelamento (HTTP ${r.status}).` };
  }

}
