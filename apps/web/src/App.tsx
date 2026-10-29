import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import type { CodigoPermissao } from '@etiquetas/shared';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Agentes } from './pages/Agentes';
import { Bancos } from './pages/Bancos';
import { Empresas } from './pages/Empresas';
import { Inicio } from './pages/Inicio';
import { Login } from './pages/Login';
import { MinhaConta } from './pages/MinhaConta';
import { Perfis } from './pages/Perfis';
import { Usuarios } from './pages/Usuarios';

function Protegida({ children, permissao, superAdmin }: { children: ReactNode; permissao?: CodigoPermissao; superAdmin?: boolean }) {
  const { usuario, pode } = useAuth();
  if (superAdmin && !usuario?.superAdmin) return <Navigate to="/" replace />;
  if (permissao && !pode(permissao)) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Carregando…</div>;
  }
  if (!usuario) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="empresas" element={<Protegida superAdmin><Empresas /></Protegida>} />
        <Route path="usuarios" element={<Protegida permissao="usuario.ver"><Usuarios /></Protegida>} />
        <Route path="perfis" element={<Protegida permissao="perfil.ver"><Perfis /></Protegida>} />
        <Route path="agentes" element={<Protegida permissao="agente.ver"><Agentes /></Protegida>} />
        <Route path="bancos" element={<Protegida permissao="agente.ver"><Bancos /></Protegida>} />
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
