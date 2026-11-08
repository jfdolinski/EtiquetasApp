import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codigoParaLer,
  INTERVALO_AVISO_TELA_S,
  INTERVALO_PEDIDO_TELA_S,
  linkDoVinculoDaTela,
  VERSAO_PLAYER_TELA,
  type PedidoTelaCriado,
  type RespostaAvisoTela,
  type SituacaoPedidoTela,
} from '@etiquetas/shared';
import { CodigoQr } from '../../components/CodigoQr';

const CHAVE_TOKEN = 'etiquetas.tv.token';
/** Abaixo disso, um QR não é lido: o painel de LED mostra só o código. */
const MENOR_LADO_PARA_QR = 220;
const IDENTIFICAR_MS = 30_000;
const NOVA_TENTATIVA_MS = 10_000;

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

/** O link único: sem vínculo, mostra o QR; vinculada, avisa o servidor e mostra o conteúdo. */
export function PlayerTv() {
  const [token, setToken] = useState(lerToken);
  useTelaAcesa();

  const vincular = useCallback((t: string | null) => {
    gravarToken(t);
    setToken(t);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-slate-950 p-[2vmin] text-center text-white">
      {token ? <TelaVinculada token={token} aoPerder={() => vincular(null)} /> : <PedidoDeVinculo aoVincular={vincular} />}
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

  useEffect(() => {
    let ativo = true;
    async function avisar() {
      try {
        const r = await enviar<RespostaAvisoTela & { message?: string }>('aviso', { ...medidas(), versao: VERSAO_PLAYER_TELA, segundoPlano: document.visibilityState !== 'visible' }, token);
        if (!ativo) return;
        // Desvinculada: volta ao QR. Sem internet ou servidor fora, continua como está.
        if (r.status === 401) return aoPerder();
        if (r.status === 403) return setBloqueada(r.dados?.message ?? 'Esta tela está indisponível.');
        if (r.status >= 400 || !r.dados) return;
        setBloqueada(null);
        setDados(r.dados);
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
