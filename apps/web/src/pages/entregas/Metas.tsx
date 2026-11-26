import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarCentavos, problemaNaMeta, ROTULO_SITUACAO_META, textoDaFaixa, type MetaResumo, type NovaMeta } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, Selo } from '../../components/ui';
import { centavosDoTexto } from './Avarias';

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Metas com bônus: N chamadas concluídas no período (e, se quiser, só no horário de pico) rendem
 * o bônus. Quando a meta acaba, o Flow conta sozinho e o bônus de quem chegou lá entra no Financeiro.
 */
export function Metas() {
  const { pode } = useAuth();
  const gerencia = pode('entrega.gerenciar');
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: ['entregas-metas'], queryFn: () => api<MetaResumo[]>('/entregas/metas'), refetchInterval: 60_000 });
  const guardar = (r: MetaResumo[]) => cliente.setQueryData(['entregas-metas'], r);
  const cancelar = useMutation({ mutationFn: (id: string) => api<MetaResumo[]>(`/entregas/metas/${id}/cancelar`, { metodo: 'POST' }), onSuccess: guardar });

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-slate-600">
        Crie metas para os entregadores: quem concluir o número de chamadas desta empresa no período ganha o bônus. Use o horário de pico para premiar quem trabalha nas horas mais cheias. O app mostra o progresso de cada um e, quando a meta acaba, o bônus de quem chegou lá entra sozinho no Financeiro, para pagar junto com as chamadas.
      </p>
      {gerencia && <NovaMetaForm aoCriar={guardar} />}
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      {cancelar.error && <Alerta>{cancelar.error.message}</Alerta>}
      {lista.data && !lista.data.length && <p className="text-sm text-slate-500">Nenhuma meta criada.</p>}
      <div className="space-y-3">
        {lista.data?.map((m) => (
          <div key={m.id} className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm" data-testid="meta">
            <div className="flex flex-wrap items-center gap-3">
              <strong className="text-base">{m.nome}</strong>
              <Selo cor={m.situacao === 'EM_ANDAMENTO' ? 'verde' : m.situacao === 'AGENDADA' ? 'amarelo' : 'cinza'}>{ROTULO_SITUACAO_META[m.situacao]}</Selo>
              <span className="text-slate-600">
                {m.minimoChamadas} chamadas = {formatarCentavos(m.valorCentavos)}
              </span>
              <span className="text-slate-600">
                {data(m.inicio)} a {data(m.fim)}, {textoDaFaixa(m.faixa)}
              </span>
              {gerencia && (m.situacao === 'EM_ANDAMENTO' || m.situacao === 'AGENDADA') && (
                <button type="button" className="ml-auto text-red-700 underline" disabled={cancelar.isPending} onClick={() => confirm('Cancelar esta meta? Ninguém recebe o bônus dela.') && cancelar.mutate(m.id)}>
                  Cancelar meta
                </button>
              )}
            </div>
            {m.situacao === 'ENCERRADA' && m.apuradaEm && (
              <p className="text-slate-600">
                Apurada: {m.participantes.filter((p) => p.atingida).length} {m.participantes.filter((p) => p.atingida).length === 1 ? 'entregador ganhou' : 'entregadores ganharam'} o bônus ({formatarCentavos(m.participantes.filter((p) => p.atingida).length * m.valorCentavos)} no Financeiro).
              </p>
            )}
            {m.situacao === 'ENCERRADA' && !m.apuradaEm && <p className="text-slate-500">Contando as chamadas… o bônus entra no Financeiro em instantes.</p>}
            {m.participantes.length === 0 ? (
              <div className="text-slate-500">Nenhuma chamada contou ainda.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {m.participantes.map((p) => (
                  <li key={p.entregadorId} className="flex flex-wrap items-center gap-3 py-1.5" data-testid="participante-meta">
                    <span className="w-32 font-medium">{p.nome}</span>
                    <div className="h-2 w-40 overflow-hidden rounded bg-slate-100">
                      <div className={`h-full ${p.atingida ? 'bg-green-600' : 'bg-blue-600'}`} style={{ width: `${Math.min(100, (p.feitas / m.minimoChamadas) * 100)}%` }} />
                    </div>
                    <span className="text-slate-600">
                      {p.feitas} de {m.minimoChamadas}
                    </span>
                    {p.atingida && <Selo cor="verde">Chegou lá</Selo>}
                    {p.pago && <span className="text-slate-500">pago</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NovaMetaForm({ aoCriar }: { aoCriar: (r: MetaResumo[]) => void }) {
  const [nome, setNome] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [minimo, setMinimo] = useState('20');
  const [valor, setValor] = useState('');
  const [pico, setPico] = useState(false);
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5]);
  const [picoInicio, setPicoInicio] = useState('11:00');
  const [picoFim, setPicoFim] = useState('14:00');
  const ini = inicio ? new Date(`${inicio}T00:00`) : null;
  const fimData = fim ? new Date(`${fim}T23:59:59`) : null;
  const corpo: NovaMeta | null = ini && fimData ? { nome, inicio: ini.toISOString(), fim: fimData.toISOString(), minimoChamadas: Number(minimo), valorCentavos: centavosDoTexto(valor), faixa: pico ? { dias, inicio: picoInicio, fim: picoFim } : null } : null;
  const problema = corpo ? problemaNaMeta(corpo, new Date()) : null;
  const criar = useMutation({
    mutationFn: () => api<MetaResumo[]>('/entregas/metas', { metodo: 'POST', corpo }),
    onSuccess: (r) => {
      aoCriar(r);
      setNome('');
    },
  });
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <h2 className="text-base font-semibold">Nova meta</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Ex.: Semana cheia" />
        <Campo rotulo="Do dia" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        <Campo rotulo="Até o dia" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        <Campo rotulo="Chamadas concluídas" type="number" min={1} max={500} value={minimo} onChange={(e) => setMinimo(e.target.value)} />
        <Campo rotulo="Bônus (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="50,00" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pico} onChange={(e) => setPico(e.target.checked)} /> Só contam as chamadas no horário de pico
      </label>
      {pico && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1" role="group" aria-label="Dias do horário de pico">
            {DIAS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={dias.includes(i)}
                onClick={() => setDias((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i].sort()))}
                className={`rounded border px-2 py-1 text-xs ${dias.includes(i) ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-500'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <Campo rotulo="Das" type="time" value={picoInicio} onChange={(e) => setPicoInicio(e.target.value)} />
          <Campo rotulo="Às" type="time" value={picoFim} onChange={(e) => setPicoFim(e.target.value)} />
        </div>
      )}
      <p className="text-xs text-slate-500">Contam as chamadas concluídas desta empresa, por entregador. Chamada cancelada não conta. O bônus é pago a cada um que chegar lá.</p>
      {problema && <Alerta tipo="aviso">{problema}</Alerta>}
      {criar.error && <Alerta>{criar.error.message}</Alerta>}
      <Botao onClick={() => criar.mutate()} disabled={!corpo || !!problema || criar.isPending}>
        {criar.isPending ? 'Criando…' : 'Criar meta'}
      </Botao>
    </section>
  );
}
