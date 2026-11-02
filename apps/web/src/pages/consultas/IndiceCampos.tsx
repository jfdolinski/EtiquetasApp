import { useQuery } from '@tanstack/react-query';
import { colunaDaReferencia, ROTULO_FINALIDADE, type FinalidadeConsulta, type ReferenciaCampo } from '@etiquetas/shared';
import { api } from '../../api';

export function useReferencias() {
  return useQuery({ queryKey: ['referencias'], queryFn: () => api<ReferenciaCampo[]>('/referencias'), select: (l) => l.filter((r) => r.ativa) });
}

/**
 * Índice de campos ao lado do SQL. Clicar insere `AS alias` no cursor. Com as colunas lidas,
 * mostra o que a consulta já traz; sem elas (`colunas` nulo), não afirma nada.
 */
export function IndiceCampos({ referencias, finalidade, colunas, aoInserir }: { referencias: ReferenciaCampo[]; finalidade: FinalidadeConsulta; colunas: string[] | null; aoInserir: ((alias: string) => void) | null }) {
  const obrigatoria = (r: ReferenciaCampo) => r.obrigatoriaEm.includes(finalidade);
  const obrigatorias = referencias.filter(obrigatoria);
  const opcionais = referencias.filter((r) => !obrigatoria(r));

  const linha = (r: ReferenciaCampo) => {
    const coluna = colunas ? colunaDaReferencia(r, colunas) : null;
    const falta = colunas !== null && coluna === null && obrigatoria(r);
    const titulo = [r.descricao, r.exemplo && `Ex.: ${r.exemplo}`, r.alternativos.length ? `Também aceita: ${r.alternativos.join(', ')}` : ''].filter(Boolean).join('\n');
    const conteudo = (
      <>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm">{r.alias}</span>
          {coluna !== null && <span className="shrink-0 text-xs font-medium text-green-700">✓ {coluna === r.alias ? 'na consulta' : coluna}</span>}
          {falta && <span className="shrink-0 text-xs font-medium text-red-700">Falta</span>}
        </span>
        <span className="block truncate text-xs text-slate-500">{r.nome}</span>
      </>
    );
    return (
      <li key={r.id}>
        {aoInserir ? (
          <button type="button" title={titulo} aria-label={`Inserir AS ${r.alias}: ${r.nome}`} onClick={() => aoInserir(r.alias)} className="block w-full px-4 py-1.5 text-left hover:bg-slate-50">
            {conteudo}
          </button>
        ) : (
          <div title={titulo} className="px-4 py-1.5">{conteudo}</div>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Índice de campos</h2>
        <p className="text-xs text-slate-500">{aoInserir ? 'Clique para inserir o alias depois da coluna: coluna AS alias.' : 'Dê à coluna da planilha um destes títulos.'}</p>
      </div>
      {obrigatorias.length > 0 && (
        <>
          <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-500">Obrigatórios em {ROTULO_FINALIDADE[finalidade]}</p>
          <ul className="pb-1">{obrigatorias.map(linha)}</ul>
        </>
      )}
      <details open={obrigatorias.length === 0} className="border-t border-slate-100">
        <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase text-slate-500">Opcionais ({opcionais.length})</summary>
        <ul className="max-h-80 overflow-y-auto pb-1">{opcionais.map(linha)}</ul>
      </details>
    </div>
  );
}
