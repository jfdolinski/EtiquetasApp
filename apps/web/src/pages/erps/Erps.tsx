import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ROTULO_TIPO_BANCO, TIPOS_BANCO, type SistemaErpDetalhe, type SistemaErpResumo, type TipoBanco } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela, formatarData } from '../../components/ui';

export function Erps() {
  const [novo, setNovo] = useState(false);
  const { data: erps = [], isLoading, error } = useQuery({ queryKey: ['erps'], queryFn: () => api<SistemaErpResumo[]>('/erps') });

  return (
    <>
      <Cabecalho
        titulo="Sistemas ERP"
        descricao="ERPs atendidos pela plataforma. O template de cada um (consultas padrão e mapeamento de campos) é copiado para as empresas vinculadas."
        acoes={<Botao onClick={() => setNovo(true)}>Novo ERP</Botao>}
      />
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['ERP', 'Banco', 'Consultas no template', 'Empresas', 'Atualizado em']} vazio={erps.length === 0}>
          {erps.map((e) => (
            <tr key={e.id} className={e.ativo ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5">
                <Link to={`/erps/${e.id}`} className="font-medium text-blue-700 hover:underline">{e.nome}</Link>{' '}
                {!e.ativo && <Selo cor="cinza">Desativado</Selo>}
                {e.fabricante && <div className="text-xs text-slate-500">{e.fabricante}</div>}
              </td>
              <td className="px-4 py-2.5">{ROTULO_TIPO_BANCO[e.tipoBanco]}</td>
              <td className="px-4 py-2.5">{e.totalConsultas}</td>
              <td className="px-4 py-2.5">{e.totalEmpresas}</td>
              <td className="px-4 py-2.5 text-slate-500">{formatarData(e.atualizadoEm)}</td>
            </tr>
          ))}
        </Tabela>
      )}
      <Modal titulo="Novo ERP" aberto={novo} aoFechar={() => setNovo(false)}>
        {novo && <FormNovoErp aoConcluir={() => setNovo(false)} />}
      </Modal>
    </>
  );
}

function FormNovoErp({ aoConcluir }: { aoConcluir: () => void }) {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [f, setF] = useState({ nome: '', fabricante: '', tipoBanco: 'SQLSERVER' as TipoBanco, descricao: '' });
  const criar = useMutation({
    mutationFn: () => api<SistemaErpDetalhe>('/erps', { metodo: 'POST', corpo: { ...f, fabricante: f.fabricante || undefined, descricao: f.descricao || undefined } }),
    onSuccess: (e) => {
      void cliente.invalidateQueries({ queryKey: ['erps'] });
      aoConcluir();
      navegar(`/erps/${e.id}`);
    },
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    criar.mutate();
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      {criar.error && <Alerta>{criar.error.message}</Alerta>}
      <Campo rotulo="Nome" required placeholder="Ex.: ERP X – SQL Server" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <Campo rotulo="Fabricante" value={f.fabricante} onChange={(e) => setF({ ...f, fabricante: e.target.value })} />
      <Selecao rotulo="Banco de dados" value={f.tipoBanco} onChange={(e) => setF({ ...f, tipoBanco: e.target.value as TipoBanco })}>
        {TIPOS_BANCO.map((t) => (
          <option key={t} value={t}>{ROTULO_TIPO_BANCO[t]}</option>
        ))}
      </Selecao>
      <Campo rotulo="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={criar.isPending}>Criar</Botao>
      </div>
    </form>
  );
}
