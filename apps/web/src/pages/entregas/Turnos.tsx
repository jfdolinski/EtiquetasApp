import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatarCentavos,
  HORAS_PARA_SAIR_DO_TURNO,
  MAX_VAGAS_TURNO,
  problemaNoTurno,
  ROTULO_INSCRICAO,
  type NovoTurno,
  type ReputacaoEmpresa,
  type TurnoResumo,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, Selo } from '../../components/ui';
import { centavosDoTexto } from './Avarias';

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Escala de turnos: a empresa abre o horário e as vagas, os entregadores se inscrevem pelo app e,
 * durante o turno, recebem as chamadas desta empresa antes dos outros. Depois, a empresa marca
 * quem esteve presente; com valor, o turno entra no Financeiro.
 */
export function Turnos() {
  const { pode } = useAuth();
  const gerencia = pode('entrega.gerenciar');
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: ['entregas-turnos'], queryFn: () => api<TurnoResumo[]>('/entregas/turnos'), refetchInterval: 30_000 });
  const guardar = (r: TurnoResumo[]) => cliente.setQueryData(['entregas-turnos'], r);
  const acao = useMutation({ mutationFn: ({ caminho, corpo }: { caminho: string; corpo?: unknown }) => api<TurnoResumo[]>(`/entregas/${caminho}`, { metodo: 'POST', corpo }), onSuccess: guardar });
  const agora = Date.now();
  const futuros = (lista.data ?? []).filter((t) => new Date(t.fim).getTime() > agora);
  const passados = (lista.data ?? []).filter((t) => new Date(t.fim).getTime() <= agora).reverse();

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-slate-600">
        Abra turnos com horário e vagas. Os entregadores se inscrevem pelo app e, durante o turno, recebem as chamadas desta empresa antes dos outros. Depois do turno, marque quem esteve presente: com valor, o turno entra no Financeiro para pagar junto com as chamadas. O entregador sai do turno pelo app até {HORAS_PARA_SAIR_DO_TURNO} horas antes de começar.
      </p>
      {gerencia && <NovoTurnoForm aoCriar={guardar} />}
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      {acao.error && <Alerta>{acao.error.message}</Alerta>}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Próximos e em andamento</h2>
        {lista.data && !futuros.length && <p className="text-sm text-slate-500">Nenhum turno aberto.</p>}
        {futuros.map((t) => (
          <CartaoTurno key={t.id} t={t} gerencia={gerencia} acao={(caminho, corpo) => acao.mutate({ caminho, corpo })} ocupado={acao.isPending} />
        ))}
      </section>
      {passados.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Terminados (14 dias)</h2>
          {passados.map((t) => (
            <CartaoTurno key={t.id} t={t} gerencia={gerencia} acao={(caminho, corpo) => acao.mutate({ caminho, corpo })} ocupado={acao.isPending} />
          ))}
        </section>
      )}
    </div>
  );
}

function CartaoTurno({ t, gerencia, acao, ocupado }: { t: TurnoResumo; gerencia: boolean; acao: (caminho: string, corpo?: unknown) => void; ocupado: boolean }) {
  const agora = Date.now();
  const terminou = new Date(t.fim).getTime() <= agora;
  const comecou = new Date(t.inicio).getTime() <= agora;
  const ativos = t.inscritos.filter((i) => i.situacao !== 'SAIU');
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm" data-testid="turno">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-base">
          {dataHora(t.inicio)} às {hora(t.fim)}
        </strong>
        {t.canceladoEm ? <Selo cor="cinza">Cancelado</Selo> : comecou && !terminou ? <Selo cor="verde">Em andamento</Selo> : null}
        <span className="text-slate-600">
          {ativos.length} de {t.vagas} {t.vagas === 1 ? 'vaga' : 'vagas'}
        </span>
        <span className="text-slate-600">{t.valorCentavos ? `${formatarCentavos(t.valorCentavos)} por presente` : 'sem valor (só a prioridade)'}</span>
        {gerencia && !t.canceladoEm && !terminou && (
          <button type="button" className="ml-auto text-red-700 underline" disabled={ocupado} onClick={() => confirm('Cancelar este turno? Os inscritos deixam de ter prioridade.') && acao(`turnos/${t.id}/cancelar`)}>
            Cancelar turno
          </button>
        )}
      </div>
      {t.observacao && <div className="text-slate-600">{t.observacao}</div>}
      {t.inscritos.length === 0 ? (
        <div className="text-slate-500">Ninguém inscrito ainda.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {t.inscritos.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-1.5" data-testid="inscrito">
              <span className="font-medium">{i.nome}</span>
              <Selo cor={i.situacao === 'PRESENTE' ? 'verde' : i.situacao === 'FALTOU' ? 'vermelho' : 'cinza'}>{ROTULO_INSCRICAO[i.situacao]}</Selo>
              {comecou && i.situacao !== 'SAIU' && (
                <span className="text-slate-500">
                  {i.chamadas} {i.chamadas === 1 ? 'chamada concluída' : 'chamadas concluídas'} no turno
                </span>
              )}
              {i.pago && <span className="text-slate-500">pago</span>}
              {gerencia && !t.canceladoEm && (
                <span className="ml-auto flex gap-3">
                  {terminou && i.situacao !== 'SAIU' && !i.pago && (
                    <>
                      <button type="button" className="text-blue-700 underline disabled:text-slate-400" disabled={ocupado || i.situacao === 'PRESENTE'} onClick={() => acao(`turnos/inscricoes/${i.id}/presenca`, { situacao: 'PRESENTE' })}>
                        Presente
                      </button>
                      <button type="button" className="text-blue-700 underline disabled:text-slate-400" disabled={ocupado || i.situacao === 'FALTOU'} onClick={() => acao(`turnos/inscricoes/${i.id}/presenca`, { situacao: 'FALTOU' })}>
                        Faltou
                      </button>
                    </>
                  )}
                  {!comecou && i.situacao === 'INSCRITO' && (
                    <button type="button" className="text-red-700 underline" disabled={ocupado} onClick={() => acao(`turnos/inscricoes/${i.id}/remover`)}>
                      Tirar do turno
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NovoTurnoForm({ aoCriar }: { aoCriar: (r: TurnoResumo[]) => void }) {
  const [dia, setDia] = useState('');
  const [inicio, setInicio] = useState('11:00');
  const [fim, setFim] = useState('15:00');
  const [vagas, setVagas] = useState('3');
  const [valor, setValor] = useState('');
  const [observacao, setObservacao] = useState('');
  // Fim antes do início passa da meia-noite.
  const ini = dia ? new Date(`${dia}T${inicio}`) : null;
  let fimData = dia ? new Date(`${dia}T${fim}`) : null;
  if (ini && fimData && fimData <= ini) fimData = new Date(fimData.getTime() + 86_400_000);
  const corpo: NovoTurno | null = ini && fimData && !Number.isNaN(ini.getTime()) && !Number.isNaN(fimData.getTime()) ? { inicio: ini.toISOString(), fim: fimData.toISOString(), vagas: Number(vagas), valorCentavos: centavosDoTexto(valor), observacao } : null;
  const problema = corpo ? problemaNoTurno(corpo, new Date()) : null;
  const criar = useMutation({
    mutationFn: () => api<TurnoResumo[]>('/entregas/turnos', { metodo: 'POST', corpo }),
    onSuccess: (r) => {
      aoCriar(r);
      setDia('');
      setObservacao('');
    },
  });
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <h2 className="text-base font-semibold">Abrir turno</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Campo rotulo="Dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        <Campo rotulo="Começa" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        <Campo rotulo="Termina" type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
        <Campo rotulo="Vagas" type="number" min={1} max={MAX_VAGAS_TURNO} value={vagas} onChange={(e) => setVagas(e.target.value)} />
        <Campo rotulo="Valor por presente (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        <Campo rotulo="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} />
      </div>
      <p className="text-xs text-slate-500">O valor é pago a cada entregador presente, além das chamadas. Sem valor, o turno só dá a prioridade.</p>
      {problema && <Alerta tipo="aviso">{problema}</Alerta>}
      {criar.error && <Alerta>{criar.error.message}</Alerta>}
      <Botao onClick={() => criar.mutate()} disabled={!corpo || !!problema || criar.isPending}>
        {criar.isPending ? 'Abrindo…' : 'Abrir turno'}
      </Botao>
    </section>
  );
}

/** Como os entregadores avaliam a empresa (média de 90 dias, comentários sem o nome). */
export function ReputacaoDaEmpresa() {
  const { data } = useQuery({ queryKey: ['entregas-reputacao'], queryFn: () => api<ReputacaoEmpresa>('/entregas/reputacao') });
  if (!data || !data.avaliacoes) return null;
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm" data-testid="reputacao-empresa">
      <h2 className="text-base font-semibold">Como os entregadores avaliam sua empresa</h2>
      {data.media === null ? (
        <p className="text-slate-600">
          {data.avaliacoes} {data.avaliacoes === 1 ? 'avaliação' : 'avaliações'} nos últimos 90 dias. A média aparece a partir de 3 (com menos, daria para saber quem avaliou).
        </p>
      ) : (
        <>
          <p>
            Média <strong className="text-lg">{data.media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</strong> de 5, em {data.avaliacoes} avaliações nos últimos 90 dias. Os entregadores veem a média na oferta.
          </p>
          {data.comentarios.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {data.comentarios.map((c, i) => (
                <li key={i} className="py-1.5">
                  <span className="font-medium">{c.nota}/5</span> · {c.comentario} <span className="text-xs text-slate-500">{c.em.split('-').reverse().join('/')}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
