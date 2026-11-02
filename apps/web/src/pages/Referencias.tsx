import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROTULO_FINALIDADE, type FinalidadeConsulta, type ReferenciaCampo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selo, Tabela } from '../components/ui';

/** Finalidades em que um campo pode ser obrigatório. "Outra" não tem exigência. */
const FINALIDADES: { valor: FinalidadeConsulta; rotulo: string }[] = [
  { valor: 'LISTA_DIARIA', rotulo: 'Lista do dia' },
  { valor: 'BUSCA_PRODUTO', rotulo: 'Etiqueta avulsa' },
];

type Edicao = { referencia: ReferenciaCampo | null } | null;

export function Referencias() {
  const { usuario } = useAuth();
  const podeEditar = Boolean(usuario?.superAdmin);
  const cliente = useQueryClient();
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [filtro, setFiltro] = useState('');
  const { data: referencias = [], isLoading, error } = useQuery({ queryKey: ['referencias'], queryFn: () => api<ReferenciaCampo[]>('/referencias') });
  const excluir = useMutation({
    mutationFn: (id: string) => api(`/referencias/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['referencias'] }),
  });

  const f = filtro.trim().toLowerCase();
  const visiveis = f ? referencias.filter((r) => [r.alias, r.nome, r.descricao, ...r.alternativos].some((t) => t.toLowerCase().includes(f))) : referencias;

  return (
    <>
      <Cabecalho
        titulo="Índice de campos"
        descricao="O que cada alias significa no sistema. Na consulta, relacione a coluna do banco com o alias: p.preco_venda AS preco."
        acoes={podeEditar && <Botao onClick={() => setEdicao({ referencia: null })}>Novo campo</Botao>}
      />
      <div className="space-y-4">
        {(error ?? excluir.error) && <Alerta>{(error ?? excluir.error)!.message}</Alerta>}
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Procurar campo…"
          aria-label="Procurar campo"
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {!isLoading && (
          <Tabela colunas={['Alias', 'O que é', 'Outros nomes aceitos', 'Exemplo', 'Obrigatório em', '']} vazio={visiveis.length === 0}>
            {visiveis.map((r) => (
              <tr key={r.id} className={r.ativa ? '' : 'text-slate-400'}>
                <td className="px-4 py-2.5 align-top font-mono text-sm font-medium">
                  {r.alias}
                  {r.sistema && <div className="mt-1 font-sans"><Selo cor="verde">Sistema</Selo></div>}
                  {!r.ativa && <div className="mt-1 font-sans"><Selo cor="cinza">Inativo</Selo></div>}
                </td>
                <td className="max-w-sm px-4 py-2.5 align-top">
                  <div className="font-medium">{r.nome}</div>
                  {r.descricao && <div className="text-xs text-slate-500">{r.descricao}</div>}
                </td>
                <td className="max-w-48 px-4 py-2.5 align-top font-mono text-xs text-slate-600">{r.alternativos.join(', ') || '—'}</td>
                <td className="px-4 py-2.5 align-top text-slate-600">{r.exemplo || '—'}</td>
                <td className="px-4 py-2.5 align-top">
                  {r.obrigatoriaEm.length === 0 ? (
                    <span className="text-slate-500">Opcional</span>
                  ) : (
                    <div className="flex flex-col items-start gap-1">
                      {r.obrigatoriaEm.map((o) => <Selo key={o} cor="amarelo">{FINALIDADES.find((x) => x.valor === o)?.rotulo ?? ROTULO_FINALIDADE[o]}</Selo>)}
                    </div>
                  )}
                </td>
                <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right align-top">
                  {podeEditar && <Botao variante="secundario" aria-label={`Editar ${r.alias}`} onClick={() => setEdicao({ referencia: r })}>Editar</Botao>}
                  {podeEditar && !r.sistema && (
                    <Botao variante="secundario" aria-label={`Excluir ${r.alias}`} disabled={excluir.isPending} onClick={() => window.confirm(`Excluir o campo ${r.alias} do índice? As consultas que usam esse alias continuam funcionando.`) && excluir.mutate(r.id)}>
                      Excluir
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
        )}
      </div>

      <Modal titulo={edicao?.referencia ? `Editar ${edicao.referencia.alias}` : 'Novo campo'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && <FormReferencia referencia={edicao.referencia} aoConcluir={() => setEdicao(null)} />}
      </Modal>
    </>
  );
}

function FormReferencia({ referencia, aoConcluir }: { referencia: ReferenciaCampo | null; aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const fixo = Boolean(referencia?.sistema);
  const [f, setF] = useState({
    alias: referencia?.alias ?? '',
    nome: referencia?.nome ?? '',
    descricao: referencia?.descricao ?? '',
    exemplo: referencia?.exemplo ?? '',
    alternativos: referencia?.alternativos.join(', ') ?? '',
    obrigatoriaEm: referencia?.obrigatoriaEm ?? ([] as FinalidadeConsulta[]),
    ativa: referencia?.ativa ?? true,
  });
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: f.nome,
        descricao: f.descricao,
        exemplo: f.exemplo,
        obrigatoriaEm: f.obrigatoriaEm,
        ...(fixo ? {} : { alias: f.alias, alternativos: f.alternativos.split(/[\s,;]+/).filter(Boolean) }),
      };
      return referencia ? api(`/referencias/${referencia.id}`, { metodo: 'PATCH', corpo: { ...corpo, ...(fixo ? {} : { ativa: f.ativa }) } }) : api('/referencias', { metodo: 'POST', corpo });
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['referencias'] });
      aoConcluir();
    },
  });

  function alternar(valor: FinalidadeConsulta, ligar: boolean) {
    setF({ ...f, obrigatoriaEm: ligar ? [...f.obrigatoriaEm, valor] : f.obrigatoriaEm.filter((o) => o !== valor) });
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
      {fixo && <Alerta tipo="info">O sistema lê este campo pelo nome, então o alias e os outros nomes são fixos.</Alerta>}
      <Campo rotulo="Alias" required disabled={fixo} value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })} ajuda="Como aparece na consulta: letras minúsculas sem acento, números e sublinhado." />
      <Campo rotulo="O que é" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <label className="block text-sm font-medium text-slate-700">
        Descrição
        <textarea rows={2} maxLength={500} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
      </label>
      <Campo rotulo="Exemplo de valor" value={f.exemplo} onChange={(e) => setF({ ...f, exemplo: e.target.value })} />
      <Campo rotulo="Outros nomes aceitos" disabled={fixo} value={f.alternativos} onChange={(e) => setF({ ...f, alternativos: e.target.value })} ajuda="Separados por vírgula. Uma coluna com um desses nomes já conta como este campo." />
      <fieldset className="space-y-1 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Obrigatório nas consultas de</legend>
        {FINALIDADES.map((o) => (
          <label key={o.valor} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.obrigatoriaEm.includes(o.valor)} onChange={(e) => alternar(o.valor, e.target.checked)} />
            {o.rotulo}
          </label>
        ))}
        <p className="text-xs text-slate-500">Sem marcar nada, o campo é opcional. Consulta nova ou alterada sem um campo obrigatório não é salva.</p>
      </fieldset>
      {referencia && !fixo && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />
          Ativo (inativo não aparece no editor de consultas)
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
      </div>
    </form>
  );
}
