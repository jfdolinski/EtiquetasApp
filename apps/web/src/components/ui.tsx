import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

type Variante = 'primario' | 'secundario' | 'perigo';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
  secundario: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  perigo: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
};

export function Botao({ variante = 'primario', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTES[variante]} ${className}`}
      {...props}
    />
  );
}

const CLASSE_CAMPO =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100';

export function Campo({ rotulo, ajuda, ...props }: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; ajuda?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{rotulo}</span>
      <input className={CLASSE_CAMPO} {...props} />
      {ajuda && <span className="mt-1 block text-xs text-slate-500">{ajuda}</span>}
    </label>
  );
}

export function Selecao({ rotulo, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{rotulo}</span>
      <select className={CLASSE_CAMPO} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Alerta({ tipo = 'erro', children }: { tipo?: 'erro' | 'aviso' | 'info'; children: ReactNode }) {
  const cores = {
    erro: 'border-red-200 bg-red-50 text-red-800',
    aviso: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
  };
  return <div className={`rounded-md border px-4 py-3 text-sm ${cores[tipo]}`}>{children}</div>;
}

export function Modal({ titulo, aberto, aoFechar, children }: { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label={titulo} className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <button type="button" onClick={aoFechar} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Cabecalho({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-slate-500">{descricao}</p>}
      </div>
      {acoes}
    </div>
  );
}

export function Selo({ cor, children }: { cor: 'verde' | 'amarelo' | 'vermelho' | 'cinza'; children: ReactNode }) {
  const cores = {
    verde: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    amarelo: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    vermelho: 'bg-red-50 text-red-700 ring-red-600/20',
    cinza: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cores[cor]}`}>{children}</span>;
}

export function Tabela({ colunas, children, vazio }: { colunas: string[]; children: ReactNode; vazio?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {colunas.map((c) => (
              <th key={c} className="px-4 py-2.5 text-left font-medium text-slate-600">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {vazio ? (
            <tr>
              <td colSpan={colunas.length} className="px-4 py-8 text-center text-slate-500">
                Nenhum registro.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
