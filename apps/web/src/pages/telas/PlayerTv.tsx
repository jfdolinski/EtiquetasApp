import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codigoParaLer,
  INTERVALO_AVISO_TELA_S,
  INTERVALO_PEDIDO_TELA_S,
  linkDoVinculoDaTela,
  nivelEfetivo,
  programasValidos,
  VERSAO_PLAYER_TELA,
  type PedidoTelaCriado,
  type ProgramacaoTela,
  type ProgramaTela,
  type RespostaAvisoTela,
  type SituacaoPedidoTela,
} from '@etiquetas/shared';
import { CodigoQr } from '../../components/CodigoQr';
import { ExibicaoTela } from './ExibicaoTela';

const CHAVE_TOKEN = 'etiquetas.tv.token';
/** Abaixo disso, um QR não é lido: o painel de LED mostra só o código. */
const MENOR_LADO_PARA_QR = 220;
const IDENTIFICAR_MS = 30_000;
const NOVA_TENTATIVA_MS = 10_000;
const CHAVE_PROGRAMACAO = 'etiquetas.tv.programacao';
/** Confere se algum preço venceu, mesmo sem falar com o servidor. */
const CONFERIR_VALIDADE_MS = 15_000;

interface Guardado {
  programacao: ProgramacaoTela;
  perfil: RespostaAvisoTela['perfil'];
  /** Diferença entre o relógio do servidor e o desta TV. */
  diferencaMs: number;
}

/** A TV religada sem internet volta com o que tinha, sempre limitado pelo `validoAte`. */
function lerGuardado(): Guardado | null {
  try {
    const t = localStorage.getItem(CHAVE_PROGRAMACAO);
    return t ? (JSON.parse(t) as Guardado) : null;
  } catch {
    return null;
  }
}
function gravarGuardado(g: Guardado | null) {
  try {
    if (g) localStorage.setItem(CHAVE_PROGRAMACAO, JSON.stringify(g));
    else localStorage.removeItem(CHAVE_PROGRAMACAO);
  } catch {
    // Sem armazenamento, só não sobrevive a religar a TV sem internet.
  }
}

/** Quadros por segundo nos primeiros instantes: é o que decide a animação no modo automático. */
function useQuadrosPorSegundo(): number | null {
  const [quadros, setQuadros] = useState<number | null>(null);
  useEffect(() => {
    let id = 0;
    let n = 0;
    let inicio = 0;
    const passo = (t: number) => {
      if (!inicio) inicio = t;
      n++;
      if (t - inicio >= 1500) return setQuadros((n / (t - inicio)) * 1000);
      id = requestAnimationFrame(passo);
    };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, []);
  return quadros;
}

function useTamanhoDaJanela() {
  const [tamanho, setTamanho] = useState({ largura: window.innerWidth, altura: window.innerHeight });
  useEffect(() => {
    const medir = () => setTamanho({ largura: window.innerWidth, altura: window.innerHeight });
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);
  return tamanho;
}

// A TV pode bloquear o armazenamento: sem ele, a tela só pede o vínculo de novo ao religar.
function lerToken(): string | null {
  try {
    return localStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}
function gravarToken(token: string | null) {
  try {
    if (token) localStorage.setItem(CHAVE_TOKEN, token);
    else localStorage.removeItem(CHAVE_TOKEN);
  } catch {
    // Fica só na memória.
  }
}

const medidas = () => ({
  largura: Math.round(window.innerWidth),
  altura: Math.round(window.innerHeight),
  escala: window.devicePixelRatio || 1,
  navegador: navigator.userAgent.slice(0, 300),
});

async function enviar<T>(caminho: string, corpo: unknown, token?: string): Promise<{ status: number; dados: T | null }> {
  const r = await fetch(`/api/tv/${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, dados: (await r.json().catch(() => null)) as T | null };
}

/** Mantém a tela acesa onde o navegador deixa; onde não deixa, a TV segue a própria configuração. */
function useTelaAcesa() {
  useEffect(() => {
    let trava: { release: () => Promise<void> } | null = null;
    const pedir = () => {
      const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      void wakeLock?.request('screen').then((t) => (trava = t)).catch(() => undefined);
    };
    pedir();
    const aoVoltar = () => document.visibilityState === 'visible' && pedir();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      void trava?.release().catch(() => undefined);
    };
  }, []);
}

/** Voltar precisa continuar saindo da tela cheia: Esc, voltar, e os códigos de voltar da LG (461) e da Samsung (10009). */
const TECLAS_DE_SAIR = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack']);
const CODIGOS_DE_SAIR = new Set([461, 10009]);
/** O aviso fica por cima do conteúdo: aparece só por um tempo, para não esconder preço. */
const DICA_TELA_CHEIA_MS = 20_000;

type ElementoComPrefixo = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type DocumentoComPrefixo = Document & { webkitFullscreenElement?: Element | null };

/**
 * O navegador só entra em tela cheia depois de um gesto de alguém, então a página não faz isso sozinha:
 * qualquer botão do controle pede. Não dura ao recarregar, e algumas TVs simplesmente não deixam.
 */
function useTelaCheia(): boolean {
  const [dica, setDica] = useState(false);
  useEffect(() => {
    const raiz = document.documentElement as ElementoComPrefixo;
    const pedir = raiz.requestFullscreen ?? raiz.webkitRequestFullscreen;
    if (!pedir) return;
    const emTelaCheia = () => !!(document.fullscreenElement ?? (document as DocumentoComPrefixo).webkitFullscreenElement);
    // Aberta em modo quiosque já ocupa tudo: não há o que pedir.
    const ocupaTudo = () => window.innerWidth >= window.screen.width && window.innerHeight >= window.screen.height;
    let fimDaDica: ReturnType<typeof setTimeout>;
    const mostrarDica = () => {
      clearTimeout(fimDaDica);
      const precisa = !emTelaCheia() && !ocupaTudo();
      setDica(precisa);
      if (precisa) fimDaDica = setTimeout(() => setDica(false), DICA_TELA_CHEIA_MS);
    };
    const tentar = () => {
      if (emTelaCheia()) return;
      try {
        // Recusou: tira o aviso, que só prometeria algo que esta TV não faz. O próximo botão tenta de novo.
        void Promise.resolve(pedir.call(raiz)).catch(() => setDica(false));
      } catch {
        setDica(false);
      }
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (!TECLAS_DE_SAIR.has(e.key) && !CODIGOS_DE_SAIR.has(e.keyCode)) tentar();
    };
    mostrarDica();
    window.addEventListener('keydown', aoTeclar);
    window.addEventListener('pointerdown', tentar);
    document.addEventListener('fullscreenchange', mostrarDica);
    document.addEventListener('webkitfullscreenchange', mostrarDica);
    return () => {
      clearTimeout(fimDaDica);
      window.removeEventListener('keydown', aoTeclar);
      window.removeEventListener('pointerdown', tentar);
      document.removeEventListener('fullscreenchange', mostrarDica);
      document.removeEventListener('webkitfullscreenchange', mostrarDica);
    };
  }, []);
  return dica;
}

/** O link único: sem vínculo, mostra o QR; vinculada, avisa o servidor e mostra o conteúdo. */
export function PlayerTv() {
  const [token, setToken] = useState(lerToken);
  useTelaAcesa();
  const dicaTelaCheia = useTelaCheia();

  const vincular = useCallback((t: string | null) => {
    gravarToken(t);
    gravarGuardado(null);
    setToken(t);
  }, []);

  return (
    <div className="flex h-screen w-screen cursor-none flex-col items-center justify-center overflow-hidden bg-slate-950 p-[2vmin] text-center text-white">
      {token ? <TelaVinculada token={token} aoPerder={() => vincular(null)} /> : <PedidoDeVinculo aoVincular={vincular} />}
      {dicaTelaCheia && Math.min(window.innerWidth, window.innerHeight) >= MENOR_LADO_PARA_QR && (
        <p role="status" className="fixed bottom-[3vmin] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/80 px-[3vmin] py-[1.2vmin] text-[2.6vmin] text-white">
          Aperte OK no controle para usar a tela inteira
        </p>
      )}
    </div>
  );
}

function PedidoDeVinculo({ aoVincular }: { aoVincular: (token: string) => void }) {
  const [pedido, setPedido] = useState<PedidoTelaCriado | null>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [menorLado, setMenorLado] = useState(() => Math.min(window.innerWidth, window.innerHeight));

  useEffect(() => {
    const medir = () => setMenorLado(Math.min(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  useEffect(() => {
    let ativo = true;
    let relogio: ReturnType<typeof setTimeout>;
    const agendar = (acao: () => void, ms: number) => {
      if (ativo) relogio = setTimeout(acao, ms);
    };
    async function pedir() {
      try {
        const r = await enviar<PedidoTelaCriado>('pedidos', medidas());
        if (!ativo) return;
        if (!r.dados || r.status >= 400) throw new Error('pedido');
        setPedido(r.dados);
        setSemConexao(false);
        agendar(() => void conferir(r.dados!.segredo), INTERVALO_PEDIDO_TELA_S * 1000);
      } catch {
        setSemConexao(true);
        agendar(() => void pedir(), NOVA_TENTATIVA_MS);
      }
    }
    async function conferir(segredo: string) {
      try {
        const { dados } = await enviar<SituacaoPedidoTela>('pedidos/situacao', { segredo });
        if (!ativo) return;
        if (dados?.situacao === 'VINCULADA') return aoVincular(dados.token);
        // Venceu: aparece um QR novo sozinho, sem ninguém mexer na TV.
        if (dados?.situacao === 'VENCIDO') return void pedir();
        setSemConexao(false);
      } catch {
        setSemConexao(true);
      }
      agendar(() => void conferir(segredo), INTERVALO_PEDIDO_TELA_S * 1000);
    }
    void pedir();
    return () => {
      ativo = false;
      clearTimeout(relogio);
    };
  }, [aoVincular]);

  if (!pedido) return <p className="text-[4vmin] text-slate-300">{semConexao ? 'Sem conexão com o servidor. Tentando de novo…' : 'Preparando…'}</p>;

  const mostrarQr = menorLado >= MENOR_LADO_PARA_QR;
  return (
    <>
      {mostrarQr && (
        <>
          <h1 className="mb-[2vmin] text-[5vmin] font-semibold">Vincular esta tela</h1>
          <div className="rounded-lg bg-white p-[1vmin]">
            <CodigoQr texto={linkDoVinculoDaTela(window.location.origin, pedido.codigo)} tamanho={Math.round(menorLado * 0.5)} />
          </div>
          <p className="mt-[2vmin] text-[3vmin] text-slate-300">Leia no aplicativo, em Telas, ou digite o código no sistema:</p>
        </>
      )}
      <p aria-label="Código da tela" className={`font-mono font-bold tracking-widest ${mostrarQr ? 'mt-[1vmin] text-[7vmin]' : 'text-[30vmin] leading-none'}`} style={mostrarQr ? undefined : { fontSize: `min(30vh, ${Math.floor(90 / 9)}vw)` }}>
        {codigoParaLer(pedido.codigo)}
      </p>
      {mostrarQr && <p className="mt-[1vmin] text-[2.2vmin] text-slate-500">Esta tela informa {medidas().largura}×{medidas().altura}</p>}
      {semConexao && <p className="mt-[1vmin] text-[2.5vmin] text-amber-300">Sem conexão com o servidor. Tentando de novo…</p>}
    </>
  );
}

function TelaVinculada({ token, aoPerder }: { token: string; aoPerder: () => void }) {
  const [dados, setDados] = useState<RespostaAvisoTela | null>(null);
  const [bloqueada, setBloqueada] = useState<string | null>(null);
  const [identificando, setIdentificando] = useState(false);
  const fimIdentificacao = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [guardado, setGuardado] = useState(lerGuardado);
  const [programas, setProgramas] = useState<ProgramaTela[]>([]);
  const versao = useRef(guardado?.programacao.versao ?? null);
  const quadros = useQuadrosPorSegundo();
  const tamanho = useTamanhoDaJanela();

  // Preço vencido sai da tela pelo relógio do servidor, com ou sem internet.
  useEffect(() => {
    const conferir = () => setProgramas(guardado ? programasValidos(guardado.programacao.programas, new Date(Date.now() + guardado.diferencaMs)) : []);
    conferir();
    const relogio = setInterval(conferir, CONFERIR_VALIDADE_MS);
    return () => clearInterval(relogio);
  }, [guardado]);

  useEffect(() => {
    let ativo = true;
    async function buscarProgramacao(perfil: RespostaAvisoTela['perfil']) {
      const r = await enviar<ProgramacaoTela>('programacao', {}, token);
      if (!ativo || r.status >= 400 || !r.dados) return;
      const novo = { programacao: r.dados, perfil, diferencaMs: new Date(r.dados.agora).getTime() - Date.now() };
      versao.current = r.dados.versao;
      gravarGuardado(novo);
      setGuardado(novo);
    }
    async function avisar() {
      try {
        const r = await enviar<RespostaAvisoTela & { message?: string }>('aviso', { ...medidas(), versao: VERSAO_PLAYER_TELA, segundoPlano: document.visibilityState !== 'visible' }, token);
        if (!ativo) return;
        // Desvinculada: volta ao QR. Sem internet ou servidor fora, continua como está.
        if (r.status === 401) return aoPerder();
        if (r.status === 403) {
          versao.current = null;
          gravarGuardado(null);
          setGuardado(null);
          return setBloqueada(r.dados?.message ?? 'Esta tela está indisponível.');
        }
        if (r.status >= 400 || !r.dados) return;
        setBloqueada(null);
        setDados(r.dados);
        if (r.dados.versaoProgramacao !== versao.current) await buscarProgramacao(r.dados.perfil);
        if (r.dados.comando === 'RECARREGAR') window.location.reload();
        if (r.dados.comando === 'IDENTIFICAR') {
          setIdentificando(true);
          clearTimeout(fimIdentificacao.current);
          fimIdentificacao.current = setTimeout(() => setIdentificando(false), IDENTIFICAR_MS);
        }
      } catch {
        // Tenta no próximo aviso.
      }
    }
    void avisar();
    const relogio = setInterval(() => void avisar(), INTERVALO_AVISO_TELA_S * 1000);
    return () => {
      ativo = false;
      clearInterval(relogio);
      clearTimeout(fimIdentificacao.current);
    };
  }, [token, aoPerder]);

  if (bloqueada) return <p className="max-w-[80vw] text-[4vmin] text-slate-300">{bloqueada}</p>;
  if (!identificando && programas.length > 0 && guardado) {
    const perfil = dados?.perfil ?? guardado.perfil;
    return (
      <div className="fixed inset-0">
        <ExibicaoTela programas={programas} largura={tamanho.largura} altura={tamanho.altura} margemPct={perfil.margemPct} nivel={nivelEfetivo(perfil.nivelAnimacao, quadros, perfil.tipo)} fuso={guardado.programacao.fuso} />
      </div>
    );
  }
  if (!dados) return <p className="text-[4vmin] text-slate-300">Conectando…</p>;

  if (identificando) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-blue-700 p-[2vmin]">
        <p className="text-[14vmin] font-bold leading-tight">{dados.tela.nome}</p>
        {dados.tela.local && <p className="mt-[2vmin] text-[6vmin]">{dados.tela.local}</p>}
      </div>
    );
  }
  return (
    <>
      <h1 className="text-[7vmin] font-semibold">{dados.tela.nome}</h1>
      {dados.tela.local && <p className="mt-[1vmin] text-[4vmin] text-slate-300">{dados.tela.local}</p>}
      <p className="mt-[3vmin] text-[3vmin] text-slate-400">Tela vinculada. Aguardando conteúdo.</p>
    </>
  );
}
