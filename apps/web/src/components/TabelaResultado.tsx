import type { ResultadoConsulta } from '@etiquetas/shared';

/** Linhas devolvidas pelo agente, com o tipo de cada coluna no cabeçalho. */
export function TabelaResultado({ resultado }: { resultado: ResultadoConsulta }) {
  return (
    <>
      <div className="text-xs text-slate-500">
        {resultado.linhas.length} linha(s){resultado.truncado && ' (há mais)'} · {resultado.colunas.length} coluna(s) ·{' '}
        {resultado.duracaoMs} ms
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {resultado.colunas.map((c, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap text-slate-700">
                  {c.nome || <span className="text-red-600">(sem nome)</span>}
                  <div className="font-normal text-slate-400">{c.tipo.toLowerCase()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white font-mono">
            {resultado.linhas.length === 0 && (
              <tr>
                <td colSpan={Math.max(resultado.colunas.length, 1)} className="px-3 py-4 text-center font-sans text-slate-500">
                  Nenhuma linha.
                </td>
              </tr>
            )}
            {resultado.linhas.map((linha, i) => (
              <tr key={i}>
                {linha.map((v, j) => (
                  <td key={j} className="max-w-xs truncate px-3 py-1.5 whitespace-nowrap">
                    {v === null ? <span className="text-slate-400">null</span> : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
