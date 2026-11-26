import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReputacaoDaEmpresa } from './Turnos';
import { ROTULO_VEICULO, type EntregadorDaEmpresa } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, formatarData, Selo, Tabela } from '../../components/ui';

/** Quem já atendeu ou recebeu oferta da empresa: preferidos sobem na fila, bloqueados não recebem. */
export function EntregadoresDaEmpresa() {
  const { pode } = useAuth();
  const cliente = useQueryClient();
  const configura = pode('entrega.configurar');
  const { data, error, isLoading } = useQuery({ queryKey: ['entregas-entregadores'], queryFn: () => api<EntregadorDaEmpresa[]>('/entregas/entregadores') });
  const marcar = useMutation({
    mutationFn: ({ id, preferido, bloqueado }: { id: string; preferido: boolean; bloqueado: boolean }) => api<EntregadorDaEmpresa[]>(`/entregas/entregadores/${id}`, { metodo: 'PUT', corpo: { preferido, bloqueado } }),
    onSuccess: (lista) => cliente.setQueryData(['entregas-entregadores'], lista),
  });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (isLoading || !data) return <div className="text-sm text-slate-500">Carregando…</div>;
  return (
    <div className="space-y-3">
      <ReputacaoDaEmpresa />
      <p className="text-sm text-slate-600">Entregadores que já receberam oferta ou atenderam a empresa. Preferido ganha pontos (ou vem primeiro, conforme o Direcionamento); bloqueado não recebe nenhuma oferta da empresa, nem manual.</p>
      {marcar.error && <Alerta>{marcar.error.message}</Alerta>}
      <Tabela colunas={['Entregador', 'Veículo', 'Avaliação', 'Concluídas', 'Última chamada', 'Situação', ...(configura ? [''] : [])]} vazio={data.length === 0}>
        {data.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2.5">{e.nome}</td>
            <td className="px-4 py-2.5">{ROTULO_VEICULO[e.veiculo]}</td>
            <td className="px-4 py-2.5">{e.avaliacaoMedia != null ? `${e.avaliacaoMedia.toLocaleString('pt-BR')} ★` : '—'}</td>
            <td className="px-4 py-2.5">{e.concluidas}</td>
            <td className="px-4 py-2.5">{e.ultimaEm ? formatarData(e.ultimaEm) : '—'}</td>
            <td className="px-4 py-2.5">{e.bloqueado ? <Selo cor="vermelho">Bloqueado</Selo> : e.preferido ? <Selo cor="verde">Preferido</Selo> : <Selo cor="cinza">Normal</Selo>}</td>
            {configura && (
              <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                <Botao variante="secundario" disabled={marcar.isPending} onClick={() => marcar.mutate({ id: e.id, preferido: !e.preferido, bloqueado: false })} aria-label={`${e.preferido ? 'Tirar dos preferidos' : 'Preferir'} ${e.nome}`}>
                  {e.preferido ? 'Tirar dos preferidos' : 'Preferir'}
                </Botao>
                <Botao variante={e.bloqueado ? 'secundario' : 'perigo'} disabled={marcar.isPending} onClick={() => (e.bloqueado || confirm(`Bloquear ${e.nome}? Ele deixa de receber ofertas da empresa.`)) && marcar.mutate({ id: e.id, preferido: false, bloqueado: !e.bloqueado })} aria-label={`${e.bloqueado ? 'Desbloquear' : 'Bloquear'} ${e.nome}`}>
                  {e.bloqueado ? 'Desbloquear' : 'Bloquear'}
                </Botao>
              </td>
            )}
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
