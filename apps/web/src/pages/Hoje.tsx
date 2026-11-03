import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  MODELOS_POST,
  problemaNasFolhas,
  QUANTIDADE_MAXIMA_ITEM,
  registroBanido,
  textoNaTela,
  type BanirResposta,
  type ImprimirResposta,
  type ItemListaResumo,
  type LimitesFolha,
  type ListaDiariaResumo,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { BanirProdutos } from '../components/BanirProdutos';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { AcompanharTrabalhos } from '../components/Trabalhos';
import { Alerta, Botao, Cabecalho, Selo, formatarData } from '../components/ui';

export function Hoje() {
  return (
    <ExigeEmpresa>
      <ListaDoDia />
    </ExigeEmpresa>
  );
}

interface Grupo {
  chave: string;
  impressora: string;
  modelo: string;
  semImpressora: boolean;
  folha: LimitesFolha | null;
  itens: ItemListaResumo[];
  /** Todas as colunas que a consulta do modelo trouxe, na ordem dela. */
  colunas: string[];
}

function agrupar(lista: ListaDiariaResumo, itens: ItemListaResumo[]): Grupo[] {
  const modelos = new Map(lista.modelos.map((m) => [m.id, m]));
  const impressora = new Map(lista.impressoras.map((i) => [i.id, `${i.nome} (${i.linguagem})`]));
  const grupos = new Map<string, Grupo>();
  for (const item of itens) {
    const chave = `${item.impressoraId ?? ''}|${item.modeloId}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        impressora: item.impressoraId ? (impressora.get(item.impressoraId) ?? 'Impressora excluída') : 'Sem impressora',
        modelo: modelos.get(item.modeloId)?.nome ?? 'Modelo',
        semImpressora: !item.impressoraId,
        folha: modelos.get(item.modeloId)?.folha ?? null,
        itens: [],
        colunas: [...(modelos.get(item.modeloId)?.colunas ?? [])],
      });
    }
    const grupo = grupos.get(chave)!;
    grupo.itens.push(item);
    for (const c of Object.keys(item.registro)) if (!grupo.colunas.includes(c)) grupo.colunas.push(c);
  }
  return [...grupos.values()].sort((a, b) => a.impressora.localeCompare(b.impressora) || a.modelo.localeCompare(b.modelo));
}

function ListaDoDia() {
  const { empresaId, pode } = useAuth();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const chave = ['lista-hoje', empresaId];
  const { data, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<{ lista: ListaDiariaResumo | null }>('/listas/hoje') });
  const lista = data?.lista ?? null;

  // Seleção e quantidades ficam na tela até imprimir (desmarcado = não imprime agora).
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [envio, setEnvio] = useState<{ ids: string[]; avisos: string[] } | null>(null);
  const [banindo, setBanindo] = useState<ItemListaResumo[] | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const atualizarCache = (l: ListaDiariaResumo) => cliente.setQueryData(chave, { lista: l });
  const recarregar = () => void cliente.invalidateQueries({ queryKey: chave });

  const gerar = useMutation({
    mutationFn: () => api<ListaDiariaResumo>('/listas/hoje/gerar', { metodo: 'POST' }),
    onSuccess: (l) => {
      atualizarCache(l);
      setDesmarcados(new Set());
      setQuantidades({});
    },
  });

  const mudarItem = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'PENDENTE' | 'DESCARTADO' }) => api(`/listas/itens/${id}`, { metodo: 'PATCH', corpo: { status } }),
    onSuccess: recarregar,
  });

  const descartar = useMutation({
    mutationFn: (ids: string[]) => api<{ descartados: number }>('/listas/itens/descartar', { metodo: 'POST', corpo: { ids } }),
    onSuccess: recarregar,
  });

  const pendentes =useMemo(() => lista?.itens.filter((i) => i.status === 'PENDENTE') ?? [], [lista]);
  const grupos = useMemo(() => (lista ? agrupar(lista, pendentes) : []), [lista, pendentes]);
  const enviados = lista?.itens.filter((i) => i.status === 'NA_FILA' || i.status === 'IMPRESSO') ?? [];
  const descartados = lista?.itens.filter((i) => i.status === 'DESCARTADO') ?? [];

  const qtd = (i: ItemListaResumo) => quantidades[i.id] ?? i.quantidade;
  const selecionados = pendentes.filter((i) => !desmarcados.has(i.id));
  const totalEtiquetas = selecionados.reduce((s, i) => s + qtd(i), 0);

  const imprimir = useMutation({
    mutationFn: () =>
      api<ImprimirResposta>(`/listas/${lista!.id}/imprimir`, {
        metodo: 'POST',
        corpo: { itens: selecionados.map((i) => ({ id: i.id, quantidade: qtd(i) })) },
      }),
    onSuccess: (r) => {
      setEnvio({ ids: r.trabalhos.map((t) => t.id), avisos: r.avisos });
      setQuantidades({});
      recarregar();
    },
  });

  function alternar(ids: string[], marcar: boolean) {
    const novo = new Set(desmarcados);
    for (const id of ids) {
      if (marcar) novo.delete(id);
      else novo.add(id);
    }
    setDesmarcados(novo);
  }

  function apagarSelecionados() {
    if (!window.confirm(`Apagar ${selecionados.length} produto(s) da lista de hoje? Eles ficam em “Descartados hoje” e podem voltar à lista.`)) return;
    setResultado(`${selecionados.length} produto(s) apagado(s) da lista.`);
    descartar.mutate(selecionados.map((i) => i.id));
  }

  /** O produto pode estar em mais de um modelo: tudo o que ficou banido sai da lista, não só o marcado. */
  function aposBanir(codigos: string[], r: BanirResposta) {
    const banidos = new Set(codigos);
    const ids = pendentes.filter((i) => registroBanido(i.registro, banidos)).map((i) => i.id);
    setBanindo(null);
    setResultado(`${r.incluidos} código(s) banido(s)` + (r.jaBanidos ? `, ${r.jaBanidos} já estava(m) banido(s)` : '') + `. ${ids.length} produto(s) saíram da lista.`);
    if (ids.length) descartar.mutate(ids);
  }

  if (isLoading) return <div className="text-sm text-slate-500">Carregando…</div>;

  return (
    <>
      <Cabecalho
        titulo={lista ? `Hoje você tem ${pendentes.reduce((s, i) => s + qtd(i), 0)} etiqueta(s) para imprimir` : 'Lista do dia'}
        descricao={
          lista
            ? `${pendentes.length} produto(s) pendente(s) · lista atualizada em ${formatarData(lista.atualizadaEm)}`
            : 'Busca nos bancos do ERP os produtos que precisam de etiqueta hoje.'
        }
        acoes={
          <Botao variante={lista ? 'secundario' : 'primario'} disabled={gerar.isPending} onClick={() => gerar.mutate()}>
            {gerar.isPending ? 'Consultando…' : lista ? 'Atualizar lista' : 'Gerar lista de hoje'}
          </Botao>
        }
      />
      <div className="space-y-4">
        {(error ?? gerar.error) && <Alerta>{(error ?? gerar.error)!.message}</Alerta>}
        {descartar.error ? <Alerta>{descartar.error.message}</Alerta> : resultado && <Alerta tipo="info">{resultado}</Alerta>}
        {lista?.erros.map((e) => (
          <Alerta key={e.modeloId + e.mensagem} tipo="aviso">
            <strong>{e.modeloNome}:</strong> {e.mensagem}
          </Alerta>
        ))}
        {lista && pendentes.length === 0 && <Alerta tipo="info">Nenhuma etiqueta pendente. Use “Atualizar lista” para buscar alterações novas.</Alerta>}

        {grupos.map((g) => {
          const ids = g.itens.map((i) => i.id);
          const todos = ids.every((id) => !desmarcados.has(id));
          const etiquetasDoGrupo = g.itens.filter((i) => !desmarcados.has(i.id)).reduce((s, i) => s + qtd(i), 0);
          const problemaFolha = etiquetasDoGrupo > 0 ? problemaNasFolhas(etiquetasDoGrupo, g.folha) : null;
          return (
            <section key={g.chave} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={todos} onChange={(e) => alternar(ids, e.target.checked)} aria-label="Marcar todos do grupo" />
                  {g.modelo}
                  <span className="font-normal text-slate-500">→ {g.impressora}</span>
                </label>
                <span className="text-xs text-slate-500">
                  {etiquetasDoGrupo} etiqueta(s)
                  {g.folha && ` · ${g.folha.minimo === g.folha.maximo ? g.folha.minimo : `${g.folha.minimo} a ${g.folha.maximo}`} por folha`}
                </span>
              </header>
              {g.semImpressora && (
                <div className="px-4 pt-3">
                  <Alerta tipo="aviso">Defina a impressora deste modelo (Modelos de etiqueta) para imprimir estes itens.</Alerta>
                </div>
              )}
              {problemaFolha && (
                <div className="px-4 pt-3">
                  <Alerta tipo="aviso">{problemaFolha} Sem ajuste, este modelo não será enviado.</Alerta>
                </div>
              )}
              <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="w-10 px-4 py-2" />
                    <th className="w-28 px-2 py-2 font-medium">Etiquetas</th>
                    {g.colunas.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-2 font-medium">{c}</th>
                    ))}
                    <th className="w-24 px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {g.itens.map((i) => (
                    <tr key={i.id} className={desmarcados.has(i.id) ? 'text-slate-400' : ''}>
                      <td className="w-10 px-4 py-2">
                        <input type="checkbox" checked={!desmarcados.has(i.id)} onChange={(e) => alternar([i.id], e.target.checked)} aria-label={`Imprimir ${i.descricao}`} />
                      </td>
                      <td className="w-28 px-2 py-2">
                        <input
                          type="number"
                          min={1}
                          max={QUANTIDADE_MAXIMA_ITEM}
                          value={qtd(i)}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(QUANTIDADE_MAXIMA_ITEM, Math.floor(e.target.valueAsNumber || 1)));
                            setQuantidades({ ...quantidades, [i.id]: n });
                          }}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                          aria-label="Quantidade"
                        />
                      </td>
                      {g.colunas.map((c, n) => (
                        <td key={c} className="whitespace-nowrap px-2 py-2">
                          {textoNaTela(i.registro[c])}
                          {n === 0 && i.trabalhoId && <span className="ml-2"><Selo cor="vermelho">Falhou antes</Selo></span>}
                        </td>
                      ))}
                      <td className="w-24 px-4 py-2 text-right">
                        <button type="button" className="text-xs text-slate-500 hover:text-red-700" onClick={() => mudarItem.mutate({ id: i.id, status: 'DESCARTADO' })}>
                          Descartar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          );
        })}

        {pendentes.length > 0 && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <label className="mr-auto flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={selecionados.length === pendentes.length} onChange={(e) => alternar(pendentes.map((i) => i.id), e.target.checked)} />
              Marcar todos
            </label>
            {pode('produto_banido.editar') && (
              <Botao variante="secundario" disabled={selecionados.length === 0} onClick={() => setBanindo(selecionados)}>
                Banir selecionados
              </Botao>
            )}
            <Botao variante="secundario" disabled={descartar.isPending || selecionados.length === 0} onClick={apagarSelecionados}>
              Apagar selecionados
            </Botao>
            {pode('post.editar') && (
              <Botao
                variante="secundario"
                disabled={selecionados.length === 0 || selecionados.length > MODELOS_POST.OFERTA.maxProdutos}
                title={`Marque de 1 a ${MODELOS_POST.OFERTA.maxProdutos} produtos.`}
                onClick={() => navegar('/posts/novo', { state: { registros: selecionados.map((i) => i.registro) } })}
              >
                Criar post
              </Botao>
            )}
            <span className="text-sm text-slate-600">
              {selecionados.length} produto(s) · <strong>{totalEtiquetas}</strong> etiqueta(s)
            </span>
            <Botao disabled={imprimir.isPending || selecionados.length === 0} onClick={() => imprimir.mutate()}>
              {imprimir.isPending ? 'Gerando…' : 'Imprimir selecionadas'}
            </Botao>
          </div>
        )}
        {imprimir.error && <Alerta>{imprimir.error.message}</Alerta>}
        <BanirProdutos registros={banindo?.map((i) => i.registro) ?? null} aoFechar={() => setBanindo(null)} aoBanir={aposBanir} />

        {envio && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Impressão enviada</h2>
            {envio.avisos.map((a) => (
              <Alerta key={a} tipo="aviso">{a}</Alerta>
            ))}
            <AcompanharTrabalhos ids={envio.ids} aoTerminar={recarregar} />
          </div>
        )}

        {enviados.length > 0 && (
          <details className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            <summary className="cursor-pointer text-slate-600">Já enviados hoje ({enviados.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100">
              {enviados.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 py-1.5">
                  <span>{i.descricao} <span className="text-xs text-slate-400">× {i.quantidade}</span></span>
                  {i.status === 'IMPRESSO' ? <Selo cor="verde">Impresso {i.impressoEm && formatarData(i.impressoEm).split(' ')[1]}</Selo> : <Selo cor="amarelo">Na fila</Selo>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {descartados.length > 0 && (
          <details className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            <summary className="cursor-pointer text-slate-600">Descartados hoje ({descartados.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100">
              {descartados.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 py-1.5">
                  <span className="text-slate-500">{i.descricao}</span>
                  <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => mudarItem.mutate({ id: i.id, status: 'PENDENTE' })}>
                    Voltar à lista
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
