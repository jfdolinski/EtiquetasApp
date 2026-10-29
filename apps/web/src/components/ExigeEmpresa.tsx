import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import { Alerta } from './ui';

/** Telas de dados do tenant: o super-admin precisa escolher a empresa no topo antes. */
export function ExigeEmpresa({ children }: { children: ReactNode }) {
  const { empresaId } = useAuth();
  if (!empresaId) {
    return <Alerta tipo="info">Selecione uma empresa no topo da tela para gerenciar seus dados.</Alerta>;
  }
  return children;
}
