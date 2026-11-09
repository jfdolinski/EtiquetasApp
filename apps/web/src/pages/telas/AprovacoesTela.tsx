import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diferencasDaProposta, LIMITE_MOTIVO_RECUSA, modeloUsaConsulta, ROTULO_MODELO_CONTEUDO, type ConteudoParaAprovar, type PerfilTelaResumo, type PreviaConteudoResposta, type TelaResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, formatarData } from '../../components/ui';
import { formularioDe, PreVisualizacao } from './ConteudosTela';

/** O que espera decisão. Uma linha por pedido: abrir mostra a tela como vai ficar, com os dados de verdade. */
export function AprovacoesTela({ pedidos }: { pedidos: ConteudoParaAprovar[] }) {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const aberto = pedidos.find((p) => p.id === abertoId);
  if (aberto) return <DecidirPedido key={aberto.aprovacao!.versao} pedido={aberto} aoFechar={() => setAbertoId(null)} />;
  if (pedidos.length === 0) return <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Nada esperando aprovação.</p>;
  return (
    <ul className="space-y-2">
      {pedidos.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{p.aprovacao!.proposta!.nome}</div>
            <div className="text-xs text-slate-500">
              {ROTULO_MODELO_CONTEUDO[p.aprovacao!.proposta!.modelo].titulo} · {p.publicado ? 'mudança em conteúdo no ar' : 'conteúdo novo'} · enviado por {p.aprovacao!.pedidaPorNome ?? 'usuário removido'} em {formatarData(p.aprovacao!.versao)}
            </div>
          </div>
          <Botao variante="secundario" onClick={() => setAbertoId(p.id)}>Ver e decidir</Botao>
        </li>
      ))}
    </ul>
  );
}

function DecidirPedido({ pedido, aoFechar }: { pedido: ConteudoParaAprovar; aoFechar: () => void }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const aprovacao = pedido.aprovacao!;
  const proposta = aprovacao.proposta!;
  const f = formularioDe(proposta);
  const comConsulta = modeloUsaConsulta(proposta.modelo);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const { data: perfis = [] } = useQuery({ queryKey: ['telas-perfis'], queryFn: () => api<PerfilTelaResumo[]>('/telas/perfis') });
  const { data: telas = [] } = useQuery({ queryKey: ['telas', empresaId], queryFn: () => api<TelaResumo[]>('/telas') });
  // Consulta o banco do cliente: uma vez por pedido aberto, não a cada foco na janela.
  const previa = useQuery({
    queryKey: ['telas-aprovacao-previa', pedido.id, aprovacao.versao],
    queryFn: () => api<PreviaConteudoResposta>(`/telas/conteudos/${pedido.id}/aprovacao/previa`, { metodo: 'POST' }),
    enabled: comConsulta,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const decidir = useMutation({
    mutationFn: (corpo: { caminho: 'aprovar' | 'recusar'; motivo?: string }) => api(`/telas/conteudos/${pedido.id}/aprovacao/${corpo.caminho}`, { metodo: 'POST', corpo: { versao: aprovacao.versao, ...(corpo.motivo ? { motivo: corpo.motivo } : {}) } }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['telas-aprovacoes', empresaId] });
      void cliente.invalidateQueries({ queryKey: ['telas-conteudos', empresaId] });
      aoFechar();
    },
    // Reenviado ou decidido por outra pessoa: a lista precisa mostrar o que vale agora.
    onError: () => void cliente.invalidateQueries({ queryKey: ['telas-aprovacoes', empresaId] }),
  });

  const nomesDasTelas = proposta.telaIds.map((id) => telas.find((t) => t.id === id)?.nome).filter(Boolean);
  const mudancas = pedido.publicado ? diferencasDaProposta(pedido, proposta) : [];
  const vigencia = [proposta.horarioInicio && `das ${proposta.horarioInicio} às ${proposta.horarioFim}`, proposta.dataInicio && `a partir de ${proposta.dataInicio}`, proposta.dataFim && `até ${proposta.dataFim}`].filter(Boolean).join(', ');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-slate-900">{proposta.nome}</h2>
          <p className="text-sm text-slate-500">{ROTULO_MODELO_CONTEUDO[proposta.modelo].titulo}</p>
        </div>
        <dl className="space-y-2 text-sm">
          <div><dt className="text-xs text-slate-500">Enviado por</dt><dd className="text-slate-900">{aprovacao.pedidaPorNome ?? 'usuário removido'}, em {formatarData(aprovacao.versao)}</dd></div>
          <div><dt className="text-xs text-slate-500">Telas</dt><dd className="text-slate-900">{nomesDasTelas.join(', ') || 'Nenhuma disponível'}</dd></div>
          <div><dt className="text-xs text-slate-500">Quando passa</dt><dd className="text-slate-900">{vigencia || 'Sempre'}</dd></div>
          {pedido.publicado && (
            <div>
              <dt className="text-xs text-slate-500">O que muda em relação ao que está no ar</dt>
              <dd className="text-slate-900">{mudancas.join(', ') || 'Nada: é igual ao que está no ar'}</dd>
            </div>
          )}
        </dl>
        {comConsulta && <p className="text-xs text-slate-500">Você aprova o desenho e as regras. Os preços vêm da consulta e seguem atualizando sozinhos, sem nova aprovação.</p>}
        {pedido.impedimento && <Alerta tipo="aviso">{pedido.impedimento}</Alerta>}
        {decidir.error && <Alerta>{(decidir.error as Error).message}</Alerta>}
        {recusando ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700" htmlFor="motivo-recusa">O que precisa mudar</label>
            <textarea id="motivo-recusa" rows={3} maxLength={LIMITE_MOTIVO_RECUSA} value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="secundario" onClick={() => setRecusando(false)}>Voltar</Botao>
              <Botao disabled={motivo.trim().length < 3 || decidir.isPending} onClick={() => decidir.mutate({ caminho: 'recusar', motivo: motivo.trim() })}>{decidir.isPending ? 'Recusando…' : 'Confirmar recusa'}</Botao>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Botao variante="secundario" onClick={aoFechar}>Voltar</Botao>
            <Botao variante="secundario" disabled={!!pedido.impedimento || decidir.isPending} onClick={() => setRecusando(true)}>Recusar</Botao>
            <Botao disabled={!!pedido.impedimento || decidir.isPending} onClick={() => decidir.mutate({ caminho: 'aprovar' })}>{decidir.isPending ? 'Publicando…' : 'Aprovar e publicar'}</Botao>
          </div>
        )}
      </div>
      <PreVisualizacao f={f} comConsulta={comConsulta} perfis={perfis} previa={previa.data ?? null} carregando={previa.isFetching} erro={previa.error as Error | null} />
    </div>
  );
}
