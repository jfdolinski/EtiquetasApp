import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CodigoPermissao, LoginResposta, UsuarioLogado } from '@etiquetas/shared';
import { api, EVENTO_SESSAO_EXPIRADA, sessao } from './api';

interface ContextoAuth {
  usuario: UsuarioLogado | null;
  carregando: boolean;
  aviso: string | null;
  entrar(email: string, senha: string): Promise<void>;
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
    api<UsuarioLogado>('/auth/me')
      .then(setUsuario)
      .catch(() => sair())
      .finally(() => setCarregando(false));
  }, [sair]);

  useEffect(() => {
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, sair);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, sair);
  }, [sair]);

  const entrar = useCallback(async (email: string, senha: string) => {
    const r = await api<LoginResposta>('/auth/login', { metodo: 'POST', corpo: { email, senha } });
    sessao.definirToken(r.token);
    if (!r.usuario.superAdmin) {
      sessao.definirEmpresa(null);
      setEmpresaSelecionada(null);
    }
    setUsuario(r.usuario);
    setAviso(r.aviso);
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
      sair,
      pode: (p) => Boolean(usuario?.superAdmin || usuario?.permissoes.includes(p)),
      empresaId: usuario?.superAdmin ? empresaSelecionada : (usuario?.empresa?.id ?? null),
      selecionarEmpresa,
    }),
    [usuario, carregando, aviso, entrar, sair, empresaSelecionada, selecionarEmpresa],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): ContextoAuth {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
