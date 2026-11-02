import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  chaveImagemPost,
  conteudoVazio,
  FORMATOS_POST,
  legendaSugerida,
  MODELOS_POST,
  montarPost,
  produtoDoRegistro,
  RODAPE_PADRAO,
  type AjusteElemento,
  type BuscaProdutosPost,
  type ConsultaPost,
  type DadosPost,
  type FormatoPost,
  type ImagemGaleria,
  type ImagemPost,
  type ModeloPost,
  type PostCompleto,
  type ProdutoCatalogo,
  type ProdutoPost,
  type Registro,
  type SituacaoMarcaPost,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Selecao } from '../../components/ui';
import { enviarParaGaleria, useImagensPost } from './apoio';
import { TelaPost, type TelaPostControle } from './TelaPost';

const FORMATOS = Object.keys(FORMATOS_POST) as FormatoPost[];
const MODELOS = Object.keys(MODELOS_POST) as ModeloPost[];

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
  return { titulo: produtos[0]?.descricao.slice(0, 120) ?? '', modelo, formato: 'QUADRADO', conteudo: { ...conteudoVazio(), titulo: modelo === 'OFERTA' ? 'Ofertas' : '', produtos }, legenda: '', ajustes: {} };
}

function Carregador() {
  const { id } = useParams();
  const { state } = useLocation() as { state: { registros?: Registro[] } | null };
  const { data: post, error } = useQuery({ queryKey: ['post', id], queryFn: () => api<PostCompleto>(`/posts/${id}`), enabled: !!id, gcTime: 0 });
  const { data: marca } = useQuery({ queryKey: ['posts-marca'], queryFn: () => api<SituacaoMarcaPost>('/posts/marca') });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!marca || (id && !post)) return <div className="text-sm text-slate-500">Carregando…</div>;
  return <Editor key={id ?? 'novo'} id={id ?? null} inicial={post ?? novoPost(state?.registros ?? [])} marca={marca} />;
}

function Miniatura({ imagem, foto, rotulo, marcada, aoEscolher }: { imagem: ImagemPost; foto: HTMLImageElement | 'erro' | undefined; rotulo: string; marcada: boolean; aoEscolher: () => void }) {
  return (
    <button type="button" aria-label={rotulo} aria-pressed={marcada} title={rotulo} onClick={aoEscolher} className={`relative h-16 w-16 overflow-hidden rounded border bg-white ${marcada ? 'border-blue-600 ring-2 ring-blue-600' : 'border-slate-300'}`} data-imagem={chaveImagemPost(imagem)}>
      {foto && foto !== 'erro' && <img src={foto.src} alt="" className="h-full w-full object-contain" />}
      {foto === 'erro' && <span className="text-[10px] text-slate-500">Indisponível</span>}
      {imagem.origem === 'CATALOGO' && imagem.ia && <span className="absolute bottom-0 left-0 bg-amber-200 px-1 text-[10px] font-medium text-amber-900">IA</span>}
    </button>
  );
}

/** Imagens que dá para escolher: as do catálogo, para o produto, e a galeria da empresa. */
function EscolherImagem({ titulo, catalogo, marcada, somenteLeitura, aoEscolher }: { titulo: string; catalogo: ProdutoCatalogo | null; marcada: ImagemPost | null; somenteLeitura: boolean; aoEscolher: (i: ImagemPost | null) => void }) {
  const cliente = useQueryClient();
  const [verIa, setVerIa] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { data: galeria = [] } = useQuery({ queryKey: ['posts-imagens'], queryFn: () => api<ImagemGaleria[]>('/posts/imagens') });
  const reais = catalogo?.imagens.filter((i) => !i.ia) ?? [];
  const deIa = catalogo?.imagens.filter((i) => i.ia) ?? [];
  const doCatalogo: ImagemPost[] = [...reais, ...(verIa ? deIa : [])].map((i) => ({ origem: 'CATALOGO', url: i.url, ia: i.ia }));
  const daGaleria: ImagemPost[] = galeria.map((i) => ({ origem: 'GALERIA', id: i.id }));
  const fotos = useImagensPost(useMemo(() => [...doCatalogo, ...daGaleria], [doCatalogo.map(chaveImagemPost).join(), daGaleria.map(chaveImagemPost).join()])); // eslint-disable-line react-hooks/exhaustive-deps
  const chaveMarcada = marcada && chaveImagemPost(marcada);

  async function enviar(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro('');
    setEnviando(true);
    try {
      const nova = await enviarParaGaleria(arquivo);
      await cliente.invalidateQueries({ queryKey: ['posts-imagens'] });
      aoEscolher({ origem: 'GALERIA', id: nova.id });
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const grade = (lista: ImagemPost[], rotulo: string) => (
    <div className="flex flex-wrap gap-2">
      {lista.map((i, n) => (
        <Miniatura key={chaveImagemPost(i)} imagem={i} foto={fotos.get(chaveImagemPost(i))} rotulo={`${rotulo} ${n + 1} para ${titulo}`} marcada={chaveMarcada === chaveImagemPost(i)} aoEscolher={() => aoEscolher(chaveMarcada === chaveImagemPost(i) ? null : i)} />
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      {erro && <Alerta>{erro}</Alerta>}
      {catalogo?.aviso && <Alerta tipo="aviso">{catalogo.aviso}</Alerta>}
      {catalogo && !catalogo.aviso && catalogo.imagens.length === 0 && <p className="text-xs text-slate-500">Sem imagem no catálogo para este produto. Use uma imagem própria.</p>}
      {doCatalogo.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Do catálogo</p>
          {grade(doCatalogo, 'Imagem do catálogo')}
        </div>
      )}
      {deIa.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={verIa} onChange={(e) => setVerIa(e.target.checked)} />
          Mostrar {deIa.length} imagem(ns) gerada(s) por IA. Saem com um aviso na arte e podem não reproduzir a embalagem exata.
        </label>
      )}
      {daGaleria.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Da galeria</p>
          {grade(daGaleria, 'Imagem da galeria')}
        </div>
      )}
      {!somenteLeitura && (
        <label className="block text-xs font-medium text-slate-600">
          {enviando ? 'Enviando…' : `Enviar imagem própria para ${titulo}`}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void enviar(e)} disabled={enviando} className="mt-1 block w-full text-sm font-normal" />
        </label>
      )}
    </div>
  );
}

function EditarProduto({ produto, somenteLeitura, escolherFoto, aoMudar, aoTirar }: { produto: ProdutoPost; somenteLeitura: boolean; escolherFoto: boolean; aoMudar: (p: Partial<ProdutoPost>) => void; aoTirar: () => void }) {
  const { data: catalogo = null } = useQuery({
    queryKey: ['posts-catalogo', produto.codigo],
    queryFn: () => api<ProdutoCatalogo>(`/posts/catalogo/${encodeURIComponent(produto.codigo)}`),
    enabled: !!produto.codigo,
    staleTime: 5 * 60_000,
  });
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
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      {produto.medicamento && (
        <Alerta tipo="aviso">O catálogo marca este produto como medicamento. A propaganda de medicamentos tem regras próprias da Anvisa, inclusive advertências obrigatórias e proibição para os de venda sob prescrição. Confira antes de publicar.</Alerta>
      )}
      <Campo rotulo="Nome do produto" maxLength={300} value={produto.descricao} disabled={somenteLeitura} onChange={(e) => aoMudar({ descricao: e.target.value })} ajuda={produto.codigo ? `Código ${produto.codigo}` : undefined} />
      <Campo rotulo="Preço" maxLength={40} value={produto.preco} disabled={somenteLeitura} onChange={(e) => aoMudar({ preco: e.target.value })} />
      <EscolherImagem titulo={produto.descricao || 'o produto'} catalogo={catalogo} marcada={produto.imagem} somenteLeitura={somenteLeitura} aoEscolher={(imagem) => aoMudar({ imagem })} />
      {!somenteLeitura && (
        <Botao variante="secundario" onClick={aoTirar}>
          Tirar produto
        </Botao>
      )}
    </div>
  );
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
      {buscar.data && buscar.data.produtos.length === 0 && <p className="text-sm text-slate-500">Nada encontrado.</p>}
      {buscar.data && buscar.data.produtos.length > 0 && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-auto rounded border border-slate-200 text-sm">
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

function Editor({ id, inicial, marca }: { id: string | null; inicial: DadosPost; marca: SituacaoMarcaPost }) {
  const { pode } = useAuth();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const somenteLeitura = !pode('post.editar');
  const podeLivre = pode('post.edicao_livre') && !somenteLeitura;
  const [d, setD] = useState<DadosPost>(inicial);
  const [livre, setLivre] = useState(false);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const tela = useRef<TelaPostControle>(null);

  const elementos = useMemo(() => montarPost(d, marca), [d, marca]);
  const usadas = useMemo(() => elementos.flatMap((e) => (e.tipo === 'imagem' ? [e.imagem] : [])), [elementos]);
  const imagens = useImagensPost(usadas);
  const { largura, altura, rotulo } = FORMATOS_POST[d.formato];
  const limites = MODELOS_POST[d.modelo];
  const conteudo = d.conteudo;
  const temAjustes = Object.keys(d.ajustes[d.formato] ?? {}).length > 0;

  const mudarConteudo = (m: Partial<DadosPost['conteudo']>) => setD((a) => ({ ...a, conteudo: { ...a.conteudo, ...m } }));
  const mudarProduto = (i: number, m: Partial<ProdutoPost>) => setD((a) => ({ ...a, conteudo: { ...a.conteudo, produtos: a.conteudo.produtos.map((p, n) => (n === i ? { ...p, ...m } : p)) } }));

  function trocarModelo(modelo: ModeloPost) {
    const max = MODELOS_POST[modelo].maxProdutos;
    // Trocar de modelo muda os elementos: os ajustes de posição deixam de fazer sentido.
    // O rodapé padrão fala de ofertas: num aviso, sai; quem escreveu o próprio não perde o texto.
    const rodape = (atual: string) => (modelo === 'AVISO' && atual === RODAPE_PADRAO ? '' : modelo !== 'AVISO' && !atual ? RODAPE_PADRAO : atual);
    setD((a) => ({ ...a, modelo, ajustes: {}, conteudo: { ...a.conteudo, rodape: rodape(a.conteudo.rodape), produtos: a.conteudo.produtos.slice(0, max), titulo: modelo === 'OFERTA' && !a.conteudo.titulo ? 'Ofertas' : a.conteudo.titulo } }));
  }

  function incluir(p: ProdutoPost) {
    setD((a) => {
      // Com um produto já escolhido e pedindo mais um, o modelo vira oferta.
      const modelo = a.modelo === 'PRODUTO' && a.conteudo.produtos.length >= 1 ? 'OFERTA' : a.modelo === 'AVISO' ? 'PRODUTO' : a.modelo;
      if (a.conteudo.produtos.length >= MODELOS_POST.OFERTA.maxProdutos) return a;
      return { ...a, modelo, ajustes: modelo === a.modelo ? a.ajustes : {}, titulo: a.titulo || p.descricao.slice(0, 120), conteudo: { ...a.conteudo, titulo: modelo === 'OFERTA' && !a.conteudo.titulo ? 'Ofertas' : a.conteudo.titulo, produtos: [...a.conteudo.produtos, p] } };
    });
  }

  function ajustar(elemento: string, ajuste: AjusteElemento) {
    setD((a) => ({ ...a, ajustes: { ...a.ajustes, [a.formato]: { ...a.ajustes[a.formato], [elemento]: ajuste } } }));
  }

  const salvar = useMutation({
    mutationFn: () => (id ? api<PostCompleto>(`/posts/${id}`, { metodo: 'PATCH', corpo: d }) : api<PostCompleto>('/posts', { metodo: 'POST', corpo: d })),
    onSuccess: (p) => {
      void cliente.invalidateQueries({ queryKey: ['posts'] });
      setAviso('Post salvo.');
      if (!id) navegar(`/posts/${p.id}`, { replace: true });
    },
  });

  const nomeArquivo = () => `${(d.titulo || 'post').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'post'}-${d.formato.toLowerCase()}.png`;

  async function baixar() {
    setErro('');
    const blob = await tela.current?.exportar();
    if (!blob) return setErro('Não foi possível gerar a imagem.');
    const endereco = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = endereco;
    a.download = nomeArquivo();
    a.click();
    setTimeout(() => URL.revokeObjectURL(endereco), 10_000);
  }

  async function compartilhar() {
    setErro('');
    const blob = await tela.current?.exportar();
    if (!blob) return setErro('Não foi possível gerar a imagem.');
    const arquivo = new File([blob], nomeArquivo(), { type: 'image/png' });
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

  return (
    <>
      <Cabecalho
        titulo={id ? 'Editar post' : 'Novo post'}
        descricao="Nome e preço vêm do ERP; a imagem, do catálogo ou da sua galeria."
        acoes={<Link to="/posts" className="text-sm text-blue-700 hover:underline">Voltar aos posts</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {erro && <Alerta>{erro}</Alerta>}
          {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
          {aviso && <Alerta tipo="info">{aviso}</Alerta>}
          {!marca.catalogoConfigurado && <Alerta tipo="aviso">O catálogo não está configurado neste servidor. Por enquanto, só imagem própria.</Alerta>}
          <Campo rotulo="Nome do post" required maxLength={120} value={d.titulo} disabled={somenteLeitura} onChange={(e) => setD({ ...d, titulo: e.target.value })} ajuda="Só para você achar depois. Não aparece na arte." />
          <Selecao rotulo="Modelo" value={d.modelo} disabled={somenteLeitura} onChange={(e) => trocarModelo(e.target.value as ModeloPost)}>
            {MODELOS.map((m) => (
              <option key={m} value={m}>{MODELOS_POST[m].rotulo}</option>
            ))}
          </Selecao>

          {d.modelo !== 'PRODUTO' && <Campo rotulo="Título" maxLength={120} value={conteudo.titulo} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ titulo: e.target.value })} />}
          {d.modelo === 'AVISO' && (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Texto</span>
                <textarea rows={3} maxLength={500} value={conteudo.texto} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ texto: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <EscolherImagem titulo="o aviso" catalogo={null} marcada={conteudo.imagem} somenteLeitura={somenteLeitura} aoEscolher={(imagem) => mudarConteudo({ imagem })} />
            </>
          )}

          {limites.maxProdutos > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Produtos ({conteudo.produtos.length} de {limites.maxProdutos})</h2>
              {conteudo.produtos.map((p, i) => (
                <EditarProduto
                  key={`${p.codigo}-${i}`}
                  produto={p}
                  somenteLeitura={somenteLeitura}
                  escolherFoto={!somenteLeitura && !inicial.conteudo.produtos.some((x) => x.codigo === p.codigo && id)}
                  aoMudar={(m) => mudarProduto(i, m)}
                  aoTirar={() => setD((a) => ({ ...a, ajustes: {}, conteudo: { ...a.conteudo, produtos: a.conteudo.produtos.filter((_, n) => n !== i) } }))}
                />
              ))}
              {!somenteLeitura && conteudo.produtos.length < MODELOS_POST.OFERTA.maxProdutos && (
                <>
                  <BuscarNoErp aoIncluir={incluir} />
                  <Botao variante="secundario" onClick={() => incluir({ codigo: '', descricao: 'Novo produto', preco: '', imagem: null })}>Incluir à mão</Botao>
                </>
              )}
              {conteudo.produtos.length < limites.minProdutos && <Alerta tipo="aviso">Este modelo precisa de pelo menos {limites.minProdutos} produto(s).</Alerta>}
            </section>
          )}

          <Campo rotulo="Rodapé" maxLength={200} value={conteudo.rodape} disabled={somenteLeitura} onChange={(e) => mudarConteudo({ rodape: e.target.value })} />

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Legenda</span>
            <textarea rows={5} maxLength={2200} value={d.legenda} disabled={somenteLeitura} onChange={(e) => setD({ ...d, legenda: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="flex flex-wrap gap-2">
            {!somenteLeitura && <Botao variante="secundario" onClick={() => setD({ ...d, legenda: legendaSugerida(d.modelo, conteudo, marca) })}>Sugerir legenda</Botao>}
            <Botao variante="secundario" disabled={!d.legenda} onClick={() => void copiarLegenda()}>Copiar legenda</Botao>
          </div>
        </div>

        <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Tamanho do post">
            {FORMATOS.map((f) => (
              <button key={f} type="button" aria-pressed={d.formato === f} onClick={() => setD({ ...d, formato: f })} className={`rounded-md border px-3 py-1.5 text-sm ${d.formato === f ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {FORMATOS_POST[f].rotulo}
              </button>
            ))}
          </div>
          <TelaPost ref={tela} elementos={elementos} largura={largura} altura={altura} imagens={imagens} editavel={livre} aoAjustar={ajustar} />
          <p className="text-center text-xs text-slate-500">{rotulo}: {largura} × {altura} pixels</p>
          {podeLivre && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={livre} onChange={(e) => setLivre(e.target.checked)} />
                Edição livre: arraste e redimensione os elementos
              </label>
              {temAjustes && <Botao variante="secundario" onClick={() => setD((a) => { const { [a.formato]: _f, ...resto } = a.ajustes; return { ...a, ajustes: resto }; })}>Voltar ao modelo</Botao>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!somenteLeitura && <Botao disabled={salvar.isPending} onClick={() => { setAviso(''); salvar.mutate(); }}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>}
            <Botao variante="secundario" onClick={() => void baixar()}>Baixar imagem</Botao>
            {podeCompartilhar && <Botao variante="secundario" onClick={() => void compartilhar()}>Compartilhar</Botao>}
          </div>
          <p className="text-xs text-slate-500">O sistema não publica sozinho: baixe a imagem, copie a legenda e publique pela rede social.</p>
        </div>
      </div>
    </>
  );
}
