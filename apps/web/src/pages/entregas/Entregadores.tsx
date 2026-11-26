import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatarCelular,
  formatarCentavos,
  pixConfigurado,
  problemaNoPacote,
  problemaNosParametrosEntregas,
  problemaNoPadraoDaPlataforma,
  TABELA_PRECOS_PADRAO,
  ROTULO_DOCUMENTO,
  ROTULO_PEDIDO_CREDITO,
  ROTULO_SITUACAO_ENTREGADOR,
  ROTULO_VEICULO,
  type EntregadorResumo,
  type PacoteCredito,
  type ParametrosEntregasPlataforma,
  type PedidoCreditoAdmin,
  type SituacaoEntregador,
  type TipoDocumentoEntregador,
} from '@etiquetas/shared';
import { api } from '../../api';
import type { EmpresaAvaliada } from '@etiquetas/shared';
import { TabelaPrecosEditor } from './TabelaPrecosEditor';

/** "12,50" → 1250; vazio ou inválido vira 0 e a validação avisa. */
const paraCentavos = (t: string) => Math.round(Number(t.trim().replace(/\./g, '').replace(',', '.') || '0') * 100) || 0;
import { Alerta, Botao, Cabecalho, Campo, formatarData, Modal, Selecao, Selo, Tabela } from '../../components/ui';

type Aba = 'cadastros' | 'creditos' | 'pacotes' | 'empresas';

const COR_SITUACAO: Record<SituacaoEntregador, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = { PENDENTE: 'amarelo', APROVADO: 'verde', RECUSADO: 'vermelho', SUSPENSO: 'cinza' };

/** Super-admin: aprova entregadores, confere as compras de diárias e define pacotes e Pix. */
export function Entregadores() {
  const [aba, setAba] = useState<Aba>('cadastros');
  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'cadastros', rotulo: 'Cadastros' },
    { id: 'creditos', rotulo: 'Compras de diárias' },
    { id: 'pacotes', rotulo: 'Pacotes e Pix' },
    { id: 'empresas', rotulo: 'Empresas avaliadas' },
  ];
  return (
    <div>
      <Cabecalho titulo="Entregadores" descricao="Cadastro da plataforma: o mesmo entregador atende todas as empresas. Ele compra diárias para ficar online." />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {abas.map(({ id, rotulo }) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'cadastros' && <Cadastros />}
      {aba === 'creditos' && <Compras />}
      {aba === 'pacotes' && <PacotesEPix />}
      {aba === 'empresas' && <EmpresasAvaliadas />}
    </div>
  );
}

// Empresas avaliadas pelos entregadores -----------------------------------------------------

function EmpresasAvaliadas() {
  const { data, error } = useQuery({ queryKey: ['empresas-avaliadas'], queryFn: () => api<EmpresaAvaliada[]>('/plataforma-entregas/empresas-avaliadas') });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Notas que os entregadores deram às empresas nos últimos 90 dias, da pior para a melhor. A média só aparece a partir de 3 avaliações.</p>
      {error && <Alerta>{error.message}</Alerta>}
      <Tabela colunas={['Empresa', 'Média', 'Avaliações', 'Notas 1 e 2']} vazio={data?.length === 0}>
        {data?.map((e) => (
          <tr key={e.empresaId}>
            <td className="px-4 py-2.5">{e.nome}</td>
            <td className="px-4 py-2.5">{e.media !== null ? <span className={e.media < 3.5 ? 'font-semibold text-red-700' : ''}>{e.media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</span> : '—'}</td>
            <td className="px-4 py-2.5">{e.avaliacoes}</td>
            <td className="px-4 py-2.5">{e.ruins}</td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}

// Cadastros ---------------------------------------------------------------------------------

function Cadastros() {
  const [situacao, setSituacao] = useState<SituacaoEntregador | ''>('PENDENTE');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<EntregadorResumo | null>(null);
  const filtro = new URLSearchParams({ ...(situacao ? { situacao } : {}), ...(busca.trim() ? { busca: busca.trim() } : {}) });
  const { data = [], error, isLoading } = useQuery({ queryKey: ['entregadores', situacao, busca.trim()], queryFn: () => api<EntregadorResumo[]>(`/entregadores?${filtro}`) });
  const atual = aberto ? (data.find((e) => e.id === aberto.id) ?? aberto) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Selecao rotulo="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoEntregador | '')}>
            <option value="">Todas</option>
            {(Object.keys(ROTULO_SITUACAO_ENTREGADOR) as SituacaoEntregador[]).map((s) => (
              <option key={s} value={s}>
                {ROTULO_SITUACAO_ENTREGADOR[s]}
              </option>
            ))}
          </Selecao>
        </div>
        <div className="w-72">
          <Campo rotulo="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CPF, e-mail ou celular" />
        </div>
      </div>
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Entregador', 'Veículo', 'Documentos', 'Diárias', 'Situação', '']} vazio={data.length === 0}>
          {data.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-2.5 align-top">
                <div className="font-medium">{e.nome}</div>
                <div className="text-xs text-slate-500">
                  {e.cpf} · {formatarCelular(e.celular)}
                </div>
              </td>
              <td className="px-4 py-2.5 align-top">
                {ROTULO_VEICULO[e.veiculo]}
                {e.placa && <div className="text-xs text-slate-500">{e.placa}</div>}
              </td>
              <td className="px-4 py-2.5 align-top">{e.documentosFaltando.length ? <Selo cor="amarelo">Faltam {e.documentosFaltando.length}</Selo> : <Selo cor="verde">Completos</Selo>}</td>
              <td className="px-4 py-2.5 align-top">{e.saldoDiarias}</td>
              <td className="px-4 py-2.5 align-top">
                <Selo cor={COR_SITUACAO[e.situacao]}>{ROTULO_SITUACAO_ENTREGADOR[e.situacao]}</Selo>
                {e.online && <div className="mt-1 text-xs text-emerald-700">Online</div>}
              </td>
              <td className="px-4 py-2.5 text-right align-top">
                <Botao variante="secundario" onClick={() => setAberto(e)}>
                  Abrir
                </Botao>
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      {atual && <DetalheEntregador entregador={atual} aoFechar={() => setAberto(null)} />}
    </div>
  );
}

function Documento({ id, tipo }: { id: string; tipo: TipoDocumentoEntregador }) {
  const { data, error } = useQuery({ queryKey: ['entregador-doc', id, tipo], queryFn: () => api<{ dados: string }>(`/entregadores/${id}/documentos/${tipo}`) });
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-slate-600">{ROTULO_DOCUMENTO[tipo]}</figcaption>
      {error && <div className="text-xs text-red-600">{error.message}</div>}
      {data && (
        <a href={data.dados} target="_blank" rel="noreferrer">
          <img src={data.dados} alt={ROTULO_DOCUMENTO[tipo]} className="max-h-64 rounded border border-slate-200 object-contain" />
        </a>
      )}
    </figure>
  );
}

function DetalheEntregador({ entregador: e, aoFechar }: { entregador: EntregadorResumo; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [bonus, setBonus] = useState({ diarias: '1', validade: '30', motivo: '' });
  const recarregar = () => void cliente.invalidateQueries({ queryKey: ['entregadores'] });
  const acao = useMutation({
    mutationFn: ({ caminho, corpo }: { caminho: string; corpo?: unknown }) => api(`/entregadores/${e.id}/${caminho}`, { metodo: 'POST', corpo }),
    onSuccess: (_, { caminho }) => {
      setMotivo('');
      setBonus({ diarias: '1', validade: '30', motivo: '' });
      recarregar();
      // Mudou a situação: a lista (filtrada) já mostra onde ele foi parar.
      if (caminho !== 'bonus') aoFechar();
    },
  });
  const completo = e.documentosFaltando.length === 0;

  return (
    <Modal titulo={e.nome} aberto aoFechar={aoFechar} largo>
      <div className="space-y-5">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Info rotulo="CPF" valor={e.cpf} />
          <Info rotulo="Celular" valor={formatarCelular(e.celular)} />
          <Info rotulo="E-mail" valor={e.email} />
          <Info rotulo="Veículo" valor={`${ROTULO_VEICULO[e.veiculo]}${e.placa ? ` · ${e.placa}` : ''}`} />
          <Info rotulo="Chave Pix" valor={e.chavePix} />
          <Info rotulo="Cadastro" valor={formatarData(e.criadoEm)} />
          <Info rotulo="Situação" valor={ROTULO_SITUACAO_ENTREGADOR[e.situacao]} />
          <Info rotulo="Diárias disponíveis" valor={String(e.saldoDiarias)} />
          <Info rotulo="Última posição" valor={e.posicaoEm ? formatarData(e.posicaoEm) : 'Nunca'} />
        </dl>
        {e.motivo && <Alerta tipo="aviso">Motivo: {e.motivo}</Alerta>}

        <div className="grid gap-4 sm:grid-cols-3">
          {e.documentos.map((t) => (
            <Documento key={t} id={e.id} tipo={t} />
          ))}
        </div>
        {!completo && <Alerta tipo="aviso">Faltam: {e.documentosFaltando.map((t) => ROTULO_DOCUMENTO[t]).join(', ')}.</Alerta>}
        {acao.error && <Alerta>{acao.error.message}</Alerta>}

        <div className="space-y-3 border-t border-slate-200 pt-4">
          {(e.situacao === 'PENDENTE' || e.situacao === 'RECUSADO') && (
            <Botao onClick={() => acao.mutate({ caminho: 'aprovar' })} disabled={!completo || acao.isPending}>
              Aprovar cadastro
            </Botao>
          )}
          {e.situacao === 'SUSPENSO' && (
            <Botao onClick={() => acao.mutate({ caminho: 'reativar' })} disabled={acao.isPending}>
              Reativar
            </Botao>
          )}
          {(e.situacao === 'PENDENTE' || e.situacao === 'APROVADO') && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <Campo rotulo={e.situacao === 'PENDENTE' ? 'Motivo da recusa (o entregador vê)' : 'Motivo da suspensão (o entregador vê)'} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
              </div>
              <Botao variante="perigo" disabled={motivo.trim().length < 3 || acao.isPending} onClick={() => acao.mutate({ caminho: e.situacao === 'PENDENTE' ? 'recusar' : 'suspender', corpo: { motivo } })}>
                {e.situacao === 'PENDENTE' ? 'Recusar' : 'Suspender'}
              </Botao>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200 pt-4">
          <div className="text-sm font-medium">Dar diárias de bônus</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-24">
              <Campo rotulo="Diárias" type="number" min={1} max={60} value={bonus.diarias} onChange={(ev) => setBonus({ ...bonus, diarias: ev.target.value })} />
            </div>
            <div className="w-28">
              <Campo rotulo="Validade (dias)" type="number" min={1} max={365} value={bonus.validade} onChange={(ev) => setBonus({ ...bonus, validade: ev.target.value })} />
            </div>
            <div className="min-w-56 flex-1">
              <Campo rotulo="Motivo" value={bonus.motivo} onChange={(ev) => setBonus({ ...bonus, motivo: ev.target.value })} />
            </div>
            <Botao variante="secundario" disabled={bonus.motivo.trim().length < 3 || acao.isPending} onClick={() => acao.mutate({ caminho: 'bonus', corpo: { diarias: Number(bonus.diarias), validadeDias: Number(bonus.validade), motivo: bonus.motivo } })}>
              Dar bônus
            </Botao>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="break-words">{valor}</dd>
    </div>
  );
}

// Compras de diárias --------------------------------------------------------------------------

function Compras() {
  const cliente = useQueryClient();
  const [situacao, setSituacao] = useState('AGUARDANDO');
  const [recusando, setRecusando] = useState<PedidoCreditoAdmin | null>(null);
  const [motivo, setMotivo] = useState('');
  const [comprovante, setComprovante] = useState<string | null>(null);
  const { data = [], error, isLoading } = useQuery({ queryKey: ['entregadores-creditos', situacao], queryFn: () => api<PedidoCreditoAdmin[]>(`/entregadores/creditos?situacao=${situacao}`) });
  const recarregar = () => void cliente.invalidateQueries({ queryKey: ['entregadores-creditos'] });
  const confirmar = useMutation({ mutationFn: (id: string) => api(`/entregadores/creditos/${id}/confirmar`, { metodo: 'POST' }), onSuccess: recarregar });
  const recusar = useMutation({
    mutationFn: () => api(`/entregadores/creditos/${recusando!.id}/recusar`, { metodo: 'POST', corpo: { motivo } }),
    onSuccess: () => {
      setRecusando(null);
      setMotivo('');
      recarregar();
    },
  });
  const verComprovante = useMutation({ mutationFn: (id: string) => api<{ dados: string }>(`/entregadores/creditos/${id}/comprovante`), onSuccess: (r) => setComprovante(r.dados) });

  return (
    <div className="space-y-4">
      <Alerta tipo="info">Confira no extrato do banco o Pix com o valor e o identificador (txid) antes de confirmar. Confirmar libera as diárias na hora.</Alerta>
      <div className="w-56">
        <Selecao rotulo="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="AGUARDANDO">Aguardando confirmação</option>
          <option value="CONFIRMADO">Confirmadas</option>
          <option value="RECUSADO">Recusadas</option>
          <option value="CANCELADO">Canceladas</option>
          <option value="TODOS">Todas</option>
        </Selecao>
      </div>
      {(error ?? confirmar.error ?? verComprovante.error) && <Alerta>{(error ?? confirmar.error ?? verComprovante.error)!.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Entregador', 'Pacote', 'Valor', 'Identificador', 'Pagamento', 'Situação', '']} vazio={data.length === 0}>
          {data.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-2.5 align-top">
                <div className="font-medium">{p.entregador.nome}</div>
                <div className="text-xs text-slate-500">{p.entregador.cpf}</div>
              </td>
              <td className="px-4 py-2.5 align-top">
                {p.pacote}
                <div className="text-xs text-slate-500">
                  {p.diarias} diária{p.diarias === 1 ? '' : 's'}, valem {p.validadeDias} dias
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 align-top font-medium">{formatarCentavos(p.precoCentavos)}</td>
              <td className="px-4 py-2.5 align-top font-mono text-xs">{p.txid}</td>
              <td className="px-4 py-2.5 align-top text-xs">
                {p.pagamentoInformadoEm ? `Informado em ${formatarData(p.pagamentoInformadoEm)}` : <span className="text-slate-400">Não informado</span>}
                {p.temComprovante && (
                  <button type="button" className="mt-1 block text-blue-700 underline" onClick={() => verComprovante.mutate(p.id)}>
                    Ver comprovante
                  </button>
                )}
              </td>
              <td className="px-4 py-2.5 align-top">
                <Selo cor={p.situacao === 'CONFIRMADO' ? 'verde' : p.situacao === 'AGUARDANDO' ? 'amarelo' : p.situacao === 'RECUSADO' ? 'vermelho' : 'cinza'}>{ROTULO_PEDIDO_CREDITO[p.situacao]}</Selo>
                {p.motivo && <div className="mt-1 text-xs text-slate-500">{p.motivo}</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right align-top">
                {p.situacao === 'AGUARDANDO' && (
                  <div className="flex justify-end gap-2">
                    <Botao onClick={() => confirmar.mutate(p.id)} disabled={confirmar.isPending}>
                      Confirmar
                    </Botao>
                    <Botao variante="secundario" onClick={() => setRecusando(p)}>
                      Recusar
                    </Botao>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      <Modal titulo="Recusar compra" aberto={!!recusando} aoFechar={() => setRecusando(null)}>
        <div className="space-y-3">
          <Campo rotulo="Motivo (o entregador vê)" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Pix não encontrado no extrato" />
          {recusar.error && <Alerta>{recusar.error.message}</Alerta>}
          <Botao variante="perigo" disabled={motivo.trim().length < 3 || recusar.isPending} onClick={() => recusar.mutate()}>
            Recusar
          </Botao>
        </div>
      </Modal>
      <Modal titulo="Comprovante" aberto={!!comprovante} aoFechar={() => setComprovante(null)} largo>
        {comprovante && <img src={comprovante} alt="Comprovante do Pix" className="mx-auto max-h-[75vh] object-contain" />}
      </Modal>
    </div>
  );
}

// Pacotes e Pix ---------------------------------------------------------------------------------

type FormPacote = { id: string | null; nome: string; diarias: string; preco: string; validade: string; ativo: boolean };

const centavosDoTexto = (t: string) => Math.round(Number(t.replace(/\./g, '').replace(',', '.')) * 100);

function PacotesEPix() {
  const cliente = useQueryClient();
  const pacotes = useQuery({ queryKey: ['entregadores-pacotes'], queryFn: () => api<PacoteCredito[]>('/entregadores/pacotes') });
  const parametros = useQuery({ queryKey: ['entregadores-parametros'], queryFn: () => api<ParametrosEntregasPlataforma>('/entregadores/parametros') });
  const [form, setForm] = useState<FormPacote | null>(null);
  const [p, setP] = useState<ParametrosEntregasPlataforma | null>(null);
  useEffect(() => {
    if (parametros.data) setP(parametros.data);
  }, [parametros.data]);

  const salvarPacote = useMutation({
    mutationFn: (f: FormPacote) =>
      api(f.id ? `/entregadores/pacotes/${f.id}` : '/entregadores/pacotes', {
        metodo: f.id ? 'PUT' : 'POST',
        corpo: { nome: f.nome, diarias: Number(f.diarias), precoCentavos: centavosDoTexto(f.preco), validadeDias: Number(f.validade), ativo: f.ativo },
      }),
    onSuccess: () => {
      setForm(null);
      void cliente.invalidateQueries({ queryKey: ['entregadores-pacotes'] });
    },
  });
  const excluir = useMutation({ mutationFn: (id: string) => api(`/entregadores/pacotes/${id}`, { metodo: 'DELETE' }), onSuccess: () => void cliente.invalidateQueries({ queryKey: ['entregadores-pacotes'] }) });
  const salvarParametros = useMutation({
    mutationFn: (dados: ParametrosEntregasPlataforma) => api<ParametrosEntregasPlataforma>('/entregadores/parametros', { metodo: 'PUT', corpo: dados }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['entregadores-parametros'] }),
  });

  const problemaForm = form
    ? problemaNoPacote({ nome: form.nome, diarias: Number(form.diarias), precoCentavos: centavosDoTexto(form.preco), validadeDias: Number(form.validade), ativo: form.ativo })
    : null;
  const problemaParametros = p ? (problemaNosParametrosEntregas(p) ?? problemaNoPadraoDaPlataforma(p.tabelaPadrao, p.valorMinimoCentavos)) : null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pacotes de diárias</h2>
          <Botao onClick={() => setForm({ id: null, nome: '', diarias: '7', preco: '', validade: '30', ativo: true })}>Novo pacote</Botao>
        </div>
        {(pacotes.error ?? excluir.error) && <Alerta>{(pacotes.error ?? excluir.error)!.message}</Alerta>}
        <Tabela colunas={['Pacote', 'Diárias', 'Preço', 'Por diária', 'Validade', 'Situação', '']} vazio={(pacotes.data ?? []).length === 0}>
          {(pacotes.data ?? []).map((k) => (
            <tr key={k.id}>
              <td className="px-4 py-2.5 font-medium">{k.nome}</td>
              <td className="px-4 py-2.5">{k.diarias}</td>
              <td className="px-4 py-2.5">{formatarCentavos(k.precoCentavos)}</td>
              <td className="px-4 py-2.5 text-slate-500">{formatarCentavos(Math.round(k.precoCentavos / k.diarias))}</td>
              <td className="px-4 py-2.5">{k.validadeDias} dias</td>
              <td className="px-4 py-2.5">
                <Selo cor={k.ativo ? 'verde' : 'cinza'}>{k.ativo ? 'À venda' : 'Fora de venda'}</Selo>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                <div className="flex justify-end gap-2">
                  <Botao variante="secundario" onClick={() => setForm({ id: k.id, nome: k.nome, diarias: String(k.diarias), preco: (k.precoCentavos / 100).toFixed(2).replace('.', ','), validade: String(k.validadeDias), ativo: k.ativo })}>
                    Editar
                  </Botao>
                  <Botao variante="secundario" onClick={() => confirm(`Excluir o pacote ${k.nome}? Quem já comprou não perde nada.`) && excluir.mutate(k.id)}>
                    Excluir
                  </Botao>
                </div>
              </td>
            </tr>
          ))}
        </Tabela>
      </section>

      {p && (
        <section className="max-w-xl space-y-3">
          <h2 className="font-semibold">Pix para receber as compras</h2>
          {!pixConfigurado(p) && <Alerta tipo="aviso">Sem o Pix, os entregadores não conseguem comprar diárias.</Alerta>}
          <Campo rotulo="Chave Pix" value={p.pixChave} onChange={(e) => setP({ ...p, pixChave: e.target.value })} placeholder="CNPJ, e-mail, celular ou chave aleatória" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome de quem recebe" value={p.pixNome} onChange={(e) => setP({ ...p, pixNome: e.target.value })} ajuda="Até 25 letras, sem acento no Pix." />
            <Campo rotulo="Cidade de quem recebe" value={p.pixCidade} onChange={(e) => setP({ ...p, pixCidade: e.target.value })} />
          </div>
          <h2 className="pt-2 font-semibold">Diárias grátis no cadastro</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Diárias ao aprovar (0 = nenhuma)" type="number" min={0} max={30} value={String(p.diariasBonusCadastro)} onChange={(e) => setP({ ...p, diariasBonusCadastro: Number(e.target.value) })} />
            <Campo rotulo="Validade (dias)" type="number" min={1} max={365} value={String(p.validadeBonusDias)} onChange={(e) => setP({ ...p, validadeBonusDias: Number(e.target.value) })} />
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-3" data-testid="padrao-plataforma">
            <div className="text-sm font-medium">Padrões das empresas</div>
            <Campo rotulo="Valor mínimo por chamada (R$, 0 = sem mínimo)" inputMode="decimal" defaultValue={(p.valorMinimoCentavos / 100).toFixed(2).replace('.', ',')} onChange={(e) => setP({ ...p, valorMinimoCentavos: paraCentavos(e.target.value) })} ajuda="Nenhuma chamada sai por menos, em nenhuma empresa." />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!p.tabelaPadrao} onChange={(e) => setP({ ...p, tabelaPadrao: e.target.checked ? (parametros.data?.tabelaPadrao ?? TABELA_PRECOS_PADRAO) : null })} /> Tabela de preços padrão da plataforma
            </label>
            <p className="text-xs text-slate-500">Vale para as empresas que ainda não salvaram a tabela delas em Entregas &gt; Configuração. Desmarcado, vale a tabela que vem com o sistema.</p>
            {p.tabelaPadrao && <TabelaPrecosEditor inicial={parametros.data?.tabelaPadrao ?? TABELA_PRECOS_PADRAO} mudar={(t) => setP({ ...p, tabelaPadrao: t })} />}
          </div>
          {(problemaParametros ?? salvarParametros.error) && <Alerta>{problemaParametros ?? salvarParametros.error!.message}</Alerta>}
          {salvarParametros.isSuccess && <Alerta tipo="info">Salvo.</Alerta>}
          <Botao onClick={() => salvarParametros.mutate(p)} disabled={!!problemaParametros || salvarParametros.isPending}>
            Salvar
          </Botao>
        </section>
      )}

      <Modal titulo={form?.id ? 'Editar pacote' : 'Novo pacote'} aberto={!!form} aoFechar={() => setForm(null)}>
        {form && (
          <div className="space-y-3">
            <Campo rotulo="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Semana" />
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="Diárias" type="number" min={1} value={form.diarias} onChange={(e) => setForm({ ...form, diarias: e.target.value })} />
              <Campo rotulo="Preço (R$)" inputMode="decimal" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} placeholder="35,00" />
              <Campo rotulo="Validade (dias)" type="number" min={1} value={form.validade} onChange={(e) => setForm({ ...form, validade: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> À venda no aplicativo
            </label>
            {(problemaForm ?? salvarPacote.error) && <Alerta>{problemaForm ?? salvarPacote.error!.message}</Alerta>}
            <Botao onClick={() => salvarPacote.mutate(form)} disabled={!!problemaForm || salvarPacote.isPending}>
              Salvar
            </Botao>
          </div>
        )}
      </Modal>
    </div>
  );
}
