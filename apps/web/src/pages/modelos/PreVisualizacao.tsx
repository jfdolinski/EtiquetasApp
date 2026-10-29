import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DPIS,
  LINGUAGENS,
  ROTULO_LINGUAGEM,
  type ImpressoraResumo,
  type LayoutEtiqueta,
  type LinguagemImpressora,
  type Registro,
  type SaidaEtiquetas,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao } from '../../components/ui';

const EXTENSAO: Record<LinguagemImpressora, string> = { ZPL: 'zpl', PPLA: 'ppla', PPLB: 'pplb', ESCPOS: 'bin', PDF: 'pdf' };

function bytes(saida: SaidaEtiquetas): Uint8Array {
  if (saida.codificacao === 'texto') return new TextEncoder().encode(saida.conteudo);
  return Uint8Array.from(atob(saida.conteudo), (c) => c.charCodeAt(0));
}

/** Gera a saída do layout em edição com os registros da amostra e mostra/baixa o resultado. */
export function PreVisualizacao({ layout, registros, nome }: { layout: LayoutEtiqueta; registros: Registro[]; nome: string }) {
  const { empresaId, pode } = useAuth();
  const [alvo, setAlvo] = useState<string>('PDF');
  const [dpi, setDpi] = useState(203);
  const { data: impressoras = [] } = useQuery({
    queryKey: ['impressoras', empresaId],
    queryFn: () => api<ImpressoraResumo[]>('/impressoras'),
    enabled: pode('impressora.ver'),
  });

  const gerar = useMutation({
    mutationFn: () => {
      const impressora = impressoras.find((i) => i.id === alvo);
      return api<SaidaEtiquetas>('/modelos/gerar', {
        metodo: 'POST',
        corpo: {
          layout,
          registros: registros.length ? registros : [{}],
          ...(impressora ? { impressoraId: impressora.id } : { linguagem: alvo, dpi }),
        },
      });
    },
  });
  const saida = gerar.data;

  const url = useMemo(() => {
    if (!saida) return null;
    return URL.createObjectURL(new Blob([bytes(saida) as BlobPart], { type: saida.mime }));
  }, [saida]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-0.5 block text-xs font-medium text-slate-600">Gerar para</span>
          <select className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <optgroup label="Linguagem">
              {LINGUAGENS.map((l) => (
                <option key={l} value={l}>{ROTULO_LINGUAGEM[l]}</option>
              ))}
            </optgroup>
            {impressoras.length > 0 && (
              <optgroup label="Impressora cadastrada">
                {impressoras.filter((i) => i.ativo).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome} · {i.linguagem} {i.dpi} dpi
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {LINGUAGENS.includes(alvo as LinguagemImpressora) && alvo !== 'PDF' && (
          <label className="block">
            <span className="mb-0.5 block text-xs font-medium text-slate-600">DPI</span>
            <select className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {DPIS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        )}
        <Botao variante="secundario" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
          {gerar.isPending ? 'Gerando…' : `Gerar ${registros.length || 1} etiqueta(s)`}
        </Botao>
        {saida && url && (
          <a href={url} download={`${nome || 'etiquetas'}.${EXTENSAO[saida.linguagem]}`} className="text-sm text-blue-700 hover:underline">
            Baixar arquivo
          </a>
        )}
      </div>
      {gerar.error && <Alerta>{gerar.error.message}</Alerta>}
      {saida?.avisos.map((a) => (
        <Alerta key={a} tipo="aviso">{a}</Alerta>
      ))}
      {saida && url && saida.linguagem === 'PDF' && <iframe title="PDF gerado" src={url} className="h-[28rem] w-full rounded border border-slate-200" />}
      {saida && saida.codificacao === 'texto' && (
        <pre className="max-h-80 overflow-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">
          {saida.conteudo.replace(/\x02/g, '<STX>').slice(0, 20_000)}
        </pre>
      )}
      {saida?.linguagem === 'ESCPOS' && <p className="text-sm text-slate-600">ESC/POS é binário: use “Baixar arquivo” para enviar à impressora.</p>}
    </div>
  );
}
