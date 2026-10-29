import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  QUANTIDADE_MAXIMA_ITEM,
  type BuscaAvulsaResposta,
  type ImpressoraResumo,
  type ImprimirResposta,
  type ModeloAvulso,
  type Registro,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { AcompanharTrabalhos } from '../components/Trabalhos';
import { Alerta, Botao, Cabecalho, Selecao } from '../components/ui';

export function Avulsa() {
  return (
    <ExigeEmpresa>
      <EtiquetaAvulsa />
    </ExigeEmpresa>
  );
}

function EtiquetaAvulsa() {
  const { empresaId, pode } = useAuth();
  const { data: modelos = [], isLoading } = useQuery({
    queryKey: ['avulsa-modelos', empresaId],
    queryFn: () => api<ModeloAvulso[]>('/avulsa/modelos'),
  });
  const { data: impressoras = [] } = useQuery({
    queryKey: ['impressoras', empresaId],
    queryFn: () => api<ImpressoraResumo[]>('/impressoras'),
    enabled: pode('impressora.ver'),
  });

  const [modeloId, setModeloId] = useState('');
  const [impressoraId, setImpressoraId] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<BuscaAvulsaResposta | null>(null);
  const [quantidades, setQuantidades] = useState<Record<number, number>>({});
  const [envio, setEnvio] = useState<ImprimirResposta | null>(null);

  const modelo = modelos.find((m) => m.id === modeloId) ?? modelos[0] ?? null;

  const buscar = useMutation({
    mutationFn: () => api<BuscaAvulsaResposta>('/avulsa/buscar', { metodo: 'POST', corpo: { modeloId: modelo!.id, parametros: valores } }),
    onSuccess: (r) => {
      setResultado(r);
      setQuantidades(r.registros.length === 1 ? { 0: 1 } : {});
      setEnvio(null);
    },
  });

  const escolhidos = Object.entries(quantidades).filter(([, q]) => q > 0);
  const imprimir = useMutation({
    mutationFn: () =>
      api<ImprimirResposta>('/avulsa/imprimir', {
        metodo: 'POST',
        corpo: {
          modeloId: modelo!.id,
          impressoraId: impressoraId || undefined,
          itens: escolhidos.map(([i, q]) => ({ registro: resultado!.registros[Number(i)] as Registro, quantidade: q })),
        },
      }),
    onSuccess: setEnvio,
  });

  function enviarBusca(e: FormEvent) {
    e.preventDefault();
    buscar.mutate();
  }

  if (isLoading) return <div className="text-sm text-slate-500">Carregando…</div>;

  return (
    <>
      <Cabecalho titulo="Etiqueta avulsa" descricao="Busca o produto direto no banco do ERP e imprime na hora." />
      {modelos.length === 0 ? (
        <Alerta tipo="info">
          Nenhum modelo pronto para etiqueta avulsa. Crie uma consulta com finalidade “Busca de produto” usando {'{param.busca}'} e vincule-a a um modelo.
        </Alerta>
      ) : (
        <div className="space-y-4">
          <form onSubmit={enviarBusca} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="w-64">
              <Selecao
                rotulo="Modelo"
                value={modelo?.id ?? ''}
                onChange={(e) => {
                  setModeloId(e.target.value);
                  setResultado(null);
                }}
              >
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </Selecao>
            </div>
            {modelo?.parametros.map((p) => (
              <label key={p} className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">{p === 'busca' ? 'Código, EAN ou nome' : p}</span>
                <input
                  autoFocus
                  value={valores[p] ?? ''}
                  onChange={(e) => setValores({ ...valores, [p]: e.target.value })}
                  className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            ))}
            <Botao type="submit" disabled={buscar.isPending || !modelo}>{buscar.isPending ? 'Buscando…' : 'Buscar'}</Botao>
          </form>
          {buscar.error && <Alerta>{buscar.error.message}</Alerta>}

          {resultado && resultado.registros.length === 0 && <Alerta tipo="info">Nenhum produto encontrado.</Alerta>}
          {resultado && resultado.registros.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Etiquetas</th>
                    {resultado.colunas.map((c) => (
                      <th key={c} className="px-4 py-2 text-left font-medium text-slate-600">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resultado.registros.map((r, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          max={QUANTIDADE_MAXIMA_ITEM}
                          value={quantidades[i] ?? 0}
                          onChange={(e) => setQuantidades({ ...quantidades, [i]: Math.max(0, Math.min(QUANTIDADE_MAXIMA_ITEM, Math.floor(e.target.valueAsNumber || 0))) })}
                          className="w-20 rounded border border-slate-300 px-2 py-1"
                          aria-label="Quantidade de etiquetas"
                        />
                      </td>
                      {resultado.colunas.map((c) => (
                        <td key={c} className="px-4 py-2 whitespace-nowrap">{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resultado && resultado.registros.length > 0 && (
            <div className="flex flex-wrap items-end justify-end gap-3">
              {impressoras.length > 0 && (
                <div className="w-72">
                  <Selecao rotulo="Impressora" value={impressoraId} onChange={(e) => setImpressoraId(e.target.value)}>
                    <option value="">Padrão do modelo</option>
                    {impressoras.filter((i) => i.ativo).map((i) => (
                      <option key={i.id} value={i.id}>{i.nome} ({i.linguagem})</option>
                    ))}
                  </Selecao>
                </div>
              )}
              <Botao disabled={imprimir.isPending || escolhidos.length === 0} onClick={() => imprimir.mutate()}>
                {imprimir.isPending ? 'Gerando…' : `Imprimir ${escolhidos.reduce((s, [, q]) => s + q, 0)} etiqueta(s)`}
              </Botao>
            </div>
          )}
          {imprimir.error && <Alerta>{imprimir.error.message}</Alerta>}
          {envio && (
            <div className="space-y-2">
              {envio.avisos.map((a) => (
                <Alerta key={a} tipo="aviso">{a}</Alerta>
              ))}
              <AcompanharTrabalhos ids={envio.trabalhos.map((t) => t.id)} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
