import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { ROTULO_VEICULO, type RastreioPublico } from '@etiquetas/shared';
import { MapaEntregadores } from '../entregas/MapaEntregadores';

const ATUALIZAR_MS = 15_000;

async function pedir<T>(caminho: string): Promise<T> {
  const r = await fetch(`/api/rastreio/${caminho}`);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((corpo as { message?: string }).message ?? 'Não foi possível carregar.');
  return corpo as T;
}

/** Página pública do destinatário: /rastreio/<codigo>, sem login (docs/ENTREGAS.md). */
export function Rastreio() {
  const { pathname } = useLocation();
  const codigo = decodeURIComponent(pathname.split('/')[2] ?? '');
  const [dados, setDados] = useState<RastreioPublico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      pedir<RastreioPublico>(codigo).then(
        (d) => vivo && (setDados(d), setErro(null)),
        (e: Error) => vivo && setErro(e.message),
      );
    void carregar();
    const t = setInterval(carregar, ATUALIZAR_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [codigo]);

  const temFoto = !!dados?.entregador?.temFoto;
  useEffect(() => {
    if (!temFoto) return setFoto(null);
    void pedir<{ dados: string }>(`${codigo}/foto`).then((r) => setFoto(r.dados), () => setFoto(null));
  }, [codigo, temFoto]);

  const marcas = useMemo(
    () =>
      dados
        ? [
            { ...dados.pontoCliente, cor: '#7c3aed', rotulo: 'Você' },
            ...(dados.posicao ? [{ ...dados.posicao, cor: '#2563eb', rotulo: dados.entregador?.nome ?? 'Entregador' }] : []),
          ]
        : [],
    [dados],
  );

  useEffect(() => {
    document.title = dados ? `${dados.texto} · ${dados.empresa}` : 'Acompanhe a entrega';
  }, [dados]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-lg space-y-4">
        {erro && !dados && <p className="rounded-md bg-red-50 px-4 py-3 text-red-800">{erro}</p>}
        {!dados && !erro && <p className="text-slate-500">Carregando…</p>}
        {dados && (
          <>
            <header>
              <p className="text-sm text-slate-500">
                {dados.empresa} · {dados.tipo === 'ENTREGA' ? 'Entrega' : dados.tipo === 'COLETA' ? 'Coleta' : 'Devolução de máquina'} nº {dados.numero}
              </p>
              <h1 className="text-2xl font-bold" data-testid="rastreio-situacao">
                {dados.texto}
              </h1>
              {dados.previsaoMinutos != null && <p className="text-lg text-blue-700">Chega em cerca de {dados.previsaoMinutos} min</p>}
              {dados.concluidaEm && <p className="text-slate-600">em {new Date(dados.concluidaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
            </header>

            {dados.codigoConfirmacao && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-sm text-amber-900">Código de confirmação: informe ao entregador na hora de receber.</p>
                <p className="font-mono text-4xl font-bold tracking-[0.3em]" data-testid="rastreio-codigo">
                  {dados.codigoConfirmacao}
                </p>
              </div>
            )}

            {dados.entregador && (
              <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-sm">
                {foto ? <img src={foto} alt={`Foto de ${dados.entregador.nome}`} className="h-14 w-14 rounded-full object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-xl font-bold text-slate-500">{dados.entregador.nome.slice(0, 1)}</div>}
                <div>
                  <p className="font-semibold">{dados.entregador.nome}</p>
                  <p className="text-sm text-slate-600">
                    {ROTULO_VEICULO[dados.entregador.veiculo]}
                    {dados.entregador.placa ? ` · placa ${dados.entregador.placa}` : ''}
                  </p>
                </div>
              </div>
            )}

            <MapaEntregadores config={dados.mapa} base={null} raioKm={1} marcas={marcas} altura={320} />
            <p className="text-center text-xs text-slate-400">
              Atualiza sozinho a cada 15 s · {new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR')}
            </p>
            {dados.posicao == null && dados.situacao !== 'CONCLUIDA' && dados.situacao !== 'CANCELADA' && <p className="text-center text-xs text-slate-500">A posição do entregador aparece quando ele estiver vindo até você.</p>}
          </>
        )}
        <p className="pt-4 text-center text-xs text-slate-400">Flow Entregas</p>
      </div>
    </div>
  );
}
