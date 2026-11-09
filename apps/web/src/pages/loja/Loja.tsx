import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  caminhoAcompanhamento,
  centavosDe,
  faltaParaMinimo,
  formatarCelular,
  formatarCentavos,
  LIMITES_DADOS_PEDIDO,
  MAX_QUANTIDADE_ITEM,
  normalizarCelular,
  normalizarCep,
  problemaNoEndereco,
  rotuloSituacaoPedido,
  ROTULO_MODALIDADE,
  ROTULO_PAGAMENTO,
  subtotalDe,
  textoDaMudanca,
  textoDataAgendamento,
  textoEndereco,
  textoFaixa,
  trocoPara,
  UFS,
  unidadesDe,
  FORMAS_PAGAMENTO,
  type CatalogoPublico,
  type EnderecoPedido,
  type FaixaAgendamento,
  type FormaPagamento,
  type ItemCatalogo,
  type ModalidadeEntrega,
  type MudancaCarrinho,
  type NovoPedido,
  type PedidoCriado,
  type PedidoPublico,
  type SituacaoPedido,
} from '@etiquetas/shared';

/**
 * A página que o cliente da loja abre pelo link: sem login, feita para o celular. Os preços mostrados são
 * os da cópia do catálogo, e o servidor confere tudo de novo ao enviar; o que mudar volta para o cliente.
 */

class ErroLoja extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo: unknown,
  ) {
    super(message);
  }
}

async function pedir<T>(caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`/api/loja/${caminho}`, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const m = j?.message;
    throw new ErroLoja(Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : 'Não deu certo. Confira a internet e tente de novo.', r.status, j);
  }
  return j as T;
}

// O navegador pode recusar o armazenamento (aba anônima, dados bloqueados): a página funciona sem ele.
function ler<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(chave);
    return v ? (JSON.parse(v) as T) : padrao;
  } catch {
    return padrao;
  }
}
function gravar(chave: string, valor: unknown) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Só não fica guardado.
  }
}

const simplificar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Loja() {
  const caminho = window.location.pathname;
  const acompanhamento = caminho.match(/^\/loja\/pedido\/([^/]+)\/?$/);
  if (acompanhamento) return <Acompanhamento codigo={acompanhamento[1]} />;
  const codigo = caminho.match(/^\/loja\/([^/]+)\/?$/)?.[1];
  if (!codigo) return <Aviso titulo="Link incompleto">Peça o link certo para a loja.</Aviso>;
  return <Catalogo codigo={codigo} />;
}

function Aviso({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">{titulo}</h1>
        {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
      </div>
    </div>
  );
}

type Carrinho = Record<string, number>;
type Etapa = 'produtos' | 'carrinho' | 'dados';
interface PedidoGuardado {
  numero: number;
  codigo: string;
  em: string;
}

const POR_VEZ = 40;

function Catalogo({ codigo }: { codigo: string }) {
  const chaveCarrinho = `etiquetas.loja.${codigo}.carrinho`;
  const chavePedidos = `etiquetas.loja.${codigo}.pedidos`;
  const [catalogo, setCatalogo] = useState<CatalogoPublico | null>(null);
  const [erro, setErro] = useState<ErroLoja | null>(null);
  const [carrinho, setCarrinhoBruto] = useState<Carrinho>(() => ler(chaveCarrinho, {}));
  const [etapa, setEtapa] = useState<Etapa>('produtos');
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(POR_VEZ);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<PedidoCriado | null>(null);
  const [pedidos] = useState<PedidoGuardado[]>(() => ler(chavePedidos, []));

  const setCarrinho = useCallback(
    (c: Carrinho) => {
      setCarrinhoBruto(c);
      gravar(chaveCarrinho, Object.keys(c).length ? c : null);
    },
    [chaveCarrinho],
  );

  const carregar = useCallback(async () => {
    try {
      const c = await pedir<CatalogoPublico>(codigo);
      setCatalogo(c);
      setErro(null);
      document.title = c.empresa;
      return c;
    } catch (e) {
      setErro(e as ErroLoja);
      return null;
    }
  }, [codigo]);

  useEffect(() => {
    void carregar().then((c) => {
      if (!c) return;
      // O carrinho guardado pode ter ficado velho: some o que saiu do catálogo e a quantidade cabe no estoque.
      const porCodigo = new Map(c.itens.map((i) => [i.codigo, i]));
      const antes = ler<Carrinho>(chaveCarrinho, {});
      const depois: Carrinho = {};
      for (const [k, q] of Object.entries(antes)) {
        const i = porCodigo.get(k);
        if (i) depois[k] = Math.min(q, i.estoque ?? MAX_QUANTIDADE_ITEM);
      }
      if (JSON.stringify(antes) !== JSON.stringify(depois)) setAviso('Alguns itens do seu carrinho mudaram ou não estão mais disponíveis.');
      setCarrinho(depois);
    });
  }, [carregar, chaveCarrinho, setCarrinho]);

  const porCodigo = useMemo(() => new Map((catalogo?.itens ?? []).map((i) => [i.codigo, i])), [catalogo]);
  const filtrados = useMemo(() => {
    const termo = simplificar(busca.trim());
    return (catalogo?.itens ?? []).filter((i) => (!categoria || i.categoria === categoria) && (!termo || simplificar(i.nome).includes(termo) || i.codigo === busca.trim()));
  }, [catalogo, busca, categoria]);
  useEffect(() => setMostrar(POR_VEZ), [busca, categoria]);

  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fim.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const o = new IntersectionObserver((e) => e[0]?.isIntersecting && setMostrar((m) => m + POR_VEZ), { rootMargin: '600px' });
    o.observe(el);
    return () => o.disconnect();
  }, [filtrados, etapa]);

  if (enviado) return <PedidoEnviado empresa={catalogo?.empresa ?? ''} pedido={enviado} />;
  if (erro) return <Aviso titulo={erro.status === 404 ? 'Link não encontrado' : 'Catálogo indisponível'}>{erro.message}</Aviso>;
  if (!catalogo) return <Aviso titulo="Carregando produtos…" />;

  const linhas = Object.entries(carrinho)
    .map(([k, quantidade]) => ({ item: porCodigo.get(k), quantidade }))
    .filter((l): l is { item: ItemCatalogo; quantidade: number } => !!l.item);
  const subtotal = subtotalDe(linhas.map((l) => ({ quantidade: l.quantidade, precoCentavos: l.item.precoCentavos })));
  const unidades = unidadesDe(linhas);
  const falta = faltaParaMinimo(subtotal, catalogo.pedidoMinimoCentavos);
  const mudarQuantidade = (i: ItemCatalogo, q: number) => {
    const c = { ...carrinho };
    const max = Math.min(i.estoque ?? MAX_QUANTIDADE_ITEM, MAX_QUANTIDADE_ITEM);
    if (q <= 0) delete c[i.codigo];
    else c[i.codigo] = Math.min(q, max);
    setCarrinho(c);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-28 text-slate-900">
      <header className="bg-white px-4 pb-3 pt-4 shadow-sm">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{catalogo.empresa}</h1>
            {catalogo.mensagem && <p className="mt-0.5 text-sm text-slate-600">{catalogo.mensagem}</p>}
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${catalogo.aberta ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{catalogo.aberta ? 'Aberto agora' : 'Fechado agora'}</span>
        </div>
        {!catalogo.aberta && (
          <p className="mx-auto mt-2 max-w-5xl rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {catalogo.abreEm ? `Abrimos ${catalogo.abreEm}.` : 'Estamos fechados.'} {catalogo.modalidades.length ? 'Você já pode agendar a entrega.' : 'Você pode olhar os produtos e voltar quando estivermos abertos.'}
          </p>
        )}
        {pedidos.length > 0 && etapa === 'produtos' && (
          <p className="mx-auto mt-2 max-w-5xl text-sm">
            Seus pedidos:{' '}
            {pedidos.slice(-3).reverse().map((p, n) => (
              <a key={p.codigo} className="text-blue-700 underline" href={caminhoAcompanhamento(p.codigo)}>
                {n > 0 ? ', ' : ''}nº {p.numero}
              </a>
            ))}
          </p>
        )}
      </header>

      {aviso && (
        <div className="mx-auto mt-3 max-w-5xl px-4">
          <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {aviso} <button type="button" className="ml-1 underline" onClick={() => setAviso(null)}>Ok</button>
          </p>
        </div>
      )}

      {etapa === 'produtos' && (
        <main className="mx-auto max-w-5xl px-4">
          <div className="sticky top-0 z-10 -mx-4 bg-slate-50/95 px-4 pb-2 pt-3 backdrop-blur">
            <input type="search" aria-label="Buscar produto" placeholder="Buscar produto" className="w-full rounded-full border border-slate-300 bg-white px-4 py-2.5 text-base shadow-sm focus:border-blue-500 focus:outline-none" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {catalogo.categorias.length > 0 && (
              <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categorias">
                {[null, ...catalogo.categorias].map((c) => (
                  <button key={c ?? '*'} type="button" role="tab" aria-selected={categoria === c} onClick={() => setCategoria(c)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${categoria === c ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>
                    {c ?? 'Todos'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {filtrados.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Nenhum produto encontrado.</p>}
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtrados.slice(0, mostrar).map((i) => (
              <CartaoProduto key={i.codigo} item={i} quantidade={carrinho[i.codigo] ?? 0} aoMudar={(q) => mudarQuantidade(i, q)} />
            ))}
          </ul>
          <div ref={fim} />
          {mostrar < filtrados.length && (
            <div className="py-4 text-center">
              <button type="button" className="text-sm text-blue-700 underline" onClick={() => setMostrar((m) => m + POR_VEZ)}>Mostrar mais</button>
            </div>
          )}
        </main>
      )}

      {etapa === 'carrinho' && (
        <main className="mx-auto max-w-2xl px-4 pt-4">
          <Voltar aoClicar={() => setEtapa('produtos')}>Continuar comprando</Voltar>
          <h2 className="mt-2 text-lg font-semibold">Seu carrinho</h2>
          {linhas.length === 0 && <p className="py-8 text-center text-sm text-slate-500">O carrinho está vazio.</p>}
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg bg-white shadow-sm">
            {linhas.map(({ item, quantidade }) => (
              <li key={item.codigo} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.nome}</p>
                  <p className="text-xs text-slate-500">{formatarCentavos(item.precoCentavos)}{item.unidade ? ` / ${item.unidade}` : ''}</p>
                </div>
                <Quantidade nome={item.nome} valor={quantidade} max={item.estoque} aoMudar={(q) => mudarQuantidade(item, q)} />
                <p className="w-20 text-right text-sm font-semibold">{formatarCentavos(item.precoCentavos * quantidade)}</p>
              </li>
            ))}
          </ul>
        </main>
      )}

      {etapa === 'dados' && (
        <Finalizar
          codigo={codigo}
          catalogo={catalogo}
          linhas={linhas}
          subtotal={subtotal}
          aoVoltar={() => setEtapa('carrinho')}
          aoMudanca={async (itens) => {
            // O servidor diz o que vale agora: o carrinho passa a ser esse, e o catálogo é relido.
            setCarrinho(Object.fromEntries(itens.map((i) => [i.codigo, i.quantidade])));
            await carregar();
          }}
          aoEnviar={(p) => {
            gravar(chavePedidos, [...ler<PedidoGuardado[]>(chavePedidos, []), { numero: p.numero, codigo: p.codigo, em: new Date().toISOString() }].slice(-10));
            setCarrinho({});
            setEnviado(p);
          }}
        />
      )}

      {etapa !== 'dados' && unidades > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.06)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold">{unidades} {unidades === 1 ? 'item' : 'itens'} · {formatarCentavos(subtotal)}</p>
              {falta > 0 && <p className="text-xs text-amber-700">Faltam {formatarCentavos(falta)} para o pedido mínimo</p>}
            </div>
            {etapa === 'produtos' ? (
              <button type="button" className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white" onClick={() => setEtapa('carrinho')}>Ver carrinho</button>
            ) : (
              <button type="button" disabled={falta > 0 || catalogo.modalidades.length === 0} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300" onClick={() => setEtapa('dados')}>Continuar</button>
            )}
          </div>
          {etapa === 'carrinho' && catalogo.modalidades.length === 0 && <p className="mx-auto mt-1 max-w-5xl text-xs text-amber-700">A loja está fechada e não recebe pedidos agora.</p>}
        </div>
      )}
    </div>
  );
}

function Voltar({ aoClicar, children }: { aoClicar: () => void; children: ReactNode }) {
  return (
    <button type="button" className="text-sm text-blue-700" onClick={aoClicar}>
      ← {children}
    </button>
  );
}

function CartaoProduto({ item, quantidade, aoMudar }: { item: ItemCatalogo; quantidade: number; aoMudar: (q: number) => void }) {
  const [semFoto, setSemFoto] = useState(false);
  return (
    <li className="flex flex-col overflow-hidden rounded-lg bg-white shadow-sm" data-testid="produto-loja">
      <div className="flex aspect-square items-center justify-center bg-white p-2">
        {item.foto && !semFoto ? <img src={item.foto} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setSemFoto(true)} /> : <span className="text-4xl font-bold text-slate-200">{item.nome.slice(0, 1)}</span>}
      </div>
      <div className="flex flex-1 flex-col p-2.5 pt-0">
        <p className="line-clamp-2 text-sm leading-snug">{item.nome}</p>
        <div className="mt-auto pt-1.5">
          {item.precoDeCentavos && <p className="text-xs text-slate-400 line-through">{formatarCentavos(item.precoDeCentavos)}</p>}
          <p className="text-base font-bold">
            {formatarCentavos(item.precoCentavos)}
            {item.unidade && <span className="text-xs font-normal text-slate-500"> / {item.unidade}</span>}
          </p>
          <div className="mt-2">
            {quantidade === 0 ? (
              <button type="button" className="w-full rounded-full bg-blue-600 py-2 text-sm font-semibold text-white" aria-label={`Adicionar ${item.nome}`} onClick={() => aoMudar(1)}>Adicionar</button>
            ) : (
              <Quantidade nome={item.nome} valor={quantidade} max={item.estoque} aoMudar={aoMudar} largo />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Quantidade({ nome, valor, max, aoMudar, largo }: { nome: string; valor: number; max?: number; aoMudar: (q: number) => void; largo?: boolean }) {
  const limite = Math.min(max ?? MAX_QUANTIDADE_ITEM, MAX_QUANTIDADE_ITEM);
  return (
    <div className={`flex items-center justify-between rounded-full ring-1 ring-blue-600 ${largo ? 'w-full' : ''}`}>
      <button type="button" aria-label={`Tirar um ${nome}`} className="h-9 w-9 text-lg font-semibold text-blue-700" onClick={() => aoMudar(valor - 1)}>–</button>
      <span className="min-w-6 text-center text-sm font-semibold" aria-label={`Quantidade de ${nome}`}>{valor}</span>
      <button type="button" aria-label={`Mais um ${nome}`} disabled={valor >= limite} className="h-9 w-9 text-lg font-semibold text-blue-700 disabled:text-slate-300" onClick={() => aoMudar(valor + 1)}>+</button>
    </div>
  );
}

interface DadosCliente {
  nome: string;
  telefone: string;
  endereco: EnderecoPedido;
}

const ENDERECO_VAZIO: EnderecoPedido = { cep: '', rua: '', numero: '', semNumero: false, complemento: '', bairro: '', cidade: '', uf: '' };
const CHAVE_CLIENTE = 'etiquetas.loja.cliente';

const mascaraCelular = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const mascaraCep = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

function Finalizar({
  codigo,
  catalogo,
  linhas,
  subtotal,
  aoVoltar,
  aoMudanca,
  aoEnviar,
}: {
  codigo: string;
  catalogo: CatalogoPublico;
  linhas: { item: ItemCatalogo; quantidade: number }[];
  subtotal: number;
  aoVoltar: () => void;
  aoMudanca: (itens: { codigo: string; quantidade: number }[]) => Promise<void>;
  aoEnviar: (p: PedidoCriado) => void;
}) {
  // Quem já pediu aqui não digita tudo de novo: os dados ficam só neste aparelho.
  const guardado = ler<DadosCliente>(CHAVE_CLIENTE, { nome: '', telefone: '', endereco: ENDERECO_VAZIO });
  const [nome, setNome] = useState(guardado.nome);
  const [telefone, setTelefone] = useState(guardado.telefone);
  const [endereco, setEndereco] = useState<EnderecoPedido>({ ...ENDERECO_VAZIO, ...guardado.endereco });
  const [modalidade, setModalidade] = useState<ModalidadeEntrega>(catalogo.modalidades[0]?.modalidade ?? 'ENTREGA');
  const [faixa, setFaixa] = useState<FaixaAgendamento | null>(null);
  const [pagamento, setPagamento] = useState<FormaPagamento>('PIX');
  const [trocoTexto, setTrocoTexto] = useState('');
  const [semTroco, setSemTroco] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [cepSituacao, setCepSituacao] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mudancas, setMudancas] = useState<MudancaCarrinho[]>([]);

  const taxa = catalogo.modalidades.find((m) => m.modalidade === modalidade)?.precoCentavos ?? 0;
  const total = subtotal + taxa;
  const trocoPara_ = semTroco || pagamento !== 'DINHEIRO' ? null : centavosDe(trocoTexto);
  const troco = trocoPara_ === null ? null : trocoPara(total, trocoPara_);
  const comEndereco = modalidade !== 'RETIRADA';
  const faixasPorDia = useMemo(() => {
    const m = new Map<string, FaixaAgendamento[]>();
    for (const f of catalogo.faixas) m.set(f.data, [...(m.get(f.data) ?? []), f]);
    return m;
  }, [catalogo.faixas]);

  const problema =
    nome.trim().length < 2
      ? 'Informe o seu nome.'
      : !normalizarCelular(telefone)
        ? 'Informe um celular com DDD.'
        : comEndereco && problemaNoEndereco(endereco)
          ? problemaNoEndereco(endereco)
          : modalidade === 'AGENDADA' && !faixa
            ? 'Escolha o dia e o horário da entrega.'
            : pagamento === 'DINHEIRO' && !semTroco && (trocoPara_ === null || troco === null)
              ? `Diga para quanto é o troco (o total é ${formatarCentavos(total)}), ou marque que não precisa.`
              : null;

  const buscarCep = async (cep: string) => {
    const n = normalizarCep(cep);
    if (!n) return;
    setCepSituacao('Buscando o endereço…');
    try {
      const d = await pedir<{ rua: string; bairro: string; cidade: string; uf: string }>(`${codigo}/cep/${n}`);
      setEndereco((e) => ({ ...e, cep, rua: d.rua || e.rua, bairro: d.bairro || e.bairro, cidade: d.cidade, uf: d.uf }));
      setCepSituacao(d.rua ? null : 'Este CEP vale para a cidade toda: preencha a rua e o bairro.');
    } catch (e) {
      setCepSituacao((e as Error).message);
    }
  };

  const enviar = async () => {
    if (problema) return;
    setEnviando(true);
    setErro(null);
    const corpo: NovoPedido = {
      itens: linhas.map((l) => ({ codigo: l.item.codigo, quantidade: l.quantidade, precoCentavos: l.item.precoCentavos })),
      nome: nome.trim(),
      telefone,
      modalidade,
      endereco: comEndereco ? endereco : null,
      agendamento: modalidade === 'AGENDADA' ? faixa : null,
      pagamento,
      trocoParaCentavos: trocoPara_,
      observacao: observacao.trim(),
    };
    try {
      const r = await pedir<PedidoCriado>(`${codigo}/pedidos`, corpo);
      gravar(CHAVE_CLIENTE, { nome: nome.trim(), telefone, endereco });
      aoEnviar(r);
    } catch (e) {
      const x = e as ErroLoja;
      const corpoErro = x.corpo as { mudancas?: MudancaCarrinho[]; itens?: { codigo: string; quantidade: number }[] } | null;
      if (x.status === 409 && corpoErro?.mudancas) {
        setMudancas(corpoErro.mudancas);
        await aoMudanca(corpoErro.itens ?? []);
      } else setErro(x.message);
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none';
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 pb-10 pt-4">
      <Voltar aoClicar={aoVoltar}>Voltar ao carrinho</Voltar>
      <h2 className="text-lg font-semibold">Finalizar pedido</h2>

      <Bloco titulo="Seus dados">
        <Rotulo texto="Nome">
          <input className={campo} autoComplete="name" maxLength={LIMITES_DADOS_PEDIDO.nome} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Rotulo>
        <Rotulo texto="Celular (WhatsApp)">
          <input className={campo} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(11) 98765-4321" value={telefone} onChange={(e) => setTelefone(mascaraCelular(e.target.value))} />
        </Rotulo>
      </Bloco>

      <Bloco titulo="Como quer receber">
        <div className="space-y-2">
          {catalogo.modalidades.map((m) => (
            <label key={m.modalidade} className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 ${modalidade === m.modalidade ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name="modalidade" checked={modalidade === m.modalidade} onChange={() => setModalidade(m.modalidade)} />
                <span className="text-sm font-medium">{ROTULO_MODALIDADE[m.modalidade].titulo}</span>
              </span>
              <span className="text-sm">{m.precoCentavos ? formatarCentavos(m.precoCentavos) : 'Grátis'}</span>
            </label>
          ))}
        </div>
        {modalidade === 'RETIRADA' && catalogo.enderecoRetirada && <p className="text-sm text-slate-700">Retire em: <strong>{catalogo.enderecoRetirada}</strong></p>}
        {modalidade === 'AGENDADA' && (
          <Rotulo texto="Dia e horário da entrega">
            <select className={campo} value={faixa ? `${faixa.data}|${faixa.inicio}` : ''} onChange={(e) => setFaixa(catalogo.faixas.find((f) => `${f.data}|${f.inicio}` === e.target.value) ?? null)}>
              <option value="">Escolher…</option>
              {[...faixasPorDia.entries()].map(([data, fs]) => (
                <optgroup key={data} label={textoDataAgendamento(data, catalogo.hoje)}>
                  {fs.map((f) => (
                    <option key={f.inicio} value={`${f.data}|${f.inicio}`}>{textoFaixa(f, catalogo.hoje)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {catalogo.faixas.length === 0 && <p className="mt-1 text-xs text-amber-700">Não há horários livres para agendar.</p>}
          </Rotulo>
        )}
      </Bloco>

      {comEndereco && (
        <Bloco titulo="Endereço de entrega">
          <Rotulo texto="CEP">
            <input
              className={campo}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              value={endereco.cep}
              onChange={(e) => {
                const cep = mascaraCep(e.target.value);
                setEndereco({ ...endereco, cep });
                if (cep.replace(/\D/g, '').length === 8) void buscarCep(cep);
              }}
            />
          </Rotulo>
          {cepSituacao && <p className="text-xs text-slate-600" role="status">{cepSituacao}</p>}
          <Rotulo texto="Rua">
            <input className={campo} autoComplete="address-line1" maxLength={LIMITES_DADOS_PEDIDO.rua} value={endereco.rua} onChange={(e) => setEndereco({ ...endereco, rua: e.target.value })} />
          </Rotulo>
          <div className="grid grid-cols-2 gap-3">
            <Rotulo texto="Número">
              <input className={campo} inputMode="numeric" disabled={endereco.semNumero} maxLength={LIMITES_DADOS_PEDIDO.numero} value={endereco.numero} onChange={(e) => setEndereco({ ...endereco, numero: e.target.value })} />
            </Rotulo>
            <label className="flex items-end gap-2 pb-3 text-sm">
              <input type="checkbox" checked={endereco.semNumero} onChange={(e) => setEndereco({ ...endereco, semNumero: e.target.checked, numero: '' })} /> Sem número
            </label>
          </div>
          <Rotulo texto="Complemento (opcional)">
            <input className={campo} autoComplete="address-line2" maxLength={LIMITES_DADOS_PEDIDO.complemento} placeholder="Apto, bloco, referência" value={endereco.complemento} onChange={(e) => setEndereco({ ...endereco, complemento: e.target.value })} />
          </Rotulo>
          <Rotulo texto="Bairro">
            <input className={campo} maxLength={LIMITES_DADOS_PEDIDO.bairro} value={endereco.bairro} onChange={(e) => setEndereco({ ...endereco, bairro: e.target.value })} />
          </Rotulo>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Rotulo texto="Cidade">
              <input className={campo} autoComplete="address-level2" maxLength={LIMITES_DADOS_PEDIDO.cidade} value={endereco.cidade} onChange={(e) => setEndereco({ ...endereco, cidade: e.target.value })} />
            </Rotulo>
            <Rotulo texto="Estado">
              <select className={campo} value={endereco.uf} onChange={(e) => setEndereco({ ...endereco, uf: e.target.value })}>
                <option value="">UF</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </Rotulo>
          </div>
        </Bloco>
      )}

      <Bloco titulo="Pagamento na entrega">
        <div className="grid grid-cols-3 gap-2">
          {FORMAS_PAGAMENTO.map((f) => (
            <label key={f} className={`flex cursor-pointer items-center justify-center rounded-md border p-2.5 text-center text-sm ${pagamento === f ? 'border-blue-600 bg-blue-50 font-medium' : 'border-slate-200'}`}>
              <input type="radio" name="pagamento" className="sr-only" checked={pagamento === f} onChange={() => setPagamento(f)} />
              {ROTULO_PAGAMENTO[f]}
            </label>
          ))}
        </div>
        {pagamento === 'DINHEIRO' && (
          <div className="space-y-2">
            <Rotulo texto="Troco para quanto?">
              <input className={campo} inputMode="decimal" disabled={semTroco} placeholder="R$ 100,00" value={trocoTexto} onChange={(e) => setTrocoTexto(e.target.value.replace(/^R\$\s*/i, ''))} />
            </Rotulo>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={semTroco} onChange={(e) => setSemTroco(e.target.checked)} /> Não preciso de troco
            </label>
            {troco !== null && <p className="text-sm text-emerald-800" data-testid="troco">Seu troco: <strong>{formatarCentavos(troco)}</strong></p>}
            {trocoPara_ !== null && troco === null && <p className="text-sm text-amber-700">O valor precisa cobrir o total de {formatarCentavos(total)}.</p>}
          </div>
        )}
        <p className="text-xs text-slate-500">O pagamento é feito na entrega ou na retirada. A forma escolhida aqui é só para a loja se preparar.</p>
      </Bloco>

      <Bloco titulo="Observação (opcional)">
        <textarea aria-label="Observação" className={campo} rows={2} maxLength={LIMITES_DADOS_PEDIDO.observacao} placeholder="Ex.: tocar o interfone" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </Bloco>

      <Bloco titulo="Resumo">
        <dl className="space-y-1 text-sm">
          <Linha rotulo={`Produtos (${unidadesDe(linhas)})`} valor={formatarCentavos(subtotal)} />
          <Linha rotulo={ROTULO_MODALIDADE[modalidade].titulo} valor={taxa ? formatarCentavos(taxa) : 'Grátis'} />
          <Linha rotulo="Total" valor={formatarCentavos(total)} forte />
        </dl>
      </Bloco>

      {mudancas.length > 0 && (
        <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Alguns produtos mudaram desde que você os escolheu:</p>
          <ul className="mt-1 list-disc pl-5">
            {mudancas.map((m) => (
              <li key={`${m.codigo}-${m.tipo}`}>{textoDaMudanca(m)}</li>
            ))}
          </ul>
          <p className="mt-1">O carrinho já foi atualizado. Confira o total e envie de novo.</p>
        </div>
      )}
      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {problema && <p className="text-sm text-amber-700">{problema}</p>}
      <p className="text-xs text-slate-500">Seu nome, celular e endereço são usados só para este pedido, por {catalogo.empresa}.</p>
      <button type="button" disabled={!!problema || enviando || linhas.length === 0} onClick={() => void enviar()} className="w-full rounded-full bg-blue-600 py-3 text-base font-semibold text-white disabled:bg-slate-300">
        {enviando ? 'Enviando…' : `Enviar pedido · ${formatarCentavos(total)}`}
      </button>
    </main>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
      {children}
    </section>
  );
}

function Rotulo({ texto, children }: { texto: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-700">{texto}</span>
      {children}
    </label>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex justify-between ${forte ? 'border-t border-slate-200 pt-1.5 text-base font-bold' : ''}`}>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function PedidoEnviado({ empresa, pedido }: { empresa: string; pedido: PedidoCriado }) {
  const link = `${window.location.origin}${caminhoAcompanhamento(pedido.codigo)}`;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="mt-3 text-xl font-bold">Pedido nº {pedido.numero} enviado!</h1>
        <p className="mt-2 text-sm text-slate-600">{empresa} já recebeu o seu pedido. Acompanhe por este link; ele também fica guardado neste aparelho.</p>
        <a href={caminhoAcompanhamento(pedido.codigo)} className="mt-5 inline-block rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white">Acompanhar o pedido</a>
        <button type="button" className="mt-3 block w-full text-sm text-blue-700 underline" onClick={() => void navigator.clipboard?.writeText(link)}>Copiar o link</button>
      </div>
    </div>
  );
}

const PASSOS: SituacaoPedido[] = ['NOVO', 'EM_SEPARACAO', 'PRONTO', 'CONCLUIDO'];
const RELER_ACOMPANHAMENTO_MS = 30_000;

function Acompanhamento({ codigo }: { codigo: string }) {
  const [pedido, setPedido] = useState<PedidoPublico | null>(null);
  const [erro, setErro] = useState<ErroLoja | null>(null);
  useEffect(() => {
    let vivo = true;
    const ler_ = () =>
      pedir<PedidoPublico>(`pedido/${codigo}`)
        .then((p) => {
          if (!vivo) return;
          setPedido(p);
          document.title = `Pedido nº ${p.numero} – ${p.empresa}`;
        })
        .catch((e) => vivo && setErro(e as ErroLoja));
    void ler_();
    const r = setInterval(() => void ler_(), RELER_ACOMPANHAMENTO_MS);
    return () => {
      vivo = false;
      clearInterval(r);
    };
  }, [codigo]);

  if (!pedido) return erro ? <Aviso titulo="Pedido não encontrado">{erro.message}</Aviso> : <Aviso titulo="Carregando o pedido…" />;
  const atual = PASSOS.indexOf(pedido.situacao);
  return (
    <div className="min-h-screen bg-slate-50 pb-10 text-slate-900">
      <header className="bg-white px-4 py-4 shadow-sm">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-slate-500">{pedido.empresa}</p>
          <h1 className="text-xl font-bold">Pedido nº {pedido.numero}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <Bloco titulo="Situação">
          {pedido.situacao === 'CANCELADO' ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800" data-testid="situacao-pedido">Cancelado</p>
          ) : (
            <ol className="space-y-2">
              {PASSOS.map((s, n) => (
                <li key={s} className={`flex items-center gap-2 text-sm ${n <= atual ? 'font-medium text-slate-900' : 'text-slate-400'}`} {...(n === atual ? { 'data-testid': 'situacao-pedido', 'aria-current': 'step' as const } : {})}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${n < atual ? 'bg-emerald-600 text-white' : n === atual ? 'bg-blue-600 text-white' : 'bg-slate-200'}`}>{n < atual ? '✓' : n + 1}</span>
                  {rotuloSituacaoPedido(s, pedido.modalidade)}
                </li>
              ))}
            </ol>
          )}
        </Bloco>
        <Bloco titulo={ROTULO_MODALIDADE[pedido.modalidade].titulo}>
          {pedido.agendamento && <p className="text-sm">{textoFaixa(pedido.agendamento, '')}</p>}
          {pedido.endereco && <p className="text-sm text-slate-700">{textoEndereco(pedido.endereco)}</p>}
          {pedido.enderecoRetirada && <p className="text-sm text-slate-700">Retire em: {pedido.enderecoRetirada}</p>}
          <p className="text-sm text-slate-700">{pedido.nome} · {formatarCelular(pedido.telefone)}</p>
        </Bloco>
        <Bloco titulo="Produtos">
          <ul className="divide-y divide-slate-100 text-sm">
            {pedido.itens.map((i) => (
              <li key={i.codigo} className="flex justify-between gap-3 py-1.5">
                <span>{i.quantidade}× {i.nome}</span>
                <span className="whitespace-nowrap">{formatarCentavos(i.quantidade * i.precoCentavos)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-slate-200 pt-2 text-sm">
            <Linha rotulo="Produtos" valor={formatarCentavos(pedido.totais.subtotalCentavos)} />
            <Linha rotulo="Entrega" valor={pedido.totais.taxaCentavos ? formatarCentavos(pedido.totais.taxaCentavos) : 'Grátis'} />
            <Linha rotulo="Total" valor={formatarCentavos(pedido.totais.totalCentavos)} forte />
          </dl>
        </Bloco>
        <Bloco titulo="Pagamento">
          <p className="text-sm">
            {ROTULO_PAGAMENTO[pedido.pagamento]}
            {pedido.trocoParaCentavos !== null && pedido.totais.trocoCentavos !== null && ` · troco para ${formatarCentavos(pedido.trocoParaCentavos)}: devolver ${formatarCentavos(pedido.totais.trocoCentavos)}`}
          </p>
          {pedido.observacao && <p className="text-sm text-slate-600">Observação: {pedido.observacao}</p>}
        </Bloco>
      </main>
    </div>
  );
}
