import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatarDataBr,
  formatarMoeda,
  ROTULO_ETAPA,
  type AssinaturaResumo,
  type PagamentoResumo,
  type ParametrosCobrancaEmpresa,
  type SituacaoCobrancaEmpresa,
} from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Campo } from '../../components/ui';

const hoje = () => new Date().toLocaleDateString('en-CA');

export function FormAssinatura({ situacao, aoMudar }: { situacao: SituacaoCobrancaEmpresa; aoMudar: () => void }) {
  const empresaId = situacao.empresa.id;
  const cliente = useQueryClient();
  const [assinatura, setAssinatura] = useState<AssinaturaResumo | null>(situacao.assinatura);
  const atualizarTudo = () => {
    aoMudar();
    void cliente.invalidateQueries({ queryKey: ['empresas'] });
  };

  return (
    <div className="space-y-6">
      {situacao.avaliacao && (
        <p className="text-sm">
          Situação: <strong>{ROTULO_ETAPA[situacao.avaliacao.etapa]}</strong>
          {situacao.avaliacao.diasAtraso > 0 && ` · ${situacao.avaliacao.diasAtraso} dia(s) de atraso`}
          {situacao.avaliacao.etapa !== 'BLOQUEADA' && situacao.avaliacao.diasAtraso > 0 && ` · bloqueio em ${situacao.avaliacao.diasParaBloqueio} dia(s)`}
        </p>
      )}
      <DadosAssinatura
        empresaId={empresaId}
        inicial={assinatura}
        aoSalvar={(a) => {
          setAssinatura(a);
          atualizarTudo();
        }}
      />
      {assinatura && <Pagamentos empresaId={empresaId} assinatura={assinatura} aoMudar={atualizarTudo} />}
      <Sobrescritos empresaId={empresaId} inicial={situacao.parametros} aoSalvar={atualizarTudo} />
    </div>
  );
}

function DadosAssinatura({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial: AssinaturaResumo | null; aoSalvar: (a: AssinaturaResumo | null) => void }) {
  const [f, setF] = useState({
    valorMensal: String(inicial?.valorMensal ?? ''),
    diaVencimento: String(inicial?.diaVencimento ?? 10),
    vencimentoAtual: inicial?.vencimentoAtual ?? hoje(),
    controleManual: inicial?.controleManual ?? false,
    observacoes: inicial?.observacoes ?? '',
  });
  const salvar = useMutation({
    mutationFn: () =>
      api<AssinaturaResumo>(`/cobranca/empresas/${empresaId}/assinatura`, {
        metodo: 'PUT',
        corpo: { ...f, valorMensal: Number(f.valorMensal), diaVencimento: Number(f.diaVencimento), observacoes: f.observacoes || undefined },
      }),
    onSuccess: aoSalvar,
  });
  const remover = useMutation({ mutationFn: () => api(`/cobranca/empresas/${empresaId}/assinatura`, { metodo: 'DELETE' }), onSuccess: () => aoSalvar(null) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <h3 className="text-sm font-semibold">Mensalidade</h3>
      {(salvar.error ?? remover.error) && <Alerta>{(salvar.error ?? remover.error)!.message}</Alerta>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Valor mensal (R$)" type="number" step="0.01" min={0} required value={f.valorMensal} onChange={(e) => setF({ ...f, valorMensal: e.target.value })} />
        <Campo rotulo="Dia do vencimento" type="number" min={1} max={31} required value={f.diaVencimento} onChange={(e) => setF({ ...f, diaVencimento: e.target.value })} />
        <Campo
          rotulo="Vencimento em aberto"
          type="date"
          required
          value={f.vencimentoAtual}
          onChange={(e) => setF({ ...f, vencimentoAtual: e.target.value })}
          ajuda="Mensalidade mais antiga ainda não paga."
        />
      </div>
      <Campo rotulo="Observações" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.controleManual} onChange={(e) => setF({ ...f, controleManual: e.target.checked })} />
        Controle manual: a avaliação diária não muda o status desta empresa (use o cadastro da empresa para bloquear/liberar)
      </label>
      <div className="flex justify-end gap-2">
        {inicial && (
          <Botao variante="secundario" disabled={remover.isPending} onClick={() => window.confirm('Remover a assinatura? A empresa deixa de ser cobrada e avaliada.') && remover.mutate()}>
            Remover assinatura
          </Botao>
        )}
        <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar mensalidade'}</Botao>
      </div>
    </form>
  );
}

function Pagamentos({ empresaId, assinatura, aoMudar }: { empresaId: string; assinatura: AssinaturaResumo; aoMudar: () => void }) {
  const cliente = useQueryClient();
  const chave = ['pagamentos', empresaId];
  const { data: pagamentos = [] } = useQuery({ queryKey: chave, queryFn: () => api<PagamentoResumo[]>(`/cobranca/empresas/${empresaId}/pagamentos`) });
  const [f, setF] = useState({ meses: '1', valor: '', pagoEm: hoje(), observacao: '' });
  const aposMudar = (lista: PagamentoResumo[]) => {
    cliente.setQueryData(chave, lista);
    aoMudar();
  };
  const registrar = useMutation({
    mutationFn: () =>
      api<PagamentoResumo[]>(`/cobranca/empresas/${empresaId}/pagamentos`, {
        metodo: 'POST',
        corpo: { meses: Number(f.meses), valor: f.valor ? Number(f.valor) : undefined, pagoEm: f.pagoEm, observacao: f.observacao || undefined },
      }),
    onSuccess: (l) => {
      aposMudar(l);
      setF({ ...f, valor: '', observacao: '' });
    },
  });
  const estornar = useMutation({
    mutationFn: (id: string) => api<PagamentoResumo[]>(`/cobranca/empresas/${empresaId}/pagamentos/${id}/estornar`, { metodo: 'POST' }),
    onSuccess: aposMudar,
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    registrar.mutate();
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Pagamentos</h3>
      {(registrar.error ?? estornar.error) && <Alerta>{(registrar.error ?? estornar.error)!.message}</Alerta>}
      <form onSubmit={enviar} className="grid items-end gap-2 sm:grid-cols-[6rem_9rem_10rem_1fr_auto]">
        <Campo rotulo="Meses" type="number" min={1} max={36} required value={f.meses} onChange={(e) => setF({ ...f, meses: e.target.value })} />
        <Campo
          rotulo="Valor (R$)"
          type="number"
          step="0.01"
          min={0}
          placeholder={String((assinatura.valorMensal * Number(f.meses || 1)).toFixed(2))}
          value={f.valor}
          onChange={(e) => setF({ ...f, valor: e.target.value })}
        />
        <Campo rotulo="Pago em" type="date" required value={f.pagoEm} onChange={(e) => setF({ ...f, pagoEm: e.target.value })} />
        <Campo rotulo="Observação" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
        <Botao type="submit" disabled={registrar.isPending}>Registrar</Botao>
      </form>
      <p className="text-xs text-slate-500">Quita a(s) mensalidade(s) a partir de {formatarDataBr(assinatura.vencimentoAtual)} e reavalia na hora (libera se estiver bloqueada).</p>
      {pagamentos.length > 0 && (
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Pago em</th>
              <th>Valor</th>
              <th>Quitou</th>
              <th>Por</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagamentos.map((p, i) => (
              <tr key={p.id}>
                <td className="py-1.5">{formatarDataBr(p.pagoEm)}</td>
                <td>{formatarMoeda(p.valor)}</td>
                <td>
                  {p.meses} mês(es): {formatarDataBr(p.vencimentoQuitado)} → próximo {formatarDataBr(p.novoVencimento)}
                </td>
                <td className="text-slate-500">{p.registradoPor ?? '—'}</td>
                <td className="text-right">
                  {i === 0 && (
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      disabled={estornar.isPending}
                      onClick={() => window.confirm('Estornar este pagamento? O vencimento volta ao anterior.') && estornar.mutate(p.id)}
                    >
                      Estornar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const ROTULOS: Record<keyof ParametrosCobrancaEmpresa, string> = {
  diasAvisoPrevio: 'Aviso prévio',
  diasCarencia: 'Carência',
  diasAteBloqueio: 'Bloqueio',
  frequenciaAvisoDias: 'Repetir aviso',
};

function Sobrescritos({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial: ParametrosCobrancaEmpresa; aoSalvar: () => void }) {
  const [f, setF] = useState<Record<keyof ParametrosCobrancaEmpresa, string>>({
    diasAvisoPrevio: inicial.diasAvisoPrevio?.toString() ?? '',
    diasCarencia: inicial.diasCarencia?.toString() ?? '',
    diasAteBloqueio: inicial.diasAteBloqueio?.toString() ?? '',
    frequenciaAvisoDias: inicial.frequenciaAvisoDias?.toString() ?? '',
  });
  const salvar = useMutation({
    mutationFn: () =>
      api(`/cobranca/empresas/${empresaId}/parametros`, {
        metodo: 'PUT',
        corpo: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : Number(v)])),
      }),
    onSuccess: aoSalvar,
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <h3 className="text-sm font-semibold">Prazos desta empresa (dias)</h3>
      <p className="text-xs text-slate-500">Em branco = usa o parâmetro global.</p>
      {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
      {salvar.isSuccess && <Alerta tipo="info">Prazos salvos e empresa reavaliada.</Alerta>}
      <div className="grid gap-2 sm:grid-cols-4">
        {(Object.keys(ROTULOS) as (keyof ParametrosCobrancaEmpresa)[]).map((k) => (
          <Campo key={k} rotulo={ROTULOS[k]} type="number" min={0} max={365} placeholder="global" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        ))}
      </div>
      <div className="flex justify-end">
        <Botao type="submit" variante="secundario" disabled={salvar.isPending}>Salvar prazos</Botao>
      </div>
    </form>
  );
}
