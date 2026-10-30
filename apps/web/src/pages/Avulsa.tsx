import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  somarResultados,
  type BuscaAvulsaResposta,
  type ImpressoraResumo,
  type ImprimirResposta,
  type LinhaAvulsa,
  type ModeloAvulso,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { AcompanharTrabalhos } from '../components/Trabalhos';
import { Alerta, Botao, Cabecalho, Selecao } from '../components/ui';
import { Grade } from './avulsa/Grade';

/** Limites do pedido de impressão avulsa (iguais aos da API). */
const MAXIMO_LINHAS = 200;
const MAXIMO_ETIQUETAS = 20_000;
const LIMITE_HISTORICO = 30;

export function Avulsa() {
  return (
    <ExigeEmpresa>
      <EtiquetaAvulsa />
    </ExigeEmpresa>
  );
}

function carregar(chave: string): LinhaAvulsa[] {
  try {
    const dados = JSON.parse(localStorage.getItem(chave) ?? '[]');
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

/**
 * Lista do modelo, guardada no navegador: recarregar a página ou trocar de modelo e voltar
 * não perde o que foi montado. Inclui o histórico para desfazer.
 */
function useListaDoModelo(chave: string) {
  const [estado, setEstado] = useState(() => ({ chave, linhas: carregar(chave), historico: [] as LinhaAvulsa[][] }));
  const atual = estado.chave === chave ? estado : { chave, linhas: carregar(chave), historico: [] };
  if (atual !== estado) setEstado(atual);
  const ref = useRef(atual);
  ref.current = atual;

  useEffect(() => {
    try {
      if (atual.linhas.length) localStorage.setItem(atual.chave, JSON.stringify(atual.linhas));
      else localStorage.removeItem(atual.chave);
    } catch {
      // Navegador sem armazenamento: a lista vale só nesta tela.
    }
  }, [atual.chave, atual.linhas]);

  const trocar = useCallback((linhas: LinhaAvulsa[], historico: LinhaAvulsa[][]) => {
    ref.current = { ...ref.current, linhas, historico };
    setEstado(ref.current);
  }, []);
  return {
    linhas: atual.linhas,
    podeDesfazer: atual.historico.length > 0,
    alterar: (novas: LinhaAvulsa[]) => trocar(novas, [...ref.current.historico.slice(-(LIMITE_HISTORICO - 1)), ref.current.linhas]),
    substituir: (novas: LinhaAvulsa[]) => trocar(novas, ref.current.historico),
    lembrar: (antes: LinhaAvulsa[]) => trocar(ref.current.linhas, [...ref.current.historico.slice(-(LIMITE_HISTORICO - 1)), antes]),
    desfazer: () => {
      const h = ref.current.historico;
      if (h.length) trocar(h[h.length - 1], h.slice(0, -1));
    },
  };
}

function EtiquetaAvulsa() {
  const { empresaId, pode } = useAuth();
  const { data: modelos = [], isLoading } = useQuery({
    queryKey: ['avulsa-modelos', empresaId],
    queryFn: () => api<ModeloAvulso[]>('/avulsa/modelos'),
  });
  const { data: impressoras = [] } = useQuery({
    queryKey: ['impressoras', empresaId],
    queryFn: () => api<ImpressoraResumo[]>('/impressoras'),
    enabled: pode('impressora.ver'),
  });

  const [modeloId, setModeloId] = useState('');
  const [impressoraId, setImpressoraId] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [somar, setSomar] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [focarId, setFocarId] = useState<string | null>(null);
  const [envio, setEnvio] = useState<ImprimirResposta | null>(null);
  const primeiroParametro = useRef<HTMLInputElement>(null);

  const modelo = modelos.find((m) => m.id === modeloId) ?? modelos[0] ?? null;
  const lista = useListaDoModelo(`etiquetas.avulsa.${empresaId}.${modelo?.id ?? ''}`);
  const { linhas } = lista;

  // Colunas: campos do modelo primeiro, depois as que vieram das buscas.
  const colunas = [...new Set([...(modelo?.campos ?? []), ...linhas.flatMap((l) => Object.keys(l.registro))])];

  const buscar = useMutation({
    mutationFn: () => api<BuscaAvulsaResposta>('/avulsa/buscar', { metodo: 'POST', corpo: { modeloId: modelo!.id, parametros: valores } }),
    onSuccess: (r) => {
      setEnvio(null);
      if (r.registros.length === 0) return setAviso('Nenhum produto encontrado.');
      const umSo = r.registros.length === 1;
      if (somar && umSo) {
        // Leitor de código de barras: o mesmo produto de novo soma uma etiqueta.
        const igual = linhas.find((l) => JSON.stringify(l.registro) === JSON.stringify(r.registros[0]));
        if (igual) {
          lista.alterar(linhas.map((l) => (l === igual ? { ...l, quantidade: l.quantidade + 1 } : l)));
          setAviso(`Produto já estava na lista: agora com ${igual.quantidade + 1} etiqueta(s).`);
          return limparBusca();
        }
      }
      const base = somar ? linhas : [];
      const { linhas: novas, novas: quantas } = somarResultados(base, r.registros, () => crypto.randomUUID(), umSo ? 1 : 0);
      lista.alterar(novas);
      const repetidos = r.registros.length - quantas;
      setAviso(
        `${quantas} produto(s) ${somar ? 'adicionado(s) à lista' : 'na lista'}` +
          (repetidos ? `, ${repetidos} já estava(m) nela` : '') +
          (umSo ? '.' : '. Informe a quantidade de etiquetas de cada um (ou use “Alterar em massa”).'),
      );
      limparBusca();
    },
  });

  function limparBusca() {
    setValores({});
    primeiroParametro.current?.focus();
  }

  function novaLinha() {
    const id = crypto.randomUUID();
    lista.alterar([{ id, quantidade: 1, registro: Object.fromEntries(colunas.map((c) => [c, ''])) }, ...linhas]);
    setFocarId(id);
  }

  const imprimir = useMutation({
    mutationFn: (itens: LinhaAvulsa[]) =>
      api<ImprimirResposta>('/avulsa/imprimir', {
        metodo: 'POST',
        corpo: {
          modeloId: modelo!.id,
          impressoraId: impressoraId || undefined,
          itens: itens.map((l) => ({ registro: l.registro, quantidade: l.quantidade })),
        },
      }),
    onSuccess: setEnvio,
  });

  function enviarBusca(e: FormEvent) {
    e.preventDefault();
    buscar.mutate();
  }

  if (isLoading) return <div className="text-sm text-slate-500">Carregando…</div>;

  return (
    <>
      <Cabecalho
        titulo="Etiqueta avulsa"
        descricao="Monte a lista buscando no ERP ou digitando, ajuste os dados e imprima. A lista fica guardada neste navegador."
      />
      {modelos.length === 0 ? (
        <Alerta tipo="info">
          Nenhum modelo pronto para etiqueta avulsa. Crie uma consulta com finalidade “Busca de produto” usando {'{param.busca}'} e vincule-a a um modelo.
        </Alerta>
      ) : (
        <div className="space-y-4">
          <form onSubmit={enviarBusca} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="w-64">
              <Selecao
                rotulo="Modelo"
                value={modelo?.id ?? ''}
                onChange={(e) => {
                  setModeloId(e.target.value);
                  setAviso(null);
                  setEnvio(null);
                }}
              >
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </Selecao>
            </div>
            {modelo?.parametros.map((p, i) => (
              <label key={p} className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">{p === 'busca' ? 'Código, EAN ou nome' : p}</span>
                <input
                  ref={i === 0 ? primeiroParametro : undefined}
                  autoFocus={i === 0}
                  value={valores[p] ?? ''}
                  onChange={(e) => setValores({ ...valores, [p]: e.target.value })}
                  className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            ))}
            <Botao type="submit" disabled={buscar.isPending || !modelo}>{buscar.isPending ? 'Buscando…' : 'Buscar'}</Botao>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700" title="Desmarcado, cada busca substitui a lista">
              <input type="checkbox" checked={somar} onChange={(e) => setSomar(e.target.checked)} />
              Somar à lista
            </label>
            {linhas.length > 0 && (
              <button
                type="button"
                className="ml-auto pb-2 text-sm text-red-700 hover:underline"
                onClick={() => window.confirm(`Apagar as ${linhas.length} linha(s) da lista?`) && (lista.alterar([]), setAviso(null), setEnvio(null))}
              >
                Limpar lista
              </button>
            )}
          </form>
          {buscar.error && <Alerta>{buscar.error.message}</Alerta>}
          {aviso && <Alerta tipo="info">{aviso}</Alerta>}

          <Grade
            linhas={linhas}
            colunas={colunas}
            alterar={lista.alterar}
            substituir={lista.substituir}
            lembrar={lista.lembrar}
            podeDesfazer={lista.podeDesfazer}
            desfazer={lista.desfazer}
            novaLinha={novaLinha}
            focarId={focarId}
            rodape={(visiveis) => {
              const itens = visiveis.filter((l) => l.quantidade > 0);
              const total = itens.reduce((s, l) => s + l.quantidade, 0);
              const ocultas = linhas.filter((l) => l.quantidade > 0).length - itens.length;
              const problema =
                itens.length > MAXIMO_LINHAS
                  ? `No máximo ${MAXIMO_LINHAS} linhas por impressão; filtre ou imprima em partes.`
                  : total > MAXIMO_ETIQUETAS
                    ? `No máximo ${MAXIMO_ETIQUETAS.toLocaleString('pt-BR')} etiquetas por vez.`
                    : null;
              return (
                <div className="flex flex-wrap items-end justify-end gap-3 pt-2">
                  {ocultas > 0 && (
                    <p className="mr-auto self-center text-xs text-amber-700">
                      {ocultas} linha(s) com etiquetas estão ocultas pelo filtro e não serão impressas.
                    </p>
                  )}
                  {problema && <p className="mr-auto self-center text-xs text-red-700">{problema}</p>}
                  {impressoras.length > 0 && (
                    <div className="w-72">
                      <Selecao rotulo="Impressora" value={impressoraId} onChange={(e) => setImpressoraId(e.target.value)}>
                        <option value="">Padrão do modelo</option>
                        {impressoras.filter((i) => i.ativo).map((i) => (
                          <option key={i.id} value={i.id}>{i.nome} ({i.linguagem})</option>
                        ))}
                      </Selecao>
                    </div>
                  )}
                  <Botao disabled={imprimir.isPending || itens.length === 0 || problema !== null} onClick={() => imprimir.mutate(itens)}>
                    {imprimir.isPending ? 'Gerando…' : `Imprimir ${total} etiqueta(s)`}
                  </Botao>
                </div>
              );
            }}
          />

          {imprimir.error && <Alerta>{imprimir.error.message}</Alerta>}
          {envio && (
            <div className="space-y-2">
              {envio.avisos.map((a) => (
                <Alerta key={a} tipo="aviso">{a}</Alerta>
              ))}
              <AcompanharTrabalhos ids={envio.trabalhos.map((t) => t.id)} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
