import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  caminhoAcompanhamento,
  centavosDe,
  diferencasDaPropostaPedido,
  formatarCelular,
  formatarCentavos,
  linkWhatsApp,
  mensagemWhatsApp,
  MODALIDADES_ENTREGA,
  podeMudarSituacao,
  problemaNaProposta,
  PROXIMA_SITUACAO,
  rotuloAvancar,
  rotuloSituacaoPedido,
  ROTULO_MODALIDADE,
  ROTULO_PAGAMENTO,
  LIMITE_OBSERVACAO_ITEM,
  linkMapa,
  PRECISAO_BOA_METROS,
  textoEndereco,
  textoFaixa,
  totaisDaProposta,
  type BlocoFolha,
  type EstadoPedido,
  type FiltroPedidos,
  type ModalidadeEntrega,
  type PedidoCompleto,
  type PedidoResumo,
  type PropostaPedido,
  type SituacaoPedido,
  type TrabalhoResumo,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, Modal, Selecao, Selo, formatarData } from '../../components/ui';

const COR_SITUACAO: Record<SituacaoPedido, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  NOVO: 'amarelo',
  EM_SEPARACAO: 'cinza',
  PRONTO: 'cinza',
  CONCLUIDO: 'verde',
  CANCELADO: 'vermelho',
};

const FILTROS: { valor: NonNullable<FiltroPedidos['situacao']> | ''; rotulo: string }[] = [
  { valor: 'ABERTOS', rotulo: 'Em aberto' },
  { valor: 'NOVO', rotulo: 'Novos' },
  { valor: 'EM_SEPARACAO', rotulo: 'Em separação' },
  { valor: 'PRONTO', rotulo: 'Prontos ou a caminho' },
  { valor: 'CONCLUIDO', rotulo: 'Concluídos' },
  { valor: 'CANCELADO', rotulo: 'Cancelados' },
  { valor: '', rotulo: 'Todos' },
];

const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');

export function PainelPedidos() {
  const { empresaId } = useAuth();
  const [filtro, setFiltro] = useState<FiltroPedidos>({ situacao: 'ABERTOS' });
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const parametros = new URLSearchParams(Object.entries({ ...filtro, busca: busca.trim() }).filter(([, v]) => v) as [string, string][]).toString();
  const { data: pedidos = [], error } = useQuery({
    queryKey: ['pedidos', empresaId, parametros],
    queryFn: () => api<PedidoResumo[]>(`/pedidos${parametros ? `?${parametros}` : ''}`),
    refetchInterval: 15_000,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Selecao rotulo="Situação" value={filtro.situacao ?? ''} onChange={(e) => setFiltro({ ...filtro, situacao: (e.target.value || undefined) as FiltroPedidos['situacao'] })}>
            {FILTROS.map((f) => (
              <option key={f.rotulo} value={f.valor}>{f.rotulo}</option>
            ))}
          </Selecao>
          <Campo rotulo="Buscar" placeholder="Nº, nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Campo rotulo="De" type="date" value={filtro.de ?? ''} onChange={(e) => setFiltro({ ...filtro, de: e.target.value || undefined })} />
          <Campo rotulo="Até" type="date" value={filtro.ate ?? ''} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value || undefined })} />
        </div>
        {error && <Alerta>{(error as Error).message}</Alerta>}
        {pedidos.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nenhum pedido.</p>}
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {pedidos.map((p) => (
            <li key={p.id}>
              <button type="button" data-testid="linha-pedido" onClick={() => setSelecionado(p.id)} className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50 ${selecionado === p.id ? 'bg-blue-50' : ''}`}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">nº {p.numero} · {p.clienteNome}</span>
                  <span className="block text-xs text-slate-500">
                    {formatarData(p.criadoEm)} · {ROTULO_MODALIDADE[p.modalidade].titulo}
                    {p.agendamento ? ` · ${textoFaixa(p.agendamento, '')}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Selo cor={COR_SITUACAO[p.situacao]}>{rotuloSituacaoPedido(p.situacao, p.modalidade)}</Selo>
                  {p.aguardandoCliente && <span className="text-xs text-amber-700">Esperando o cliente</span>}
                  <span className="text-xs font-medium text-slate-700">{formatarCentavos(p.totalCentavos)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>{selecionado ? <DetalhePedido key={selecionado} id={selecionado} /> : <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Escolha um pedido para ver os detalhes.</p>}</section>
    </div>
  );
}

/** Observação do cliente sobre o produto e a resposta da loja, que aparece no acompanhamento. */
function RespostaDoItem({ pedidoId, item, podeResponder, aoSalvar }: { pedidoId: string; item: PedidoCompleto['itens'][number]; podeResponder: boolean; aoSalvar: (p: PedidoCompleto) => void }) {
  const [texto, setTexto] = useState(item.resposta ?? '');
  const [editando, setEditando] = useState(false);
  const salvar = useMutation({
    mutationFn: () => api<PedidoCompleto>(`/pedidos/${pedidoId}/itens/resposta`, { metodo: 'POST', corpo: { codigo: item.codigo, resposta: texto } }),
    onSuccess: (p) => {
      setEditando(false);
      aoSalvar(p);
    },
  });
  return (
    <div className="mt-1 space-y-1 text-xs" data-testid="observacao-item">
      {item.observacao && <p className="rounded bg-amber-50 px-2 py-1 text-amber-900"><strong>Cliente:</strong> {item.observacao}</p>}
      {item.resposta && !editando && (
        <p className="rounded bg-blue-50 px-2 py-1 text-blue-900">
          <strong>Loja:</strong> {item.resposta}
          {podeResponder && <button type="button" className="ml-2 text-blue-700 underline" onClick={() => setEditando(true)}>mudar</button>}
        </p>
      )}
      {podeResponder && (editando || !item.resposta) && (
        <div className="flex gap-1.5">
          <input
            aria-label={`Responder sobre ${item.nome}`}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            maxLength={LIMITE_OBSERVACAO_ITEM}
            placeholder="Responder ao cliente"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <Botao variante="secundario" disabled={salvar.isPending || (!texto.trim() && !item.resposta)} onClick={() => salvar.mutate()}>{salvar.isPending ? '…' : 'Responder'}</Botao>
        </div>
      )}
      {salvar.error && <p className="text-red-700">{(salvar.error as Error).message}</p>}
    </div>
  );
}

function DetalhePedido({ id }: { id: string }) {
  const { empresaId, pode } = useAuth();
  const cliente = useQueryClient();
  const podeGerenciar = pode('pedido.gerenciar');
  const chave = ['pedido', empresaId, id];
  const { data: p, error } = useQuery({ queryKey: chave, queryFn: () => api<PedidoCompleto>(`/pedidos/${id}`), refetchInterval: 15_000 });
  const [propondo, setPropondo] = useState(false);
  const [folha, setFolha] = useState(false);
  const atualizar = (novo: PedidoCompleto) => {
    cliente.setQueryData(chave, novo);
    void cliente.invalidateQueries({ queryKey: ['pedidos', empresaId] });
  };
  const situacao = useMutation({
    mutationFn: (corpo: { situacao: SituacaoPedido; motivo?: string }) => api<PedidoCompleto>(`/pedidos/${id}/situacao`, { metodo: 'POST', corpo }),
    onSuccess: atualizar,
  });
  const desistir = useMutation({ mutationFn: () => api<PedidoCompleto>(`/pedidos/${id}/proposta/desistir`, { metodo: 'POST' }), onSuccess: atualizar });

  if (error) return <Alerta>{(error as Error).message}</Alerta>;
  if (!p) return <p className="text-sm text-slate-500">Carregando…</p>;
  const link = `${window.location.origin}${caminhoAcompanhamento(p.codigoAcompanhamento)}`;
  const proxima = PROXIMA_SITUACAO[p.situacao];
  const avancar = rotuloAvancar(p.situacao, p.modalidade);
  const aberto = p.situacao !== 'CONCLUIDO' && p.situacao !== 'CANCELADO';
  const mapa = p.endereco ? linkMapa(p.endereco) : null;
  const ponto = p.endereco?.localizacao ?? null;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4" data-testid="detalhe-pedido">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pedido nº {p.numero}</h2>
          <p className="text-xs text-slate-500">Recebido em {formatarData(p.criadoEm)}{p.aceitoPorNome ? ` · aceito por ${p.aceitoPorNome}` : ''}</p>
        </div>
        <Selo cor={COR_SITUACAO[p.situacao]}>{rotuloSituacaoPedido(p.situacao, p.modalidade)}</Selo>
      </div>

      {situacao.error && <Alerta>{(situacao.error as Error).message}</Alerta>}
      {podeGerenciar && aberto && (
        <div className="flex flex-wrap gap-2">
          {proxima && avancar && (
            <Botao disabled={situacao.isPending || p.aguardandoCliente} onClick={() => situacao.mutate({ situacao: proxima })}>{avancar}</Botao>
          )}
          {!p.aguardandoCliente && <Botao variante="secundario" onClick={() => setPropondo(true)}>Propor alteração</Botao>}
          {p.situacao !== 'NOVO' && <Botao variante="secundario" onClick={() => setFolha(true)}>Folha de lançamento</Botao>}
          {podeMudarSituacao(p.situacao, 'CANCELADO') && (
            <Botao
              variante="perigo"
              disabled={situacao.isPending}
              onClick={() => {
                const motivo = window.prompt('Cancelar o pedido? Diga o motivo (o cliente vê no acompanhamento):');
                if (motivo !== null) situacao.mutate({ situacao: 'CANCELADO', motivo });
              }}
            >
              Cancelar
            </Botao>
          )}
        </div>
      )}
      {p.situacao === 'CONCLUIDO' && podeGerenciar && <Botao variante="secundario" onClick={() => setFolha(true)}>Folha de lançamento</Botao>}
      {p.aguardandoCliente && <p className="text-xs text-amber-700">A próxima etapa espera a resposta do cliente à alteração.</p>}

      {p.proposta && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="proposta-pendente">
          <p className="font-medium text-amber-900">Alteração esperando o cliente</p>
          <ul className="mt-1 list-disc pl-5 text-amber-900">
            {p.proposta.diferencas.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {p.proposta.mensagem && <p className="mt-1 text-amber-900">“{p.proposta.mensagem}”</p>}
          <p className="mt-1 text-amber-900">Novo total: <strong>{formatarCentavos(p.proposta.totais.totalCentavos)}</strong></p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" target="_blank" rel="noreferrer" href={linkWhatsApp(p.clienteTelefone, mensagemWhatsApp('proposta', p, p.empresa, link))}>
              Avisar o cliente no WhatsApp
            </a>
            {podeGerenciar && <Botao variante="secundario" disabled={desistir.isPending} onClick={() => desistir.mutate()}>Desistir da alteração</Botao>}
          </div>
        </div>
      )}
      {p.respostaProposta && !p.proposta && (
        <p className={`rounded-md px-3 py-2 text-sm ${p.respostaProposta.aceita ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
          O cliente {p.respostaProposta.aceita ? 'aceitou' : 'recusou'} a última alteração em {formatarData(p.respostaProposta.em)}.
        </p>
      )}
      {p.motivoCancelamento && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Motivo do cancelamento: {p.motivoCancelamento}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold text-slate-900">Cliente</h3>
          <p>{p.clienteNome}</p>
          {p.clienteTelefone && (
            <p className="flex flex-wrap items-center gap-2">
              {formatarCelular(p.clienteTelefone)}
              <a className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700" target="_blank" rel="noreferrer" href={linkWhatsApp(p.clienteTelefone, mensagemWhatsApp('contato', p, p.empresa, link))}>
                Conversar no WhatsApp
              </a>
            </p>
          )}
          <p className="text-xs text-slate-500">
            Acompanhamento:{' '}
            <a className="text-blue-700 underline" href={link} target="_blank" rel="noreferrer">abrir</a>{' '}
            · <button type="button" className="text-blue-700 underline" onClick={() => void navigator.clipboard?.writeText(link)}>copiar link</button>
          </p>
        </div>
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold text-slate-900">{ROTULO_MODALIDADE[p.modalidade].titulo}</h3>
          {p.agendamento && <p>{textoFaixa(p.agendamento, '')}</p>}
          {p.modalidade !== 'RETIRADA' && p.endereco && (
            <p>
              {textoEndereco(p.endereco)}{' '}
              {mapa && <a className="text-xs text-blue-700 underline" href={mapa} target="_blank" rel="noreferrer">{ponto ? 'mapa (localização do cliente)' : 'mapa'}</a>}
            </p>
          )}
          {p.modalidade !== 'RETIRADA' && ponto && (
            <p className={`text-xs ${ponto.precisaoMetros > PRECISAO_BOA_METROS ? 'text-amber-700' : 'text-slate-500'}`} data-testid="localizacao-pedido">
              📍 O cliente enviou a localização{ponto.precisaoMetros > PRECISAO_BOA_METROS ? `, mas aproximada (cerca de ${ponto.precisaoMetros.toLocaleString('pt-BR')} m): confira com o endereço.` : ` (precisão de ${ponto.precisaoMetros} m).`}
            </p>
          )}
          <p>
            {ROTULO_PAGAMENTO[p.pagamento]}
            {p.trocoParaCentavos !== null && ` · troco para ${formatarCentavos(p.trocoParaCentavos)}${p.totais.trocoCentavos !== null ? `: levar ${formatarCentavos(p.totais.trocoCentavos)}` : ' (não cobre o total)'}`}
          </p>
          {p.observacao && <p className="text-slate-600">Obs.: {p.observacao}</p>}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1 font-medium">Produto</th>
            <th className="py-1 text-right font-medium">Qtd.</th>
            <th className="py-1 text-right font-medium">Preço</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {p.itens.map((i) => (
            <tr key={i.codigo} className="border-t border-slate-100 align-top">
              <td className="py-1.5">
                {i.nome} <span className="text-xs text-slate-400">{i.codigoBarras || i.codigo}</span>
                {(i.observacao || i.resposta) && (
                  <RespostaDoItem pedidoId={p.id} item={i} podeResponder={podeGerenciar && p.situacao !== 'CONCLUIDO' && p.situacao !== 'CANCELADO'} aoSalvar={atualizar} />
                )}
              </td>
              <td className="py-1.5 text-right">{i.quantidade}</td>
              <td className="py-1.5 text-right">{formatarCentavos(i.precoCentavos)}</td>
              <td className="py-1.5 text-right">{formatarCentavos(i.precoCentavos * i.quantidade)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          <tr className="border-t border-slate-200"><td colSpan={3} className="pt-2 text-right">Produtos</td><td className="pt-2 text-right">{formatarCentavos(p.totais.subtotalCentavos)}</td></tr>
          <tr><td colSpan={3} className="text-right">Entrega</td><td className="text-right">{formatarCentavos(p.totais.taxaCentavos)}</td></tr>
          {p.totais.descontoCentavos > 0 && <tr><td colSpan={3} className="text-right">Desconto</td><td className="text-right">-{formatarCentavos(p.totais.descontoCentavos)}</td></tr>}
          <tr className="font-bold"><td colSpan={3} className="text-right">Total</td><td className="text-right">{formatarCentavos(p.totais.totalCentavos)}</td></tr>
        </tfoot>
      </table>

      {p.historico.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Histórico</h3>
          <ol className="space-y-0.5 text-xs text-slate-600">
            {[...p.historico].reverse().map((h, n) => (
              <li key={n}>{formatarData(h.em)} · {h.texto}{h.por ? ` (${h.por})` : ' (cliente)'}</li>
            ))}
          </ol>
        </div>
      )}

      {propondo && <EditorProposta pedido={p} aoFechar={() => setPropondo(false)} aoSalvar={(novo) => { atualizar(novo); setPropondo(false); }} />}
      {folha && <FolhaDeLancamento pedido={p} podeImprimir={podeGerenciar} aoFechar={() => setFolha(false)} aoImprimir={() => void cliente.invalidateQueries({ queryKey: chave })} />}
    </div>
  );
}

function EditorProposta({ pedido, aoFechar, aoSalvar }: { pedido: PedidoCompleto; aoFechar: () => void; aoSalvar: (p: PedidoCompleto) => void }) {
  const [quantidades, setQuantidades] = useState<Record<string, string>>(() => Object.fromEntries(pedido.itens.map((i) => [i.codigo, String(i.quantidade)])));
  const [modalidade, setModalidade] = useState<ModalidadeEntrega>(pedido.modalidade);
  const [faixa, setFaixa] = useState(pedido.agendamento ? `${pedido.agendamento.data}|${pedido.agendamento.inicio}` : '');
  const [taxa, setTaxa] = useState(reais(pedido.totais.taxaCentavos));
  const [desconto, setDesconto] = useState(reais(pedido.totais.descontoCentavos));
  const [mensagem, setMensagem] = useState('');
  const faixas = useMemo(() => (pedido.agendamento && !pedido.faixas.some((f) => f.data === pedido.agendamento!.data && f.inicio === pedido.agendamento!.inicio) ? [pedido.agendamento, ...pedido.faixas] : pedido.faixas), [pedido]);
  const estado: EstadoPedido = { itens: pedido.itens, modalidade: pedido.modalidade, taxaCentavos: pedido.totais.taxaCentavos, descontoCentavos: pedido.totais.descontoCentavos, agendamento: pedido.agendamento, temEndereco: !!pedido.endereco, trocoParaCentavos: pedido.trocoParaCentavos };
  const proposta: PropostaPedido = {
    itens: pedido.itens.map((i) => ({ codigo: i.codigo, quantidade: Number(quantidades[i.codigo] ?? i.quantidade) })),
    modalidade,
    taxaCentavos: taxa.trim() ? (centavosDe(taxa) ?? -1) : 0,
    descontoCentavos: desconto.trim() ? (centavosDe(desconto) ?? -1) : 0,
    agendamento: modalidade === 'AGENDADA' ? (faixas.find((f) => `${f.data}|${f.inicio}` === faixa) ?? null) : null,
    mensagem,
  };
  const problema = problemaNaProposta(estado, proposta, pedido.faixas);
  const enviar = useMutation({ mutationFn: () => api<PedidoCompleto>(`/pedidos/${pedido.id}/proposta`, { metodo: 'POST', corpo: proposta }), onSuccess: aoSalvar });
  const totais = !problema ? totaisDaProposta(estado, proposta) : null;

  return (
    <Modal titulo={`Propor alteração no pedido nº ${pedido.numero}`} aberto aoFechar={aoFechar}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">O pedido só muda quando o cliente aceitar, no link de acompanhamento. Para tirar um produto, deixe a quantidade em 0.</p>
        <div className="space-y-1.5">
          {pedido.itens.map((i) => (
            <label key={i.codigo} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{i.nome} <span className="text-xs text-slate-400">({formatarCentavos(i.precoCentavos)})</span></span>
              <input type="number" min={0} max={999} aria-label={`Quantidade de ${i.nome}`} className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right" value={quantidades[i.codigo]} onChange={(e) => setQuantidades({ ...quantidades, [i.codigo]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Selecao rotulo="Entrega" value={modalidade} onChange={(e) => setModalidade(e.target.value as ModalidadeEntrega)}>
            {MODALIDADES_ENTREGA.map((m) => (
              <option key={m} value={m}>{ROTULO_MODALIDADE[m].titulo}</option>
            ))}
          </Selecao>
          {modalidade === 'AGENDADA' && (
            <Selecao rotulo="Dia e horário" value={faixa} onChange={(e) => setFaixa(e.target.value)}>
              <option value="">Escolher…</option>
              {faixas.map((f) => (
                <option key={`${f.data}|${f.inicio}`} value={`${f.data}|${f.inicio}`}>{textoFaixa(f, '')}</option>
              ))}
            </Selecao>
          )}
          <Campo rotulo="Taxa de entrega (R$)" inputMode="decimal" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
          <Campo rotulo="Desconto (R$)" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
        </div>
        <Campo rotulo="Mensagem para o cliente" maxLength={300} placeholder="Ex.: acabou o feijão de 1 kg" value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        {!problema && (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <ul className="list-disc pl-5">
              {diferencasDaPropostaPedido(estado, proposta).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            {totais && <p className="mt-1">Novo total: <strong>{formatarCentavos(totais.totalCentavos)}</strong> (era {formatarCentavos(pedido.totais.totalCentavos)})</p>}
            {totais && pedido.trocoParaCentavos !== null && totais.trocoCentavos === null && <p className="mt-1 text-amber-700">O troco que o cliente pediu ({formatarCentavos(pedido.trocoParaCentavos)}) não cobre mais o total.</p>}
          </div>
        )}
        {problema && <p className="text-sm text-amber-700">{problema}</p>}
        {enviar.error && <Alerta>{(enviar.error as Error).message}</Alerta>}
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>Voltar</Botao>
          <Botao disabled={!!problema || enviar.isPending} onClick={() => enviar.mutate()}>{enviar.isPending ? 'Enviando…' : 'Enviar ao cliente'}</Botao>
        </div>
      </div>
    </Modal>
  );
}

function FolhaDeLancamento({ pedido, podeImprimir, aoFechar, aoImprimir }: { pedido: PedidoCompleto; podeImprimir: boolean; aoFechar: () => void; aoImprimir: () => void }) {
  const { empresaId } = useAuth();
  const { data, error } = useQuery({ queryKey: ['pedido-folha', empresaId, pedido.id, pedido.totalCentavos], queryFn: () => api<{ blocos: BlocoFolha[]; avisos: string[]; impressora: string | null }>(`/pedidos/${pedido.id}/folha`) });
  const imprimir = useMutation({ mutationFn: () => api<{ trabalho: TrabalhoResumo; avisos: string[] }>(`/pedidos/${pedido.id}/folha/imprimir`, { metodo: 'POST' }), onSuccess: aoImprimir });
  return (
    <Modal titulo={`Folha de lançamento · pedido nº ${pedido.numero}`} aberto largo aoFechar={aoFechar}>
      <div className="space-y-3">
        {error && <Alerta>{(error as Error).message}</Alerta>}
        {data && (
          <>
            {data.avisos.map((a) => (
              <Alerta key={a} tipo="aviso">{a}</Alerta>
            ))}
            <div className="max-h-[60vh] overflow-auto rounded-md bg-slate-100 p-3">
              <PreviaCupom blocos={data.blocos} />
            </div>
            {imprimir.data && <Alerta tipo="info">Folha enviada para {data.impressora}. Acompanhe em Histórico de impressão.</Alerta>}
            {imprimir.error && <Alerta>{(imprimir.error as Error).message}</Alerta>}
            <div className="flex items-center justify-end gap-2">
              {!data.impressora && <span className="text-xs text-amber-700">Escolha a impressora da folha na aba Configuração.</span>}
              <Botao variante="secundario" onClick={aoFechar}>Fechar</Botao>
              {podeImprimir && <Botao disabled={!data.impressora || imprimir.isPending} onClick={() => imprimir.mutate()}>{imprimir.isPending ? 'Enviando…' : `Imprimir${data.impressora ? ` em ${data.impressora}` : ''}`}</Botao>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** O cupom como sai na térmica: 48 colunas, códigos de barras desenhados pelo bwip-js (o mesmo do editor). */
function PreviaCupom({ blocos }: { blocos: BlocoFolha[] }) {
  return (
    <div className="mx-auto w-[calc(48ch+1rem)] bg-white px-2 py-3 font-mono text-[11px] leading-snug text-black shadow" data-testid="previa-folha">
      {blocos.map((b, n) => {
        if (b.tipo === 'separador') return <div key={n} className="my-1 border-t border-dashed border-slate-400" />;
        if (b.tipo === 'titulo') return <div key={n} className="mt-1 font-bold">{b.texto}</div>;
        if (b.tipo === 'texto') return <div key={n} className={`${b.negrito ? 'font-bold' : ''} ${b.grande ? 'text-base' : ''} ${b.centro ? 'text-center' : ''} break-words`}>{b.texto}</div>;
        return (
          <div key={n} className="mt-2" data-testid="barras-folha">
            <Barras simbologia={b.simbologia} dados={b.dados} />
            <div className="whitespace-pre">{b.legenda}</div>
          </div>
        );
      })}
    </div>
  );
}

function Barras({ simbologia, dados }: { simbologia: 'EAN13' | 'EAN8' | 'CODE128'; dados: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void import('bwip-js/browser').then(({ default: bwipjs }) => {
      if (!vivo || !ref.current) return;
      try {
        bwipjs.toCanvas(ref.current, { bcid: { EAN13: 'ean13', EAN8: 'ean8', CODE128: 'code128' }[simbologia], text: dados, scale: 2, height: 10 });
      } catch (e) {
        setErro(String((e as Error).message ?? e));
      }
    });
    return () => {
      vivo = false;
    };
  }, [simbologia, dados]);
  return erro ? <div className="text-red-700">{erro}</div> : <canvas ref={ref} className="mx-auto block max-w-full" aria-label={`Código de barras ${dados}`} />;
}
