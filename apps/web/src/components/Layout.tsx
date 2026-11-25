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
  /** Grupo do menu: com quase 30 itens, o título do grupo diz onde procurar. */
  grupo: string;
}

const MENU: ItemMenu[] = [
  { para: '/', rotulo: 'Início', grupo: '' },
  { para: '/hoje', rotulo: 'Lista do dia', permissao: 'imprimir', grupo: 'Etiquetas' },
  { para: '/avulsa', rotulo: 'Etiqueta avulsa', permissao: 'imprimir', grupo: 'Etiquetas' },
  { para: '/historico', rotulo: 'Histórico de impressão', permissao: 'imprimir', grupo: 'Etiquetas' },
  { para: '/agendamentos', rotulo: 'Agendamentos', permissao: 'agendamento.ver', grupo: 'Etiquetas' },
  { para: '/banidos', rotulo: 'Produtos banidos', permissao: 'produto_banido.ver', grupo: 'Etiquetas' },
  { para: '/modelos', rotulo: 'Modelos de etiqueta', permissao: 'etiqueta.modelo.ver', grupo: 'Etiquetas' },
  { para: '/impressoras', rotulo: 'Impressoras', permissao: 'impressora.ver', grupo: 'Etiquetas' },
  { para: '/pedidos', rotulo: 'Pedidos', permissao: 'pedido.ver', grupo: 'Vendas' },
  { para: '/entregas', rotulo: 'Entregas', permissao: 'entrega.ver', grupo: 'Vendas' },
  { para: '/posts', rotulo: 'Posts', permissao: 'post.ver', grupo: 'Vendas' },
  { para: '/telas', rotulo: 'Telas', permissao: 'tela.ver', grupo: 'Vendas' },
  { para: '/agentes', rotulo: 'Agentes', permissao: 'agente.ver', grupo: 'Dados do ERP' },
  { para: '/bancos', rotulo: 'Conexões de dados', permissao: 'agente.ver', grupo: 'Dados do ERP' },
  { para: '/consultas', rotulo: 'Consultas SQL', permissao: 'sql.ver', grupo: 'Dados do ERP' },
  { para: '/referencias', rotulo: 'Índice de campos', permissao: 'sql.ver', grupo: 'Dados do ERP' },
  { para: '/empresas', rotulo: 'Empresas', superAdmin: true, grupo: 'Plataforma' },
  { para: '/erps', rotulo: 'Sistemas ERP', superAdmin: true, grupo: 'Plataforma' },
  { para: '/cobranca', rotulo: 'Cobrança', superAdmin: true, grupo: 'Plataforma' },
  { para: '/banners', rotulo: 'Banners', superAdmin: true, grupo: 'Plataforma' },
  { para: '/entregadores', rotulo: 'Entregadores', superAdmin: true, grupo: 'Plataforma' },
  { para: '/saude', rotulo: 'Saúde do sistema', superAdmin: true, grupo: 'Plataforma' },
  { para: '/usuarios', rotulo: 'Usuários', permissao: 'usuario.ver', grupo: 'Equipe e conta' },
  { para: '/perfis', rotulo: 'Perfis e permissões', permissao: 'perfil.ver', grupo: 'Equipe e conta' },
  { para: '/assinatura', rotulo: 'Assinatura', permissao: 'empresa.ver', grupo: 'Equipe e conta' },
  { para: '/notificacoes', rotulo: 'Notificações', permissao: 'notificacao.ver', grupo: 'Equipe e conta' },
  { para: '/auditoria', rotulo: 'Auditoria', permissao: 'auditoria.ver', grupo: 'Equipe e conta' },
  { para: '/minha-conta', rotulo: 'Minha conta', grupo: 'Equipe e conta' },
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
      className="max-w-64 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
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
    <Link to="/notificacoes" className="relative rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" aria-label={n ? `Notificações: ${n} sem ler` : 'Notificações'} title="Notificações">
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

  const grupos = itens.reduce<{ titulo: string; itens: ItemMenu[] }[]>((lista, i) => {
    const ultimo = lista[lista.length - 1];
    if (ultimo && ultimo.titulo === i.grupo) ultimo.itens.push(i);
    else lista.push({ titulo: i.grupo, itens: [i] });
    return lista;
  }, []);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-grafite text-slate-300 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight text-white">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            Flow
          </div>
          <div className="mt-1 truncate text-xs text-slate-400">
            {usuario.superAdmin ? 'Administração da plataforma' : usuario.empresa?.nomeFantasia || usuario.empresa?.razaoSocial}
          </div>
        </div>
        <nav aria-label="Menu" className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:gap-0 md:overflow-visible">
          {grupos.map((g) => (
            <div key={g.titulo || 'inicio'} className="contents md:mb-3 md:block">
              {g.titulo && <div className="hidden px-3 pt-2 pb-1 font-display text-xs font-semibold text-slate-500 md:block">{g.titulo}</div>}
              {g.itens.map((i) => (
                <NavLink
                  key={i.para}
                  to={i.para}
                  end={i.para === '/'}
                  className={({ isActive }) =>
                    `flex items-center whitespace-nowrap px-3 py-1.5 font-display text-[0.9rem] font-medium md:my-px ${isActive ? 'etiqueta-ativa' : 'rounded-md text-slate-300 hover:bg-grafite-claro hover:text-white'}`
                  }
                >
                  {i.rotulo}
                  {pendencias[i.para] > 0 && (
                    <span className="ml-auto rounded-full bg-white px-1.5 text-[11px] font-semibold leading-4 text-blue-700" title="Aguardando aprovação">{pendencias[i.para]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-8">
          <Relogio />
          {usuario.superAdmin && <SeletorEmpresa />}
          <Sino />
          <span className="text-sm font-medium text-slate-700">{usuario.nome}</span>
          <button type="button" onClick={sair} className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">
            Sair
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-7 sm:px-8">
          <BannerCobranca />
          <BannerPublicidade />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
