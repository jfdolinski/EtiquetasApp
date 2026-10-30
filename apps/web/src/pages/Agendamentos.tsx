import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INTERVALO_MINIMO_SEGUNDOS,
  ROTULO_UNIDADE,
  SEGUNDOS_POR_UNIDADE,
  decomporIntervalo,
  formatarIntervalo,
  proximasExecucoes,
  type AgendamentoResumo,
  type ExecucaoAgendamento,
  type OpcoesAgendamento,
  type UnidadeCiclo,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela } from '../components/ui';

const UNIDADES = Object.keys(SEGUNDOS_POR_UNIDADE) as UnidadeCiclo[];

/** Com segundos: ciclos curtos rodam várias vezes no mesmo minuto. */
function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
}

export function Agendamentos() {
  return (
    <ExigeEmpresa>
      <ListaAgendamentos />
    </ExigeEmpresa>
  );
}

function ListaAgendamentos() {
  const { empresaId, pode } = useAuth();
  const podeEditar = pode('agendamento.editar');
  const cliente = useQueryClient();
  const [edicao, setEdicao] = useState<{ agendamento: AgendamentoResumo | null } | null>(null);
  const [historico, setHistorico] = useState<AgendamentoResumo | null>(null);
  const chave = ['agendamentos', empresaId];
  const { data: agendamentos = [], isLoading, error } = useQuery({
    queryKey: chave,
    queryFn: () => api<AgendamentoResumo[]>('/agendamentos'),
    // Acompanha os ciclos: próxima execução e resultado da última.
    refetchInterval: 10_000,
  });
  const { data: opcoes } = useQuery({ queryKey: ['agendamentos-opcoes', empresaId], queryFn: () => api<OpcoesAgendamento>('/agendamentos/opcoes') });

  const executar = useMutation({
    mutationFn: (id: string) => api<AgendamentoResumo>(`/agendamentos/${id}/executar`, { metodo: 'POST' }),
    onSuccess: (a) => {
      void cliente.invalidateQueries({ queryKey: chave });
      setHistorico(a);
    },
  });
  const alternar = useMutation({
    mutationFn: (a: AgendamentoResumo) => api(`/agendamentos/${a.id}`, { metodo: 'PATCH', corpo: { ativo: !a.ativo } }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: chave }),
  });

  return (
    <>
      <Cabecalho
        titulo="Agendamentos"
        descricao="A cada ciclo, a consulta do modelo é executada e os produtos novos entram na lista do dia. Com impressão automática, as etiquetas já saem na impressora. O mesmo produto não é impresso duas vezes no dia."
        acoes={podeEditar && <Botao onClick={() => setEdicao({ agendamento: null })}>Novo agendamento</Botao>}
      />
      {(error ?? executar.error ?? alternar.error) && <Alerta>{(error ?? executar.error ?? alternar.error)!.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Modelo', 'Ciclo', 'Impressão', 'Próxima execução', 'Última execução', '']} vazio={agendamentos.length === 0}>
          {agendamentos.map((a) => {
            const ultima = a.historico[0];
            return (
              <tr key={a.id} className={a.ativo ? '' : 'text-slate-400'}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">
                    {a.modeloNome} {!a.ativo && <Selo cor="cinza">Pausado</Selo>} {a.emExecucao && <Selo cor="amarelo">Executando</Selo>}
                  </div>
                  {a.responsavelNome && <div className="text-xs text-slate-500">Roda como {a.responsavelNome}</div>}
                </td>
                <td className="px-4 py-2.5">
                  {formatarIntervalo(a.intervaloSegundos)}
                  <div className="text-xs text-slate-500">desde {formatarData(a.inicioEm)}</div>
                </td>
                <td className="px-4 py-2.5">
                  {a.imprimirAutomatico ? <Selo cor="verde">Automática</Selo> : <Selo cor="cinza">Só lista do dia</Selo>}
                  <div className="text-xs text-slate-500">{a.impressoraNome ?? 'Sem impressora'}</div>
                </td>
                <td className="px-4 py-2.5">{a.ativo ? formatarData(a.proximaExecucaoEm) : '—'}</td>
                <td className="px-4 py-2.5">
                  {ultima ? (
                    <button type="button" className="text-left hover:underline" onClick={() => setHistorico(a)}>
                      <ResumoExecucao e={ultima} />
                    </button>
                  ) : (
                    <span className="text-slate-400">Ainda não executou</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  {podeEditar && (
                    <div className="flex justify-end gap-2">
                      <Botao variante="secundario" disabled={executar.isPending || a.emExecucao} onClick={() => executar.mutate(a.id)}>
                        {executar.isPending && executar.variables === a.id ? 'Executando…' : 'Executar agora'}
                      </Botao>
                      <Botao variante="secundario" disabled={alternar.isPending} onClick={() => alternar.mutate(a)}>
                        {a.ativo ? 'Pausar' : 'Retomar'}
                      </Botao>
                      <Botao variante="secundario" onClick={() => setEdicao({ agendamento: a })}>Editar</Botao>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Tabela>
      )}
      <Modal titulo={edicao?.agendamento ? 'Editar agendamento' : 'Novo agendamento'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && opcoes && <FormAgendamento agendamento={edicao.agendamento} opcoes={opcoes} aoConcluir={() => setEdicao(null)} />}
      </Modal>
      <Modal titulo={historico ? `Execuções: ${historico.modeloNome}` : ''} aberto={historico !== null} aoFechar={() => setHistorico(null)}>
        {historico && <Historico agendamento={agendamentos.find((a) => a.id === historico.id) ?? historico} />}
      </Modal>
    </>
  );
}

function ResumoExecucao({ e }: { e: ExecucaoAgendamento }) {
  return (
    <>
      <div className="text-xs text-slate-500">{formatarData(e.em)}</div>
      {e.erro ? (
        <div className="text-sm text-red-600">{e.erro}</div>
      ) : (
        <div className="text-sm">
          {e.itensNovos} {e.itensNovos === 1 ? 'item novo' : 'itens novos'}
          {e.etiquetas > 0 && ` · ${e.etiquetas} ${e.etiquetas === 1 ? 'etiqueta impressa' : 'etiquetas impressas'}`}
        </div>
      )}
    </>
  );
}

function Historico({ agendamento }: { agendamento: AgendamentoResumo }) {
  if (agendamento.historico.length === 0) return <p className="text-sm text-slate-500">Ainda não executou.</p>;
  return (
    <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
      {agendamento.historico.map((e) => (
        <div key={e.em} className="py-2">
          <div className="flex items-center gap-2">
            <ResumoExecucao e={e} />
            <span className="ml-auto text-xs text-slate-400">
              {e.origem === 'manual' ? 'manual' : 'agendada'} · {(e.duracaoMs / 1000).toFixed(1)} s
            </span>
          </div>
          {e.avisos?.map((aviso) => (
            <div key={aviso} className="text-xs text-amber-700">{aviso}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** "2026-10-30T14:05" no fuso do navegador (valor do input datetime-local). */
function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function FormAgendamento({ agendamento, opcoes, aoConcluir }: { agendamento: AgendamentoResumo | null; opcoes: OpcoesAgendamento; aoConcluir: () => void }) {
  // O modelo de um agendamento existente aparece mesmo que não possa mais ser agendado (para pausar ou excluir).
  const modelos =
    agendamento && !opcoes.modelos.some((m) => m.id === agendamento.modeloId)
      ? [{ id: agendamento.modeloId, nome: agendamento.modeloNome, impressoraId: null, naListaDiaria: false }, ...opcoes.modelos]
      : opcoes.modelos;
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const ciclo = decomporIntervalo(agendamento?.intervaloSegundos ?? 3600);
  const inicioPadrao = new Date();
  inicioPadrao.setSeconds(0, 0);
  inicioPadrao.setMinutes(inicioPadrao.getMinutes() + 1);
  const [f, setF] = useState({
    modeloId: agendamento?.modeloId ?? modelos[0]?.id ?? '',
    valor: String(ciclo.valor),
    unidade: ciclo.unidade,
    inicio: paraInputLocal(agendamento ? new Date(agendamento.inicioEm) : inicioPadrao),
    imprimirAutomatico: agendamento?.imprimirAutomatico ?? false,
    impressoraId: agendamento?.impressoraId ?? '',
    ativo: agendamento?.ativo ?? true,
  });
  const invalidar = () => void cliente.invalidateQueries({ queryKey: ['agendamentos', empresaId] });

  const intervaloSegundos = Math.round(Number(f.valor.replace(',', '.')) * SEGUNDOS_POR_UNIDADE[f.unidade]);
  const intervaloValido = Number.isFinite(intervaloSegundos) && intervaloSegundos >= INTERVALO_MINIMO_SEGUNDOS;
  const inicio = new Date(f.inicio);
  const modelo = modelos.find((m) => m.id === f.modeloId);
  const impressoraPadrao = opcoes.impressoras.find((i) => i.id === modelo?.impressoraId);
  const impressoraUsada = f.impressoraId ? opcoes.impressoras.find((i) => i.id === f.impressoraId) : impressoraPadrao;
  const proximas = intervaloValido && !Number.isNaN(inicio.getTime()) ? proximasExecucoes(inicio, intervaloSegundos, new Date(), 3) : [];

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        intervaloSegundos,
        inicioEm: inicio.toISOString(),
        imprimirAutomatico: f.imprimirAutomatico,
        impressoraId: f.impressoraId || null,
        ativo: f.ativo,
      };
      return agendamento
        ? api(`/agendamentos/${agendamento.id}`, { metodo: 'PATCH', corpo })
        : api('/agendamentos', { metodo: 'POST', corpo: { ...corpo, modeloId: f.modeloId } });
    },
    onSuccess: () => {
      invalidar();
      aoConcluir();
    },
  });
  const excluir = useMutation({
    mutationFn: () => api(`/agendamentos/${agendamento!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      invalidar();
      aoConcluir();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  if (modelos.length === 0) {
    return <Alerta tipo="info">Nenhum modelo pode ser agendado. O modelo precisa estar ativo e ter uma consulta de lista vinculada (consultas de busca, que pedem valores digitados, não rodam sozinhas).</Alerta>;
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {(salvar.error ?? excluir.error) && <Alerta>{(salvar.error ?? excluir.error)!.message}</Alerta>}
      <Selecao rotulo="Modelo de etiqueta" value={f.modeloId} disabled={!!agendamento} onChange={(e) => setF({ ...f, modeloId: e.target.value })}>
        {modelos.map((m) => (
          <option key={m.id} value={m.id}>{m.nome}</option>
        ))}
      </Selecao>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Ciclo: executar a cada</span>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            step="any"
            required
            className="w-28 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            value={f.valor}
            onChange={(e) => setF({ ...f, valor: e.target.value })}
          />
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value as UnidadeCiclo })}>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>{ROTULO_UNIDADE[u][1]}</option>
            ))}
          </select>
          <span className="self-center text-xs text-slate-500">{intervaloValido ? `= ${intervaloSegundos.toLocaleString('pt-BR')} segundos` : `mínimo ${INTERVALO_MINIMO_SEGUNDOS} segundos`}</span>
        </div>
      </div>

      <Campo
        rotulo="Começar em"
        type="datetime-local"
        step={1}
        required
        ajuda="Os ciclos ficam alinhados a esse horário (ex.: todo dia às 06:00)."
        value={f.inicio}
        onChange={(e) => setF({ ...f, inicio: e.target.value })}
      />
      {proximas.length > 0 && f.ativo && (
        <div className="text-xs text-slate-500">Próximas execuções: {proximas.map((d) => formatarData(d.toISOString())).join(' · ')}</div>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={f.imprimirAutomatico} onChange={(e) => setF({ ...f, imprimirAutomatico: e.target.checked })} />
        <span>
          <span className="font-medium">Impressão automática</span>
          <span className="block text-xs text-slate-500">
            Marcado: imprime os produtos novos a cada ciclo. Desmarcado: só coloca na lista do dia para o operador imprimir.
          </span>
        </span>
      </label>

      <Selecao rotulo="Impressora" value={f.impressoraId} onChange={(e) => setF({ ...f, impressoraId: e.target.value })}>
        <option value="">Padrão do modelo{impressoraPadrao ? ` (${impressoraPadrao.nome})` : ' (nenhuma)'}</option>
        {opcoes.impressoras.map((i) => (
          <option key={i.id} value={i.id} disabled={!i.ativo}>
            {i.nome} {!i.ativo ? '(desativada)' : i.linguagem === 'PDF' ? '(PDF: sem impressão automática)' : ''}
          </option>
        ))}
      </Selecao>
      {f.imprimirAutomatico && (!impressoraUsada || impressoraUsada.linguagem === 'PDF') && (
        <Alerta tipo="aviso">Impressão automática precisa de uma impressora térmica (o PDF é impresso pelo navegador).</Alerta>
      )}
      {modelo?.naListaDiaria && (
        <Alerta tipo="info">Este modelo também está na lista do dia: o botão Atualizar da lista e o agendamento trazem os mesmos produtos, sem repetir.</Alerta>
      )}

      {agendamento && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo
        </label>
      )}

      <div className="flex items-center gap-2 pt-2">
        {agendamento && (
          <Botao
            type="button"
            variante="perigo"
            disabled={excluir.isPending}
            onClick={() => window.confirm('Excluir este agendamento?') && excluir.mutate()}
          >
            Excluir
          </Botao>
        )}
        <div className="ml-auto flex gap-2">
          <Botao type="button" variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
          <Botao type="submit" disabled={salvar.isPending || !intervaloValido}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </div>
    </form>
  );
}
