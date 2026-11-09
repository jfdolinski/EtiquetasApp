import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { CodigoPermissao } from '@etiquetas/shared';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Agentes } from './pages/Agentes';
import { Bancos } from './pages/Bancos';
import { Consultas } from './pages/Consultas';
import { EditorConsulta } from './pages/EditorConsulta';
import { Assinatura } from './pages/Assinatura';
import { Auditoria } from './pages/Auditoria';
import { Avulsa } from './pages/Avulsa';
import { Cobranca } from './pages/cobranca/Cobranca';
import { Empresas } from './pages/Empresas';
import { EditorErp } from './pages/erps/EditorErp';
import { Erps } from './pages/erps/Erps';
import { Agendamentos } from './pages/Agendamentos';
import { Banidos } from './pages/Banidos';
import { Historico } from './pages/Historico';
import { Hoje } from './pages/Hoje';
import { Impressoras } from './pages/Impressoras';
import { Modelos } from './pages/modelos/Modelos';
import { Inicio } from './pages/Inicio';
import { Cadastro } from './pages/Cadastro';
import { EsqueciSenha, RedefinirSenha } from './pages/EsqueciSenha';
import { Login } from './pages/Login';
import { MinhaConta } from './pages/MinhaConta';
import { Notificacoes } from './pages/Notificacoes';
import { Perfis } from './pages/Perfis';
import { Banners } from './pages/Banners';
import { Posts } from './pages/posts/Posts';
import { Referencias } from './pages/Referencias';
import { Saude } from './pages/Saude';
import { Usuarios } from './pages/Usuarios';

import { Pedidos } from './pages/pedidos/Pedidos';
import { Telas } from './pages/telas/Telas';
import { VincularTela } from './pages/telas/VincularTela';

// Konva e bwip-js são pesados: o editor só é baixado quando aberto.
const EditorModelo = lazy(() => import('./pages/modelos/EditorModelo').then((m) => ({ default: m.EditorModelo })));
const EditorPost = lazy(() => import('./pages/posts/EditorPost').then((m) => ({ default: m.EditorPost })));
const PlayerTv = lazy(() => import('./pages/telas/PlayerTv').then((m) => ({ default: m.PlayerTv })));

function Protegida({ children, permissao, superAdmin }: { children: ReactNode; permissao?: CodigoPermissao; superAdmin?: boolean }) {
  const { usuario, pode } = useAuth();
  if (superAdmin && !usuario?.superAdmin) return <Navigate to="/" replace />;
  if (permissao && !pode(permissao)) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const { usuario, carregando } = useAuth();
  const { pathname } = useLocation();

  // A TV não faz login: o link é o mesmo para todas as empresas, e quem define a tela é quem lê o QR.
  if (pathname === '/tv') {
    return (
      <Suspense fallback={<div className="h-screen w-screen bg-slate-950" />}>
        <PlayerTv />
      </Suspense>
    );
  }

  if (carregando) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Carregando…</div>;
  }
  if (!usuario) {
    return (
      <Routes>
        <Route path="cadastro" element={<Cadastro />} />
        <Route path="esqueci-senha" element={<EsqueciSenha />} />
        <Route path="redefinir-senha" element={<RedefinirSenha />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="empresas" element={<Protegida superAdmin><Empresas /></Protegida>} />
        <Route path="erps" element={<Protegida superAdmin><Erps /></Protegida>} />
        <Route path="erps/:id" element={<Protegida superAdmin><EditorErp /></Protegida>} />
        <Route path="cobranca" element={<Protegida superAdmin><Cobranca /></Protegida>} />
        <Route path="banners" element={<Protegida superAdmin><Banners /></Protegida>} />
        <Route path="saude" element={<Protegida superAdmin><Saude /></Protegida>} />
        <Route path="assinatura" element={<Protegida permissao="empresa.ver"><Assinatura /></Protegida>} />
        <Route path="usuarios" element={<Protegida permissao="usuario.ver"><Usuarios /></Protegida>} />
        <Route path="perfis" element={<Protegida permissao="perfil.ver"><Perfis /></Protegida>} />
        <Route path="agentes" element={<Protegida permissao="agente.ver"><Agentes /></Protegida>} />
        <Route path="bancos" element={<Protegida permissao="agente.ver"><Bancos /></Protegida>} />
        <Route path="consultas" element={<Protegida permissao="sql.ver"><Consultas /></Protegida>} />
        <Route path="referencias" element={<Protegida permissao="sql.ver"><Referencias /></Protegida>} />
        <Route path="consultas/:id" element={<Protegida permissao="sql.ver"><EditorConsulta /></Protegida>} />
        <Route path="modelos" element={<Protegida permissao="etiqueta.modelo.ver"><Modelos /></Protegida>} />
        <Route path="modelos/:id" element={<Protegida permissao="etiqueta.modelo.ver"><Suspense fallback={<div className="text-sm text-slate-500">Carregando editor…</div>}><EditorModelo /></Suspense></Protegida>} />
        <Route path="posts" element={<Protegida permissao="post.ver"><Posts /></Protegida>} />
        <Route path="posts/novo" element={<Protegida permissao="post.editar"><Suspense fallback={<div className="text-sm text-slate-500">Carregando editor…</div>}><EditorPost /></Suspense></Protegida>} />
        <Route path="posts/:id" element={<Protegida permissao="post.ver"><Suspense fallback={<div className="text-sm text-slate-500">Carregando editor…</div>}><EditorPost /></Suspense></Protegida>} />
        <Route path="pedidos" element={<Protegida permissao="pedido.configurar"><Pedidos /></Protegida>} />
        <Route path="telas" element={<Protegida permissao="tela.ver"><Telas /></Protegida>} />
        <Route path="telas/vincular" element={<Protegida permissao="tela.editar"><VincularTela /></Protegida>} />
        <Route path="impressoras" element={<Protegida permissao="impressora.ver"><Impressoras /></Protegida>} />
        <Route path="hoje" element={<Protegida permissao="imprimir"><Hoje /></Protegida>} />
        <Route path="avulsa" element={<Protegida permissao="imprimir"><Avulsa /></Protegida>} />
        <Route path="historico" element={<Protegida permissao="imprimir"><Historico /></Protegida>} />
        <Route path="banidos" element={<Protegida permissao="produto_banido.ver"><Banidos /></Protegida>} />
        <Route path="agendamentos" element={<Protegida permissao="agendamento.ver"><Agendamentos /></Protegida>} />
        <Route path="notificacoes" element={<Protegida permissao="notificacao.ver"><Notificacoes /></Protegida>} />
        <Route path="auditoria" element={<Protegida permissao="auditoria.ver"><Auditoria /></Protegida>} />
        <Route path="minha-conta" element={<MinhaConta />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
