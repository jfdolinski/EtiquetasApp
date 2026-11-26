import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatarCentavos,
  ROTULO_TIPO_CHAMADA,
  somaDasLinhas,
  totalDaChamada,
  type APagarEntregador,
  type ContestacaoEmpresa,
  type FechamentoResumo,
  type LinhaFechamento,
} from '@etiquetas/shared';
import { api, apiArquivo } from '../../api';
import { useHojeDoSistema } from '../../components/Relogio';
import { Alerta, Botao, Campo, formatarData, Modal, Selo, Tabela } from '../../components/ui';

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * O que a empresa deve a cada entregador e o registro dos pagamentos (feitos fora do sistema,
 * por Pix para a chave dele), mais as contestações.
 */
export function Financeiro() {
  const [pagando, setPagando] = useState<APagarEntregador | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const aPagar = useQuery({ queryKey: ['entregas-a-pagar'], queryFn: () => api<APagarEntregador[]>('/entregas/financeiro/a-pagar') });
  const total = (aPagar.data ?? []).reduce((s, a) => s + a.totalCentavos, 0);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">A pagar</h2>
          {aPagar.data && aPagar.data.length > 0 && <span className="text-sm text-slate-600">Total: <strong>{formatarCentavos(total)}</strong></span>}
        </div>
        <p className="text-sm text-slate-600">Chamadas concluídas que ainda não entraram num pagamento. Pague pelo Pix do entregador, fora do sistema, e registre aqui: ele vê no aplicativo.</p>
        {aPagar.error && <Alerta>{aPagar.error.message}</Alerta>}
        <Tabela colunas={['Entregador', 'Chave Pix', 'Chamadas', 'Desde', 'Total', '']} vazio={aPagar.data?.length === 0}>
          {aPagar.data?.map((a) => (
            <tr key={a.entregador.id}>
              <td className="px-4 py-2.5">
                {a.entregador.nome}
                {a.contestacoesAbertas > 0 && (
                  <span className="ml-2">
                    <Selo cor="vermelho">{a.contestacoesAbertas} contestação{a.contestacoesAbertas > 1 ? 'ões' : ''}</Selo>
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">
                {a.entregador.chavePix}{' '}
                <button type="button" className="text-blue-700 underline" onClick={() => void navigator.clipboard?.writeText(a.entregador.chavePix)}>
                  copiar
                </button>
              </td>
              <td className="px-4 py-2.5">{a.quantidade}</td>
              <td className="px-4 py-2.5">{dataBr(a.maisAntiga)}</td>
              <td className="px-4 py-2.5 font-semibold">{formatarCentavos(a.totalCentavos)}</td>
              <td className="px-4 py-2.5 text-right">
                <Botao onClick={() => setPagando(a)} aria-label={`Registrar pagamento de ${a.entregador.nome}`}>
                  Registrar pagamento
                </Botao>
              </td>
            </tr>
          ))}
        </Tabela>
      </section>

      <Contestacoes />
      <Pagamentos ver={setVendo} />

      {pagando && <RegistrarPagamento a={pagando} aoFechar={() => setPagando(null)} />}
      {vendo && <DetalhePagamento id={vendo} aoFechar={() => setVendo(null)} />}
    </div>
  );
}

function RegistrarPagamento({ a, aoFechar }: { a: APagarEntregador; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const linhas = useQuery({ queryKey: ['entregas-pendentes', a.entregador.id], queryFn: () => api<LinhaFechamento[]>(`/entregas/financeiro/a-pagar/${a.entregador.id}`) });
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const hoje = useHojeDoSistema();
  const [escolhido, setPagoEm] = useState<string | null>(null);
  const pagoEm = escolhido ?? hoje;
  const [observacao, setObservacao] = useState('');
  const [comprovante, setComprovante] = useState<string | null>(null);
  useEffect(() => {
    if (linhas.data) setMarcadas(new Set(linhas.data.map((l) => l.chamadaId)));
  }, [linhas.data]);
  const escolhidas = useMemo(() => (linhas.data ?? []).filter((l) => marcadas.has(l.chamadaId)), [linhas.data, marcadas]);
  const registrar = useMutation({
    mutationFn: () => api<FechamentoResumo>('/entregas/financeiro/fechamentos', { metodo: 'POST', corpo: { entregadorId: a.entregador.id, chamadaIds: escolhidas.map((l) => l.chamadaId), pagoEm, observacao, comprovante } }),
    onSuccess: () => {
      for (const k of ['entregas-a-pagar', 'entregas-pagamentos', 'chamadas']) void cliente.invalidateQueries({ queryKey: [k] });
      aoFechar();
    },
  });
  const alternar = (id: string) => {
    const n = new Set(marcadas);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setMarcadas(n);
  };

  return (
    <Modal titulo={`Pagamento a ${a.entregador.nome}`} aberto aoFechar={aoFechar} largo>
      <div className="space-y-4 text-sm">
        <p>
          Chave Pix: <span className="font-mono">{a.entregador.chavePix}</span>. Faça o Pix e registre aqui as chamadas que ele cobre.
        </p>
        {linhas.error && <Alerta>{linhas.error.message}</Alerta>}
        <div className="max-h-72 overflow-auto rounded border border-slate-200">
          {linhas.data?.map((l) => (
            <label key={l.chamadaId} className="flex items-start gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
              <input type="checkbox" className="mt-1" checked={marcadas.has(l.chamadaId)} onChange={() => alternar(l.chamadaId)} aria-label={`Chamada ${l.numero}`} />
              <span className="flex-1">
                Nº {l.numero} · {ROTULO_TIPO_CHAMADA[l.tipo]} · {dataBr(l.concluidaEm)} · {l.destino}
                {l.cancelada && <span className="block text-xs text-amber-800">Cancelada depois do aceite: taxa de deslocamento</span>}
                {l.extraCentavos > 0 && <span className="block text-xs text-slate-500">Extra {formatarCentavos(l.extraCentavos)}: {l.extraMotivo}</span>}
                {(l.esperaCentavos ?? 0) > 0 && <span className="block text-xs text-slate-500">Inclui espera de {formatarCentavos(l.esperaCentavos!)}</span>}
                {(l.devolucaoCentavos ?? 0) > 0 && <span className="block text-xs text-slate-500">Inclui volta à origem de {formatarCentavos(l.devolucaoCentavos!)}</span>}
                {l.contestacaoAberta && <span className="block text-xs text-red-700">Contestação esperando resposta</span>}
              </span>
              <span className="font-medium">{formatarCentavos(totalDaChamada(l))}</span>
            </label>
          ))}
        </div>
        <div className="text-base">
          {escolhidas.length} chamada{escolhidas.length === 1 ? '' : 's'}: <strong>{formatarCentavos(somaDasLinhas(escolhidas))}</strong>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data do pagamento" type="date" max={hoje} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
          <Campo rotulo="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: Pix do dia, id da transação" />
        </div>
        <label className="block">
          <span className="text-sm font-medium">Comprovante (imagem, opcional)</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block text-sm" onChange={async (e) => setComprovante(e.target.files?.[0] ? await lerArquivo(e.target.files[0]) : null)} />
        </label>
        {registrar.error && <Alerta>{registrar.error.message}</Alerta>}
        <Botao onClick={() => registrar.mutate()} disabled={!escolhidas.length || !pagoEm || registrar.isPending}>
          {registrar.isPending ? 'Registrando…' : `Registrar pagamento de ${formatarCentavos(somaDasLinhas(escolhidas))}`}
        </Botao>
      </div>
    </Modal>
  );
}

function Contestacoes() {
  const cliente = useQueryClient();
  const [filtro, setFiltro] = useState<'ABERTAS' | 'TODAS'>('ABERTAS');
  const lista = useQuery({ queryKey: ['entregas-contestacoes', filtro], queryFn: () => api<ContestacaoEmpresa[]>(`/entregas/financeiro/contestacoes?filtro=${filtro}`) });
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const responder = useMutation({
    mutationFn: (id: string) => api(`/entregas/financeiro/contestacoes/${id}/responder`, { metodo: 'POST', corpo: { resposta: respostas[id] ?? '' } }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['entregas-contestacoes'] });
      void cliente.invalidateQueries({ queryKey: ['entregas-a-pagar'] });
    },
  });
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Contestações</h2>
        <button type="button" className="text-sm text-blue-700 underline" onClick={() => setFiltro(filtro === 'ABERTAS' ? 'TODAS' : 'ABERTAS')}>
          {filtro === 'ABERTAS' ? 'Ver também as respondidas' : 'Só as abertas'}
        </button>
      </div>
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      {lista.data?.length === 0 && <p className="text-sm text-slate-500">{filtro === 'ABERTAS' ? 'Nenhuma contestação esperando resposta.' : 'Nenhuma contestação.'}</p>}
      {responder.error && <Alerta>{responder.error.message}</Alerta>}
      {lista.data?.map((c) => (
        <div key={c.id} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span>
              <strong>{c.entregadorNome}</strong> · chamada nº {c.numero} · {formatarCentavos(c.totalCentavos)} · {c.pago ? 'paga' : 'a pagar'}
            </span>
            <span className="text-xs text-slate-500">{formatarData(c.criadoEm)}</span>
          </div>
          <p className="whitespace-pre-line">{c.mensagem}</p>
          {c.resposta ? (
            <p className="rounded bg-slate-50 px-2 py-1 text-slate-700">Resposta: {c.resposta}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <Campo rotulo={`Resposta a ${c.entregadorNome}`} value={respostas[c.id] ?? ''} onChange={(e) => setRespostas({ ...respostas, [c.id]: e.target.value })} ajuda="Para corrigir o valor, lance um extra na chamada (se ainda não foi paga)." />
              </div>
              <Botao onClick={() => responder.mutate(c.id)} disabled={(respostas[c.id] ?? '').trim().length < 2 || responder.isPending}>
                Responder
              </Botao>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function Pagamentos({ ver }: { ver: (id: string) => void }) {
  const lista = useQuery({ queryKey: ['entregas-pagamentos'], queryFn: () => api<FechamentoResumo[]>('/entregas/financeiro/fechamentos') });
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Pagamentos registrados</h2>
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      <Tabela colunas={['Pago em', 'Entregador', 'Chamadas', 'Total', 'Registrado por', '']} vazio={lista.data?.length === 0}>
        {lista.data?.map((f) => (
          <tr key={f.id}>
            <td className="px-4 py-2.5">{dataBr(f.pagoEm)}</td>
            <td className="px-4 py-2.5">{f.entregadorNome}</td>
            <td className="px-4 py-2.5">{f.quantidade}</td>
            <td className="px-4 py-2.5 font-semibold">{formatarCentavos(f.totalCentavos)}</td>
            <td className="px-4 py-2.5 text-xs text-slate-500">
              {f.criadoPorNome ?? '—'} · {formatarData(f.criadoEm)}
            </td>
            <td className="px-4 py-2.5 text-right">
              <Botao variante="secundario" onClick={() => ver(f.id)}>
                Ver
              </Botao>
            </td>
          </tr>
        ))}
      </Tabela>
    </section>
  );
}

function DetalhePagamento({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const f = useQuery({ queryKey: ['entregas-pagamento', id], queryFn: () => api<FechamentoResumo>(`/entregas/financeiro/fechamentos/${id}`) });
  const [imagem, setImagem] = useState<string | null>(null);
  const comprovante = useMutation({ mutationFn: () => api<{ dados: string }>(`/entregas/financeiro/fechamentos/${id}/comprovante`), onSuccess: (r) => setImagem(r.dados) });
  const desfazer = useMutation({
    mutationFn: () => api(`/entregas/financeiro/fechamentos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      for (const k of ['entregas-a-pagar', 'entregas-pagamentos', 'chamadas']) void cliente.invalidateQueries({ queryKey: [k] });
      aoFechar();
    },
  });
  const pdf = useMutation({
    mutationFn: async () => {
      const blob = await apiArquivo(`/entregas/financeiro/fechamentos/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pagamento-${f.data?.entregadorNome ?? 'entregador'}-${f.data?.pagoEm ?? ''}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  const d = f.data;
  return (
    <Modal titulo={d ? `Pagamento a ${d.entregadorNome} em ${dataBr(d.pagoEm)}` : 'Pagamento'} aberto aoFechar={aoFechar} largo>
      {f.error && <Alerta>{f.error.message}</Alerta>}
      {d && (
        <div className="space-y-3 text-sm">
          <div className="text-base">
            {d.quantidade} chamada{d.quantidade === 1 ? '' : 's'}: <strong>{formatarCentavos(d.totalCentavos)}</strong>
          </div>
          {d.observacao && <p>Obs.: {d.observacao}</p>}
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {d.chamadas?.map((l) => (
              <li key={l.chamadaId} className="flex justify-between px-3 py-1.5">
                <span>
                  Nº {l.numero} · {ROTULO_TIPO_CHAMADA[l.tipo]} · {dataBr(l.concluidaEm)} · {l.destino}
                </span>
                <span>{formatarCentavos(totalDaChamada(l))}</span>
              </li>
            ))}
          </ul>
          {desfazer.error && <Alerta>{desfazer.error.message}</Alerta>}
          {pdf.error && <Alerta>{pdf.error.message}</Alerta>}
          <div className="flex flex-wrap gap-2">
            <Botao variante="secundario" onClick={() => pdf.mutate()} disabled={pdf.isPending}>
              {pdf.isPending ? 'Gerando…' : 'Baixar comprovante (PDF)'}
            </Botao>
            {d.temComprovante && (
              <Botao variante="secundario" onClick={() => comprovante.mutate()}>
                Ver comprovante
              </Botao>
            )}
            <Botao variante="perigo" disabled={desfazer.isPending} onClick={() => confirm('Desfazer este registro? As chamadas voltam para "a pagar" (o dinheiro não volta: isto só corrige o registro).') && desfazer.mutate()}>
              Desfazer registro
            </Botao>
          </div>
          {imagem && <img src={imagem} alt="Comprovante do pagamento" className="max-h-[60vh] object-contain" />}
        </div>
      )}
    </Modal>
  );
}
