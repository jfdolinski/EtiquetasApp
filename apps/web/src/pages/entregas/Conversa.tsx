import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITE_MENSAGEM, type MensagemChamada } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao } from '../../components/ui';

type Conversa = { mensagens: MensagemChamada[]; podeEscrever: boolean };

/** Conversa com o entregador dentro da chamada: nenhum lado vê o celular do outro. */
export function ConversaDaChamada({ chamadaId, gerencia }: { chamadaId: string; gerencia: boolean }) {
  const cliente = useQueryClient();
  const chave = ['conversa', chamadaId];
  const { data, error } = useQuery({ queryKey: chave, queryFn: () => api<Conversa>(`/entregas/chamadas/${chamadaId}/mensagens`), refetchInterval: 8_000 });
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const enviar = useMutation({
    mutationFn: () => api<Conversa>(`/entregas/chamadas/${chamadaId}/mensagens`, { metodo: 'POST', corpo: { texto } }),
    onSuccess: (c) => {
      setTexto('');
      cliente.setQueryData(chave, c);
      void cliente.invalidateQueries({ queryKey: ['chamadas'] });
    },
  });
  const n = data?.mensagens.length ?? 0;
  useEffect(() => fim.current?.scrollIntoView({ block: 'nearest' }), [n]);
  const aoEnviar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim()) enviar.mutate();
  };

  return (
    <div className="rounded-xl border border-slate-200" data-testid="conversa">
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Conversa com o entregador</div>
      <div className="max-h-56 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {error && <Alerta>{error.message}</Alerta>}
        {n === 0 && <p className="text-slate-500">Nenhuma mensagem. O que você escrever aparece no app do entregador.</p>}
        {data?.mensagens.map((m) => (
          <div key={m.id} className={`flex ${m.autor === 'empresa' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-1.5 ${m.autor === 'empresa' ? 'bg-blue-50 text-slate-900' : 'bg-slate-100 text-slate-900'}`}>
              <div className="text-xs text-slate-500">
                {m.nome} · {new Date(m.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="whitespace-pre-wrap">{m.texto}</div>
            </div>
          </div>
        ))}
        <div ref={fim} />
      </div>
      {gerencia && data?.podeEscrever && (
        <form onSubmit={aoEnviar} className="flex gap-2 border-t border-slate-200 p-2">
          <input aria-label="Mensagem para o entregador" value={texto} maxLength={LIMITE_MENSAGEM} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva para o entregador" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <Botao type="submit" disabled={!texto.trim() || enviar.isPending}>
            Enviar
          </Botao>
        </form>
      )}
      {enviar.error && <div className="px-3 pb-2"><Alerta>{enviar.error.message}</Alerta></div>}
    </div>
  );
}
