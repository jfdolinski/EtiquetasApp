import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { formatarCnpj, type CodigoPermissao, type EmpresaResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta } from './ui';

interface ItemMenu {
  para: string;
  rotulo: string;
  permissao?: CodigoPermissao;
  superAdmin?: boolean;
}

const MENU: ItemMenu[] = [
  { para: '/', rotulo: 'Início' },
  { para: '/empresas', rotulo: 'Empresas', superAdmin: true },
  { para: '/usuarios', rotulo: 'Usuários', permissao: 'usuario.ver' },
  { para: '/perfis', rotulo: 'Perfis e permissões', permissao: 'perfil.ver' },
  { para: '/agentes', rotulo: 'Agentes', permissao: 'agente.ver' },
  { para: '/bancos', rotulo: 'Bancos de dados', permissao: 'agente.ver' },
  { para: '/consultas', rotulo: 'Consultas SQL', permissao: 'sql.ver' },
  { para: '/minha-conta', rotulo: 'Minha conta' },
];

function SeletorEmpresa() {
  const { empresaId, selecionarEmpresa } = useAuth();
  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => api<EmpresaResumo[]>('/empresas'),
  });

  return (
    <select
      value={empresaId ?? ''}
      onChange={(e) => selecionarEmpresa(e.target.value || null)}
      className="max-w-64 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      aria-label="Empresa em que você está operando"
    >
      <option value="">Selecione uma empresa…</option>
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nomeFantasia || e.razaoSocial} · {formatarCnpj(e.cnpj)}
        </option>
      ))}
    </select>
  );
}

export function Layout() {
  const { usuario, sair, pode, aviso } = useAuth();
  if (!usuario) return null;

  const itens = MENU.filter((i) => (i.superAdmin ? usuario.superAdmin : !i.permissao || pode(i.permissao)));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="px-5 py-4">
          <div className="text-lg font-semibold text-blue-700">Etiquetas</div>
          <div className="truncate text-xs text-slate-500">
            {usuario.superAdmin ? 'Administração da plataforma' : usuario.empresa?.nomeFantasia || usuario.empresa?.razaoSocial}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {itens.map((i) => (
            <NavLink
              key={i.para}
              to={i.para}
              end={i.para === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-100'}`
              }
            >
              {i.rotulo}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
          {usuario.superAdmin && <SeletorEmpresa />}
          <span className="text-sm text-slate-600">{usuario.nome}</span>
          <button type="button" onClick={sair} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">
            Sair
          </button>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">
          {aviso && (
            <div className="mb-4">
              <Alerta tipo="aviso">{aviso}</Alerta>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
