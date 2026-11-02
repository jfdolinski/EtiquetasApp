import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  alterarTextoDoElemento,
  conteudoVazio,
  coresDoPost,
  FORMATOS_POST,
  imagensDosElementos,
  legendaSugerida,
  MODELOS_POST,
  montarPost,
  PALETAS_POST,
  produtoDoRegistro,
  RODAPE_PADRAO,
  TONS_LEGENDA,
  VARIACOES_POST,
  type AjusteElemento,
  type BuscaProdutosPost,
  type ConsultaPost,
  type DadosPost,
  type DesignPost,
  type ElementoPost,
  type EstiloElemento,
  type ExtraPost,
  type FormatoPost,
  type FundoPost,
  type ImagemPost,
  type ModeloPost,
  type PostCompleto,
  type ProdutoCatalogo,
  type ProdutoPost,
  type Registro,
  type SituacaoMarcaPost,
  type TipoExtra,
  type TomLegenda,
  type VariacaoPost,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { SeletorFonte } from '../../components/SeletorFonte';
import { Alerta, Botao, Cabecalho, Campo, Selecao } from '../../components/ui';
import { useImagensPost } from './apoio';
import { EscolherImagem } from './EscolherImagem';
import { Camadas, Cor, PainelElemento, type ModoAlinhar } from './PainelElemento';
import { TelaPost, type TelaPostControle } from './TelaPost';

const FORMATOS = Object.keys(FORMATOS_POST) as FormatoPost[];
const MODELOS = Object.keys(MODELOS_POST) as ModeloPost[];
const LIMITE_HISTORICO = 100;

type Aba = 'dados' | 'aparencia' | 'adicionar' | 'legenda';

export function EditorPost() {
  return (
    <ExigeEmpresa>
      <Carregador />
    </ExigeEmpresa>
  );
}

function novoPost(registros: Registro[]): DadosPost {
  const produtos = registros.slice(0, MODELOS_POST.OFERTA.maxProdutos).map(produtoDoRegistro);
  const modelo: ModeloPost = produtos.length > 1 ? 'OFERTA' : 'PRODUTO';
  return { titulo: produtos[0]?.descricao.slice(0, 120) ?? '', modelo, formato: 'QUADRADO', conteudo: { ...conteudoVazio(), titulo: modelo === 'OFERTA' ? 'Ofertas' : '', produtos }, legenda: '', ajustes: {}, design: {} };
}

function Carregador() {
  const { id } = useParams();
  const { state } = useLocation() as { state: { registros?: Registro[]; copia?: DadosPost } | null };
  const { data: post, error } = useQuery({ queryKey: ['post', id], queryFn: () => api<PostCompleto>(`/posts/${id}`), enabled: !!id, gcTime: 0 });
  const { data: marca } = useQuery({ queryKey: ['posts-marca'], queryFn: () => api<SituacaoMarcaPost>('/posts/marca') });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!marca || (id && !post)) return <div className="text-sm text-slate-500">Carregando…</div>;
  return <Editor key={id ?? 'novo'} id={id ?? null} inicial={post ?? state?.copia ?? novoPost(state?.registros ?? [])} marca={marca} />;
}

/** Histórico para desfazer. Digitação no mesmo campo vira um passo só. */
function useHistorico(inicial: DadosPost) {
  const [estado, setEstado] = useState({ d: inicial, antes: [] as DadosPost[], depois: [] as DadosPost[] });
  const ultimoGrupo = useRef<{ grupo: string; quando: number } | null>(null);
  const mudar = useCallback((fn: (d: DadosPost) => DadosPost, grupo?: string) => {
    setEstado((e) => {
      const novo = fn(e.d);
      if (novo === e.d) return e;
      const agora = Date.now();
      const junta = grupo && ultimoGrupo.current?.grupo === grupo && agora - ultimoGrupo.current.quando < 1200;
      ultimoGrupo.current = grupo ? { grupo, quando: agora } : null;
      return { d: novo, antes: junta ? e.antes : [...e.antes.slice(-(LIMITE_HISTORICO - 1)), e.d], depois: [] };
    });
  }, []);
  /** Trocar o tamanho visto não é alteração a desfazer. */
  const semHistorico = useCallback((fn: (d: DadosPost) => DadosPost) => setEstado((e) => ({ ...e, d: fn(e.d) })), []);
  const desfazer = useCallback(() => setEstado((e) => (e.antes.length ? { d: { ...e.antes[e.antes.length - 1], formato: e.d.formato }, antes: e.antes.slice(0, -1), depois: [e.d, ...e.depois] } : e)), []);
  const refazer = useCallback(() => setEstado((e) => (e.depois.length ? { d: { ...e.depois[0], formato: e.d.formato }, antes: [...e.antes, e.d], depois: e.depois.slice(1) } : e)), []);
  return { d: estado.d, mudar, semHistorico, desfazer, refazer, podeDesfazer: estado.antes.length > 0, podeRefazer: estado.depois.length > 0 };
}

const semVazios = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function EditarProduto({ produto, somenteLeitura, escolherFoto, aoMudar, aoTirar }: { produto: ProdutoPost; somenteLeitura: boolean; escolherFoto: boolean; aoMudar: (p: Partial<ProdutoPost>) => void; aoTirar: () => void }) {
  const catalogo = useCatalogo(produto.codigo);
  // Produto recém-incluído já vem com a primeira foto real; imagem de IA só por decisão de quem edita.
  // Num post salvo não: tirar a imagem foi uma escolha.
  const aplicado = useRef(false);
  useEffect(() => {
    if (!catalogo || aplicado.current) return;
    aplicado.current = true;
    const real = catalogo.imagens.find((i) => !i.ia);
    aoMudar({ medicamento: catalogo.medicamento, ...(escolherFoto && !produto.imagem && real ? { imagem: { origem: 'CATALOGO', url: real.url, ia: false } } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao chegar a resposta do catálogo.
  }, [catalogo]);

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      {produto.medicamento && (
        <Alerta tipo="aviso">O catálogo marca este produto como medicamento. A propaganda de medicamentos tem regras próprias da Anvisa, inclusive advertências obrigatórias e proibição para os de venda sob prescrição. Confira antes de publicar.</Alerta>
      )}
      <Campo rotulo="Nome do produto" maxLength={300} value={produto.descricao} disabled={somenteLeitura} onChange={(e) => aoMudar({ descricao: e.target.value })} ajuda={produto.codigo ? `Código ${produto.codigo}` : undefined} />
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Preço" maxLength={40} value={produto.preco} disabled={somenteLeitura} onChange={(e) => aoMudar({ preco: e.target.value })} />
        <Campo rotulo="Preço anterior" maxLength={40} placeholder="R$ 9,99" value={produto.precoDe ?? ''} disabled={somenteLeitura} onChange={(e) => aoMudar({ precoDe: e.target.value || undefined })} />
        <Campo rotulo="Unidade" maxLength={40} placeholder="/kg, cada" value={produto.unidade ?? ''} disabled={somenteLeitura} onChange={(e) => aoMudar({ unidade: e.target.value || undefined })} />
        <Campo rotulo="Selo" maxLength={40} placeholder="-20%, Novo" value={produto.selo ?? ''} disabled={somenteLeitura} onChange={(e) => aoMudar({ selo: e.target.value || undefined })} />
      </div>
      <Campo rotulo="Detalhe" maxLength={160} placeholder="Leve 3, pague 2" value={produto.detalhe ?? ''} disabled={somenteLeitura} onChange={(e) => aoMudar({ detalhe: e.target.value || undefined })} />
      <EscolherImagem titulo={produto.descricao || 'o produto'} catalogo={catalogo} marcada={produto.imagem} somenteLeitura={somenteLeitura} aoEscolher={(imagem) => aoMudar({ imagem })} />
      {!somenteLeitura && <Botao variante="secundario" onClick={aoTirar}>Tirar produto</Botao>}
    </div>
  );
}

function useCatalogo(codigo: string): ProdutoCatalogo | null {
  const { data = null } = useQuery({
    queryKey: ['posts-catalogo', codigo],
    queryFn: () => api<ProdutoCatalogo>(`/posts/catalogo/${encodeURIComponent(codigo)}`),
    enabled: !!codigo,
    staleTime: 5 * 60_000,
  });
  return data;
}

function BuscarNoErp({ aoIncluir }: { aoIncluir: (p: ProdutoPost) => void }) {
  const { data: consultas = [] } = useQuery({ queryKey: ['posts-consultas'], queryFn: () => api<ConsultaPost[]>('/posts/consultas') });
  const [consultaId, setConsultaId] = useState('');
  const [termo, setTermo] = useState('');
  const escolhida = consultaId || consultas[0]?.id || '';
  const buscar = useMutation({ mutationFn: () => api<BuscaProdutosPost>('/posts/produtos/busca', { metodo: 'POST', corpo: { consultaId: escolhida, termo: termo.trim() } }) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (termo.trim() && escolhida) buscar.mutate();
  }

  if (consultas.length === 0) {
    return <Alerta tipo="info">Para trazer nome e preço do ERP, cadastre uma consulta de busca de produto em Consultas SQL. Sem ela, inclua o produto à mão.</Alerta>;
  }
  return (
    <div className="space-y-2">
      <form onSubmit={enviar} className="flex flex-wrap items-end gap-2">
        {consultas.length > 1 && (
          <div className="min-w-40 flex-1">
            <Selecao rotulo="Consulta" value={escolhida} onChange={(e) => setConsultaId(e.target.value)}>
              {consultas.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Selecao>
          </div>
        )}
        <div className="min-w-40 flex-1">
          <Campo rotulo="Buscar no ERP" placeholder="Código de barras ou nome" value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <Botao type="submit" variante="secundario" disabled={buscar.isPending || !termo.trim()}>{buscar.isPending ? 'Buscando…' : 'Buscar'}</Botao>
      </form>
      {buscar.error && <Alerta>{buscar.error.message}</Alerta>}
      {buscar.data && buscar.data.banidos > 0 && <Alerta tipo="info">{buscar.data.banidos} produto(s) banido(s) ficaram de fora.</Alerta>}
      {buscar.data && buscar.data.produtos.length === 0 && <p className="text-sm text-slate-500">Produto não encontrado.</p>}
      {buscar.data && buscar.data.produtos.length > 0 && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-auto rounded border border-slate-200 bg-white text-sm">
          {buscar.data.produtos.map((p, i) => (
            <li key={`${p.codigo}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0 truncate">{p.descricao}{p.preco && <span className="text-slate-500"> · {p.preco}</span>}</span>
              <button type="button" className="shrink-0 text-xs font-medium text-blue-700 hover:underline" onClick={() => aoIncluir(p)}>Incluir</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AreaTexto({ rotulo, valor, aoMudar, linhas = 3, max, disabled }: { rotulo: string; valor: string; aoMudar: (t: string) => void; linhas?: number; max: number; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{rotulo}</span>
      <textarea rows={linhas} maxLength={max} value={valor} disabled={disabled} onChange={(e) => aoMudar(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" />
    </label>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

const ADICIONAVEIS: { tipo: TipoExtra; rotulo: string; largura: number; altura: number; texto?: string }[] = [
  { tipo: 'texto', rotulo: 'Texto', largura: 700, altura: 140, texto: 'Seu texto aqui' },
  { tipo: 'retangulo', rotulo: 'Retângulo', largura: 400, altura: 200 },
  { tipo: 'elipse', rotulo: 'Círculo', largura: 280, altura: 280 },
  { tipo: 'estrela', rotulo: 'Estrela', largura: 280, altura: 280 },
  { tipo: 'linha', rotulo: 'Linha', largura: 600, altura: 30 },
  { tipo: 'qr', rotulo: 'QR code', largura: 240, altura: 240, texto: '' },
];

function Editor({ id, inicial, marca }: { id: string | null; inicial: DadosPost; marca: SituacaoMarcaPost }) {
  const { pode } = useAuth();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const somenteLeitura = !pode('post.editar');
  const podeLivre = pode('post.edicao_livre') && !somenteLeitura;
  const { d, mudar, semHistorico, desfazer, refazer, podeDesfazer, podeRefazer } = useHistorico(inicial);
  const [aba, setAba] = useState<Aba>('dados');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [tom, setTom] = useState<TomLegenda>('direto');
  const [salvo, setSalvo] = useState(d);
  const [exportando, setExportando] = useState(false);
  const tela = useRef<TelaPostControle>(null);

  const design: DesignPost = useMemo(() => d.design ?? {}, [d.design]);
  const elementos = useMemo(() => montarPost(d, marca), [d, marca]);
  const usadas = useMemo(() => imagensDosElementos(elementos), [elementos]);
  const imagens = useImagensPost(usadas);
  const { largura, altura, rotulo } = FORMATOS_POST[d.formato];
  const limites = MODELOS_POST[d.modelo];
  const conteudo = d.conteudo;
  const cores = coresDoPost(design, marca);
  const alterado = d !== salvo && JSON.stringify({ ...d, formato: 0 }) !== JSON.stringify({ ...salvo, formato: 0 });
  const el = elementos.find((e) => e.id === selecionado && !e.fixo) ?? null;
  const varios = conteudo.produtos.length > 1;
  const temAjustes = Object.keys(d.ajustes[d.formato] ?? {}).length > 0;
  // Imagem de produto selecionada: o painel oferece as outras fotos dele no catálogo.
  const indiceFoto = el ? /^imagem-(\d+)$/.exec(el.id)?.[1] : undefined;
  const catalogoDoElemento = useCatalogo(indiceFoto === undefined ? '' : (conteudo.produtos[Number(indiceFoto)]?.codigo ?? ''));

  useEffect(() => {
    if (!alterado) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [alterado]);

  const mudarConteudo = (m: Partial<DadosPost['conteudo']>, grupo?: string) => mudar((a) => ({ ...a, conteudo: { ...a.conteudo, ...m } }), grupo);
  const mudarProduto = (i: number, m: Partial<ProdutoPost>) => mudar((a) => ({ ...a, conteudo: { ...a.conteudo, produtos: a.conteudo.produtos.map((p, n) => (n === i ? { ...p, ...m } : p)) } }), `produto-${i}-${Object.keys(m).join()}`);
  const mudarDesign = (m: Partial<DesignPost>, grupo?: string) => mudar((a) => ({ ...a, design: semVazios({ ...a.design, ...m }) }), grupo);
  const mudarFundo = (m: Partial<FundoPost>) => mudarDesign({ fundo: { tipo: 'cor', ...design.fundo, ...m } }, 'fundo');

  function trocarModelo(modelo: ModeloPost) {
    const max = MODELOS_POST[modelo].maxProdutos;
    // Trocar de modelo muda os elementos: os ajustes de posição deixam de fazer sentido.
    // O rodapé padrão fala de ofertas: num aviso, sai; quem escreveu o próprio não perde o texto.
    const rodape = (atual: string) => (modelo === 'AVISO' && atual === RODAPE_PADRAO ? '' : modelo !== 'AVISO' && !atual ? RODAPE_PADRAO : atual);
    setSelecionado(null);
    mudar((a) => ({ ...a, modelo, ajustes: {}, conteudo: { ...a.conteudo, rodape: rodape(a.conteudo.rodape), produtos: a.conteudo.produtos.slice(0, max), titulo: modelo === 'OFERTA' && !a.conteudo.titulo ? 'Ofertas' : a.conteudo.titulo } }));
  }

  function incluir(p: ProdutoPost) {
    mudar((a) => {
      if (a.conteudo.produtos.length >= MODELOS_POST.OFERTA.maxProdutos) return a;
      // Com um produto já escolhido e pedindo mais um, o modelo vira oferta.
      const modelo = a.modelo === 'PRODUTO' && a.conteudo.produtos.length >= 1 ? 'OFERTA' : a.modelo === 'AVISO' ? 'PRODUTO' : a.modelo;
      return { ...a, modelo, ajustes: modelo === a.modelo ? a.ajustes : {}, titulo: a.titulo || p.descricao.slice(0, 120), conteudo: { ...a.conteudo, titulo: modelo === 'OFERTA' && !a.conteudo.titulo ? 'Ofertas' : a.conteudo.titulo, produtos: [...a.conteudo.produtos, p] } };
    });
  }

  const ajustar = useCallback(
    (elemento: string, ajuste: AjusteElemento, grupo?: string) => {
      mudar((a) => ({ ...a, ajustes: { ...a.ajustes, [a.formato]: { ...a.ajustes[a.formato], [elemento]: semVazios({ ...a.ajustes[a.formato]?.[elemento], ...ajuste }) } } }), grupo);
    },
    [mudar],
  );

  function estilizar(elemento: string, m: EstiloElemento) {
    mudar((a) => ({ ...a, design: { ...a.design, estilos: { ...a.design?.estilos, [elemento]: semVazios({ ...a.design?.estilos?.[elemento], ...m }) } } }), `estilo-${elemento}-${Object.keys(m).join()}`);
  }

  function escreverNoElemento(e: ElementoPost, texto: string) {
    if (e.id.startsWith('extra-')) mudar((a) => ({ ...a, design: { ...a.design, extras: a.design?.extras?.map((x) => (x.id === e.id ? { ...x, texto } : x)) } }), `texto-${e.id}`);
    else {
      const novo = alterarTextoDoElemento(conteudo, e.id, texto);
      if (novo) mudarConteudo(novo, `texto-${e.id}`);
    }
  }

  function novoExtra(tipo: TipoExtra, extra: Partial<ExtraPost>) {
    const def = ADICIONAVEIS.find((a) => a.tipo === tipo);
    const l = extra.largura ?? def?.largura ?? 400;
    const h = extra.altura ?? def?.altura ?? 400;
    const novo: ExtraPost = { id: `extra-${crypto.randomUUID()}`, tipo, x: Math.round((largura - l) / 2), yRel: Math.max(0, (altura - h) / 2) / altura, largura: l, altura: h, texto: def?.texto, ...extra };
    mudar((a) => ({ ...a, design: { ...a.design, extras: [...(a.design?.extras ?? []), novo] } }));
    setSelecionado(novo.id);
  }

  function alinhar(e: ElementoPost, m: ModoAlinhar) {
    const mudancas: Record<ModoAlinhar, AjusteElemento> = {
      esquerda: { x: 0 },
      centroX: { x: Math.round((largura - e.largura) / 2) },
      direita: { x: largura - e.largura },
      topo: { y: 0 },
      centroY: { y: Math.round((altura - e.altura) / 2) },
      base: { y: altura - e.altura },
    };
    ajustar(e.id, mudancas[m]);
  }

  function moverCamada(id: string, m: 'frente' | 'tras' | 'subir' | 'descer') {
    const ordem = elementos.filter((e) => !e.fixo).map((e) => e.id);
    const i = ordem.indexOf(id);
    if (i < 0) return;
    ordem.splice(i, 1);
    const destino = m === 'frente' ? ordem.length : m === 'tras' ? 0 : m === 'subir' ? Math.min(ordem.length, i + 1) : Math.max(0, i - 1);
    ordem.splice(destino, 0, id);
    mudarDesign({ ordem: { ...design.ordem, [d.formato]: ordem } });
  }

  function duplicar(e: ElementoPost) {
    const copia: ExtraPost = { id: `extra-${crypto.randomUUID()}`, tipo: e.tipo, x: e.x + 30, yRel: (e.y + 30) / altura, largura: e.largura, altura: e.altura, ...(e.tipo === 'texto' || e.tipo === 'qr' ? { texto: e.texto } : {}), ...(e.tipo === 'imagem' ? { imagem: e.imagem } : {}) };
    // O visual vem junto: o que foi desenhado pelo modelo vira estilo da cópia.
    const { id: _id, tipo: _tipo, x: _x, y: _y, largura: _l, altura: _a, rotacao: _r, oculto: _o, travado: _t, fixo: _f, ...resto } = e as ElementoPost & Record<string, unknown>;
    const { texto: _texto, imagem: _imagem, preco: _preco, ...estilo } = resto as Record<string, unknown>;
    mudar((a) => ({ ...a, design: { ...a.design, extras: [...(a.design?.extras ?? []), copia], estilos: { ...a.design?.estilos, [copia.id]: estilo as EstiloElemento } } }));
    setSelecionado(copia.id);
  }

  function excluir(e: ElementoPost) {
    setSelecionado(null);
    if (!e.id.startsWith('extra-')) return ajustar(e.id, { oculto: true });
    mudar((a) => {
      const { [e.id]: _e, ...estilos } = a.design?.estilos ?? {};
      return { ...a, design: { ...a.design, estilos, extras: a.design?.extras?.filter((x) => x.id !== e.id) } };
    });
  }

  function restaurar(idEl: string) {
    mudar((a) => {
      const { [idEl]: _e, ...estilos } = a.design?.estilos ?? {};
      const ajustes = Object.fromEntries(Object.entries(a.ajustes).map(([f, porId]) => {
        const { [idEl]: _a, ...resto } = porId ?? {};
        return [f, resto];
      }));
      return { ...a, ajustes, design: { ...a.design, estilos } };
    });
  }

  /** Imagem do elemento: conforme o caso, é dado do produto, do aviso ou do elemento acrescentado. */
  function trocadorDeImagem(e: ElementoPost): ((i: ImagemPost | null) => void) | null {
    if (e.id === 'imagem-aviso') return (imagem) => mudarConteudo({ imagem });
    const m = /^imagem-(\d+)$/.exec(e.id);
    if (m) return (imagem) => mudarProduto(Number(m[1]), { imagem });
    if (e.id.startsWith('extra-')) return (imagem) => { if (imagem) mudar((a) => ({ ...a, design: { ...a.design, extras: a.design?.extras?.map((x) => (x.id === e.id ? { ...x, imagem } : x)) } })); };
    return null;
  }

  const textoDoElemento = (e: ElementoPost): string | null => {
    if (e.tipo !== 'texto' && e.tipo !== 'qr') return null;
    if (e.id.startsWith('extra-')) return e.texto;
    return alterarTextoDoElemento(conteudo, e.id, e.texto) ? e.texto : null;
  };

  // Teclado: setas movem (Shift, de 10 em 10), Delete tira, Ctrl+Z desfaz, Ctrl+D duplica.
  const atalhos = useRef<(e: KeyboardEvent) => void>(() => undefined);
  atalhos.current = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) refazer();
      else desfazer();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      refazer();
      return;
    }
    if (!el || !podeLivre) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicar(el);
    } else if (e.key === 'Delete') excluir(el);
    else if (e.key === 'Escape') setSelecionado(null);
    else if (e.key.startsWith('Arrow') && !el.travado) {
      e.preventDefault();
      const passo = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -passo : e.key === 'ArrowRight' ? passo : 0;
      const dy = e.key === 'ArrowUp' ? -passo : e.key === 'ArrowDown' ? passo : 0;
      ajustar(el.id, { x: el.x + dx, y: el.y + dy }, `setas-${el.id}`);
    }
  };
  useEffect(() => {
    const ouvir = (e: KeyboardEvent) => atalhos.current(e);
    window.addEventListener('keydown', ouvir);
    return () => window.removeEventListener('keydown', ouvir);
  }, []);

  const salvar = useMutation({
    mutationFn: () => (id ? api<PostCompleto>(`/posts/${id}`, { metodo: 'PATCH', corpo: d }) : api<PostCompleto>('/posts', { metodo: 'POST', corpo: d })),
    onSuccess: (p) => {
      void cliente.invalidateQueries({ queryKey: ['posts'] });
      setSalvo(d);
      setAviso('Post salvo.');
      if (!id) navegar(`/posts/${p.id}`, { replace: true });
    },
  });

  const nomeArquivo = (formato: FormatoPost, extensao: string) => `${(d.titulo || 'post').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'post'}-${formato.toLowerCase()}.${extensao}`;

  function salvarArquivo(blob: Blob, nome: string) {
    const endereco = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = endereco;
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(endereco), 10_000);
  }

  async function baixar(tipo: 'image/png' | 'image/jpeg') {
    setErro('');
    setSelecionado(null);
    const blob = await tela.current?.exportar(tipo);
    if (!blob) return setErro('Não foi possível gerar a imagem.');
    salvarArquivo(blob, nomeArquivo(d.formato, tipo === 'image/png' ? 'png' : 'jpg'));
  }

  /** Os três tamanhos de uma vez: mostra cada um, espera desenhar e baixa. */
  async function baixarTodos() {
    setErro('');
    setSelecionado(null);
    setExportando(true);
    const atual = d.formato;
    try {
      for (const formato of FORMATOS) {
        semHistorico((a) => ({ ...a, formato }));
        await new Promise((r) => setTimeout(r, 400));
        const blob = await tela.current?.exportar('image/png');
        if (blob) salvarArquivo(blob, nomeArquivo(formato, 'png'));
      }
    } finally {
      semHistorico((a) => ({ ...a, formato: atual }));
      setExportando(false);
    }
  }

  async function compartilhar() {
    setErro('');
    setSelecionado(null);
    const blob = await tela.current?.exportar('image/png');
    if (!blob) return setErro('Não foi possível gerar a imagem.');
    const arquivo = new File([blob], nomeArquivo(d.formato, 'png'), { type: 'image/png' });
    try {
      await navigator.share({ files: [arquivo], text: d.legenda || undefined });
    } catch (x) {
      if ((x as Error).name !== 'AbortError') setErro('O compartilhamento falhou. Baixe a imagem e publique pela rede social.');
    }
  }

  async function copiarLegenda() {
    try {
      await navigator.clipboard.writeText(d.legenda);
      setAviso('Legenda copiada.');
    } catch {
      setErro('O navegador não deixou copiar. Selecione o texto da legenda e copie.');
    }
  }

  const podeCompartilhar = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([], 'a.png', { type: 'image/png' })] });
  const abas: { id: Aba; rotulo: string; so?: boolean }[] = [
    { id: 'dados', rotulo: 'Dados' },
    { id: 'aparencia', rotulo: 'Aparência', so: podeLivre },
    { id: 'adicionar', rotulo: 'Adicionar', so: podeLivre },
    { id: 'legenda', rotulo: 'Legenda' },
  ];
  const fundoTipo = design.fundo?.tipo ?? 'cor';

  return (
    <>
      <Cabecalho
        titulo={id ? 'Editar post' : 'Novo post'}
        descricao="Nome e preço vêm do ERP; a imagem, do catálogo ou da sua galeria."
        acoes={<Link to="/posts" className="text-sm text-blue-700 hover:underline">Voltar aos posts</Link>}
      />
      <div className="mb-3 space-y-2">
        {erro && <Alerta>{erro}</Alerta>}
        {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
        {aviso && <Alerta tipo="info">{aviso}</Alerta>}
        {!marca.catalogoConfigurado && <Alerta tipo="aviso">O catálogo não está configurado neste servidor. Por enquanto, só imagem própria.</Alerta>}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Partes do editor" className="flex overflow-hidden rounded-md border border-slate-300 bg-white">
            {abas.filter((a) => a.so !== false).map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)} className={`flex-1 px-2 py-1.5 text-sm ${aba === a.id ? 'bg-blue-600 font-medium text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{a.rotulo}</button>
            ))}
          </div>

          {aba === 'dados' && (
            <div className="space-y-4">
              <Campo rotulo="Nome do post" required maxLength={120} value={d.titulo} disabled={somenteLeitura} onChange={(e) => mudar((a) => ({ ...a, titulo: e.target.value }), 'titulo')} ajuda="Só para você achar depois. Não aparece na arte." />
              <div className="grid grid-cols-2 gap-2">
                <Selecao rotulo="Modelo" value={d.modelo} disabled={somenteLeitura} onChange={(e) => trocarModelo(e.target.value as ModeloPost)}>
                  {MODELOS.map((m) => (
                    <option key={m} value={m}>{MODELOS_POST[m].rotulo}</option>
                  ))}
                </Selecao>
                <Selecao rotulo="Variação" value={conteudo.variacao ?? 'CLASSICO'} disabled={somenteLeitura} onChange={(e) => { setSelecionado(null); mudar((a) => ({ ...a, ajustes: {}, conteudo: { ...a.conteudo, variacao: e.target.value as VariacaoPost } })); }}>
                  {(Object.keys(VARIACOES_POST) as VariacaoPost[]).map((v) => (
                    <option key={v} value={v}>{VARIACOES_POST[v]}</option>
                  ))}
                </Selecao>
              </div>

              {d.modelo !== 'PRODUTO' && (
                <>
                  <Campo rotulo="Título" maxLength={120} value={conteudo.titulo} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ titulo: e.target.value }, 'titulo-arte')} />
                  <Campo rotulo="Subtítulo" maxLength={160} value={conteudo.subtitulo ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ subtitulo: e.target.value || undefined }, 'subtitulo')} />
                </>
              )}
              {d.modelo === 'AVISO' && (
                <>
                  <AreaTexto rotulo="Texto" valor={conteudo.texto} max={500} disabled={somenteLeitura} aoMudar={(texto) => mudarConteudo({ texto }, 'texto')} />
                  <EscolherImagem titulo="o aviso" catalogo={null} marcada={conteudo.imagem} somenteLeitura={somenteLeitura} aoEscolher={(imagem) => mudarConteudo({ imagem })} />
                </>
              )}

              {limites.maxProdutos > 0 && (
                <Grupo titulo={`Produtos (${conteudo.produtos.length} de ${limites.maxProdutos})`}>
                  {conteudo.produtos.map((p, i) => (
                    <EditarProduto
                      key={`${p.codigo}-${i}`}
                      produto={p}
                      somenteLeitura={somenteLeitura}
                      escolherFoto={!somenteLeitura && !(id && inicial.conteudo.produtos.some((x) => x.codigo === p.codigo))}
                      aoMudar={(m) => mudarProduto(i, m)}
                      aoTirar={() => mudar((a) => ({ ...a, ajustes: {}, conteudo: { ...a.conteudo, produtos: a.conteudo.produtos.filter((_, n) => n !== i) } }))}
                    />
                  ))}
                  {!somenteLeitura && conteudo.produtos.length < MODELOS_POST.OFERTA.maxProdutos && (
                    <>
                      <BuscarNoErp aoIncluir={incluir} />
                      <Botao variante="secundario" onClick={() => incluir({ codigo: '', descricao: 'Novo produto', preco: '', imagem: null })}>Incluir à mão</Botao>
                    </>
                  )}
                  {conteudo.produtos.length < limites.minProdutos && <Alerta tipo="aviso">Este modelo precisa de pelo menos {limites.minProdutos} produto(s).</Alerta>}
                </Grupo>
              )}

              <Grupo titulo="Informações na arte">
                <Campo rotulo="Chamada" maxLength={160} placeholder="Compre agora" value={conteudo.chamada ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ chamada: e.target.value || undefined }, 'chamada')} />
                <Campo rotulo="Validade" maxLength={160} placeholder="Válido até 31/12" value={conteudo.validade ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ validade: e.target.value || undefined }, 'validade')} />
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="Telefone" maxLength={160} value={conteudo.telefone ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ telefone: e.target.value || undefined }, 'telefone')} />
                  <Campo rotulo="WhatsApp" maxLength={160} value={conteudo.whatsapp ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ whatsapp: e.target.value || undefined }, 'whatsapp')} />
                  <Campo rotulo="Instagram" maxLength={160} placeholder="@sualoja" value={conteudo.instagram ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ instagram: e.target.value || undefined }, 'instagram')} />
                  <Campo rotulo="Site" maxLength={160} value={conteudo.site ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ site: e.target.value || undefined }, 'site')} />
                </div>
                <Campo rotulo="Endereço" maxLength={160} value={conteudo.endereco ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ endereco: e.target.value || undefined }, 'endereco')} />
                <Campo rotulo="Rodapé" maxLength={200} value={conteudo.rodape} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ rodape: e.target.value }, 'rodape')} />
              </Grupo>
            </div>
          )}

          {aba === 'aparencia' && (
            <div className="space-y-4">
              <Grupo titulo="Paletas prontas">
                <div className="grid grid-cols-2 gap-1">
                  {PALETAS_POST.map((p) => (
                    <button key={p.nome} type="button" onClick={() => mudarDesign({ corPrincipal: p.principal, corDestaque: p.destaque, fundo: undefined })} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs hover:bg-slate-50">
                      <span aria-hidden="true" className="flex shrink-0 overflow-hidden rounded border border-slate-300">
                        <span className="h-5 w-4" style={{ background: p.principal }} />
                        <span className="h-5 w-4" style={{ background: p.destaque }} />
                      </span>
                      {p.nome}
                    </button>
                  ))}
                </div>
              </Grupo>
              <Grupo titulo="Cores deste post">
                <div className="grid grid-cols-2 gap-2">
                  <Cor rotulo="Cor principal" valor={cores.principal} aoMudar={(corPrincipal) => mudarDesign({ corPrincipal }, 'cor-principal')} />
                  <Cor rotulo="Cor de destaque" valor={cores.destaque} aoMudar={(corDestaque) => mudarDesign({ corDestaque }, 'cor-destaque')} />
                </div>
                {(design.corPrincipal || design.corDestaque) && <Botao variante="secundario" onClick={() => mudarDesign({ corPrincipal: undefined, corDestaque: undefined })}>Usar as cores da marca</Botao>}
              </Grupo>
              <Grupo titulo="Fonte de todos os textos">
                <SeletorFonte valor={design.fontePadrao} aoMudar={(fontePadrao) => mudarDesign({ fontePadrao })} rotulo="Fonte de todos os textos" />
                {design.fontePadrao && <Botao variante="secundario" onClick={() => mudarDesign({ fontePadrao: undefined })}>Voltar à fonte padrão</Botao>}
              </Grupo>
              <Grupo titulo="Fundo">
                <Selecao rotulo="Tipo de fundo" value={fundoTipo} onChange={(e) => mudarFundo({ tipo: e.target.value as FundoPost['tipo'] })}>
                  <option value="cor">Cor</option>
                  <option value="degrade">Degradê</option>
                  <option value="imagem">Imagem</option>
                </Selecao>
                {fundoTipo !== 'imagem' && <Cor rotulo="Cor do fundo" valor={design.fundo?.cor ?? cores.principal} aoMudar={(cor) => mudarFundo({ cor })} />}
                {fundoTipo === 'degrade' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Cor rotulo="Segunda cor do fundo" valor={design.fundo?.cor2 ?? cores.destaque} aoMudar={(cor2) => mudarFundo({ cor2 })} />
                    <Campo rotulo="Ângulo" type="number" min={0} max={360} value={design.fundo?.angulo ?? 135} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && mudarFundo({ angulo: e.target.valueAsNumber })} />
                  </div>
                )}
                {fundoTipo === 'imagem' && (
                  <>
                    <EscolherImagem titulo="o fundo" catalogo={null} marcada={design.fundo?.imagem ?? null} somenteLeitura={false} aoEscolher={(imagem) => mudarFundo({ imagem })} />
                    <label className="block text-sm">
                      <span className="mb-0.5 flex justify-between text-xs font-medium text-slate-600">Véu escuro <span>{Math.round((design.fundo?.veu ?? 0.35) * 100)}%</span></span>
                      <input type="range" aria-label="Véu escuro" className="w-full" min={0} max={90} value={Math.round((design.fundo?.veu ?? 0.35) * 100)} onChange={(e) => mudarFundo({ veu: e.target.valueAsNumber / 100 })} />
                    </label>
                  </>
                )}
              </Grupo>
            </div>
          )}

          {aba === 'adicionar' && (
            <div className="space-y-4">
              <Grupo titulo="Elementos">
                <div className="grid grid-cols-3 gap-1">
                  {ADICIONAVEIS.map((a) => (
                    <Botao key={a.tipo} variante="secundario" aria-label={`Adicionar ${a.rotulo}`} onClick={() => novoExtra(a.tipo, {})}>{a.rotulo}</Botao>
                  ))}
                </div>
                <p className="text-xs text-slate-500">Clique no elemento na arte para mudar fonte, cor e tudo o mais. Setas movem, Delete tira, Ctrl+D duplica e Ctrl+Z desfaz.</p>
              </Grupo>
              <Grupo titulo="Imagem">
                <EscolherImagem titulo="a arte" catalogo={null} marcada={null} somenteLeitura={false} aoEscolher={(imagem) => imagem && novoExtra('imagem', { imagem, largura: 500, altura: 500 })} />
              </Grupo>
            </div>
          )}

          {aba === 'legenda' && (
            <div className="space-y-3">
              <AreaTexto rotulo="Legenda" linhas={9} valor={d.legenda} max={2200} disabled={somenteLeitura} aoMudar={(legenda) => mudar((a) => ({ ...a, legenda }), 'legenda')} />
              <p className="text-right text-xs tabular-nums text-slate-500">{d.legenda.length} de 2.200 caracteres</p>
              <Campo rotulo="Hashtags" maxLength={500} placeholder="#oferta #farmacia" value={conteudo.hashtags ?? ''} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ hashtags: e.target.value || undefined }, 'hashtags')} ajuda="Entram no fim da legenda sugerida." />
              <div className="flex flex-wrap items-end gap-2">
                {!somenteLeitura && (
                  <>
                    <div className="w-28">
                      <Selecao rotulo="Tom" value={tom} onChange={(e) => setTom(e.target.value as TomLegenda)}>
                        {(Object.keys(TONS_LEGENDA) as TomLegenda[]).map((t) => (
                          <option key={t} value={t}>{TONS_LEGENDA[t]}</option>
                        ))}
                      </Selecao>
                    </div>
                    <Botao variante="secundario" onClick={() => mudar((a) => ({ ...a, legenda: legendaSugerida(a.modelo, a.conteudo, marca, tom) }))}>Sugerir legenda</Botao>
                  </>
                )}
                <Botao variante="secundario" disabled={!d.legenda} onClick={() => void copiarLegenda()}>Copiar legenda</Botao>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Tamanho do post">
              {FORMATOS.map((f) => (
                <button key={f} type="button" aria-pressed={d.formato === f} onClick={() => { setSelecionado(null); semHistorico((a) => ({ ...a, formato: f })); }} className={`rounded-md border px-3 py-1.5 text-sm ${d.formato === f ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                  {FORMATOS_POST[f].rotulo}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {!somenteLeitura && (
                <>
                  <Botao variante="secundario" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!podeDesfazer} onClick={desfazer}>↶</Botao>
                  <Botao variante="secundario" aria-label="Refazer" title="Refazer (Ctrl+Y)" disabled={!podeRefazer} onClick={refazer}>↷</Botao>
                </>
              )}
              <select aria-label="Zoom" value={zoom === null ? '' : String(zoom)} onChange={(e) => setZoom(e.target.value ? Number(e.target.value) : null)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Ajustar</option>
                <option value="0.25">25%</option>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
              </select>
            </div>
          </div>
          <TelaPost ref={tela} elementos={elementos} largura={largura} altura={altura} imagens={imagens} editavel={podeLivre && !exportando} selecionado={selecionado} aoSelecionar={setSelecionado} aoAjustar={ajustar} zoom={zoom} />
          <p className="text-center text-xs text-slate-500">{rotulo}: {largura} × {altura} pixels{podeLivre ? '. Clique em um elemento para editar.' : ''}</p>
          <div className="flex flex-wrap items-center gap-2">
            {!somenteLeitura && <Botao disabled={salvar.isPending} onClick={() => { setAviso(''); salvar.mutate(); }}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>}
            <Botao variante="secundario" disabled={exportando} onClick={() => void baixar('image/png')}>Baixar imagem</Botao>
            <Botao variante="secundario" disabled={exportando} onClick={() => void baixar('image/jpeg')}>Baixar em JPG</Botao>
            <Botao variante="secundario" disabled={exportando} onClick={() => void baixarTodos()}>{exportando ? 'Gerando…' : 'Baixar os 3 tamanhos'}</Botao>
            {podeCompartilhar && <Botao variante="secundario" onClick={() => void compartilhar()}>Compartilhar</Botao>}
            {podeLivre && temAjustes && <Botao variante="secundario" onClick={() => { setSelecionado(null); mudar((a) => { const { [a.formato]: _f, ...resto } = a.ajustes; return { ...a, ajustes: resto }; }); }}>Voltar ao modelo</Botao>}
            {alterado && !somenteLeitura && <span className="text-xs text-amber-700">Alterações não salvas</span>}
          </div>
          <p className="text-xs text-slate-500">O sistema não publica sozinho: baixe a imagem, copie a legenda e publique pela rede social.</p>
        </div>

        {podeLivre && (
          <aside className="min-w-0 space-y-4 lg:col-start-2 2xl:col-start-3 2xl:row-start-1">
            {el ? (
              <PainelElemento
                el={el}
                varios={varios}
                texto={textoDoElemento(el)}
                aoMudarTexto={(t) => escreverNoElemento(el, t)}
                avisoTexto={el.id === 'contato' ? 'Os contatos são preenchidos na aba Dados.' : el.id === 'marca' ? 'O nome vem da marca da empresa, em Posts.' : undefined}
                aoEstilo={(m) => estilizar(el.id, m)}
                aoAjuste={(m) => ajustar(el.id, m, `ajuste-${el.id}-${Object.keys(m).join()}`)}
                aoAlinhar={(m) => alinhar(el, m)}
                aoCamada={(m) => moverCamada(el.id, m)}
                aoDuplicar={() => duplicar(el)}
                aoExcluir={() => excluir(el)}
                aoRestaurar={() => restaurar(el.id)}
                catalogo={catalogoDoElemento}
                aoTrocarImagem={trocadorDeImagem(el)}
              />
            ) : (
              <p className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-500">Clique em um elemento na arte, ou escolha uma camada, para editar.</p>
            )}
            <Camadas elementos={elementos} selecionado={selecionado} varios={varios} aoSelecionar={setSelecionado} aoAjustar={(i, m) => ajustar(i, m)} aoMover={moverCamada} />
          </aside>
        )}
      </div>
    </>
  );
}
