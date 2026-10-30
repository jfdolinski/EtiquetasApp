import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import {
  LAYOUT_PADRAO,
  ROTULO_CATEGORIA,
  validarLayout,
  type AmostraModelo,
  type ConsultaParaModelo,
  type ElementoEtiqueta,
  type ImpressoraResumo,
  type LayoutEtiqueta,
  type ModeloEtiquetaResumo,
  type TipoElemento,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { Alerta, Botao, Campo, Selecao } from '../../components/ui';
import { arredondar, novoElemento, PASSO_MM } from './elementos';
import { novaImagem } from './imagens';
import { PreVisualizacao } from './PreVisualizacao';
import { PropriedadesElemento, PropriedadesLayout } from './Propriedades';
import { Tela } from './Tela';

export function EditorModelo() {
  return (
    <ExigeEmpresa>
      <Carregar />
    </ExigeEmpresa>
  );
}

function Carregar() {
  const { id } = useParams();
  const { empresaId } = useAuth();
  const novo = !id || id === 'novo';
  const { data: modelo, error, isLoading } = useQuery({
    queryKey: ['modelo', empresaId, id],
    queryFn: () => api<ModeloEtiquetaResumo>(`/modelos/${id}`),
    enabled: !novo,
  });
  const { data: consultas, error: erroConsultas } = useQuery({
    queryKey: ['modelos-consultas', empresaId],
    queryFn: () => api<ConsultaParaModelo[]>('/modelos/consultas'),
  });
  if (error || erroConsultas) return <Alerta>{(error ?? erroConsultas)!.message}</Alerta>;
  if ((!novo && isLoading) || !consultas) return <div className="text-sm text-slate-500">Carregando…</div>;
  return <Editor key={modelo?.id ?? 'novo'} modelo={modelo ?? null} consultas={consultas} />;
}

const BOTOES: { tipo: Exclude<TipoElemento, 'imagem'>; rotulo: string }[] = [
  { tipo: 'texto', rotulo: 'Texto' },
  { tipo: 'codigo_barras', rotulo: 'Código de barras' },
  { tipo: 'qrcode', rotulo: 'QR code' },
  { tipo: 'retangulo', rotulo: 'Retângulo' },
  { tipo: 'linha', rotulo: 'Linha' },
];

function Editor({ modelo, consultas }: { modelo: ModeloEtiquetaResumo | null; consultas: ConsultaParaModelo[] }) {
  const { empresaId, pode } = useAuth();
  const editavel = pode('etiqueta.modelo.editar');
  const navegar = useNavigate();
  const cliente = useQueryClient();

  const [nome, setNome] = useState(modelo?.nome ?? '');
  const [descricao, setDescricao] = useState(modelo?.descricao ?? '');
  const [consultaId, setConsultaId] = useState(modelo?.consultaId ?? consultas[0]?.id ?? '');
  const [impressoraId, setImpressoraId] = useState(modelo?.impressoraId ?? '');
  const [naListaDiaria, setNaListaDiaria] = useState(modelo?.naListaDiaria ?? false);
  const { data: impressoras = [] } = useQuery({
    queryKey: ['impressoras', empresaId],
    queryFn: () => api<ImpressoraResumo[]>('/impressoras'),
    enabled: pode('impressora.ver'),
  });
  const [layout, setLayout] = useState<LayoutEtiqueta>(modelo?.layout ?? LAYOUT_PADRAO);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [zoom, setZoom] = useState(() => Math.max(2, Math.min(10, Math.floor(640 / (modelo?.layout.larguraMm ?? 60)))));
  const [amostra, setAmostra] = useState<AmostraModelo | null>(null);
  const [indice, setIndice] = useState(0);
  const [parametros, setParametros] = useState<Record<string, string>>({});
  const [alterado, setAlterado] = useState(false);

  const consulta = consultas.find((c) => c.id === consultaId) ?? null;
  const campos = consulta?.campos ?? [];
  const elemento = layout.elementos.find((e) => e.id === selecionado) ?? null;
  const erros = useMemo(() => validarLayout(layout), [layout]);
  const registro = amostra?.registros[indice] ?? null;

  const mudarLayout = useCallback((mudancas: Partial<LayoutEtiqueta>) => {
    setLayout((l) => ({ ...l, ...mudancas }));
    setAlterado(true);
  }, []);
  const mudarElemento = useCallback((id: string, mudancas: Partial<ElementoEtiqueta>) => {
    setLayout((l) => ({ ...l, elementos: l.elementos.map((e) => (e.id === id ? ({ ...e, ...mudancas } as ElementoEtiqueta) : e)) }));
    setAlterado(true);
  }, []);
  function adicionar(el: ElementoEtiqueta) {
    mudarLayout({ elementos: [...layout.elementos, el] });
    setSelecionado(el.id);
  }
  const [lendoImagem, setLendoImagem] = useState(false);
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  async function enviarImagem(arquivo: File | undefined) {
    if (!arquivo) return;
    setErroImagem(null);
    setLendoImagem(true);
    try {
      adicionar(await novaImagem(arquivo, layout));
    } catch (e) {
      setErroImagem((e as Error).message);
    } finally {
      setLendoImagem(false);
    }
  }
  function excluir(id: string) {
    mudarLayout({ elementos: layout.elementos.filter((e) => e.id !== id) });
    setSelecionado(null);
  }

  // Aviso ao sair com alterações não salvas.
  useEffect(() => {
    if (!alterado) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [alterado]);

  function teclas(e: KeyboardEvent) {
    if (!elemento || !editavel || (e.target as HTMLElement).closest('input, select, textarea')) return;
    const passo = e.shiftKey ? 5 : PASSO_MM;
    const mover: Record<string, [number, number]> = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      excluir(elemento.id);
    } else if (mover[e.key]) {
      e.preventDefault();
      const [dx, dy] = mover[e.key];
      mudarElemento(elemento.id, {
        x: Math.max(0, Math.min(layout.larguraMm - elemento.largura, arredondar(elemento.x + dx))),
        y: Math.max(0, Math.min(layout.alturaMm - elemento.altura, arredondar(elemento.y + dy))),
      });
    }
  }

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome,
        descricao: descricao || undefined,
        consultaId: consultaId || null,
        // Sem impressora.ver o campo não é exibido; mantém o valor gravado.
        ...(pode('impressora.ver') ? { impressoraId: impressoraId || null } : {}),
        naListaDiaria,
        layout,
      };
      return modelo
        ? api<ModeloEtiquetaResumo>(`/modelos/${modelo.id}`, { metodo: 'PATCH', corpo })
        : api<ModeloEtiquetaResumo>('/modelos', { metodo: 'POST', corpo });
    },
    onSuccess: (m) => {
      setAlterado(false);
      cliente.setQueryData(['modelo', empresaId, m.id], m);
      void cliente.invalidateQueries({ queryKey: ['modelos', empresaId] });
      if (!modelo) navegar(`/modelos/${m.id}`, { replace: true });
    },
  });

  const carregarAmostra = useMutation({
    mutationFn: () => api<AmostraModelo>(`/modelos/${modelo!.id}/amostra`, { metodo: 'POST', corpo: { parametros, limite: 10 } }),
    onSuccess: (a) => {
      setAmostra(a);
      setIndice(0);
    },
  });

  const excluirModelo = useMutation({
    mutationFn: () => api(`/modelos/${modelo!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['modelos', empresaId] });
      navegar('/modelos');
    },
  });

  // A amostra usa a consulta gravada no modelo; mudanças só de layout não afetam.
  const amostraDesatualizada = modelo && consultaId !== modelo.consultaId;

  return (
    <div className="space-y-4" onKeyDown={teclas}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/modelos" className="text-sm text-blue-700 hover:underline">← Modelos</Link>
          <h1 className="text-xl font-semibold">{modelo ? modelo.nome : 'Novo modelo'}</h1>
        </div>
        {editavel && (
          <div className="flex items-center gap-2">
            {alterado && <span className="text-xs text-amber-700">Alterações não salvas</span>}
            {modelo && (
              <Botao
                variante="secundario"
                disabled={excluirModelo.isPending}
                onClick={() => window.confirm(`Excluir o modelo "${modelo.nome}"?`) && excluirModelo.mutate()}
              >
                Excluir
              </Botao>
            )}
            <Botao disabled={salvar.isPending || erros.length > 0 || nome.trim().length < 2} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Botao>
          </div>
        )}
      </div>
      {(salvar.error || excluirModelo.error) && <Alerta>{(salvar.error ?? excluirModelo.error)!.message}</Alerta>}
      {erros.length > 0 && <Alerta tipo="aviso">{erros.slice(0, 3).join(' ')}</Alerta>}

      <fieldset disabled={!editavel} className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Nome do modelo" required value={nome} onChange={(e) => (setNome(e.target.value), setAlterado(true))} />
        <Selecao rotulo="Consulta (campos)" value={consultaId} onChange={(e) => (setConsultaId(e.target.value), setAmostra(null), setAlterado(true))}>
          <option value="">Sem consulta</option>
          {consultas.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </Selecao>
        <Campo rotulo="Descrição" value={descricao} onChange={(e) => (setDescricao(e.target.value), setAlterado(true))} />
        {pode('impressora.ver') && (
          <Selecao rotulo="Impressora padrão" value={impressoraId} onChange={(e) => (setImpressoraId(e.target.value), setAlterado(true))}>
            <option value="">Nenhuma</option>
            {impressoras.map((i) => (
              <option key={i.id} value={i.id} disabled={!i.ativo}>
                {i.nome} ({i.linguagem} {i.dpi} dpi)
              </option>
            ))}
          </Selecao>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={naListaDiaria} onChange={(e) => (setNaListaDiaria(e.target.checked), setAlterado(true))} />
          Incluir na lista do dia (os produtos da consulta entram em “Lista do dia”)
        </label>
      </fieldset>

      <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        {/* Ferramentas */}
        <aside className="space-y-4">
          {editavel && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold">Adicionar</h3>
              <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-1">
                {BOTOES.map((b) => (
                  <button
                    key={b.tipo}
                    type="button"
                    onClick={() => adicionar(novoElemento(b.tipo, layout))}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    + {b.rotulo}
                  </button>
                ))}
                <label className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-sm hover:bg-slate-50" title="Logotipo, selo ou símbolo (PNG, JPG, SVG…)">
                  {lendoImagem ? 'Lendo imagem…' : '+ Imagem'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={lendoImagem}
                    onChange={(e) => {
                      void enviarImagem(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {erroImagem && <p className="mt-2 text-xs text-red-700">{erroImagem}</p>}
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-semibold">Campos da consulta</h3>
            {!consulta && <p className="text-xs text-slate-500">Escolha uma consulta para usar os campos dela.</p>}
            {consulta && campos.length === 0 && <p className="text-xs text-slate-500">A consulta ainda não tem campos lidos.</p>}
            <ul className="space-y-1">
              {campos.map((c) => (
                <li key={c.nome}>
                  <button
                    type="button"
                    disabled={!editavel}
                    title="Adicionar como texto"
                    onClick={() =>
                      adicionar(
                        novoElemento('texto', layout, {
                          tipo: 'campo',
                          campo: c.nome,
                          formato: c.categoria === 'data' ? { tipo: 'data', formato: 'dd/MM/yyyy' } : undefined,
                        }),
                      )
                    }
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-blue-50 disabled:hover:bg-transparent"
                  >
                    <span className="truncate font-mono text-xs">{c.nome}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{ROTULO_CATEGORIA[c.categoria]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Tela */}
        <section className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-600">Zoom</span>
              <input type="range" min={2} max={14} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
              <span className="text-xs text-slate-500">
                {layout.larguraMm} × {layout.alturaMm} mm
                {layout.colunas > 1 && ` · ${layout.colunas} colunas`}
              </span>
            </div>
            {modelo?.consultaId && (
              <div className="flex flex-wrap items-center gap-2">
                {consulta?.parametros.map((p) => (
                  <input
                    key={p}
                    placeholder={`{param.${p}}`}
                    value={parametros[p] ?? ''}
                    onChange={(e) => setParametros({ ...parametros, [p]: e.target.value })}
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                ))}
                <Botao variante="secundario" disabled={carregarAmostra.isPending || Boolean(amostraDesatualizada)} onClick={() => carregarAmostra.mutate()}>
                  {carregarAmostra.isPending ? 'Buscando…' : 'Dados reais'}
                </Botao>
                {amostra && amostra.registros.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-slate-600">
                    <button type="button" disabled={indice === 0} onClick={() => setIndice(indice - 1)} className="px-1 disabled:text-slate-300">◀</button>
                    {indice + 1}/{amostra.registros.length}
                    <button type="button" disabled={indice >= amostra.registros.length - 1} onClick={() => setIndice(indice + 1)} className="px-1 disabled:text-slate-300">▶</button>
                  </span>
                )}
              </div>
            )}
          </div>
          {amostraDesatualizada && <p className="text-xs text-slate-500">Salve o modelo para buscar dados reais da nova consulta.</p>}
          {carregarAmostra.error && <Alerta>{carregarAmostra.error.message}</Alerta>}
          {amostra && amostra.registros.length === 0 && <Alerta tipo="info">A consulta não devolveu linhas.</Alerta>}
          {amostra && amostra.camposAusentes.length > 0 && (
            <Alerta tipo="aviso">A consulta não tem mais estes campos usados no modelo: {amostra.camposAusentes.join(', ')}.</Alerta>
          )}
          <div tabIndex={0} className="overflow-auto rounded-lg border border-slate-200 bg-slate-100 outline-none focus:ring-2 focus:ring-blue-500/30">
            <Tela
              layout={layout}
              escala={zoom}
              registro={registro}
              selecionado={selecionado}
              editavel={editavel}
              aoSelecionar={setSelecionado}
              aoAlterar={mudarElemento}
            />
          </div>
        </section>

        {/* Propriedades */}
        <aside className="rounded-lg border border-slate-200 bg-white p-3">
          <fieldset disabled={!editavel}>
            {elemento ? (
              <PropriedadesElemento
                el={elemento}
                layout={layout}
                campos={campos}
                aoMudar={(m) => mudarElemento(elemento.id, m)}
                aoExcluir={() => excluir(elemento.id)}
                aoDuplicar={() =>
                  adicionar({
                    ...elemento,
                    id: Math.random().toString(36).slice(2, 10),
                    x: Math.min(layout.larguraMm - elemento.largura, elemento.x + 2),
                    y: Math.min(layout.alturaMm - elemento.altura, elemento.y + 2),
                  })
                }
              />
            ) : (
              <PropriedadesLayout layout={layout} aoMudar={mudarLayout} />
            )}
          </fieldset>
        </aside>
      </div>

      <PreVisualizacao layout={layout} registros={amostra?.registros ?? []} nome={nome} />
    </div>
  );
}
