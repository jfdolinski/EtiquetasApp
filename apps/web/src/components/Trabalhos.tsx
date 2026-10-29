import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROTULO_STATUS_TRABALHO, type StatusTrabalho, type TrabalhoResumo } from '@etiquetas/shared';
import { api, apiArquivo } from '../api';
import { useAuth } from '../auth';
import { Selo, formatarData } from './ui';

const COR: Record<StatusTrabalho, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  PENDENTE: 'amarelo',
  ENVIANDO: 'amarelo',
  CONCLUIDO: 'verde',
  ERRO: 'vermelho',
  CANCELADO: 'cinza',
};

export function SeloTrabalho({ t }: { t: TrabalhoResumo }) {
  const rotulo = t.status === 'CONCLUIDO' && t.linguagem === 'PDF' ? 'PDF gerado' : ROTULO_STATUS_TRABALHO[t.status];
  return <Selo cor={COR[t.status]}>{rotulo}</Selo>;
}

/** Abre (PDF) ou baixa o conteúdo gerado de um trabalho. */
export async function abrirConteudo(t: TrabalhoResumo) {
  const blob = await apiArquivo(`/trabalhos/${t.id}/conteudo`);
  const url = URL.createObjectURL(blob);
  if (t.linguagem === 'PDF') {
    window.open(url, '_blank');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `etiquetas-${t.id.slice(0, 8)}.${t.linguagem.toLowerCase()}`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function AcoesTrabalho({ t, aoMudar }: { t: TrabalhoResumo; aoMudar?: () => void }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const acao = useMutation({
    mutationFn: (tipo: 'reenviar' | 'cancelar') => api<TrabalhoResumo>(`/trabalhos/${t.id}/${tipo}`, { metodo: 'POST' }),
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: ['trabalhos', empresaId] });
      aoMudar?.();
    },
  });
  return (
    <span className="space-x-3 whitespace-nowrap text-xs">
      {t.linguagem === 'PDF' && (
        <button type="button" className="text-blue-700 hover:underline" onClick={() => void abrirConteudo(t)}>
          Abrir PDF
        </button>
      )}
      {(t.status === 'ERRO' || t.status === 'CANCELADO') && t.linguagem !== 'PDF' && (
        <button type="button" disabled={acao.isPending} className="text-blue-700 hover:underline" onClick={() => acao.mutate('reenviar')}>
          Reenviar
        </button>
      )}
      {(t.status === 'PENDENTE' || t.status === 'ERRO') && (
        <button type="button" disabled={acao.isPending} className="text-red-700 hover:underline" onClick={() => acao.mutate('cancelar')}>
          Cancelar
        </button>
      )}
      {acao.error && <span className="text-red-700">{acao.error.message}</span>}
    </span>
  );
}

const FINAIS: StatusTrabalho[] = ['CONCLUIDO', 'ERRO', 'CANCELADO'];

/** Acompanha os trabalhos recém-criados até terminarem (consulta a cada 2 s). */
export function AcompanharTrabalhos({ ids, aoTerminar }: { ids: string[]; aoTerminar?: () => void }) {
  const { empresaId } = useAuth();
  const { data: trabalhos = [] } = useQuery({
    queryKey: ['trabalhos', empresaId, 'acompanhar', ids.join(',')],
    queryFn: async () => {
      const lista = await api<TrabalhoResumo[]>(`/trabalhos?ids=${ids.join(',')}`);
      if (lista.every((t) => FINAIS.includes(t.status))) aoTerminar?.();
      return lista;
    },
    enabled: ids.length > 0,
    refetchInterval: (q) => (q.state.data?.every((t) => FINAIS.includes(t.status)) ? false : 2000),
  });
  if (!ids.length) return null;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
      {trabalhos.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span>
            <strong>{t.modeloNome}</strong> → {t.impressoraNome} · {t.quantidadeEtiquetas} etiqueta(s)
            {t.erro && <span className="block text-xs text-red-700">{t.erro}</span>}
          </span>
          <span className="flex items-center gap-3">
            <SeloTrabalho t={t} />
            <AcoesTrabalho t={t} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LinhaHistorico({ t }: { t: TrabalhoResumo }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-slate-500">{formatarData(t.criadoEm)}</td>
      <td className="px-4 py-2.5">
        <div className="font-medium">{t.modeloNome}</div>
        <div className="text-xs text-slate-500">{t.origem === 'LISTA' ? 'Lista do dia' : 'Avulsa'}</div>
      </td>
      <td className="px-4 py-2.5">
        {t.impressoraNome}
        <div className="text-xs text-slate-500">{t.linguagem}</div>
      </td>
      <td className="px-4 py-2.5">{t.quantidadeEtiquetas}</td>
      <td className="px-4 py-2.5">
        <SeloTrabalho t={t} />
        {t.erro && <div className="mt-1 max-w-xs text-xs text-red-700">{t.erro}</div>}
      </td>
      <td className="px-4 py-2.5 text-slate-500">{t.criadoPor ?? '—'}</td>
      <td className="px-4 py-2.5 text-right">
        <AcoesTrabalho t={t} />
      </td>
    </tr>
  );
}
