import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ROTULO_FINALIDADE, type ConexaoBancoResumo, type ConsultaSqlResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Cabecalho, Selo, Tabela, formatarData } from '../components/ui';
import { PainelTemplateErp } from './TemplateErp';

export function Consultas() {
  return (
    <ExigeEmpresa>
      <ListaConsultas />
    </ExigeEmpresa>
  );
}

function ListaConsultas() {
  const { empresaId, pode } = useAuth();
  const { data: consultas = [], isLoading, error } = useQuery({
    queryKey: ['consultas', empresaId],
    queryFn: () => api<ConsultaSqlResumo[]>('/consultas'),
  });
  const { data: conexoes = [] } = useQuery({
    queryKey: ['conexoes', empresaId],
    queryFn: () => api<ConexaoBancoResumo[]>('/consultas/conexoes'),
  });
  const nomeConexao = new Map(conexoes.map((c) => [c.id, c.nome]));

  return (
    <>
      <Cabecalho
        titulo="Consultas SQL"
        descricao="Consultas que buscam os produtos no banco do ERP. As colunas retornadas viram os campos disponíveis nas etiquetas."
        acoes={
          pode('sql.editar') && (
            <Link to="/consultas/nova" className="rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Nova consulta
            </Link>
          )
        }
      />
      {error && <Alerta>{error.message}</Alerta>}
      <PainelTemplateErp conexoes={conexoes} />
      {!isLoading && (
        <Tabela colunas={['Consulta', 'Finalidade', 'Conexão', 'Campos', 'Atualizada em']} vazio={consultas.length === 0}>
          {consultas.map((c) => (
            <tr key={c.id} className={c.ativo ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5">
                <Link to={`/consultas/${c.id}`} className="font-medium text-blue-700 hover:underline">
                  {c.nome}
                </Link>
                {!c.ativo && <Selo cor="cinza">Desativada</Selo>}{' '}
                {c.templateConsultaId && <Selo cor="cinza">Template do ERP</Selo>}
                {c.descricao && <div className="text-xs text-slate-500">{c.descricao}</div>}
              </td>
              <td className="px-4 py-2.5">{ROTULO_FINALIDADE[c.finalidade]}</td>
              <td className="px-4 py-2.5">{nomeConexao.get(c.conexaoId) ?? '—'}</td>
              <td className="px-4 py-2.5">
                {c.campos.length}{' '}
                {c.camposDesatualizados && <Selo cor="amarelo">Desatualizados</Selo>}
              </td>
              <td className="px-4 py-2.5 text-slate-500">{formatarData(c.atualizadoEm)}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </>
  );
}
