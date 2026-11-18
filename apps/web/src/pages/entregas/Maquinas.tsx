import { useQuery } from '@tanstack/react-query';
import { formatarCelular, ROTULO_SITUACAO_CHAMADA, ROTULO_TIPO_CHAMADA, ROTULO_VEICULO, type MaquinaEmCustodia } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, formatarData, Selo, Tabela } from '../../components/ui';

/** Máquinas (série lida na coleta) que estão com algum entregador agora: coletadas e ainda não entregues. */
export function Maquinas() {
  const { data, error } = useQuery({ queryKey: ['entregas-maquinas'], queryFn: () => api<MaquinaEmCustodia[]>('/entregas/maquinas'), refetchInterval: 30_000 });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!data) return <p className="text-sm text-slate-500">Carregando…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Máquinas que um entregador já coletou e ainda não entregou. O entregador não fica offline com chamada em andamento; sem sinal por muito tempo, o aviso "Máquina com entregador sem sinal" das Notificações pode tocar.</p>
      <Tabela colunas={['Série', 'Chamada', 'Entregador', 'Coletada em', 'Situação', 'Sinal']} vazio={data.length === 0}>
        {data.map((m) => (
          <tr key={m.chamadaId}>
            <td className="px-4 py-2.5 font-mono">{m.serie}</td>
            <td className="px-4 py-2.5">
              nº {m.numero}
              <div className="text-xs text-slate-500">{ROTULO_TIPO_CHAMADA[m.tipo]}</div>
            </td>
            <td className="px-4 py-2.5">
              {m.entregador.nome} · {ROTULO_VEICULO[m.entregador.veiculo]}
              <div className="text-xs">
                <a className="text-blue-700 underline" href={`tel:${m.entregador.celular}`}>
                  {formatarCelular(m.entregador.celular)}
                </a>
              </div>
            </td>
            <td className="px-4 py-2.5">{formatarData(m.coletadaEm)}</td>
            <td className="px-4 py-2.5">{ROTULO_SITUACAO_CHAMADA[m.situacao]}</td>
            <td className="px-4 py-2.5">{m.semSinalMinutos === null ? <Selo cor="cinza">Sem posição</Selo> : m.semSinalMinutos <= 2 ? <Selo cor="verde">Agora</Selo> : <Selo cor={m.semSinalMinutos > 15 ? 'vermelho' : 'amarelo'}>há {m.semSinalMinutos} min</Selo>}</td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
