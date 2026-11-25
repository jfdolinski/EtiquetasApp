import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MINUTOS_ANTES_DA_AGENDADA,
  textoVolumes,
  problemaNosPedidosJuntos,
  ROTULO_MODO_ASSINATURA,
  type ParadaComPedido,
  type PedidoParaJuntar,
  type RascunhoJuntos,
  type RascunhoPedidoErp,
  textoDoChecklist,
  formatarCelular,
  formatarCentavos,
  formatarKm,
  linkWhatsApp,
  ROTULO_MOTIVO_OCORRENCIA,
  ROTULO_SITUACAO_CHAMADA,
  ROTULO_TIPO_CHAMADA,
  ROTULO_VEICULO,
  MAX_PARADAS_EXTRAS,
  ordemMaisCurta,
  rotuloDaFoto,
  taxaDoCancelamento,
  type PontoRastro,
  TIPOS_CHAMADA,
  type ChamadaResumo,
  type ConfigEntregasEmpresa,
  type ConfigMapa,
  type ElegivelOferta,
  type NovaChamada,
  type OfertaDaChamada,
  type ParadaChamada,
  type Ponto,
  type PreviaChamada,
  type RascunhoDoPedido,
  type ResultadoEndereco,
  type SituacaoChamada,
  type TipoChamada,
} from '@etiquetas/shared';
import { api, apiArquivo } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, formatarData, Modal, Selecao, Selo, Tabela } from '../../components/ui';
import { MapaEntregadores } from './MapaEntregadores';
import { PosEntrega } from './PosEntrega';
import { ConversaDaChamada } from './Conversa';
import { AlertaEmergencia, LinkRastreio } from './RastreioDaChamada';

const COR_SITUACAO: Record<SituacaoChamada, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  ABERTA: 'amarelo',
  ACEITA: 'verde',
  NA_COLETA: 'verde',
  COLETADA: 'verde',
  NO_DESTINO: 'verde',
  CONCLUIDA: 'cinza',
  OCORRENCIA: 'vermelho',
  CANCELADA: 'cinza',
};

const ROTULO_RESULTADO: Record<OfertaDaChamada['resultado'], string> = { PENDENTE: 'esperando resposta', ACEITA: 'aceitou', RECUSADA: 'recusou', EXPIRADA: 'não respondeu', CANCELADA: 'cancelada', DESISTIU: 'aceitou e desistiu' };

const COR_COLETA = '#ea580c';
const COR_DESTINO = '#7c3aed';
const COR_ENTREGADOR = '#2563eb';
const COR_PARADA = '#db2777';

const paradaVazia = (): ParadaChamada => ({ lat: 0, lon: 0, endereco: '', contato: '', telefone: '', instrucoes: '' });
const temPonto = (p: Ponto) => !(p.lat === 0 && p.lon === 0);

export function Chamadas({ config, mapa, abrir }: { config: ConfigEntregasEmpresa; mapa: ConfigMapa; abrir?: string | null }) {
  const { pode } = useAuth();
  const [filtro, setFiltro] = useState<'ATIVAS' | 'TODAS'>('ATIVAS');
  const [nova, setNova] = useState(false);
  const [juntando, setJuntando] = useState(false);
  const [juntos, setJuntos] = useState<RascunhoJuntos | null>(null);
  const [aberta, setAberta] = useState<string | null>(abrir ?? null);
  const { data = [], error, isLoading } = useQuery({ queryKey: ['chamadas', filtro], queryFn: () => api<ChamadaResumo[]>(`/entregas/chamadas?filtro=${filtro}`), refetchInterval: 10_000 });
  const gerencia = pode('entrega.gerenciar');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <Selecao rotulo="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as 'ATIVAS' | 'TODAS')}>
            <option value="ATIVAS">Em andamento e de hoje</option>
            <option value="TODAS">Todas</option>
          </Selecao>
        </div>
        {gerencia && (
          <div className="flex gap-2">
            <Botao variante="secundario" onClick={() => setJuntando(true)}>
              Juntar pedidos
            </Botao>
            <Botao onClick={() => setNova(true)}>Nova chamada</Botao>
          </div>
        )}
      </div>
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Nº', 'Serviço', 'Destino', 'Entregador', 'Valor', 'Situação']} vazio={data.length === 0}>
          {data.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setAberta(c.id)} data-testid="linha-chamada">
              <td className="px-4 py-2.5 font-medium">{c.numero}</td>
              <td className="px-4 py-2.5">
                {ROTULO_TIPO_CHAMADA[c.tipo]}
                <div className="text-xs text-slate-500">{c.agendadaPara ? `Agendada para ${formatarData(c.agendadaPara)}` : formatarData(c.criadoEm)}</div>
                {c.mensagensNaoLidas > 0 && <div className="text-xs font-semibold text-blue-700" data-testid="mensagens-nao-lidas">{c.mensagensNaoLidas === 1 ? '1 mensagem nova' : `${c.mensagensNaoLidas} mensagens novas`}</div>}
              </td>
              <td className="max-w-xs truncate px-4 py-2.5 text-slate-600">{c.destino.endereco}</td>
              <td className="px-4 py-2.5">{c.entregador?.nome ?? (c.ofertaPendente ? <span className="text-slate-500">Oferecida a {c.ofertaPendente.entregadorNome}</span> : c.distribuicao.ativa ? <span className="text-slate-500">{c.distribuicao.semEntregadorDesde ? 'Procurando (ninguém aceitou ainda)' : 'Distribuindo…'}</span> : <span className="text-slate-400">—</span>)}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{formatarCentavos(c.valorCentavos)}</td>
              <td className="px-4 py-2.5">
                <Selo cor={COR_SITUACAO[c.situacao]}>{ROTULO_SITUACAO_CHAMADA[c.situacao]}</Selo>
                {c.emergencia && !c.emergencia.vistaEm && (
                  <span className="ml-1">
                    <Selo cor="vermelho">Emergência</Selo>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      {nova && <NovaChamadaModal config={config} mapa={mapa} aoFechar={() => setNova(false)} aoCriar={(id) => { setNova(false); setAberta(id); }} />}
      {juntando && <JuntarPedidos aoFechar={() => setJuntando(false)} aoMontar={(r) => { setJuntando(false); setJuntos(r); }} />}
      {juntos && <NovaChamadaModal config={config} mapa={mapa} juntos={juntos} aoFechar={() => setJuntos(null)} aoCriar={(id) => { setJuntos(null); setAberta(id); }} />}
      {aberta && <DetalheChamada id={aberta} mapa={mapa} gerencia={gerencia} aoFechar={() => setAberta(null)} />}
    </div>
  );
}

// Nova chamada --------------------------------------------------------------------------------

/** Escolhe os pedidos (do Flow e do ERP) que vão juntos numa chamada, um por parada. */
function JuntarPedidos({ aoFechar, aoMontar }: { aoFechar: () => void; aoMontar: (r: RascunhoJuntos) => void }) {
  const { data = [], error, isLoading } = useQuery({ queryKey: ['juntar-pedidos'], queryFn: () => api<PedidoParaJuntar[]>('/entregas/juntar/pedidos') });
  const [marcados, setMarcados] = useState<string[]>([]);
  const chave = (p: PedidoParaJuntar) => `${p.origem}:${p.id}`;
  const montar = useMutation({
    mutationFn: () => {
      const escolhidos = data.filter((p) => marcados.includes(chave(p)));
      return api<RascunhoJuntos>('/entregas/juntar', { metodo: 'POST', corpo: { pedidoIds: escolhidos.filter((p) => p.origem === 'FLOW').map((p) => p.id), pedidoErpIds: escolhidos.filter((p) => p.origem === 'ERP').map((p) => p.id) } });
    },
    onSuccess: aoMontar,
  });
  const problema = problemaNosPedidosJuntos(marcados.length);
  return (
    <Modal titulo="Juntar pedidos numa chamada" aberto aoFechar={aoFechar} largo>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Cada pedido vira uma parada, na ordem do menor caminho a partir da loja. Os pedidos do Flow avançam sozinhos na coleta e na entrega de cada parada.</p>
        {error && <Alerta>{error.message}</Alerta>}
        {!isLoading && data.length === 0 && <p className="text-slate-500">Nenhum pedido com entrega esperando entregador.</p>}
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {data.map((p) => (
            <label key={chave(p)} className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 hover:bg-slate-50" data-testid="pedido-para-juntar">
              <input type="checkbox" className="mt-1" checked={marcados.includes(chave(p))} onChange={(e) => setMarcados(e.target.checked ? [...marcados, chave(p)] : marcados.filter((x) => x !== chave(p)))} />
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
        {marcados.length > 0 && problema && <Alerta tipo="aviso">{problema}</Alerta>}
        {montar.error && <Alerta>{montar.error.message}</Alerta>}
        <Botao onClick={() => montar.mutate()} disabled={!!problema || montar.isPending}>
          {montar.isPending ? 'Montando…' : `Montar a chamada com ${marcados.length} pedidos`}
        </Botao>
      </div>
    </Modal>
  );
}

/** Etiqueta de coleta: o entregador lê no balcão (pega a chamada) ou na coleta (confere o pacote). */
function EtiquetaDeColeta({ c, gerencia }: { c: ChamadaResumo; gerencia: boolean }) {
  const cliente = useQueryClient();
  const imprimir = useMutation({
    mutationFn: async () => {
      const blob = await apiArquivo(`/entregas/chamadas/${c.id}/etiqueta.pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['chamada', c.id] }),
  });
  const terminada = c.situacao === 'CONCLUIDA' || c.situacao === 'CANCELADA';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid="etiqueta-coleta">
      {c.agendadaPara && <span>Coleta agendada para <strong>{formatarData(c.agendadaPara)}</strong></span>}
      {c.volumes ? <span>{textoVolumes(c.volumes)}{c.volumesEntregues ? ' entregues' : ' na coleta'}</span> : null}
      {c.etiquetaLidaEm ? <span>Etiqueta lida às {new Date(c.etiquetaLidaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> : c.etiquetaImpressaEm ? <span>Etiqueta impressa: a coleta pede a leitura</span> : null}
      {gerencia && !terminada && (
        <Botao variante="secundario" onClick={() => imprimir.mutate()} disabled={imprimir.isPending}>
          {imprimir.isPending ? 'Gerando…' : 'Imprimir etiqueta de coleta'}
        </Botao>
      )}
      {imprimir.error && <Alerta>{imprimir.error.message}</Alerta>}
    </div>
  );
}

export function NovaChamadaModal({ config, mapa, aoFechar, aoCriar, rascunho, erp, juntos }: { config: ConfigEntregasEmpresa; mapa: ConfigMapa; aoFechar: () => void; aoCriar: (id: string) => void; rascunho?: RascunhoDoPedido; erp?: RascunhoPedidoErp; juntos?: RascunhoJuntos }) {
  const cliente = useQueryClient();
  const [tipo, setTipo] = useState<TipoChamada>(erp?.tipo ?? 'ENTREGA');
  const baseComoParada = (): ParadaChamada => (config.base ? { ...paradaVazia(), lat: config.base.lat, lon: config.base.lon, endereco: config.base.endereco } : paradaVazia());
  const [origem, setOrigem] = useState<ParadaChamada>(() => juntos?.origem ?? erp?.origem ?? baseComoParada());
  const [destino, setDestino] = useState<ParadaChamada>(() => juntos?.destino ?? erp?.destino ?? rascunho?.destino ?? paradaVazia());
  const [marcando, setMarcando] = useState<'origem' | 'destino' | number>(erp && erp.tipo !== 'ENTREGA' ? 'origem' : 'destino');
  const [extras, setExtras] = useState<ParadaComPedido[]>(() => juntos?.paradasExtras ?? []);
  const [serie, setSerie] = useState(erp?.serieEsperada ?? '');
  const [observacao, setObservacao] = useState(juntos?.observacao ?? erp?.observacao ?? rascunho?.observacao ?? '');
  const primeira = useRef(true);
  const [distribuir, setDistribuir] = useState(config.direcionamento.automatico);
  const [agendar, setAgendar] = useState(false);
  const [quando, setQuando] = useState('');

  // Coleta e devolução: buscar no cliente e trazer para a empresa.
  useEffect(() => {
    // Do pedido, o destino já vem preenchido: só troca se mudar o serviço.
    if (primeira.current) {
      primeira.current = false;
      if (rascunho || erp || juntos) return;
    }
    setExtras([]);
    if (tipo === 'ENTREGA') {
      setOrigem(baseComoParada());
      setDestino(paradaVazia());
      setMarcando('destino');
    } else {
      setOrigem(paradaVazia());
      setDestino(baseComoParada());
      setMarcando('origem');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  const corpo: NovaChamada = { tipo, origem, destino, serieEsperada: serie.trim() || null, observacao, pedidoId: juntos?.pedidoId ?? rascunho?.pedidoId ?? null, pedidoErpId: juntos?.pedidoErpId ?? erp?.pedidoErpId ?? null, paradasExtras: tipo === 'ENTREGA' ? extras : [], agendadaPara: agendar && quando ? new Date(quando).toISOString() : null };
  const prontos = temPonto(origem) && temPonto(destino) && extras.every(temPonto);
  const previa = useQuery({
    queryKey: ['chamada-previa', tipo, origem.lat, origem.lon, destino.lat, destino.lon, extras.map((p) => `${p.lat},${p.lon}`).join('|')],
    queryFn: () => api<PreviaChamada>('/entregas/chamadas/previa', { metodo: 'POST', corpo: { ...corpo, origem: { ...origem, endereco: origem.endereco || 'ponto marcado' }, destino: { ...destino, endereco: destino.endereco || 'ponto marcado' }, paradasExtras: corpo.paradasExtras?.map((p) => ({ ...p, endereco: p.endereco || 'ponto marcado' })) } }),
    enabled: prontos,
    retry: false,
  });
  const criar = useMutation({
    mutationFn: () => api<ChamadaResumo>('/entregas/chamadas', { metodo: 'POST', corpo: { ...corpo, distribuir } }),
    onSuccess: (c) => {
      void cliente.invalidateQueries({ queryKey: ['chamadas'] });
      aoCriar(c.id);
    },
  });
  const marcas = [
    ...(temPonto(origem) ? [{ ...origem, cor: COR_COLETA, rotulo: 'Coleta' }] : []),
    ...(temPonto(destino) ? [{ ...destino, cor: COR_DESTINO, rotulo: 'Destino' }] : []),
    ...extras.flatMap((p, i) => (temPonto(p) ? [{ ...p, cor: COR_PARADA, rotulo: `Parada ${i + 2}` }] : [])),
  ];

  return (
    <Modal titulo={juntos ? `Pedidos juntos (${1 + juntos.paradasExtras.length})` : rascunho ? `Entregador para o pedido nº ${rascunho.numero}` : erp ? `Entregador para o pedido ${erp.codigo} do ERP` : 'Nova chamada'} aberto aoFechar={aoFechar} largo>
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          {erp && ((erp.tipo === 'ENTREGA' ? erp.destino : erp.origem)?.lat ?? 0) === 0 && <Alerta tipo="aviso">Não achamos o endereço do pedido no mapa: marque o ponto do cliente clicando no mapa.</Alerta>}
          {juntos && juntos.semPonto.length > 0 && <Alerta tipo="aviso">Sem ponto no mapa: {juntos.semPonto.join(', ')}. Marque cada um clicando no mapa (estão no fim da lista).</Alerta>}
          {rascunho?.origemDoPonto === 'NENHUM' && <Alerta tipo="aviso">Não achamos o endereço do cliente no mapa: marque o destino clicando no mapa.</Alerta>}
          {rascunho?.origemDoPonto === 'ENDERECO' && <Alerta tipo="info">O ponto do destino veio da busca do endereço: confira no mapa e ajuste com um clique se precisar.</Alerta>}
          <Selecao rotulo="Serviço" value={tipo} onChange={(e) => setTipo(e.target.value as TipoChamada)}>
            {TIPOS_CHAMADA.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_CHAMADA[t]}
              </option>
            ))}
          </Selecao>
          <EditorParada titulo="Coleta" artigo="na" cor={COR_COLETA} parada={origem} mudar={setOrigem} ativa={marcando === 'origem'} marcar={() => setMarcando('origem')} />
          <EditorParada titulo="Destino" artigo="no" cor={COR_DESTINO} parada={destino} mudar={setDestino} ativa={marcando === 'destino'} marcar={() => setMarcando('destino')} />
          {extras.map((p, i) => (
            <div key={i} className="space-y-1">
              <EditorParada titulo={`Parada ${i + 2}${p.pedidoId || p.pedidoErpId ? ' · com pedido' : ''}`} artigo="na" cor={COR_PARADA} parada={p} mudar={(n) => setExtras(extras.map((x, j) => (j === i ? n : x)))} ativa={marcando === i} marcar={() => setMarcando(i)} />
              <button type="button" className="text-xs text-red-700 underline" onClick={() => { setExtras(extras.filter((_, j) => j !== i)); setMarcando('destino'); }}>
                Tirar a parada {i + 2}
              </button>
            </div>
          ))}
          {extras.length > 0 && temPonto(origem) && temPonto(destino) && extras.every(temPonto) && (
            <Botao
              variante="secundario"
              onClick={() => {
                // Com pedido, o destino principal fica em primeiro; senão, todas entram na conta.
                const todos = [destino, ...extras];
                const ordem = ordemMaisCurta(origem, todos, !!rascunho || !!juntos);
                setDestino(todos[ordem[0]]);
                setExtras(ordem.slice(1).map((i) => todos[i]));
              }}
            >
              Ordenar pelo menor caminho
            </Botao>
          )}
          {tipo === 'ENTREGA' && extras.length < MAX_PARADAS_EXTRAS && (
            <Botao variante="secundario" onClick={() => { setExtras([...extras, paradaVazia()]); setMarcando(extras.length); }}>
              + Adicionar parada
            </Botao>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo={tipo === 'DEVOLUCAO_MAQUINA' ? 'Número de série da máquina (opcional)' : 'Número de série (opcional)'} value={serie} onChange={(e) => setSerie(e.target.value)} ajuda={tipo === 'DEVOLUCAO_MAQUINA' ? 'O entregador sempre lê a série na coleta; se informada aqui, precisa conferir.' : undefined} />
            <Campo rotulo="Observação para o entregador" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Clique no mapa para marcar <strong style={{ color: marcando === 'origem' ? COR_COLETA : marcando === 'destino' ? COR_DESTINO : COR_PARADA }}>{marcando === 'origem' ? 'a coleta' : marcando === 'destino' ? 'o destino' : `a parada ${marcando + 2}`}</strong>.
          </p>
          <MapaEntregadores config={mapa} base={null} raioKm={1} marcas={marcas} altura={360} aoClicar={(p) => (marcando === 'origem' ? setOrigem({ ...origem, ...p }) : marcando === 'destino' ? setDestino({ ...destino, ...p }) : setExtras(extras.map((x, j) => (j === marcando ? { ...x, ...p } : x))))} />
          {previa.data && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              <div>
                Distância: <strong>{formatarKm(previa.data.metros)}</strong>
                {previa.data.estimada && <span className="text-slate-500"> (estimada)</span>} · cerca de {Math.max(1, Math.round(previa.data.segundos / 60))} min
              </div>
              <div className="text-lg font-semibold">Valor para o entregador: {formatarCentavos(previa.data.valorCentavos)}</div>
              {previa.data.minimoAplicado && <div className="text-xs text-slate-600">Valor mínimo por chamada da plataforma.</div>}
              {previa.data.adicionais.length > 0 && (
                <div className="text-xs text-slate-600" data-testid="previa-adicionais">
                  Tabela {formatarCentavos(previa.data.valorTabelaCentavos)}
                  {previa.data.adicionais.map((a) => ` + ${a.nome} ${formatarCentavos(a.centavos)}`).join('')}
                </div>
              )}
            </div>
          )}
          {previa.error && <Alerta tipo="aviso">{previa.error.message}</Alerta>}
          {criar.error && <Alerta>{criar.error.message}</Alerta>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={agendar} onChange={(e) => setAgendar(e.target.checked)} />
            <span>
              Agendar a coleta
              <span className="block text-xs text-slate-500">A distribuição começa {MINUTOS_ANTES_DA_AGENDADA} minutos antes do horário. Dá para oferecer antes, à mão, ou o entregador pegar no balcão.</span>
            </span>
          </label>
          {agendar && <Campo rotulo="Coleta em" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={distribuir} onChange={(e) => setDistribuir(e.target.checked)} />
            <span>
              Distribuir automaticamente
              <span className="block text-xs text-slate-500">O sistema oferece pelas regras do Direcionamento. Desmarcado, você escolhe o entregador depois de abrir.</span>
            </span>
          </label>
          <Botao onClick={() => criar.mutate()} disabled={!prontos || !origem.endereco || !destino.endereco || extras.some((p) => !p.endereco.trim()) || (agendar && !quando) || criar.isPending}>
            {criar.isPending ? 'Abrindo…' : 'Abrir chamada'}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

function EditorParada({ titulo, artigo, cor, parada, mudar, ativa, marcar }: { titulo: string; artigo: 'na' | 'no'; cor: string; parada: ParadaChamada; mudar: (p: ParadaChamada) => void; ativa: boolean; marcar: () => void }) {
  const [resultados, setResultados] = useState<ResultadoEndereco[] | null>(null);
  const buscar = useMutation({ mutationFn: (q: string) => api<ResultadoEndereco[]>(`/entregas/enderecos?${new URLSearchParams({ q })}`), onSuccess: setResultados });
  const aoBuscar = (e: FormEvent) => {
    e.preventDefault();
    if (parada.endereco.trim().length >= 4) buscar.mutate(parada.endereco.trim());
  };
  return (
    <fieldset className={`space-y-2 rounded-md border p-3 ${ativa ? 'border-slate-400' : 'border-slate-200'}`} onFocus={marcar}>
      <legend className="px-1 text-sm font-semibold" style={{ color: cor }}>
        {titulo} {temPonto(parada) ? '· marcado' : '· sem ponto'}
      </legend>
      <form onSubmit={aoBuscar} className="flex items-end gap-2">
        <div className="flex-1">
          <Campo rotulo={`Endereço ${artigo === 'na' ? 'da' : 'do'} ${titulo.toLowerCase()}`} value={parada.endereco} onChange={(e) => mudar({ ...parada, endereco: e.target.value })} placeholder="Rua, número, cidade" />
        </div>
        <Botao type="submit" variante="secundario" disabled={buscar.isPending || parada.endereco.trim().length < 4}>
          Buscar
        </Botao>
      </form>
      {buscar.error && <Alerta tipo="aviso">{buscar.error.message}</Alerta>}
      {resultados && (
        <div className="space-y-1">
          {resultados.length === 0 && <p className="text-xs text-slate-500">Nada encontrado: clique no mapa para marcar.</p>}
          {resultados.map((r) => (
            <button key={`${r.lat},${r.lon}`} type="button" className="block w-full rounded border border-slate-200 px-2 py-1 text-left text-xs hover:bg-slate-50" onClick={() => { mudar({ ...parada, lat: r.lat, lon: r.lon, endereco: r.endereco }); setResultados(null); }}>
              {r.endereco}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo rotulo={`Contato ${artigo} ${titulo.toLowerCase()}`} value={parada.contato} onChange={(e) => mudar({ ...parada, contato: e.target.value })} />
        <Campo rotulo={`Telefone ${artigo} ${titulo.toLowerCase()}`} value={parada.telefone} onChange={(e) => mudar({ ...parada, telefone: e.target.value })} inputMode="tel" />
      </div>
      <Campo rotulo={`Instruções ${artigo} ${titulo.toLowerCase()}`} value={parada.instrucoes} onChange={(e) => mudar({ ...parada, instrucoes: e.target.value })} placeholder="Portaria, apartamento, ponto de referência" />
      {!ativa && (
        <button type="button" className="text-xs text-blue-700 underline" onClick={marcar}>
          Marcar {artigo === 'na' ? 'a' : 'o'} {titulo.toLowerCase()} no mapa
        </button>
      )}
    </fieldset>
  );
}

// Detalhe --------------------------------------------------------------------------------------

function DetalheChamada({ id, mapa, gerencia, aoFechar }: { id: string; mapa: ConfigMapa; gerencia: boolean; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const { data: c, error } = useQuery({ queryKey: ['chamada', id], queryFn: () => api<ChamadaResumo>(`/entregas/chamadas/${id}`), refetchInterval: 5_000 });
  const rastro = useQuery({ queryKey: ['chamada-rastro', id], queryFn: () => api<PontoRastro[]>(`/entregas/chamadas/${id}/rastro`), refetchInterval: 15_000 });
  const configuracao = useQuery({ queryKey: ['entregas-config'], queryFn: () => api<{ config: ConfigEntregasEmpresa }>('/entregas/config') });
  const elegiveis = useQuery({ queryKey: ['chamada-elegiveis', id], queryFn: () => api<ElegivelOferta[]>(`/entregas/chamadas/${id}/elegiveis`), enabled: gerencia && c?.situacao === 'ABERTA' && !c.ofertaPendente, refetchInterval: 10_000 });
  const [motivo, setMotivo] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const atualizar = (r: ChamadaResumo) => {
    cliente.setQueryData(['chamada', id], r);
    void cliente.invalidateQueries({ queryKey: ['chamadas'] });
    void cliente.invalidateQueries({ queryKey: ['chamada-elegiveis', id] });
  };
  const acao = useMutation({ mutationFn: ({ caminho, corpo }: { caminho: string; corpo?: unknown }) => api<ChamadaResumo>(`/entregas/chamadas/${id}/${caminho}`, { metodo: 'POST', corpo }), onSuccess: (r) => { setMotivo(''); atualizar(r); } });
  const verFoto = useMutation({ mutationFn: (etapa: string) => api<{ dados: string }>(`/entregas/chamadas/${id}/fotos/${etapa}`), onSuccess: (r) => setFoto(r.dados) });
  const marcas = useMemo(
    () =>
      c
        ? [
            { ...c.origem, cor: COR_COLETA, rotulo: `Coleta: ${c.origem.endereco}` },
            { ...c.destino, cor: COR_DESTINO, rotulo: `Destino: ${c.destino.endereco}` },
            ...c.paradasExtras.map((p) => ({ ...p.parada, cor: COR_PARADA, rotulo: `Parada ${p.ordem + 1}: ${p.parada.endereco}` })),
            ...(c.posicaoEntregador ? [{ ...c.posicaoEntregador, cor: COR_ENTREGADOR, rotulo: `${c.entregador?.nome ?? 'Entregador'} (${new Date(c.posicaoEntregador.em).toLocaleTimeString('pt-BR')})` }] : []),
          ]
        : [],
    [c],
  );
  const pendentes = c?.ofertas.filter((o) => o.resultado === 'PENDENTE') ?? [];
  const restam = c?.ofertaPendente ? Math.max(0, Math.round((new Date(c.ofertaPendente.expiraEm).getTime() - Date.now()) / 1000)) : 0;
  const finalizada = c?.situacao === 'CONCLUIDA' || c?.situacao === 'CANCELADA';

  return (
    <Modal titulo={c ? `Chamada ${c.numero} · ${ROTULO_TIPO_CHAMADA[c.tipo]}` : 'Chamada'} aberto aoFechar={aoFechar} largo>
      {error && <Alerta>{error.message}</Alerta>}
      {c && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Selo cor={COR_SITUACAO[c.situacao]}>{ROTULO_SITUACAO_CHAMADA[c.situacao]}</Selo>
              <span className="font-semibold">{formatarCentavos(c.valorCentavos)}</span>
              {c.adicionais.length > 0 && <span className="text-xs text-slate-500">(inclui {c.adicionais.map((a) => `${a.nome} ${formatarCentavos(a.centavos)}`).join(', ')})</span>}
              {(c.esperaCentavos > 0 || c.devolucao) && (
                <span className="text-xs text-slate-500" data-testid="valor-extras">
                  (inclui {[c.esperaCentavos > 0 ? `espera de ${c.esperaMinutos} min ${formatarCentavos(c.esperaCentavos)}` : '', c.devolucao ? `volta à origem ${formatarCentavos(c.devolucao.valorCentavos)}` : ''].filter(Boolean).join(', ')})
                </span>
              )}
              <span className="text-slate-500">
                {formatarKm(c.metros)}
                {c.estimada ? ' (estimada)' : ''}
              </span>
            </div>
            {c.codigoConfirmacao && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-xs text-amber-800">Código de confirmação: passe ao destinatário. O entregador só conclui com ele.</div>
                <div className="font-mono text-2xl font-bold tracking-widest" data-testid="codigo-confirmacao">
                  {c.codigoConfirmacao}
                </div>
              </div>
            )}
            {c.codigoDevolucao && (
              <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
                <div className="text-xs text-orange-800">Voltando para a origem. Quando receber de volta, passe este código ao entregador.</div>
                <div className="font-mono text-2xl font-bold tracking-widest" data-testid="codigo-devolucao">
                  {c.codigoDevolucao}
                </div>
              </div>
            )}
            {c.devolucao && !c.codigoDevolucao && <div className="text-slate-600">Devolvida à origem: {c.devolucao.motivo} ({formatarKm(c.devolucao.metros)}).</div>}
            <EtiquetaDeColeta c={c} gerencia={gerencia} />
            <LinkRastreio c={c} />
            <AlertaEmergencia c={c} aoCiente={() => acao.mutate({ caminho: 'emergencia/ciente' })} ocupado={acao.isPending} />
            <Parada titulo="Coleta" p={c.origem} />
            <Parada titulo={c.paradasExtras.length ? `Destino (parada 1 de ${c.paradasExtras.length + 1})${c.paradaAtual > 0 || c.situacao === 'CONCLUIDA' ? ' · entregue' : ''}` : 'Destino'} p={c.destino} />
            {c.paradasExtras.map((p) => (
              <div key={p.ordem} data-testid="parada-extra">
                <Parada titulo={`Parada ${p.ordem + 1} de ${c.paradasExtras.length + 1}${p.pedido ? ` · pedido nº ${p.pedido.numero}` : p.pedidoErp ? ` · pedido ${p.pedidoErp} do ERP` : ''}${p.entregueEm ? ' · entregue' : c.paradaAtual === p.ordem && c.situacao !== 'CANCELADA' && c.situacao !== 'CONCLUIDA' ? ' · a vez dela' : ''}`} p={p.parada} />
                {p.codigoConfirmacao && <div className="text-xs">Código desta parada: <span className="font-mono font-bold">{p.codigoConfirmacao}</span>{p.linkRastreio && <> · <a className="text-blue-700 underline" href={p.linkRastreio} target="_blank" rel="noreferrer">link do cliente</a></>}</div>}
              </div>
            ))}
            {(c.serieEsperada || c.serieColetada) && (
              <div>
                Série: {c.serieEsperada ? `esperada ${c.serieEsperada}` : ''}
                {c.serieColetada ? ` · lida ${c.serieColetada}` : ''}
              </div>
            )}
            {(['COLETA', 'ENTREGA'] as const).map((etapa) => {
              const l = c.checklists[etapa];
              return l ? (
                <div key={etapa} className="text-slate-600" data-testid={`checklist-${etapa}`}>
                  Máquina na {etapa === 'COLETA' ? 'coleta' : 'entrega'}: {textoDoChecklist(l)}
                  {c.fotos.includes(etapa === 'COLETA' ? 'COLETA' : 'ENTREGA') && (
                    <>
                      {' '}
                      <button type="button" className="underline" onClick={() => verFoto.mutate(etapa === 'COLETA' ? 'COLETA' : 'ENTREGA')}>
                        ver foto
                      </button>
                    </>
                  )}
                </div>
              ) : null;
            })}
            {c.pedidoErp && <div className="text-slate-600">Pedido <strong>{c.pedidoErp}</strong> do ERP.</div>}
            {c.assinatura !== 'NAO' && <div className="text-slate-600">Comprovação: {ROTULO_MODO_ASSINATURA[c.assinatura].toLowerCase()}.</div>}
            {c.fotos.filter((f) => f.startsWith('ASSINATURA')).map((f) => (
              <button key={f} type="button" className="block text-left text-blue-700 underline" onClick={() => verFoto.mutate(f)} data-testid="ver-assinatura">
                Ver {rotuloDaFoto(f).toLowerCase()}
              </button>
            ))}
            {c.observacao && <div className="text-slate-600">Obs.: {c.observacao}</div>}
            {c.pedido && <div className="text-slate-600">Entrega do <strong>pedido nº {c.pedido.numero}</strong> (o pedido avança sozinho na coleta e na entrega).</div>}
            {c.entregador && (
              <div className="rounded-md bg-slate-50 px-3 py-2">
                <div className="font-medium">
                  {c.entregador.nome} · {ROTULO_VEICULO[c.entregador.veiculo]}
                  {c.entregador.placa ? ` · ${c.entregador.placa}` : ''}
                </div>
                {c.entregador.celular && (
                  <a className="text-blue-700 underline" href={linkWhatsApp(c.entregador.celular, `Chamada ${c.numero}`)} target="_blank" rel="noreferrer">
                    {formatarCelular(c.entregador.celular)}
                  </a>
                )}
              </div>
            )}

            {c.ocorrencia && c.situacao === 'OCORRENCIA' && (
              <Alerta tipo="aviso">
                <div className="font-medium">
                  Ocorrência: {ROTULO_MOTIVO_OCORRENCIA[c.ocorrencia.motivo]}
                  {c.ocorrencia.texto ? `: ${c.ocorrencia.texto}` : ''}
                </div>
                {c.ocorrencia.temFoto && (
                  <button type="button" className="underline" onClick={() => verFoto.mutate('OCORRENCIA')}>
                    Ver foto
                  </button>
                )}
                {gerencia && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Botao variante="secundario" onClick={() => acao.mutate({ caminho: 'ocorrencia', corpo: { acao: 'CONTINUAR' } })}>
                      {c.ocorrencia.motivo === 'SERIE_DIFERENTE' && c.ocorrencia.serieLida ? `Aceitar a máquina ${c.ocorrencia.serieLida} e seguir` : 'Seguir com ele'}
                    </Botao>
                    {(c.ocorrencia.situacaoAnterior === 'COLETADA' || c.ocorrencia.situacaoAnterior === 'NO_DESTINO') && !c.devolucao && (
                      <Botao variante="secundario" onClick={() => acao.mutate({ caminho: 'ocorrencia', corpo: { acao: 'DEVOLVER' } })}>
                        Devolver à origem
                      </Botao>
                    )}
                    <Botao variante="secundario" onClick={() => acao.mutate({ caminho: 'ocorrencia', corpo: { acao: 'REABRIR' } })}>
                      Liberar e chamar outro
                    </Botao>
                  </div>
                )}
              </Alerta>
            )}

            {c.situacao === 'ABERTA' && c.distribuicao.ativa && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2" data-testid="distribuicao">
                <span>
                  <strong>Distribuição automática</strong> · raio de {c.distribuicao.raioKm} km
                  {c.distribuicao.rodada > 0 ? ` · rodada ${c.distribuicao.rodada + 1}` : ''}
                  {!c.ofertaPendente && c.distribuicao.proximaTentativaEm && new Date(c.distribuicao.proximaTentativaEm).getTime() > Date.now() + 5_000 && <> · nova tentativa às {new Date(c.distribuicao.proximaTentativaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>}
                </span>
                {gerencia && (
                  <Botao variante="secundario" onClick={() => acao.mutate({ caminho: 'parar-distribuicao' })} disabled={acao.isPending}>
                    Parar
                  </Botao>
                )}
              </div>
            )}

            {gerencia && c.situacao === 'ABERTA' && (
              <div className="space-y-2">
                {pendentes.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md bg-blue-50 px-3 py-2">
                    <span>
                      Oferecida a <strong>{pendentes.map((o) => o.entregadorNome).join(', ')}</strong>, esperando resposta ({restam} s).
                    </span>
                    <Botao variante="secundario" onClick={() => acao.mutate({ caminho: 'cancelar-oferta' })}>
                      Cancelar oferta
                    </Botao>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">Oferecer a um entregador</div>
                      {!c.distribuicao.ativa && (
                        <Botao variante="secundario" onClick={() => acao.mutate({ caminho: 'distribuir' })} disabled={acao.isPending}>
                          Distribuir automaticamente
                        </Botao>
                      )}
                    </div>
                    {elegiveis.error && <Alerta>{elegiveis.error.message}</Alerta>}
                    {elegiveis.data?.length === 0 && <p className="text-slate-500">Nenhum entregador livre perto da coleta agora.</p>}
                    {elegiveis.data?.map((e) => (
                      <div key={e.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                        <span>
                          {e.posicao}º · {e.nome}
                          {e.preferido ? ' ★' : ''} · {ROTULO_VEICULO[e.veiculo]} · {formatarKm(e.metrosAteColeta)} da coleta
                          <span className="ml-1 text-xs text-slate-500">({e.pontos.toLocaleString('pt-BR')} pontos)</span>
                        </span>
                        <Botao onClick={() => acao.mutate({ caminho: 'oferecer', corpo: { entregadorId: e.id } })} disabled={acao.isPending}>
                          Oferecer
                        </Botao>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {c.ofertas.length > 0 && (
              <details className="rounded-md border border-slate-200 px-3 py-2" open={c.situacao === 'ABERTA'}>
                <summary className="cursor-pointer font-medium">Ofertas ({c.ofertas.length})</summary>
                <ol className="mt-2 space-y-1">
                  {c.ofertas.map((o, i) => (
                    <li key={i}>
                      <span className="text-xs text-slate-400">{new Date(o.criadoEm).toLocaleTimeString('pt-BR')}</span> {o.entregadorNome} · <span className={o.resultado === 'ACEITA' ? 'text-green-700' : 'text-slate-600'}>{ROTULO_RESULTADO[o.resultado]}</span>
                      <div className="text-xs text-slate-500">{o.motivo ? `Escolhido pela distribuição: ${o.motivo}` : 'Escolhido pela empresa'}</div>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {c.situacao === 'CONCLUIDA' && c.entregador && <PosEntrega c={c} gerencia={gerencia} />}

            {gerencia && c.situacao === 'NO_DESTINO' && (
              <Botao variante="secundario" onClick={() => confirm('Confirmar a entrega sem o código do destinatário?') && acao.mutate({ caminho: 'concluir' })}>
                Confirmar entrega sem o código
              </Botao>
            )}
            {acao.error && <Alerta>{acao.error.message}</Alerta>}
            {gerencia && !finalizada && (
              <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
                <div className="min-w-56 flex-1">
                  <Campo rotulo="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
                {(() => {
                  const taxa = taxaDoCancelamento(c.situacao, !!c.entregador, configuracao.data?.config.precos[c.tipo]?.taxaCancelamentoCentavos);
                  return taxa ? <p className="w-full text-xs text-amber-800">Cancelando agora, {c.entregador?.nome} recebe a taxa de deslocamento de {formatarCentavos(taxa)}.</p> : null;
                })()}
                <Botao variante="perigo" disabled={motivo.trim().length < 3 || acao.isPending} onClick={() => acao.mutate({ caminho: 'cancelar', corpo: { motivo } })}>
                  Cancelar chamada
                </Botao>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <MapaEntregadores config={mapa} base={null} raioKm={1} marcas={marcas} linha={rastro.data ?? []} altura={320} />
            {c.fotos.filter((f) => f !== 'OCORRENCIA').length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm" data-testid="fotos-chamada">
                {c.fotos
                  .filter((f) => f !== 'OCORRENCIA')
                  .map((f) => (
                    <button key={f} type="button" className="text-blue-700 underline" onClick={() => verFoto.mutate(f)}>
                      {rotuloDaFoto(f)}
                    </button>
                  ))}
              </div>
            )}
            {c.entregador && <ConversaDaChamada chamadaId={c.id} gerencia={gerencia} />}
            <div>
              <div className="mb-1 text-sm font-medium">Histórico</div>
              <ol className="space-y-1 text-sm">
                {[...c.historico].reverse().map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="whitespace-nowrap text-xs text-slate-400">{new Date(h.em).toLocaleTimeString('pt-BR')}</span>
                    <span>{h.texto}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
      <Modal titulo="Foto" aberto={!!foto} aoFechar={() => setFoto(null)} largo>
        {foto && <img src={foto} alt="Foto da chamada" className="mx-auto max-h-[75vh] object-contain" />}
      </Modal>
    </Modal>
  );
}

function Parada({ titulo, p }: { titulo: string; p: ParadaChamada }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div>{p.endereco}</div>
      {(p.contato || p.telefone) && (
        <div className="text-slate-600">
          {p.contato}
          {p.telefone ? ` · ${formatarCelular(p.telefone)}` : ''}
        </div>
      )}
      {p.instrucoes && <div className="text-slate-500">{p.instrucoes}</div>}
    </div>
  );
}

