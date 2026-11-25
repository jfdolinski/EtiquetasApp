import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatarCentavos, ROTULO_TIPO_CHAMADA, type ResumoRelatorio } from '@etiquetas/shared';
import { api, apiArquivo } from '../../api';
import { Alerta, Botao, Campo, Tabela } from '../../components/ui';

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const diasAtras = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const minutos = (m: number | null) => (m === null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const dataBr = (dia: string) => dia.split('-').reverse().join('/');

function Numero({ titulo, valor, detalhe }: { titulo: string; valor: string | number; detalhe?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="mt-1 font-display text-3xl font-bold tabular-nums">{valor}</div>
      {detalhe && <div className="mt-1 text-xs text-slate-500">{detalhe}</div>}
    </div>
  );
}

/** Relatório das entregas por período: totais, tempos, por entregador, por serviço e por dia, e a planilha. */
export function Relatorio() {
  const [de, setDe] = useState(diasAtras(29));
  const [ate, setAte] = useState(hojeLocal());
  const consulta = `de=${de}&ate=${ate}`;
  const { data, error, isFetching } = useQuery({ queryKey: ['relatorio-entregas', consulta], queryFn: () => api<{ de: string; ate: string; resumo: ResumoRelatorio }>(`/entregas/relatorio?${consulta}`) });
  const baixar = useMutation({
    mutationFn: async () => {
      const blob = await apiArquivo(`/entregas/relatorio.csv?${consulta}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `entregas-${de}-a-${ate}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  const r = data?.resumo;
  const maiorDia = Math.max(1, ...(r?.porDia.map((d) => d.chamadas) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Campo rotulo="De" type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="w-44">
          <Campo rotulo="Até" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </div>
        <Botao variante="secundario" onClick={() => baixar.mutate()} disabled={baixar.isPending || !r?.total}>
          {baixar.isPending ? 'Gerando…' : 'Baixar planilha (CSV)'}
        </Botao>
        {isFetching && <span className="text-sm text-slate-500">Atualizando…</span>}
      </div>
      {(error ?? baixar.error) && <Alerta>{(error ?? baixar.error)!.message}</Alerta>}
      {r && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="relatorio-numeros">
            <Numero titulo="Chamadas" valor={r.total} detalhe={`${r.concluidas} concluídas · ${r.canceladas} canceladas`} />
            <Numero titulo="Pago aos entregadores" valor={formatarCentavos(r.valorCentavos)} detalhe="Concluídas e cancelamentos com taxa" />
            <Numero titulo="Até alguém aceitar" valor={minutos(r.minutosAteAceite)} detalhe="Média, da abertura ao aceite" />
            <Numero titulo="Do aceite à entrega" valor={minutos(r.minutosAteConcluir)} detalhe={`${r.comOcorrencia} com ocorrência · ${r.devolvidas} devolvidas`} />
          </div>
          {r.porDia.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">Chamadas por dia</h2>
              <div className="flex h-32 items-end gap-1" role="img" aria-label="Chamadas por dia">
                {r.porDia.map((d) => (
                  <div key={d.dia} className="flex flex-1 flex-col items-center justify-end" title={`${dataBr(d.dia)}: ${d.chamadas} chamada(s), ${d.concluidas} concluída(s)`}>
                    <div className="w-full max-w-8 rounded-t bg-blue-600" style={{ height: `${(d.chamadas / maiorDia) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{dataBr(r.porDia[0].dia)}</span>
                <span>{dataBr(r.porDia[r.porDia.length - 1].dia)}</span>
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-sm font-semibold">Por entregador</h2>
            <Tabela colunas={['Entregador', 'Chamadas', 'Concluídas', 'Valor', 'Do aceite à entrega', 'Avaliação']} vazio={r.porEntregador.length === 0}>
              {r.porEntregador.map((e) => (
                <tr key={e.nome}>
                  <td className="px-4 py-2.5 font-medium">{e.nome}</td>
                  <td className="px-4 py-2.5 tabular-nums">{e.chamadas}</td>
                  <td className="px-4 py-2.5 tabular-nums">{e.concluidas}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatarCentavos(e.valorCentavos)}</td>
                  <td className="px-4 py-2.5">{minutos(e.minutosAteConcluir)}</td>
                  <td className="px-4 py-2.5">{e.avaliacao === null ? '—' : e.avaliacao.toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </Tabela>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Por serviço</h2>
            <Tabela colunas={['Serviço', 'Chamadas', 'Valor']} vazio={r.porTipo.length === 0}>
              {r.porTipo.map((t) => (
                <tr key={t.tipo}>
                  <td className="px-4 py-2.5">{ROTULO_TIPO_CHAMADA[t.tipo]}</td>
                  <td className="px-4 py-2.5 tabular-nums">{t.chamadas}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatarCentavos(t.valorCentavos)}</td>
                </tr>
              ))}
            </Tabela>
          </section>
        </>
      )}
    </div>
  );
}
