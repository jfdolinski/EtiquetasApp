import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarCentavos, ROTULO_SITUACAO_NOTA, type NotaResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao } from '../../components/ui';

/** Nota fiscal (NFS-e) do pedido concluído: situação e, sem nota, o botão para emitir. */
export function NotaDoPedido({ pedidoId, concluido }: { pedidoId: string; concluido: boolean }) {
  const { pode } = useAuth();
  const cliente = useQueryClient();
  const chave = ['nfse-pedido', pedidoId];
  const nota = useQuery({
    queryKey: chave,
    queryFn: () => api<{ nota: NotaResumo | null }>(`/nfse/pedidos/${pedidoId}`),
    enabled: pode('nfse.ver') && concluido,
    refetchInterval: (q) => (q.state.data?.nota && ['PENDENTE', 'PROCESSANDO'].includes(q.state.data.nota.situacao) ? 3_000 : false),
  });
  const emitir = useMutation({
    mutationFn: () => api<NotaResumo>(`/nfse/pedidos/${pedidoId}/nota`, { metodo: 'POST' }),
    onSuccess: (n) => cliente.setQueryData(chave, { nota: n }),
  });
  if (!pode('nfse.ver') || !concluido || nota.isLoading) return null;
  const n = nota.data?.nota;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm" data-testid="nota-do-pedido">
      <p className="font-semibold">Nota fiscal de serviço</p>
      {n ? (
        <p>
          {ROTULO_SITUACAO_NOTA[n.situacao]}
          {n.numeroNfse && ` · NFS-e nº ${n.numeroNfse}`} · {formatarCentavos(n.valorCentavos)}
          {n.situacao === 'ERRO' && n.erro && <span className="block text-xs text-red-700">{n.erro}</span>}
          <a href="/notas-fiscais" className="ml-2 text-xs text-blue-700 underline">
            Ver em Notas fiscais
          </a>
        </p>
      ) : (
        <>
          <p className="text-slate-600">Este pedido ainda não tem nota.</p>
          {pode('nfse.emitir') && (
            <Botao variante="secundario" onClick={() => emitir.mutate()} disabled={emitir.isPending}>
              Emitir nota do pedido
            </Botao>
          )}
        </>
      )}
      {emitir.error && <Alerta>{emitir.error.message}</Alerta>}
    </div>
  );
}
