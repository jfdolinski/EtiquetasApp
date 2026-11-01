import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EVENTOS_NOTIFICACAO,
  type ConfiguracaoNotificacoes,
  type JanelaNotificacao,
  type NotificacaoResumo,
  type RegraNotificacaoDados,
  type TesteNotificacaoResposta,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Selo, formatarData } from '../components/ui';

type Configuracao = ConfiguracaoNotificacoes & { agentes: { id: string; nome: string }[] };

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const REPETICOES = [
  { valor: 0, rotulo: 'Só uma vez' },
  { valor: 30, rotulo: 'A cada 30 min' },
  { valor: 60, rotulo: 'A cada 1 hora' },
  { valor: 120, rotulo: 'A cada 2 horas' },
  { valor: 240, rotulo: 'A cada 4 horas' },
  { valor: 480, rotulo: 'A cada 8 horas' },
  { valor: 1440, rotulo: 'Uma vez por dia' },
];

export function Notificacoes() {
  return (
    <ExigeEmpresa>
      <Tela />
    </ExigeEmpresa>
  );
}

function Tela() {
  const { pode } = useAuth();
  const [aba, setAba] = useState<'recebidas' | 'regras'>('recebidas');
  const classe = (a: string) => `border-b-2 px-3 py-2 text-sm font-medium ${aba === a ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`;
  return (
    <>
      <Cabecalho titulo="Notificações" descricao="Avisos da empresa e o que deve avisar, de que jeito e em que horário." />
      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'recebidas'} className={classe('recebidas')} onClick={() => setAba('recebidas')}>Recebidas</button>
        <button type="button" role="tab" aria-selected={aba === 'regras'} className={classe('regras')} onClick={() => setAba('regras')}>O que e como avisar</button>
      </div>
      {aba === 'recebidas' ? <Recebidas /> : <Regras podeEditar={pode('notificacao.editar')} />}
    </>
  );
}

function Recebidas() {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const chave = ['notificacoes', empresaId];
  const { data: lista = [], isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<NotificacaoResumo[]>('/notificacoes'), refetchInterval: 60_000 });
  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: chave });
    void cliente.invalidateQueries({ queryKey: ['notificacoes-nao-lidas'] });
  };
  const lerUma = useMutation({ mutationFn: (id: string) => api(`/notificacoes/${id}/lida`, { metodo: 'POST' }), onSuccess: atualizar });
  const lerTodas = useMutation({ mutationFn: () => api('/notificacoes/lidas', { metodo: 'POST' }), onSuccess: atualizar });
  const naoLidas = lista.filter((n) => !n.lidaEm).length;

  if (isLoading) return <div className="text-sm text-slate-500">Carregando…</div>;
  return (
    <div className="space-y-3">
      {error && <Alerta>{error.message}</Alerta>}
      {naoLidas > 0 && (
        <div className="flex justify-end">
          <Botao variante="secundario" disabled={lerTodas.isPending} onClick={() => lerTodas.mutate()}>Marcar todas como lidas</Botao>
        </div>
      )}
      {lista.length === 0 && <Alerta tipo="info">Nenhum aviso até agora. As regras nascem desligadas: escolha o que deve avisar em “O que e como avisar”.</Alerta>}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {lista.map((n) => (
          <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${n.lidaEm ? '' : 'bg-blue-50/50'}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {n.titulo}
                {n.resolvidaEm ? <Selo cor="verde">Resolvido</Selo> : <Selo cor={n.nivel === 'erro' ? 'vermelho' : 'amarelo'}>Em aberto</Selo>}
                {n.vezes > 1 && <span className="text-xs font-normal text-slate-500">avisado {n.vezes} vezes</span>}
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{n.mensagem}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatarData(n.ultimoEnvioEm)}
                {n.resolvidaEm && ` · resolvido em ${formatarData(n.resolvidaEm)}`}
                {n.canalAgente && ` · balão entregue a ${n.entregues} agente(s)`}
              </p>
            </div>
            {!n.lidaEm && (
              <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => lerUma.mutate(n.id)}>Marcar como lida</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Regras({ podeEditar }: { podeEditar: boolean }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const chave = ['notificacoes-configuracao', empresaId];
  const { data, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<Configuracao>('/notificacoes/configuracao') });
  const [regras, setRegras] = useState<RegraNotificacaoDados[] | null>(null);
  const [janela, setJanela] = useState<JanelaNotificacao | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    if (data) {
      setRegras(data.regras);
      setJanela(data.janela);
    }
  }, [data]);

  const salvar = useMutation({
    mutationFn: () => api<Configuracao>('/notificacoes/configuracao', { metodo: 'PUT', corpo: { janela, regras } }),
    onSuccess: (r) => {
      cliente.setQueryData(chave, r);
      setSalvo(true);
    },
  });
  const testar = useMutation({ mutationFn: () => api<TesteNotificacaoResposta>('/notificacoes/teste', { metodo: 'POST' }) });

  if (isLoading || !regras || !janela) return error ? <Alerta>{error.message}</Alerta> : <div className="text-sm text-slate-500">Carregando…</div>;

  const mudar = (evento: string, parte: Partial<RegraNotificacaoDados>) => {
    setSalvo(false);
    setRegras(regras.map((r) => (r.evento === evento ? { ...r, ...parte } : r)));
  };
  const mudarJanela = (parte: Partial<JanelaNotificacao>) => {
    setSalvo(false);
    setJanela({ ...janela, ...parte });
  };
  const agentes = data?.agentes ?? [];
  const t = testar.data;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Quando avisar</h2>
        <p className="mt-0.5 text-xs text-slate-500">Fora deste horário nada é enviado. O problema que continuar valendo é avisado quando o horário abrir.</p>
        <fieldset disabled={!podeEditar} className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex flex-wrap gap-1">
            {DIAS.map((d, i) => {
              const ligado = janela.diasSemana.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={ligado}
                  onClick={() => mudarJanela({ diasSemana: ligado ? janela.diasSemana.filter((x) => x !== i) : [...janela.diasSemana, i] })}
                  className={`rounded-md px-2.5 py-1 text-sm ring-1 ${ligado ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-300'}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Das
            <input type="time" value={janela.horaInicio} onChange={(e) => mudarJanela({ horaInicio: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            às
            <input type="time" value={janela.horaFim} onChange={(e) => mudarJanela({ horaFim: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
        </fieldset>
        {janela.diasSemana.length === 0 && <div className="mt-3"><Alerta tipo="aviso">Sem nenhum dia marcado, nada será avisado.</Alerta></div>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">O que avisar e de que jeito</h2>
        {EVENTOS_NOTIFICACAO.map((e) => {
          const r = regras.find((x) => x.evento === e.codigo)!;
          return (
            <fieldset key={e.codigo} disabled={!podeEditar} className={`rounded-lg border bg-white p-4 ${r.ativo ? 'border-blue-300' : 'border-slate-200'}`}>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" className="mt-1" checked={r.ativo} onChange={(x) => mudar(e.codigo, { ativo: x.target.checked })} />
                <span>
                  <span className="block text-sm font-medium">{e.titulo}</span>
                  <span className="block text-xs text-slate-500">{e.descricao}</span>
                </span>
              </label>
              {r.ativo && (
                <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3 pl-6">
                  {e.unidade && (
                    <label className="text-xs text-slate-600">
                      {e.unidade === 'produtos' ? 'A partir de' : 'Limite'}
                      <span className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-700">
                        <input
                          type="number"
                          min={1}
                          value={r.limite}
                          onChange={(x) => mudar(e.codigo, { limite: Math.max(0, Math.floor(x.target.valueAsNumber || 0)) })}
                          className="w-20 rounded-md border border-slate-300 px-2 py-1"
                        />
                        {e.unidade}
                      </span>
                    </label>
                  )}
                  <label className="text-xs text-slate-600">
                    Enquanto continuar
                    <select
                      value={REPETICOES.some((o) => o.valor === r.repetirMinutos) ? r.repetirMinutos : 0}
                      onChange={(x) => mudar(e.codigo, { repetirMinutos: Number(x.target.value) })}
                      className="mt-0.5 block rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      {REPETICOES.map((o) => (
                        <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                      ))}
                    </select>
                  </label>
                  <div className="space-y-1 text-sm text-slate-700">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r.canalAgente} onChange={(x) => mudar(e.codigo, { canalAgente: x.target.checked })} />
                      Balão do Windows no agente
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r.canalSistema} onChange={(x) => mudar(e.codigo, { canalSistema: x.target.checked })} />
                      Sino aqui no sistema
                    </label>
                  </div>
                  {r.canalAgente && agentes.length > 1 && (
                    <div className="text-xs text-slate-600">
                      Computadores que recebem
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700">
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={r.agenteIds.length === 0} onChange={() => mudar(e.codigo, { agenteIds: [] })} />
                          Todos
                        </label>
                        {agentes.map((a) => (
                          <label key={a.id} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={r.agenteIds.includes(a.id)}
                              onChange={(x) => mudar(e.codigo, { agenteIds: x.target.checked ? [...r.agenteIds, a.id] : r.agenteIds.filter((i) => i !== a.id) })}
                            />
                            {a.nome}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          );
        })}
      </section>

      {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
      {salvo && <Alerta tipo="info">Salvo. As regras são conferidas a cada minuto.</Alerta>}
      {testar.error && <Alerta>{testar.error.message}</Alerta>}
      {t && (
        <Alerta tipo={t.entregues ? 'info' : 'aviso'}>
          {t.agentes === 0
            ? 'Nenhum agente ativado nesta empresa.'
            : `${t.online} de ${t.agentes} agente(s) online, ${t.entregues} recebeu(ram) o teste.` + (t.desatualizados ? ` ${t.desatualizados} precisa(m) atualizar o agente para receber notificações.` : '')}
          {t.entregues > 0 && ' O balão só aparece se o ícone do agente estiver aberto no computador.'}
        </Alerta>
      )}
      {podeEditar && (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <Botao variante="secundario" disabled={testar.isPending} onClick={() => testar.mutate()}>{testar.isPending ? 'Enviando…' : 'Enviar teste aos agentes'}</Botao>
          <Botao disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      )}
    </div>
  );
}
