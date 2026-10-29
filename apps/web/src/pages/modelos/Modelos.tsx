import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ConsultaParaModelo, ModeloEtiquetaResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { Alerta, Cabecalho, Selo, Tabela, formatarData } from '../../components/ui';

export function Modelos() {
  return (
    <ExigeEmpresa>
      <ListaModelos />
    </ExigeEmpresa>
  );
}

function ListaModelos() {
  const { empresaId, pode } = useAuth();
  const { data: modelos = [], isLoading, error } = useQuery({
    queryKey: ['modelos', empresaId],
    queryFn: () => api<ModeloEtiquetaResumo[]>('/modelos'),
  });
  const { data: consultas = [] } = useQuery({
    queryKey: ['modelos-consultas', empresaId],
    queryFn: () => api<ConsultaParaModelo[]>('/modelos/consultas'),
  });
  const nomeConsulta = new Map(consultas.map((c) => [c.id, c.nome]));

  return (
    <>
      <Cabecalho
        titulo="Modelos de etiqueta"
        descricao="Layout das etiquetas: tamanho, campos, códigos de barras e QR code."
        acoes={
          pode('etiqueta.modelo.editar') && (
            <Link to="/modelos/novo" className="rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Novo modelo
            </Link>
          )
        }
      />
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Modelo', 'Tamanho', 'Consulta', 'Elementos', 'Atualizado em']} vazio={modelos.length === 0}>
          {modelos.map((m) => (
            <tr key={m.id} className={m.ativo ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5">
                <Link to={`/modelos/${m.id}`} className="font-medium text-blue-700 hover:underline">{m.nome}</Link>{' '}
                {!m.ativo && <Selo cor="cinza">Desativado</Selo>}
                {m.descricao && <div className="text-xs text-slate-500">{m.descricao}</div>}
              </td>
              <td className="px-4 py-2.5">
                {m.layout.larguraMm} × {m.layout.alturaMm} mm
                {m.layout.colunas > 1 && <span className="text-slate-500"> · {m.layout.colunas} col.</span>}
                <div className="text-xs text-slate-500">{m.layout.papel.tipo === 'rolo' ? 'Rolo' : 'Folha'}</div>
              </td>
              <td className="px-4 py-2.5">{(m.consultaId && nomeConsulta.get(m.consultaId)) ?? '—'}</td>
              <td className="px-4 py-2.5">{m.layout.elementos.length}</td>
              <td className="px-4 py-2.5 text-slate-500">{formatarData(m.atualizadoEm)}</td>
            </tr>
          ))}
        </Tabela>
      )}
    </>
  );
}
