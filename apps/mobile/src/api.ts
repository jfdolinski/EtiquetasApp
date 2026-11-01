import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';

export interface Sessao {
  servidor: string;
  token: string;
  empresaId: string;
  usuario: UsuarioLogado;
}

const CHAVE = 'etiquetas.sessao';

// O cofre do aparelho não existe no navegador, usado só para desenvolver as telas.
const cofre =
  Platform.OS === 'web'
    ? {
        getItemAsync: async (k: string) => localStorage.getItem(k),
        setItemAsync: async (k: string, v: string) => localStorage.setItem(k, v),
        deleteItemAsync: async (k: string) => localStorage.removeItem(k),
      }
    : SecureStore;

export async function lerSessao(): Promise<Sessao | null> {
  const texto = await cofre.getItemAsync(CHAVE);
  if (!texto) return null;
  try {
    return JSON.parse(texto) as Sessao;
  } catch {
    return null;
  }
}

export const gravarSessao = (s: Sessao) => cofre.setItemAsync(CHAVE, JSON.stringify(s));
export const apagarSessao = () => cofre.deleteItemAsync(CHAVE);

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Sem internet ou servidor fora: não é motivo para desvincular o celular. */
export const semConexao = (e: unknown) => e instanceof ErroApi && e.status === 0;

async function pedir<T>(servidor: string, caminho: string, opcoes: { metodo?: string; corpo?: unknown; token?: string; empresaId?: string }): Promise<T> {
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), 60_000);
  let resposta: Response;
  try {
    resposta = await fetch(`${servidor}/api${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      signal: controle.signal,
      headers: {
        ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
        ...(opcoes.empresaId ? { 'X-Empresa-Id': opcoes.empresaId } : {}),
      },
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  } finally {
    clearTimeout(limite);
  }
  if (resposta.status === 204) return undefined as T;
  const dados = (await resposta.json().catch(() => null)) as { message?: string | string[] } | null;
  if (!resposta.ok) {
    const m = dados?.message;
    throw new ErroApi(resposta.status, Array.isArray(m) ? m.join(' ') : m || 'Erro inesperado.');
  }
  return dados as T;
}

export function clienteDa(sessao: Sessao, aoExpirar: () => void) {
  return async function api<T>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
    try {
      return await pedir<T>(sessao.servidor, caminho, { ...opcoes, token: sessao.token, empresaId: sessao.empresaId });
    } catch (e) {
      // 401 aqui é sempre definitivo: aparelho desvinculado ou usuário desativado.
      if (e instanceof ErroApi && e.status === 401) aoExpirar();
      throw e;
    }
  };
}

export type Api = ReturnType<typeof clienteDa>;

export function vincular(servidor: string, codigo: string, nome: string, plataforma: 'ANDROID' | 'IOS', versao: string) {
  return pedir<{ token: string; empresaId: string; usuario: UsuarioLogado }>(servidor, '/app/vincular', { metodo: 'POST', corpo: { codigo, nome, plataforma, versao } });
}

/** Versão do aplicativo publicada no servidor; null se não der para saber. */
export async function versaoPublicada(servidor: string): Promise<string | null> {
  try {
    const r = await fetch(`${servidor}/downloads/app-versao.txt`);
    return r.ok ? (await r.text()).trim() : null;
  } catch {
    return null;
  }
}
