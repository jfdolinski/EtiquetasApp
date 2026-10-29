const CHAVE_TOKEN = 'etiquetas.token';
const CHAVE_EMPRESA = 'etiquetas.empresaSelecionada';

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    // Armazenamento indisponível (aba anônima, bloqueio): a sessão dura só até recarregar.
  }
}

export const sessao = {
  token: () => ler(CHAVE_TOKEN),
  definirToken: (t: string | null) => gravar(CHAVE_TOKEN, t),
  /** Empresa em que o super-admin está operando (enviada em X-Empresa-Id). */
  empresa: () => ler(CHAVE_EMPRESA),
  definirEmpresa: (id: string | null) => gravar(CHAVE_EMPRESA, id),
};

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Disparado quando a API responde 401, para o AuthProvider encerrar a sessão. */
export const EVENTO_SESSAO_EXPIRADA = 'etiquetas:sessao-expirada';

/** Baixa um arquivo autenticado (ex.: conteúdo de um trabalho de impressão). */
export async function apiArquivo(caminho: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = sessao.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const empresa = sessao.empresa();
  if (empresa) headers['X-Empresa-Id'] = empresa;
  const resposta = await fetch(`/api${caminho}`, { headers });
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => null);
    throw new ErroApi(resposta.status, dados?.message || 'Erro ao baixar o arquivo.');
  }
  return resposta.blob();
}

export async function api<T>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = sessao.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const empresa = sessao.empresa();
  if (empresa) headers['X-Empresa-Id'] = empresa;
  if (opcoes.corpo !== undefined) headers['Content-Type'] = 'application/json';

  const resposta = await fetch(`/api${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers,
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });

  if (resposta.status === 204) return undefined as T;
  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    if (resposta.status === 401 && token) window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    const msg = dados?.message;
    throw new ErroApi(resposta.status, Array.isArray(msg) ? msg.join(' ') : msg || 'Erro inesperado.');
  }
  return dados as T;
}
