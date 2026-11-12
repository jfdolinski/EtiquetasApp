import { BadRequestException, Injectable } from '@nestjs/common';
import { createSign } from 'node:crypto';
import lerXlsx from 'read-excel-file/node';
import { ErroPlanilha, lerChaveDrive, lerCsv, tabelaDeLinhas, type ArquivoPlanilha, type TabelaPlanilha } from '@etiquetas/shared';

const API = 'https://www.googleapis.com/drive/v3';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const ESCOPO = 'https://www.googleapis.com/auth/drive.readonly';
const TEMPO_LIMITE_MS = 30_000;
const TAMANHO_MAXIMO = 50 * 1024 * 1024;
/** Busca por código repetida: confere se o arquivo mudou no Drive no máximo a cada 30 s. */
const VALIDADE_CACHE_MS = 30_000;
const ARQUIVOS_EM_CACHE = 8;

const PLANILHA_GOOGLE = 'application/vnd.google-apps.spreadsheet';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV = 'text/csv';

interface AbasLidas {
  modificadoEm: string;
  conferidoEm: number;
  abas: Map<string, TabelaPlanilha>;
}

function base64url(dados: string | Buffer): string {
  return Buffer.from(dados).toString('base64url');
}

/** Lê planilhas de uma pasta do Google Drive com a conta de serviço da conexão (só leitura). */
@Injectable()
export class GoogleDriveService {
  private readonly tokens = new Map<string, { token: string; validoAte: number }>();
  private readonly cache = new Map<string, AbasLidas>();

  /** Planilhas diretamente na pasta. */
  async listar(chaveJson: string, pastaId: string): Promise<ArquivoPlanilha[]> {
    const tipos = [PLANILHA_GOOGLE, XLSX, CSV].map((m) => `mimeType='${m}'`).join(' or ');
    const arquivos: ArquivoPlanilha[] = [];
    let pagina: string | undefined;
    do {
      // pastaId vem de pastaDriveDoLink: só letras, números, _ e -.
      const params = new URLSearchParams({
        q: `'${pastaId}' in parents and trashed=false and (${tipos})`,
        fields: 'nextPageToken,files(id,name,size,modifiedTime)',
        orderBy: 'name',
        pageSize: '200',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pagina) params.set('pageToken', pagina);
      const r = (await (await this.pedir(chaveJson, `${API}/files?${params}`)).json()) as {
        nextPageToken?: string;
        files: { id: string; name: string; size?: string; modifiedTime?: string }[];
      };
      for (const f of r.files) arquivos.push({ id: f.id, nome: f.name, tamanho: f.size ? Number(f.size) : null, modificadoEm: f.modifiedTime ?? null });
      pagina = r.nextPageToken;
    } while (pagina && arquivos.length < 2000);
    return arquivos;
  }

  /** Abas do arquivo, relendo só quando ele mudou. Recusa arquivo fora da pasta da conexão. */
  async ler(conexaoId: string, chaveJson: string, pastaId: string, arquivoId: string): Promise<Map<string, TabelaPlanilha>> {
    const chave = `${conexaoId}/${arquivoId}`;
    const guardado = this.cache.get(chave);
    if (guardado && Date.now() - guardado.conferidoEm < VALIDADE_CACHE_MS) return guardado.abas;

    const params = new URLSearchParams({ fields: 'id,mimeType,modifiedTime,parents,size,trashed', supportsAllDrives: 'true' });
    const id = encodeURIComponent(arquivoId);
    const info = (await (await this.pedir(chaveJson, `${API}/files/${id}?${params}`)).json()) as {
      mimeType: string;
      modifiedTime: string;
      parents?: string[];
      size?: string;
      trashed?: boolean;
    };
    if (info.trashed || !(await this.estaNaPasta(chaveJson, pastaId, arquivoId, info.parents))) throw new BadRequestException('Este arquivo não está mais na pasta da conexão.');
    if (guardado && guardado.modificadoEm === info.modifiedTime) {
      guardado.conferidoEm = Date.now();
      return guardado.abas;
    }

    const endereco =
      info.mimeType === PLANILHA_GOOGLE
        ? `${API}/files/${id}/export?mimeType=${encodeURIComponent(XLSX)}`
        : `${API}/files/${id}?alt=media&supportsAllDrives=true`;
    const dados = await this.baixar(chaveJson, endereco);
    const abas = await this.interpretar(info.mimeType, dados);
    if (this.cache.size >= ARQUIVOS_EM_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(chave, { modificadoEm: info.modifiedTime, conferidoEm: Date.now(), abas });
    return abas;
  }

  /**
   * O Google nem sempre devolve `parents` (arquivo compartilhado pela pasta, Drive compartilhado):
   * sem a pasta ali, confere pela listagem da pasta, a mesma que mostrou o arquivo na tela.
   */
  private async estaNaPasta(chaveJson: string, pastaId: string, arquivoId: string, pais: string[] | undefined): Promise<boolean> {
    if (pais?.includes(pastaId)) return true;
    return (await this.listar(chaveJson, pastaId)).some((a) => a.id === arquivoId);
  }

  private async interpretar(mimeType: string, dados: Buffer): Promise<Map<string, TabelaPlanilha>> {
    const abas = new Map<string, TabelaPlanilha>();
    try {
      if (mimeType === CSV) {
        abas.set('CSV', tabelaDeLinhas(lerCsv(dados.toString('utf-8'))));
        return abas;
      }
      for (const a of await lerXlsx(dados)) {
        // Aba vazia não impede ler as outras.
        if (a.data.some((l) => l.some((v) => v !== null))) abas.set(a.sheet, tabelaDeLinhas(a.data as unknown[][]));
      }
    } catch (erro) {
      if (erro instanceof ErroPlanilha) throw new BadRequestException(erro.message);
      throw new BadRequestException('Não foi possível ler esta planilha do Drive.');
    }
    if (abas.size === 0) throw new BadRequestException('A planilha está vazia.');
    return abas;
  }

  private async baixar(chaveJson: string, endereco: string): Promise<Buffer> {
    const r = await this.pedir(chaveJson, endereco);
    if (Number(r.headers.get('content-length') ?? 0) > TAMANHO_MAXIMO) throw new BadRequestException('A planilha passa de 50 MB.');
    const dados = Buffer.from(await r.arrayBuffer());
    if (dados.byteLength > TAMANHO_MAXIMO) throw new BadRequestException('A planilha passa de 50 MB.');
    return dados;
  }

  private async pedir(chaveJson: string, endereco: string): Promise<Response> {
    const conta = this.conta(chaveJson);
    const token = await this.token(chaveJson);
    let r: Response;
    try {
      r = await fetch(endereco, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch {
      throw new BadRequestException('Não foi possível acessar o Google Drive agora. Tente de novo.');
    }
    if (r.status === 403 || r.status === 404) {
      const detalhe = await r.text();
      if (detalhe.includes('accessNotConfigured') || detalhe.includes('SERVICE_DISABLED')) {
        throw new BadRequestException('A API do Google Drive não está ativada no projeto desta conta de serviço.');
      }
      throw new BadRequestException(`O Google Drive negou o acesso: compartilhe a pasta com ${conta.email} como Leitor.`);
    }
    if (!r.ok) throw new BadRequestException(`O Google Drive respondeu ${r.status}.`);
    return r;
  }

  private conta(chaveJson: string) {
    try {
      return lerChaveDrive(chaveJson);
    } catch (erro) {
      throw new BadRequestException((erro as Error).message);
    }
  }

  /** Token de acesso com o JWT assinado pela chave. O endereço é fixo, nunca o que vem no JSON. */
  private async token(chaveJson: string): Promise<string> {
    const conta = this.conta(chaveJson);
    const guardado = this.tokens.get(chaveJson);
    if (guardado && guardado.validoAte > Date.now() + 60_000) return guardado.token;

    const agora = Math.floor(Date.now() / 1000);
    const corpo = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({ iss: conta.email, scope: ESCOPO, aud: URL_TOKEN, iat: agora, exp: agora + 3600 }),
    )}`;
    let assinatura: Buffer;
    try {
      assinatura = createSign('RSA-SHA256').update(corpo).sign(conta.chavePrivada);
    } catch {
      throw new BadRequestException('A chave privada da conta de serviço é inválida.');
    }
    let r: Response;
    try {
      r = await fetch(URL_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${corpo}.${base64url(assinatura)}` }),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch {
      throw new BadRequestException('Não foi possível acessar o Google agora. Tente de novo.');
    }
    if (!r.ok) throw new BadRequestException('O Google recusou a chave da conta de serviço. Confira se ela não foi revogada.');
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.tokens.set(chaveJson, { token: j.access_token, validoAte: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }
}
