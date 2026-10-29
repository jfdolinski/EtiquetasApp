import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ROTULO_FINALIDADE,
  ROTULO_SITUACAO_COPIA,
  ROTULO_TIPO_BANCO,
  type ConexaoBancoResumo,
  type CopiarTemplateResposta,
  type ErpDaEmpresa,
  type SituacaoCopia,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Selo } from '../components/ui';

const COR: Record<SituacaoCopia, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  igual: 'verde',
  ajustada: 'cinza',
  template_atualizado: 'amarelo',
  ambos: 'amarelo',
};

/** Painel na tela de consultas: template do ERP vinculado e cópia para a empresa. */
export function PainelTemplateErp({ conexoes }: { conexoes: ConexaoBancoResumo[] }) {
  const { empresaId, pode } = useAuth();
  const podeEditar = pode('sql.editar');
  const cliente = useQueryClient();
  const { data: erp } = useQuery({ queryKey: ['erp-empresa', empresaId], queryFn: () => api<ErpDaEmpresa>('/erp-empresa') });
  const compativeis = conexoes.filter((c) => c.ativo && c.tipo === erp?.sistema?.tipoBanco);
  const [conexaoId, setConexaoId] = useState('');
  const [resultado, setResultado] = useState<CopiarTemplateResposta | null>(null);
  const invalidar = () => {
    void cliente.invalidateQueries({ queryKey: ['erp-empresa', empresaId] });
    void cliente.invalidateQueries({ queryKey: ['consultas', empresaId] });
  };

  const copiar = useMutation({
    mutationFn: (templateIds?: string[]) =>
      api<CopiarTemplateResposta>('/erp-empresa/copiar', { metodo: 'POST', corpo: { conexaoId: conexaoId || compativeis[0]?.id, templateIds } }),
    onSuccess: (r) => {
      setResultado(r);
      invalidar();
    },
  });
  const restaurar = useMutation({
    mutationFn: (consultaId: string) => api(`/consultas/${consultaId}/restaurar-template`, { metodo: 'POST' }),
    onSuccess: invalidar,
  });

  if (!erp?.sistema) return null;
  const faltam = erp.consultas.filter((c) => !c.copia);

  return (
    <section className="mb-6 space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Template do ERP: {erp.sistema.nome}</h2>
          <p className="text-sm text-slate-600">
            {ROTULO_TIPO_BANCO[erp.sistema.tipoBanco]} · {erp.consultas.length} consulta(s) padrão. As cópias podem ser ajustadas livremente.
          </p>
        </div>
        {podeEditar && faltam.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {compativeis.length > 1 && (
              <select value={conexaoId} onChange={(e) => setConexaoId(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" aria-label="Conexão">
                {compativeis.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            )}
            <Botao disabled={copiar.isPending || compativeis.length === 0} onClick={() => copiar.mutate(undefined)}>
              {copiar.isPending ? 'Copiando…' : `Copiar ${faltam.length} consulta(s) para a empresa`}
            </Botao>
          </div>
        )}
      </div>
      {podeEditar && faltam.length > 0 && compativeis.length === 0 && (
        <Alerta tipo="info">
          Cadastre em Bancos de dados uma conexão {ROTULO_TIPO_BANCO[erp.sistema.tipoBanco]} para copiar o template.
        </Alerta>
      )}
      {(copiar.error ?? restaurar.error) && <Alerta>{(copiar.error ?? restaurar.error)!.message}</Alerta>}
      {resultado && (
        <Alerta tipo="info">
          {resultado.copiadas.length} consulta(s) copiada(s).
          {resultado.avisos.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {resultado.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </Alerta>
      )}
      <ul className="divide-y divide-blue-100 rounded border border-blue-100 bg-white text-sm">
        {erp.consultas.map(({ template, copia }) => (
          <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div>
              <span className="font-medium">{template.nome}</span> <span className="text-xs text-slate-500">{ROTULO_FINALIDADE[template.finalidade]}</span>
              {copia && copia.camposFaltando.length > 0 && (
                <div className="text-xs text-amber-800">Não devolve mais: {copia.camposFaltando.join(', ')}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {copia ? (
                <>
                  <Selo cor={COR[copia.situacao]}>{ROTULO_SITUACAO_COPIA[copia.situacao]}</Selo>
                  <Link to={`/consultas/${copia.id}`} className="text-xs text-blue-700 hover:underline">Abrir</Link>
                  {podeEditar && copia.situacao !== 'igual' && (
                    <button
                      type="button"
                      className="text-xs text-blue-700 hover:underline"
                      disabled={restaurar.isPending}
                      onClick={() =>
                        window.confirm(`Substituir o SQL de "${copia.nome}" pelo do template? Os ajustes da empresa nesta consulta serão perdidos.`) &&
                        restaurar.mutate(copia.id)
                      }
                    >
                      {copia.situacao === 'ajustada' ? 'Restaurar do template' : 'Atualizar do template'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <Selo cor="cinza">Não copiada</Selo>
                  {podeEditar && compativeis.length > 0 && (
                    <button type="button" className="text-xs text-blue-700 hover:underline" disabled={copiar.isPending} onClick={() => copiar.mutate([template.id])}>
                      Copiar
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
