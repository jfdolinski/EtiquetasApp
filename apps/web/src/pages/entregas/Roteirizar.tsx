import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarKm, MAX_PEDIDOS_JUNTOS, PARADAS_POR_CHAMADA_PADRAO, problemaNaRoteirizacao, type GrupoRoteiro, type PedidoDoRoteiro, type PedidoParaJuntar, type ResultadoRoteiro, type RoteiroProposto } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Campo, Modal } from '../../components/ui';

const chave = (p: { origem: string; id: string }) => `${p.origem}:${p.id}`;
const separar = (lista: { origem: 'FLOW' | 'ERP'; id: string }[]) => ({ pedidoIds: lista.filter((p) => p.origem === 'FLOW').map((p) => p.id), pedidoErpIds: lista.filter((p) => p.origem === 'ERP').map((p) => p.id) });

/**
 * Muitos pedidos de uma vez: o Flow divide em chamadas por direção a partir da loja (quem fica do
 * mesmo lado sai junto), até N pedidos em cada, e a empresa revisa antes de abrir todas.
 */
export function RoteirizarPedidos({ aoFechar, aoAbrir }: { aoFechar: () => void; aoAbrir: (r: ResultadoRoteiro) => void }) {
  const cliente = useQueryClient();
  const { data = [], error, isLoading } = useQuery({ queryKey: ['juntar-pedidos'], queryFn: () => api<PedidoParaJuntar[]>('/entregas/juntar/pedidos') });
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [porChamada, setPorChamada] = useState(String(PARADAS_POR_CHAMADA_PADRAO));
  const [proposta, setProposta] = useState<RoteiroProposto | null>(null);
  const [grupos, setGrupos] = useState<GrupoRoteiro[]>([]);
  const [distribuir, setDistribuir] = useState(true);
  const escolhidos = marcados ?? data.map(chave);
  const problema = problemaNaRoteirizacao(escolhidos.length, Number(porChamada));

  const propor = useMutation({
    mutationFn: () => api<RoteiroProposto>('/entregas/roteirizar', { metodo: 'POST', corpo: { ...separar(data.filter((p) => escolhidos.includes(chave(p)))), porChamada: Number(porChamada) } }),
    onSuccess: (r) => {
      setProposta(r);
      setGrupos(r.grupos);
    },
  });
  const abrir = useMutation({
    mutationFn: () => api<ResultadoRoteiro>('/entregas/roteirizar/abrir', { metodo: 'POST', corpo: { grupos: grupos.filter((g) => g.pedidos.length).map((g) => separar(g.pedidos)), distribuir } }),
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: ['chamadas'] });
      void cliente.invalidateQueries({ queryKey: ['juntar-pedidos'] });
      aoAbrir(r);
    },
  });

  const mover = (p: PedidoDoRoteiro, de: number, para: number) =>
    setGrupos((gs) => {
      const novos = gs.map((g) => ({ ...g, pedidos: [...g.pedidos] }));
      novos[de].pedidos = novos[de].pedidos.filter((x) => chave(x) !== chave(p));
      if (para === novos.length) novos.push({ pedidos: [p], metrosEstimados: 0 });
      else if (para >= 0) novos[para].pedidos.push(p);
      return novos.filter((g) => g.pedidos.length);
    });
  const cheio = grupos.some((g) => g.pedidos.length > MAX_PEDIDOS_JUNTOS);
  const totalNasRotas = grupos.reduce((s, g) => s + g.pedidos.length, 0);

  return (
    <Modal titulo="Roteirizar pedidos" aberto aoFechar={aoFechar} largo>
      <div className="space-y-4 text-sm">
        {!proposta ? (
          <>
            <p className="text-slate-600">Escolha os pedidos que vão sair. O Flow separa em chamadas pela direção a partir da loja, com até o número de pedidos que você escolher em cada, e põe cada uma na ordem do menor caminho. Nada é aberto antes de você revisar.</p>
            {error && <Alerta>{error.message}</Alerta>}
            {!isLoading && data.length === 0 && <p className="text-slate-500">Nenhum pedido com entrega esperando entregador.</p>}
            {data.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="text-blue-700 underline" onClick={() => setMarcados(data.map(chave))}>
                  Marcar todos
                </button>
                <button type="button" className="text-blue-700 underline" onClick={() => setMarcados([])}>
                  Desmarcar todos
                </button>
                <span className="text-slate-500">{escolhidos.length} de {data.length} marcados</span>
              </div>
            )}
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {data.map((p) => (
                <label key={chave(p)} className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 hover:bg-slate-50" data-testid="pedido-para-roteirizar">
                  <input type="checkbox" className="mt-1" checked={escolhidos.includes(chave(p))} onChange={(e) => setMarcados(e.target.checked ? [...escolhidos, chave(p)] : escolhidos.filter((x) => x !== chave(p)))} />
                  <span>
                    <strong>{p.rotulo}</strong> · {p.cliente || 'sem nome'}
                    <span className="block text-xs text-slate-500">
                      {p.endereco}
                      {!p.temPonto && ' · sem ponto no mapa (o endereço é procurado)'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="w-56">
              <Campo rotulo="Pedidos por chamada" type="number" min={1} max={MAX_PEDIDOS_JUNTOS} value={porChamada} onChange={(e) => setPorChamada(e.target.value)} />
            </div>
            {escolhidos.length > 0 && problema && <Alerta tipo="aviso">{problema}</Alerta>}
            {propor.error && <Alerta>{propor.error.message}</Alerta>}
            <Botao onClick={() => propor.mutate()} disabled={!!problema || propor.isPending}>
              {propor.isPending ? 'Montando as rotas…' : 'Montar as rotas'}
            </Botao>
          </>
        ) : (
          <>
            <p className="text-slate-600">
              {grupos.length} {grupos.length === 1 ? 'chamada' : 'chamadas'} com {totalNasRotas} pedidos. Mude um pedido de chamada se quiser; a ordem de cada uma é refeita pelo menor caminho ao abrir.
            </p>
            {proposta.semPonto.length > 0 && (
              <Alerta tipo="aviso">
                Ficaram de fora, sem ponto no mapa: {proposta.semPonto.map((p) => p.rotulo).join(', ')}. Chame cada um pela tela do pedido ou junte à mão, marcando o ponto.
              </Alerta>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {grupos.map((g, i) => (
                <div key={i} className="space-y-1 rounded-lg border border-slate-200 px-3 py-2" data-testid="grupo-roteiro">
                  <div className="flex items-center justify-between">
                    <strong>Chamada {i + 1}</strong>
                    <span className="text-xs text-slate-500">
                      {g.pedidos.length} {g.pedidos.length === 1 ? 'pedido' : 'pedidos'}
                      {g.metrosEstimados > 0 && ` · cerca de ${formatarKm(g.metrosEstimados)}`}
                    </span>
                  </div>
                  <ol className="list-decimal space-y-1 pl-5">
                    {g.pedidos.map((p) => (
                      <li key={chave(p)}>
                        <span className="font-medium">{p.rotulo}</span> · {p.cliente || 'sem nome'}
                        <span className="block text-xs text-slate-500">{p.endereco}</span>
                        <select className="mt-0.5 rounded border border-slate-300 px-1 py-0.5 text-xs" value={i} onChange={(e) => mover(p, i, Number(e.target.value))} aria-label={`Mover ${p.rotulo}`}>
                          {grupos.map((_, j) => (
                            <option key={j} value={j}>
                              {j === i ? `Na chamada ${j + 1}` : `Mover para a chamada ${j + 1}`}
                            </option>
                          ))}
                          <option value={grupos.length}>Numa chamada só para ele</option>
                          <option value={-1}>Tirar da roteirização</option>
                        </select>
                      </li>
                    ))}
                  </ol>
                  {g.pedidos.length > MAX_PEDIDOS_JUNTOS && <Alerta tipo="aviso">Até {MAX_PEDIDOS_JUNTOS} pedidos por chamada.</Alerta>}
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={distribuir} onChange={(e) => setDistribuir(e.target.checked)} /> Distribuir automaticamente (pelas regras do Direcionamento)
            </label>
            {abrir.error && <Alerta>{abrir.error.message}</Alerta>}
            <div className="flex gap-2">
              <Botao variante="secundario" onClick={() => setProposta(null)}>
                Voltar
              </Botao>
              <Botao onClick={() => abrir.mutate()} disabled={!grupos.length || cheio || abrir.isPending}>
                {abrir.isPending ? 'Abrindo…' : `Abrir ${grupos.length} ${grupos.length === 1 ? 'chamada' : 'chamadas'}`}
              </Botao>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** O que aconteceu ao abrir as chamadas do roteiro. */
export function ResultadoDoRoteiro({ r, aoFechar }: { r: ResultadoRoteiro; aoFechar: () => void }) {
  return (
    <div className="space-y-2" data-testid="resultado-roteiro">
      {r.abertas.length > 0 && (
        <Alerta tipo="info">
          {r.abertas.length === 1 ? 'Chamada aberta' : `${r.abertas.length} chamadas abertas`}: {r.abertas.map((a) => `nº ${a.numero}`).join(', ')}.
        </Alerta>
      )}
      {r.erros.map((e, i) => (
        <Alerta key={i}>
          {e.pedidos}: {e.erro}
        </Alerta>
      ))}
      <button type="button" className="text-xs text-slate-500 underline" onClick={aoFechar}>
        Fechar aviso
      </button>
    </div>
  );
}
