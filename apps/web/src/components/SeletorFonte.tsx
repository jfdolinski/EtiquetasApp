import { useEffect, useRef, useState } from 'react';
import { FONTES, fonteDoCatalogo } from '@etiquetas/shared';
import { cssFonte } from '../pages/modelos/fontes';

const CATEGORIAS = [...new Set(FONTES.map((f) => f.categoria))];

/** Lista de fontes com o nome escrito na própria fonte e busca: com dezenas delas, o select comum não serve. */
export function SeletorFonte({ valor, aoMudar, rotulo = 'Fonte' }: { valor: string | undefined; aoMudar: (id: string) => void; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const caixa = useRef<HTMLDivElement>(null);
  const atual = fonteDoCatalogo(valor);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  const termo = busca.trim().toLowerCase();
  return (
    <div ref={caixa} className="relative">
      <button type="button" aria-label={rotulo} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto(!aberto)} className="flex w-full items-center justify-between rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-sm" style={{ font: cssFonte(atual.id, false, false, 15) }}>
        <span className="truncate">{atual.nome}</span>
        <span aria-hidden="true" className="ml-2 text-xs text-slate-500">▾</span>
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full min-w-56 rounded-md border border-slate-200 bg-white shadow-lg">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setAberto(false)}
            placeholder={`Procurar entre ${FONTES.length} fontes…`}
            aria-label="Procurar fonte"
            className="w-full border-b border-slate-200 px-2 py-1.5 text-sm focus:outline-none"
          />
          <div role="listbox" aria-label={rotulo} className="max-h-72 overflow-y-auto py-1">
            {CATEGORIAS.map((c) => {
              const fontes = FONTES.filter((f) => f.categoria === c && (!termo || f.nome.toLowerCase().includes(termo)));
              if (!fontes.length) return null;
              return (
                <div key={c}>
                  <div className="px-2 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c}</div>
                  {fontes.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="option"
                      aria-selected={f.id === atual.id}
                      onClick={() => {
                        aoMudar(f.id);
                        setAberto(false);
                        setBusca('');
                      }}
                      className={`block w-full truncate px-2 py-1 text-left hover:bg-blue-50 ${f.id === atual.id ? 'bg-blue-50 text-blue-800' : ''}`}
                      style={{ font: cssFonte(f.id, false, false, 17) }}
                    >
                      {f.nome}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
