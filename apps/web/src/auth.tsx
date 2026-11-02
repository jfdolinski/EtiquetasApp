import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CodigoPermissao, LoginDesafio, LoginResposta, UsuarioLogado } from '@etiquetas/shared';
import { api, ErroApi, EVENTO_SESSAO_EXPIRADA, sessao } from './api';

const TENTATIVAS_SESSAO = 5;
const ESPERA_SESSAO_MS = 3000;

interface ContextoAuth {
  usuario: UsuarioLogado | null;
  carregando: boolean;
  aviso: string | null;
  /** Devolve false quando falta o código da verificação em duas etapas. */
  entrar(email: string, senha: string, codigo?: string): Promise<boolean>;
  recarregarUsuario(): Promise<void>;
  sair(): void;
  pode(permissao: CodigoPermissao): boolean;
  /** Empresa em que a tela opera: a do usuário ou a escolhida pelo super-admin. */
  empresaId: string | null;
  selecionarEmpresa(id: string | null): void;
}

const Contexto = createContext<ContextoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const cliente = useQueryClient();
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(null);
  const [carregando, setCarregando] = useState(Boolean(sessao.token()));
  const [aviso, setAviso] = useState<string | null>(null);
  const [empresaSelecionada, setEmpresaSelecionada] = useState(sessao.empresa());

  const sair = useCallback(() => {
    sessao.definirToken(null);
    sessao.definirEmpresa(null);
    setEmpresaSelecionada(null);
    setUsuario(null);
    setAviso(null);
    cliente.clear();
  }, [cliente]);

  useEffect(() => {
    if (!sessao.token()) return;
    let ativo = true;
    // Só a recusa do servidor encerra a sessão. Rede fora ou API reiniciando (publicação) não
    // pode deslogar ninguém: tenta de novo e, se não voltar, o token fica para a próxima visita.
    const carregar = async () => {
      for (let tentativa = 0; tentativa < TENTATIVAS_SESSAO && ativo; tentativa++) {
        try {
          const u = await api<UsuarioLogado>('/auth/me');
          if (ativo) setUsuario(u);
          return;
        } catch (e) {
          if (e instanceof ErroApi && e.status < 500) {
            if (ativo) sair();
            return;
          }
          await new Promise((r) => setTimeout(r, ESPERA_SESSAO_MS));
        }
      }
    };
    void carregar().finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [sair]);

  useEffect(() => {
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, sair);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, sair);
  }, [sair]);

  const entrar = useCallback(async (email: string, senha: string, codigo?: string) => {
    const r = await api<LoginResposta | LoginDesafio>('/auth/login', { metodo: 'POST', corpo: { email, senha, codigo: codigo || undefined } });
    if ('precisaCodigo' in r) return false;
    sessao.definirToken(r.token);
    if (!r.usuario.superAdmin) {
      sessao.definirEmpresa(null);
      setEmpresaSelecionada(null);
    }
    setUsuario(r.usuario);
    setAviso(r.aviso);
    return true;
  }, []);

  const recarregarUsuario = useCallback(async () => {
    setUsuario(await api<UsuarioLogado>('/auth/me'));
  }, []);

  const selecionarEmpresa = useCallback(
    (id: string | null) => {
      sessao.definirEmpresa(id);
      setEmpresaSelecionada(id);
      cliente.removeQueries({ predicate: (q) => q.queryKey[0] !== 'empresas' });
    },
    [cliente],
  );

  const valor = useMemo<ContextoAuth>(
    () => ({
      usuario,
      carregando,
      aviso,
      entrar,
      recarregarUsuario,
      sair,
      pode: (p) => Boolean(usuario?.superAdmin || usuario?.permissoes.includes(p)),
      empresaId: usuario?.superAdmin ? empresaSelecionada : (usuario?.empresa?.id ?? null),
      selecionarEmpresa,
    }),
    [usuario, carregando, aviso, entrar, recarregarUsuario, sair, empresaSelecionada, selecionarEmpresa],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): ContextoAuth {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
