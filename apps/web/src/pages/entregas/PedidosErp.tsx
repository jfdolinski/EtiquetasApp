import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAMPOS_DO_PEDIDO_ERP,
  LIMITES_INTERVALO_PEDIDOS_ERP,
  mapaDeColunas,
  problemaNasColunasErp,
  problemaNaConfigPedidosErp,
  ROTULO_CAMPO_PEDIDO_ERP,
  ROTULO_SITUACAO_CHAMADA,
  ROTULO_SITUACAO_PEDIDO_ERP,
  ROTULO_TIPO_CHAMADA,
  type ConfigEntregasEmpresa,
  type ConfigMapa,
  type ConfigPedidosErp,
  type PainelPedidosErp,
  type RascunhoPedidoErp,
  type SituacaoPedidoErp,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, formatarData, Selecao, Selo, Tabela } from '../../components/ui';
import { NovaChamadaModal } from './Chamadas';

type ConsultaParaPedidosErp = { id: string; nome: string; colunas: string[]; pedeParametro: boolean };

const COR: Record<SituacaoPedidoErp, 'verde' | 'amarelo' | 'cinza'> = { CHAMADA: 'verde', PENDENTE: 'amarelo', IGNORADO: 'cinza' };
const ATUALIZAR_MS = 20_000;

/**
 * Pedidos do ERP: uma consulta SQL traz os pedidos a entregar e cada número novo vira uma chamada,
 * uma só por pedido (docs/ENTREGAS.md, etapa 10).
 */
export function PedidosErp({ config, mapa, abrirChamada }: { config: ConfigEntregasEmpresa; mapa: ConfigMapa; abrirChamada: (id: string) => void }) {
  const { pode } = useAuth();
  const cliente = useQueryClient();
  const painel = useQuery({ queryKey: ['pedidos-erp'], queryFn: () => api<PainelPedidosErp>('/entregas/pedidos-erp'), refetchInterval: ATUALIZAR_MS });
  const [rascunho, setRascunho] = useState<RascunhoPedidoErp | null>(null);
  const atualizar = (p: PainelPedidosErp) => cliente.setQueryData(['pedidos-erp'], p);
  const ler = useMutation({ mutationFn: () => api<PainelPedidosErp>('/entregas/pedidos-erp/ler', { metodo: 'POST' }), onSuccess: atualizar });
  const acao = useMutation({ mutationFn: ({ id, caminho }: { id: string; caminho: 'ignorar' | 'voltar' }) => api<PainelPedidosErp>(`/entregas/pedidos-erp/${id}/${caminho}`, { metodo: 'POST' }), onSuccess: atualizar });
  const abrir = useMutation({ mutationFn: (id: string) => api<RascunhoPedidoErp>(`/entregas/pedidos-erp/${id}/rascunho`), onSuccess: setRascunho });
  const p = painel.data;
  const gerencia = pode('entrega.gerenciar');

  return (
    <div className="space-y-5">
      {pode('entrega.configurar') && p && <Configuracao painel={p} aoSalvar={atualizar} />}
      {painel.error && <Alerta>{painel.error.message}</Alerta>}
      {p && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-slate-600" data-testid="leitura-erp">
              {p.config.ativo ? (
                <>
                  Lendo a consulta <strong>{p.consultaNome ?? '(excluída)'}</strong> a cada {p.config.intervaloMinutos} min
                  {p.lidoEm ? <> · última leitura {formatarData(p.lidoEm)}</> : ' · ainda não leu'}
                  {p.config.chamarAutomatico ? ' · chamada automática ligada' : ' · você chama cada um'}
                </>
              ) : (
                'Leitura dos pedidos do ERP desligada.'
              )}
            </div>
            {gerencia && p.config.ativo && (
              <Botao variante="secundario" onClick={() => ler.mutate()} disabled={ler.isPending}>
                {ler.isPending ? 'Lendo…' : 'Ler agora'}
              </Botao>
            )}
          </div>
          {p.erro && <Alerta>Última leitura falhou: {p.erro}</Alerta>}
          {(ler.error ?? acao.error ?? abrir.error) && <Alerta>{(ler.error ?? acao.error ?? abrir.error)!.message}</Alerta>}
          <Tabela colunas={['Pedido', 'Serviço', 'Cliente', 'Endereço', 'Situação', 'Lido em', '']} vazio={p.pedidos.length === 0}>
            {p.pedidos.map((x) => {
              const podeChamar = gerencia && (x.situacao === 'PENDENTE' || (x.situacao === 'CHAMADA' && x.chamada?.situacao === 'CANCELADA'));
              return (
                <tr key={x.id} data-testid="pedido-erp">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">{x.codigo}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{ROTULO_TIPO_CHAMADA[x.tipo]}</td>
                  <td className="px-4 py-2.5">{x.cliente || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{x.endereco || (x.ponto ? 'Só o ponto' : '—')}</td>
                  <td className="px-4 py-2.5">
                    <Selo cor={COR[x.situacao]}>{ROTULO_SITUACAO_PEDIDO_ERP[x.situacao]}</Selo>
                    {x.chamada && (
                      <button type="button" className="ml-2 text-xs text-blue-700 underline" onClick={() => abrirChamada(x.chamada!.id)}>
                        nº {x.chamada.numero} · {ROTULO_SITUACAO_CHAMADA[x.chamada.situacao]}
                      </button>
                    )}
                    {x.mensagem && <div className="mt-1 text-xs text-slate-500">{x.mensagem}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatarData(x.criadoEm)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {podeChamar && (
                      <Botao variante="secundario" onClick={() => abrir.mutate(x.id)} disabled={abrir.isPending}>
                        Chamar entregador
                      </Botao>
                    )}
                    {gerencia && x.situacao === 'PENDENTE' && (
                      <button type="button" className="ml-2 text-sm text-slate-500 underline" onClick={() => acao.mutate({ id: x.id, caminho: 'ignorar' })}>
                        Ignorar
                      </button>
                    )}
                    {gerencia && x.situacao === 'IGNORADO' && (
                      <button type="button" className="text-sm text-slate-500 underline" onClick={() => acao.mutate({ id: x.id, caminho: 'voltar' })}>
                        Voltar para a lista
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabela>
        </>
      )}
      {rascunho && (
        <NovaChamadaModal
          config={config}
          mapa={mapa}
          erp={rascunho}
          aoFechar={() => setRascunho(null)}
          aoCriar={(id) => {
            setRascunho(null);
            void cliente.invalidateQueries({ queryKey: ['pedidos-erp'] });
            abrirChamada(id);
          }}
        />
      )}
    </div>
  );
}

function Configuracao({ painel, aoSalvar }: { painel: PainelPedidosErp; aoSalvar: (p: PainelPedidosErp) => void }) {
  const consultas = useQuery({ queryKey: ['pedidos-erp-consultas'], queryFn: () => api<ConsultaParaPedidosErp[]>('/entregas/pedidos-erp/consultas') });
  const [c, setC] = useState<ConfigPedidosErp>(painel.config);
  const [intervalo, setIntervalo] = useState(String(painel.config.intervaloMinutos));
  useEffect(() => {
    setC(painel.config);
    setIntervalo(String(painel.config.intervaloMinutos));
  }, [painel.config]);
  const salvar = useMutation({ mutationFn: (dados: ConfigPedidosErp) => api<PainelPedidosErp>('/entregas/pedidos-erp', { metodo: 'PUT', corpo: dados }), onSuccess: aoSalvar });
  const dados = { ...c, intervaloMinutos: Number(intervalo) };
  const escolhida = consultas.data?.find((x) => x.id === c.consultaId);
  const mapa = escolhida?.colunas.length ? mapaDeColunas(escolhida.colunas) : null;
  const problema = problemaNaConfigPedidosErp(dados) ?? (escolhida?.pedeParametro ? 'Esta consulta pede valores digitados ({param.*}): ela não roda sozinha.' : null) ?? (mapa ? problemaNasColunasErp(mapa) : null);

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4" open={!painel.config.consultaId}>
      <summary className="cursor-pointer text-sm font-medium">Consulta dos pedidos do ERP</summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <Selecao rotulo="Consulta SQL" value={c.consultaId ?? ''} onChange={(e) => setC({ ...c, consultaId: e.target.value || null })}>
            <option value="">Escolha…</option>
            {consultas.data?.map((x) => (
              <option key={x.id} value={x.id} disabled={x.pedeParametro}>
                {x.nome}
                {x.pedeParametro ? ' (pede valores digitados)' : ''}
              </option>
            ))}
          </Selecao>
          <Campo rotulo="Ler a cada (minutos)" type="number" min={LIMITES_INTERVALO_PEDIDOS_ERP.minimo} max={LIMITES_INTERVALO_PEDIDOS_ERP.maximo} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} />
            <span>Ler os pedidos do ERP</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={c.chamarAutomatico} onChange={(e) => setC({ ...c, chamarAutomatico: e.target.checked })} />
            <span>Abrir a chamada sozinho, na distribuição automática (desligado, cada pedido espera você clicar em "Chamar entregador")</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={c.importarExistentes} onChange={(e) => setC({ ...c, importarExistentes: e.target.checked })} />
            <span>Ao ligar, chamar também os pedidos que já estão na consulta (desligado, eles ficam como ignorados e só os novos são chamados)</span>
          </label>
          {problema && <Alerta tipo="aviso">{problema}</Alerta>}
          {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
          {salvar.isSuccess && <Alerta tipo="info">Salvo.</Alerta>}
          <Botao onClick={() => salvar.mutate(dados)} disabled={!!problema || salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Botao>
          {painel.responsavelNome && <p className="text-xs text-slate-500">A consulta roda em nome de {painel.responsavelNome} (último a salvar).</p>}
        </div>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            A consulta deve trazer só os pedidos que precisam de entregador (ex.: os de hoje, prontos e ainda não entregues). Cada número de pedido gera <strong>uma chamada só</strong>, mesmo que continue aparecendo nas próximas leituras. Os nomes das colunas dizem o que é cada informação: use o alias no SQL (<code>coluna AS pedido</code>).
          </p>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2" data-testid="colunas-erp">
            {CAMPOS_DO_PEDIDO_ERP.map(({ campo, nomes }) => (
              <li key={campo}>
                <strong>{ROTULO_CAMPO_PEDIDO_ERP[campo]}</strong>: {nomes.join(', ')}
                {mapa && <span className={mapa[campo] ? 'text-emerald-700' : 'text-slate-400'}> {mapa[campo] ? `✓ ${mapa[campo]}` : '—'}</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs">Obrigatórios: o número do pedido e o endereço (completo, ou rua e cidade) ou o ponto (lat e lon). Sem o ponto, o endereço é procurado no mapa. O tipo aceita entrega, coleta ou devolução; sem ele, é entrega.</p>
        </div>
      </div>
    </details>
  );
}
