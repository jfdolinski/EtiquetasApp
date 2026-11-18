import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatarCentavos, type ChamadaResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, Selo } from '../../components/ui';

/** Depois de concluída: situação do pagamento, extra (antes de pagar), contestação e avaliação (uma vez). */
export function PosEntrega({ c, gerencia }: { c: ChamadaResumo; gerencia: boolean }) {
  const { pode } = useAuth();
  const cliente = useQueryClient();
  const financeiro = pode('entrega.financeiro');
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [extra, setExtra] = useState(c.extraCentavos ? (c.extraCentavos / 100).toFixed(2).replace('.', ',') : '');
  const [motivo, setMotivo] = useState(c.extraMotivo);
  const recarregar = () => {
    void cliente.invalidateQueries({ queryKey: ['chamada', c.id] });
    void cliente.invalidateQueries({ queryKey: ['entregas-a-pagar'] });
  };
  const avaliar = useMutation({ mutationFn: () => api(`/entregas/chamadas/${c.id}/avaliar`, { metodo: 'POST', corpo: { nota, comentario } }), onSuccess: recarregar });
  const extraCentavos = extra.trim() ? Math.round(Number(extra.trim().replace(/\./g, '').replace(',', '.')) * 100) : 0;
  const salvarExtra = useMutation({ mutationFn: () => api(`/entregas/chamadas/${c.id}/extra`, { metodo: 'POST', corpo: { extraCentavos, motivo } }), onSuccess: recarregar });

  return (
    <div className="space-y-3 rounded-md border border-slate-200 px-3 py-2" data-testid="pos-entrega">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Pagamento ao entregador:</span>
        {c.pagoEm ? <Selo cor="verde">Pago em {c.pagoEm.split('-').reverse().join('/')}</Selo> : <Selo cor="amarelo">A pagar</Selo>}
        <span>{formatarCentavos(c.valorCentavos + c.extraCentavos)}</span>
        {c.extraCentavos > 0 && (
          <span className="text-xs text-slate-500">
            (inclui extra de {formatarCentavos(c.extraCentavos)}: {c.extraMotivo})
          </span>
        )}
      </div>
      {c.contestacao && (
        <div className="text-xs">
          <span className="font-medium text-red-700">Contestação:</span> {c.contestacao.mensagem}
          {c.contestacao.resposta ? <span className="block text-slate-600">Resposta: {c.contestacao.resposta}</span> : <span className="block text-slate-500">Sem resposta ainda (aba Financeiro).</span>}
        </div>
      )}
      {financeiro && !c.pagoEm && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-28">
            <Campo rotulo="Extra (R$)" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
          <div className="min-w-48 flex-1">
            <Campo rotulo="Motivo do extra" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Espera, volta, pedágio" />
          </div>
          <Botao variante="secundario" onClick={() => salvarExtra.mutate()} disabled={salvarExtra.isPending || Number.isNaN(extraCentavos)}>
            Salvar extra
          </Botao>
        </div>
      )}
      {salvarExtra.error && <Alerta>{salvarExtra.error.message}</Alerta>}
      {c.avaliacao ? (
        <div>
          Avaliação:{' '}
          <span aria-label={`${c.avaliacao.nota} de 5`} className="text-amber-500">
            {'★'.repeat(c.avaliacao.nota)}
            <span className="text-slate-300">{'★'.repeat(5 - c.avaliacao.nota)}</span>
          </span>
          {c.avaliacao.comentario && <span className="text-slate-600"> · {c.avaliacao.comentario}</span>}
        </div>
      ) : (
        gerencia && (
          <div className="space-y-2">
            <div className="font-medium">Avaliar {c.entregador?.nome}</div>
            <div className="flex gap-1" role="radiogroup" aria-label="Nota">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={nota === n} aria-label={`${n} estrela${n > 1 ? 's' : ''}`} onClick={() => setNota(n)} className={`text-2xl ${n <= nota ? 'text-amber-500' : 'text-slate-300'}`}>
                  ★
                </button>
              ))}
            </div>
            <Campo rotulo="Comentário (só a empresa vê)" value={comentario} onChange={(e) => setComentario(e.target.value)} />
            {avaliar.error && <Alerta>{avaliar.error.message}</Alerta>}
            <Botao onClick={() => avaliar.mutate()} disabled={!nota || avaliar.isPending}>
              Avaliar
            </Botao>
            <p className="text-xs text-slate-500">A nota entra na ordem da distribuição automática de todas as empresas; o comentário fica só aqui.</p>
          </div>
        )
      )}
    </div>
  );
}
