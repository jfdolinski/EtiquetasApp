import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { GRUPOS_ACAO, type EmpresaResumo, type LogAuditoriaResumo, type PaginaAuditoria } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, formatarData } from '../components/ui';

export function Auditoria() {
  const { usuario } = useAuth();
  // Super-admin vê a plataforma toda (com filtro de empresa); a empresa vê só o dela.
  if (usuario?.superAdmin) return <Registro plataforma />;
  return (
    <ExigeEmpresa>
      <Registro plataforma={false} />
    </ExigeEmpresa>
  );
}

interface Filtros {
  acao: string;
  usuario: string;
  de: string;
  ate: string;
  empresaId: string;
}

function Registro({ plataforma }: { plataforma: boolean }) {
  const { empresaId } = useAuth();
  const [rascunho, setRascunho] = useState<Filtros>({ acao: '', usuario: '', de: '', ate: '', empresaId: '' });
  const [filtros, setFiltros] = useState<Filtros>(rascunho);
  const { data: empresas = [] } = useQuery({ queryKey: ['empresas'], queryFn: () => api<EmpresaResumo[]>('/empresas'), enabled: plataforma });

  const consulta = useInfiniteQuery({
    queryKey: ['auditoria', plataforma, empresaId, filtros],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros)) if (v && (plataforma || k !== 'empresaId')) q.set(k, v);
      if (pageParam) q.set('cursor', pageParam);
      q.set('limite', '50');
      return api<PaginaAuditoria>(`/auditoria${plataforma ? '/plataforma' : ''}?${q}`);
    },
    getNextPageParam: (p) => p.proximo ?? undefined,
  });
  const itens = consulta.data?.pages.flatMap((p) => p.itens) ?? [];

  return (
    <>
      <Cabecalho
        titulo="Auditoria"
        descricao={plataforma ? 'Todas as ações registradas na plataforma.' : 'Ações registradas nesta empresa: quem fez o quê e quando.'}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFiltros(rascunho);
        }}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm"
      >
        {plataforma && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Empresa</span>
            <select value={rascunho.empresaId} onChange={(e) => setRascunho({ ...rascunho, empresaId: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5">
              <option value="">Todas</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Tipo de ação</span>
          <select value={rascunho.acao} onChange={(e) => setRascunho({ ...rascunho, acao: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todas</option>
            {GRUPOS_ACAO.map((g) => (
              <option key={g.prefixo} value={g.prefixo}>{g.rotulo}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Usuário</span>
          <input value={rascunho.usuario} onChange={(e) => setRascunho({ ...rascunho, usuario: e.target.value })} placeholder="nome ou e-mail" className="w-48 rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">De</span>
          <input type="date" value={rascunho.de} onChange={(e) => setRascunho({ ...rascunho, de: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Até</span>
          <input type="date" value={rascunho.ate} onChange={(e) => setRascunho({ ...rascunho, ate: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <Botao type="submit" variante="secundario">Filtrar</Botao>
      </form>

      {consulta.error && <Alerta>{consulta.error.message}</Alerta>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2.5 font-medium">Quando</th>
              {plataforma && <th className="px-4 py-2.5 font-medium">Empresa</th>}
              <th className="px-4 py-2.5 font-medium">Usuário</th>
              <th className="px-4 py-2.5 font-medium">Ação</th>
              <th className="px-4 py-2.5 font-medium">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {itens.length === 0 && !consulta.isLoading && (
              <tr>
                <td colSpan={plataforma ? 5 : 4} className="px-4 py-8 text-center text-slate-500">Nenhum registro.</td>
              </tr>
            )}
            {itens.map((l) => (
              <Linha key={l.id} l={l} plataforma={plataforma} />
            ))}
          </tbody>
        </table>
      </div>
      {consulta.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Botao variante="secundario" disabled={consulta.isFetchingNextPage} onClick={() => void consulta.fetchNextPage()}>
            {consulta.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </Botao>
        </div>
      )}
    </>
  );
}

function Linha({ l, plataforma }: { l: LogAuditoriaResumo; plataforma: boolean }) {
  const detalhes = l.detalhes && Object.keys(l.detalhes as object).length ? JSON.stringify(l.detalhes, null, 2) : null;
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatarData(l.criadoEm)}</td>
      {plataforma && <td className="px-4 py-2">{l.empresa?.nome ?? <span className="text-slate-400">Plataforma</span>}</td>}
      <td className="px-4 py-2">{l.usuario ? <span title={l.usuario.email}>{l.usuario.nome}</span> : <span className="text-slate-400">Sistema</span>}</td>
      <td className="px-4 py-2">
        <span className="font-mono text-xs">{l.acao}</span>
        <div className="text-xs text-slate-500">{l.entidade}</div>
      </td>
      <td className="px-4 py-2">
        {detalhes && (
          <details>
            <summary className="cursor-pointer text-xs text-blue-700">ver</summary>
            <pre className="mt-1 max-w-xl overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-xs">{detalhes}</pre>
          </details>
        )}
      </td>
    </tr>
  );
}
