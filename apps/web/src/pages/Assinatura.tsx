import { useQuery } from '@tanstack/react-query';
import { formatarDataBr, formatarMoeda, ROTULO_ETAPA, type MinhaAssinatura } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Cabecalho } from '../components/ui';

export function Assinatura() {
  return (
    <ExigeEmpresa>
      <MinhaAssinaturaPagina />
    </ExigeEmpresa>
  );
}

function MinhaAssinaturaPagina() {
  const { empresaId } = useAuth();
  const { data, error } = useQuery({ queryKey: ['minha-assinatura', empresaId], queryFn: () => api<MinhaAssinatura>('/assinatura') });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!data) return <div className="text-sm text-slate-500">Carregando…</div>;
  const { assinatura, avaliacao } = data;

  return (
    <>
      <Cabecalho titulo="Assinatura" descricao="Mensalidade da empresa no Sistema de Etiquetas." />
      {!assinatura ? (
        <Alerta tipo="info">Esta empresa não tem mensalidade cadastrada.</Alerta>
      ) : (
        <dl className="grid max-w-2xl gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Mensalidade</dt>
            <dd className="text-lg font-semibold">{formatarMoeda(assinatura.valorMensal)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Vencimento</dt>
            <dd className="text-lg font-semibold">Todo dia {assinatura.diaVencimento}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Próxima mensalidade em aberto</dt>
            <dd>{formatarDataBr(assinatura.vencimentoAtual)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Situação</dt>
            <dd>
              {avaliacao ? ROTULO_ETAPA[avaliacao.etapa] : '—'}
              {avaliacao && avaliacao.diasAtraso > 0 && ` · ${avaliacao.diasAtraso} dia(s) de atraso`}
            </dd>
          </div>
        </dl>
      )}
    </>
  );
}
