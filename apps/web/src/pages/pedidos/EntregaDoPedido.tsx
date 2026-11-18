import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pedidoPodeChamarEntregador,
  ROTULO_SITUACAO_CHAMADA,
  SITUACOES_FINAIS,
  type ChamadaResumo,
  type ConfigEntregasEmpresa,
  type ConfigMapa,
  type EnderecoPedido,
  type ModalidadeEntrega,
  type RascunhoDoPedido,
  type SituacaoPedido,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao } from '../../components/ui';
import { NovaChamadaModal } from '../entregas/Chamadas';

type Pedido = { id: string; situacao: SituacaoPedido; modalidade: ModalidadeEntrega; endereco: EnderecoPedido | null };

/** No pedido com entrega: chamar um entregador do módulo Entregas e ver as chamadas dele. */
export function EntregaDoPedido({ p }: { p: Pedido }) {
  const { pode } = useAuth();
  const cliente = useQueryClient();
  const [abrir, setAbrir] = useState<{ rascunho: RascunhoDoPedido; config: ConfigEntregasEmpresa; mapa: ConfigMapa } | null>(null);
  const ve = pode('entrega.ver');
  const chamadas = useQuery({ queryKey: ['chamadas-do-pedido', p.id], queryFn: () => api<ChamadaResumo[]>(`/entregas/chamadas?pedidoId=${p.id}`), enabled: ve, refetchInterval: 15_000 });
  const preparar = useMutation({
    mutationFn: async () => {
      const [rascunho, cfg] = await Promise.all([api<RascunhoDoPedido>(`/entregas/pedidos/${p.id}/rascunho`), api<{ config: ConfigEntregasEmpresa; mapa: ConfigMapa }>('/entregas/config')]);
      return { rascunho, config: cfg.config, mapa: cfg.mapa };
    },
    onSuccess: setAbrir,
  });
  if (!ve) return null;
  const ativa = chamadas.data?.find((c) => !SITUACOES_FINAIS.includes(c.situacao));
  const podeChamar = pode('entrega.gerenciar') && pedidoPodeChamarEntregador(p) && !ativa;
  if (!chamadas.data?.length && !podeChamar) return null;

  return (
    <div className="space-y-2 rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="entrega-do-pedido">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Entregador</span>
        {podeChamar && (
          <Botao variante="secundario" onClick={() => preparar.mutate()} disabled={preparar.isPending}>
            {preparar.isPending ? 'Preparando…' : 'Chamar entregador'}
          </Botao>
        )}
      </div>
      {preparar.error && <Alerta>{preparar.error.message}</Alerta>}
      {chamadas.data?.map((c) => (
        <div key={c.id} className="text-slate-700">
          Chamada nº {c.numero}: {ROTULO_SITUACAO_CHAMADA[c.situacao]}
          {c.entregador ? ` · ${c.entregador.nome}` : c.ofertaPendente ? ` · oferecida a ${c.ofertaPendente.entregadorNome}` : ''}
          <span className="text-xs text-slate-500"> (acompanhe em Entregas)</span>
        </div>
      ))}
      {abrir && (
        <NovaChamadaModal
          config={abrir.config}
          mapa={abrir.mapa}
          rascunho={abrir.rascunho}
          aoFechar={() => setAbrir(null)}
          aoCriar={() => {
            setAbrir(null);
            void cliente.invalidateQueries({ queryKey: ['chamadas-do-pedido', p.id] });
          }}
        />
      )}
    </div>
  );
}
