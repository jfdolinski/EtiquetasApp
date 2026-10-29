import { useQuery } from '@tanstack/react-query';
import type { TrabalhoResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { LinhaHistorico } from '../components/Trabalhos';
import { Alerta, Cabecalho, Tabela } from '../components/ui';

export function Historico() {
  return (
    <ExigeEmpresa>
      <ListaHistorico />
    </ExigeEmpresa>
  );
}

function ListaHistorico() {
  const { empresaId } = useAuth();
  const { data: trabalhos = [], isLoading, error } = useQuery({
    queryKey: ['trabalhos', empresaId],
    queryFn: () => api<TrabalhoResumo[]>('/trabalhos?limite=200'),
    // Atualiza enquanto houver trabalho em andamento.
    refetchInterval: (q) => (q.state.data?.some((t) => t.status === 'PENDENTE' || t.status === 'ENVIANDO') ? 3000 : false),
  });

  return (
    <>
      <Cabecalho titulo="Histórico de impressão" descricao="Últimos trabalhos enviados às impressoras, com quem imprimiu e o resultado." />
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Quando', 'Modelo', 'Impressora', 'Etiquetas', 'Situação', 'Por', '']} vazio={trabalhos.length === 0}>
          {trabalhos.map((t) => (
            <LinhaHistorico key={t.id} t={t} />
          ))}
        </Tabela>
      )}
    </>
  );
}
