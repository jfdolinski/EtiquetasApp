import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet } from 'react-router';
import { formatarCnpj, type CadastrosPendentes, type CodigoPermissao, type EmpresaResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { BannerCobranca } from './BannerCobranca';
import { BannerPublicidade } from './BannerPublicidade';
import { Relogio } from './Relogio';

interface ItemMenu {
  para: string;
  rotulo: string;
  permissao?: CodigoPermissao;
  superAdmin?: boolean;
}

const MENU: ItemMenu[] = [
  { para: '/', rotulo: 'Início' },
  { para: '/hoje', rotulo: 'Lista do dia', permissao: 'imprimir' },
  { para: '/avulsa', rotulo: 'Etiqueta avulsa', permissao: 'imprimir' },
  { para: '/historico', rotulo: 'Histórico de impressão', permissao: 'imprimir' },
  { para: '/agendamentos', rotulo: 'Agendamentos', permissao: 'agendamento.ver' },
  { para: '/banidos', rotulo: 'Produtos banidos', permissao: 'produto_banido.ver' },
  { para: '/posts', rotulo: 'Posts', permissao: 'post.ver' },
  { para: '/telas', rotulo: 'Telas', permissao: 'tela.ver' },
  { para: '/empresas', rotulo: 'Empresas', superAdmin: true },
  { para: '/erps', rotulo: 'Sistemas ERP', superAdmin: true },
  { para: '/cobranca', rotulo: 'Cobrança', superAdmin: true },
  { para: '/banners', rotulo: 'Banners', superAdmin: true },
  { para: '/saude', rotulo: 'Saúde do sistema', superAdmin: true },
  { para: '/usuarios', rotulo: 'Usuários', permissao: 'usuario.ver' },
  { para: '/perfis', rotulo: 'Perfis e permissões', permissao: 'perfil.ver' },
  { para: '/agentes', rotulo: 'Agentes', permissao: 'agente.ver' },
  { para: '/bancos', rotulo: 'Conexões de dados', permissao: 'agente.ver' },
  { para: '/consultas', rotulo: 'Consultas SQL', permissao: 'sql.ver' },
  { para: '/referencias', rotulo: 'Índice de campos', permissao: 'sql.ver' },
  { para: '/modelos', rotulo: 'Modelos de etiqueta', permissao: 'etiqueta.modelo.ver' },
  { para: '/impressoras', rotulo: 'Impressoras', permissao: 'impressora.ver' },
  { para: '/assinatura', rotulo: 'Assinatura', permissao: 'empresa.ver' },
  { para: '/notificacoes', rotulo: 'Notificações', permissao: 'notificacao.ver' },
  { para: '/auditoria', rotulo: 'Auditoria', permissao: 'auditoria.ver' },
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

function Sino() {
  const { empresaId, pode } = useAuth();
  const { data } = useQuery({
    queryKey: ['notificacoes-nao-lidas', empresaId],
    queryFn: () => api<{ quantidade: number }>('/notificacoes/nao-lidas'),
    enabled: !!empresaId && pode('notificacao.ver'),
    refetchInterval: 60_000,
  });
  if (!empresaId || !pode('notificacao.ver')) return null;
  const n = data?.quantidade ?? 0;
  return (
    <Link to="/notificacoes" className="relative rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" aria-label={n ? `Notificações: ${n} sem ler` : 'Notificações'} title="Notificações">
      🔔
      {n > 0 && <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-4 text-white">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}

/** Quantos pedidos do "Cadastre-se" esperam por quem está logado, em cada item do menu. */
function usePendencias(): Record<string, number> {
  const { usuario, empresaId, pode } = useAuth();
  const podeAprovar = !!empresaId && pode('usuario.editar');
  const { data: usuarios } = useQuery({
    queryKey: ['usuarios-pendentes', empresaId],
    queryFn: () => api<{ quantidade: number }>('/usuarios/pendentes/contagem'),
    enabled: podeAprovar,
    refetchInterval: 60_000,
  });
  const { data: plataforma } = useQuery({
    queryKey: ['cadastros-pendentes'],
    queryFn: () => api<CadastrosPendentes>('/cadastros/pendentes'),
    enabled: !!usuario?.superAdmin,
    refetchInterval: 60_000,
  });
  return {
    '/usuarios': podeAprovar ? (usuarios?.quantidade ?? 0) : 0,
    '/empresas': (plataforma?.empresas.length ?? 0) + (plataforma?.usuarios.length ?? 0),
  };
}

export function Layout() {
  const { usuario, sair, pode } = useAuth();
  const pendencias = usePendencias();
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
              {pendencias[i.para] > 0 && (
                <span className="ml-2 rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-4 text-white" title="Aguardando aprovação">{pendencias[i.para]}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
          <Relogio />
          {usuario.superAdmin && <SeletorEmpresa />}
          <Sino />
          <span className="text-sm text-slate-600">{usuario.nome}</span>
          <button type="button" onClick={sair} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">
            Sair
          </button>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">
          <BannerCobranca />
          <BannerPublicidade />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
