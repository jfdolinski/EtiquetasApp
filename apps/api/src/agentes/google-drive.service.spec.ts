import { generateKeyPairSync } from 'node:crypto';
import { GoogleDriveService } from './google-drive.service';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CHAVE = JSON.stringify({
  type: 'service_account',
  client_email: 'etiquetas@projeto.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://mal.exemplo/token',
});
const PASTA = 'pasta123';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

function simularGoogle(rotas: (url: string) => Response) {
  const chamadas: string[] = [];
  const espiao = jest.spyOn(global, 'fetch').mockImplementation(async (entrada) => {
    const url = String(entrada);
    chamadas.push(url);
    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'tok', expires_in: 3600 });
    return rotas(url);
  });
  return { chamadas, espiao };
}

afterEach(() => jest.restoreAllMocks());

const CSV = 'text/csv';

describe('GoogleDriveService', () => {
  it('lista só a pasta da conexão, com o token fixo do Google (ignora token_uri do JSON)', async () => {
    const { chamadas } = simularGoogle(() => json({ files: [{ id: 'a1', name: 'Preços', modifiedTime: '2026-11-01T10:00:00Z' }] }));
    const r = await new GoogleDriveService().listar(CHAVE, PASTA);
    expect(r).toEqual([{ id: 'a1', nome: 'Preços', tamanho: null, modificadoEm: '2026-11-01T10:00:00Z' }]);
    expect(chamadas[0]).toBe('https://oauth2.googleapis.com/token');
    expect(decodeURIComponent(chamadas[1].replace(/\+/g, ' '))).toContain(`'${PASTA}' in parents and trashed=false`);
    expect(chamadas.some((u) => u.includes('mal.exemplo'))).toBe(false);
  });

  it('acesso negado explica com qual e-mail compartilhar', async () => {
    simularGoogle(() => json({ error: { message: 'File not found' } }, 404));
    await expect(new GoogleDriveService().listar(CHAVE, PASTA)).rejects.toThrow(/compartilhe a pasta com etiquetas@projeto/);
  });

  it('recusa arquivo que não está na pasta da conexão e não baixa', async () => {
    const { chamadas } = simularGoogle((url) => (url.includes('/files?') ? json({ files: [{ id: 'b2', name: 'Outro' }] }) : json({ mimeType: CSV, modifiedTime: 'x', parents: ['outra'] })));
    await expect(new GoogleDriveService().ler('c1', CHAVE, PASTA, 'a1')).rejects.toThrow(/não está mais na pasta/);
    expect(chamadas.some((u) => u.includes('alt=media'))).toBe(false);
  });

  it('sem parents na resposta do Google, confere pela listagem da pasta', async () => {
    simularGoogle((url) => {
      if (url.includes('alt=media')) return new Response('EAN;Preço\n0789;4,99\n');
      if (url.includes('/files?')) return json({ files: [{ id: 'a1', name: 'produtos.xlsx' }] });
      return json({ mimeType: CSV, modifiedTime: 't1' });
    });
    const abas = await new GoogleDriveService().ler('c1', CHAVE, PASTA, 'a1');
    expect([...abas.keys()]).toEqual(['CSV']);
  });

  it('lê CSV e só baixa de novo quando o arquivo muda', async () => {
    let modificado = 't1';
    let downloads = 0;
    simularGoogle((url) => {
      if (url.includes('alt=media')) {
        downloads++;
        return new Response('EAN;Preço\n0789;4,99\n');
      }
      return json({ mimeType: CSV, modifiedTime: modificado, parents: [PASTA] });
    });
    const drive = new GoogleDriveService();
    const abas = await drive.ler('c1', CHAVE, PASTA, 'a1');
    expect(abas.get('CSV')).toEqual({ colunas: ['ean', 'preco'], linhas: [['0789', '4.99']] });

    const agora = Date.now();
    const relogio = jest.spyOn(Date, 'now');
    relogio.mockReturnValue(agora + 1000);
    await drive.ler('c1', CHAVE, PASTA, 'a1');
    relogio.mockReturnValue(agora + 40_000);
    await drive.ler('c1', CHAVE, PASTA, 'a1');
    expect(downloads).toBe(1);

    modificado = 't2';
    relogio.mockReturnValue(agora + 80_000);
    await drive.ler('c1', CHAVE, PASTA, 'a1');
    expect(downloads).toBe(2);
  });

  it('planilha do Google é exportada; arquivo inválido vira mensagem', async () => {
    const { chamadas } = simularGoogle((url) => {
      if (url.includes('/export')) return new Response('isto não é xlsx');
      return json({ mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: 't', parents: [PASTA] });
    });
    await expect(new GoogleDriveService().ler('c1', CHAVE, PASTA, 'a1')).rejects.toThrow(/Não foi possível ler/);
    expect(chamadas.some((u) => u.includes('/export?mimeType='))).toBe(true);
  });
});
