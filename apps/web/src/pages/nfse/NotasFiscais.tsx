import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AMBIENTES_NFSE,
  centavosDe,
  DIAS_AVISO_CERTIFICADO,
  formatarCentavos,
  formatarCnpj,
  MOTIVOS_CANCELAMENTO_NFSE,
  podeCancelarNota,
  podeEmitirDeNovo,
  problemaNoCancelamento,
  problemaNoEmissor,
  problemaNoTomador,
  REGIMES_ESPECIAIS_NFSE,
  REGIMES_NFSE,
  ROTULO_AMBIENTE_NFSE,
  ROTULO_ORIGEM_NOTA,
  ROTULO_REGIME_NFSE,
  ROTULO_SITUACAO_NOTA,
  type DadosEmissorNfse,
  type EmissorNfseResumo,
  type NotaResumo,
  type SituacaoNota,
} from '@etiquetas/shared';
import { api, apiArquivo } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Cabecalho, Campo, formatarData, Modal, Selecao, Selo, Tabela } from '../../components/ui';

const COR: Record<SituacaoNota, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  PENDENTE: 'amarelo',
  PROCESSANDO: 'amarelo',
  EMITIDA: 'verde',
  ERRO: 'vermelho',
  CANCELANDO: 'amarelo',
  CANCELADA: 'cinza',
};

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

function documentoFormatado(d: string | null | undefined): string {
  if (!d) return '';
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : formatarCnpj(d);
}

async function baixar(caminho: string, nome: string) {
  const blob = await apiArquivo(caminho);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Notas fiscais de serviço (NFS-e, padrão nacional). A empresa vê as que emitiu (pedidos e avulsas) e
 * as recebidas da plataforma (mensalidade); o super-admin vê as da plataforma. Configuração: dados
 * fiscais, certificado A1 e emissão automática.
 */
export function NotasFiscais({ plataforma = false }: { plataforma?: boolean }) {
  const { pode } = useAuth();
  const base = plataforma ? '/plataforma/nfse' : '/nfse';
  const podeConfigurar = plataforma || pode('nfse.configurar');
  const podeEmitir = plataforma || pode('nfse.emitir');
  const [aba, setAba] = useState<'EMITIDAS' | 'RECEBIDAS' | 'CONFIGURACAO'>('EMITIDAS');
  const emissor = useQuery({ queryKey: ['nfse-emissor', base], queryFn: () => api<{ emissor: EmissorNfseResumo | null }>(`${base}/emissor`) });

  const abas: { id: typeof aba; rotulo: string }[] = [
    { id: 'EMITIDAS', rotulo: 'Emitidas' },
    ...(!plataforma ? [{ id: 'RECEBIDAS' as const, rotulo: 'Recebidas do Flow' }] : []),
    ...(podeConfigurar ? [{ id: 'CONFIGURACAO' as const, rotulo: 'Configuração' }] : []),
  ];
  const e = emissor.data?.emissor;
  return (
    <div className="space-y-4">
      <Cabecalho
        titulo={plataforma ? 'Notas fiscais da plataforma' : 'Notas fiscais'}
        descricao={
          plataforma
            ? 'NFS-e da mensalidade de cada empresa, emitida pelo Emissor Nacional com o certificado da plataforma ao registrar o pagamento em Cobrança.'
            : 'NFS-e de serviço pelo Emissor Nacional: notas dos pedidos concluídos e avulsas, e as notas da mensalidade que o Flow emitiu para a sua empresa.'
        }
      />
      <div className="flex gap-1 border-b border-slate-200">
        {abas.map((a) => (
          <button key={a.id} type="button" onClick={() => setAba(a.id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === a.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba !== 'RECEBIDAS' && e?.problema && (
        <Alerta tipo="aviso">
          {e.problema}
          {podeConfigurar && aba !== 'CONFIGURACAO' && ' Veja a aba Configuração.'}
        </Alerta>
      )}
      {aba !== 'RECEBIDAS' && !emissor.isLoading && !e && <Alerta tipo="info">{podeConfigurar ? 'Preencha os dados fiscais na aba Configuração para emitir notas.' : 'A emissão de notas ainda não foi configurada.'}</Alerta>}
      {e && e.diasParaVencer !== null && e.diasParaVencer >= 0 && e.diasParaVencer <= DIAS_AVISO_CERTIFICADO && (
        <Alerta tipo="aviso">O certificado digital vence em {e.diasParaVencer} {e.diasParaVencer === 1 ? 'dia' : 'dias'}. Envie o novo antes disso.</Alerta>
      )}
      {e?.ambiente === 'PRODUCAO_RESTRITA' && aba !== 'RECEBIDAS' && <Alerta tipo="info">Ambiente de testes (Produção Restrita): as notas não têm valor fiscal.</Alerta>}
      {aba === 'CONFIGURACAO' ? (
        <Configuracao base={base} plataforma={plataforma} emissor={e ?? null} />
      ) : (
        <ListaNotas base={base} tipo={aba} podeEmitir={podeEmitir && aba === 'EMITIDAS'} emissorPronto={!!e && !e.problema} />
      )}
    </div>
  );
}

function ListaNotas({ base, tipo, podeEmitir, emissorPronto }: { base: string; tipo: 'EMITIDAS' | 'RECEBIDAS'; podeEmitir: boolean; emissorPronto: boolean }) {
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const consulta = new URLSearchParams({ ...(base === '/nfse' ? { tipo } : {}), ...(situacao ? { situacao } : {}), ...(busca.trim() ? { busca: busca.trim() } : {}) }).toString();
  const lista = useQuery({
    queryKey: ['nfse-notas', base, consulta],
    queryFn: () => api<NotaResumo[]>(`${base}/notas?${consulta}`),
    // Enquanto alguma nota está na fila, atualiza mais depressa.
    refetchInterval: (q) => ((q.state.data ?? []).some((n) => n.situacao === 'PENDENTE' || n.situacao === 'PROCESSANDO') ? 3_000 : 30_000),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Campo rotulo="Buscar" placeholder="Tomador, CPF/CNPJ ou número" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="w-48">
          <Selecao rotulo="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(ROTULO_SITUACAO_NOTA).map(([s, r]) => (
              <option key={s} value={s}>
                {r}
              </option>
            ))}
          </Selecao>
        </div>
        {podeEmitir && (
          <Botao className="ml-auto" onClick={() => setNova(true)} disabled={!emissorPronto}>
            Nova nota avulsa
          </Botao>
        )}
      </div>
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      {lista.data && (
        <Tabela colunas={tipo === 'RECEBIDAS' ? ['NFS-e', 'Emitente', 'Serviço', 'Valor', 'Emitida', 'Situação'] : ['NFS-e', 'Origem', 'Tomador', 'Valor', 'Criada', 'Situação']} vazio={!lista.data.length}>
          {lista.data.map((n) => (
            <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setAberta(n.id)} data-testid="nota-fiscal">
              <td className="px-4 py-2.5 font-medium">
                {n.numeroNfse ?? '—'}
                <div className="text-xs font-normal text-slate-500">DPS {n.serie}/{n.numeroDps}</div>
              </td>
              {tipo === 'RECEBIDAS' ? (
                <>
                  <td className="px-4 py-2.5">{n.emitente}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-slate-600">{n.descricao}</td>
                </>
              ) : (
                <>
                  <td className="px-4 py-2.5">
                    {ROTULO_ORIGEM_NOTA[n.origem]}
                    {n.pedidoNumero !== null && <div className="text-xs text-slate-500">Pedido nº {n.pedidoNumero}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {n.tomador?.nome || 'Não identificado'}
                    {n.tomador?.documento && <div className="text-xs text-slate-500">{documentoFormatado(n.tomador.documento)}</div>}
                  </td>
                </>
              )}
              <td className="px-4 py-2.5 tabular-nums">{formatarCentavos(n.valorCentavos)}</td>
              <td className="px-4 py-2.5 text-xs text-slate-600">{formatarData(tipo === 'RECEBIDAS' ? n.emitidaEm : n.criadoEm)}</td>
              <td className="px-4 py-2.5">
                <Selo cor={COR[n.situacao]}>{ROTULO_SITUACAO_NOTA[n.situacao]}</Selo>
                {n.situacao === 'ERRO' && n.erro && <div className="mt-1 max-w-xs truncate text-xs text-red-700">{n.erro}</div>}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      {nova && <NovaAvulsa base={base} aoFechar={() => setNova(false)} aoCriar={(id) => { setNova(false); setAberta(id); }} />}
      {aberta && <DetalheNota base={base} id={aberta} podeEmitir={podeEmitir} aoFechar={() => setAberta(null)} />}
    </div>
  );
}

function NovaAvulsa({ base, aoFechar, aoCriar }: { base: string; aoFechar: () => void; aoCriar: (id: string) => void }) {
  const cliente = useQueryClient();
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const valorCentavos = centavosDe(valor.replace(/\./g, '').replace(',', '.'));
  const tomador = nome.trim() || documento.trim() ? { nome: nome.trim(), documento: documento.trim() || null, email: email.trim() || null } : null;
  const problema = !valorCentavos || valorCentavos <= 0 ? 'Informe o valor do serviço.' : problemaNoTomador(tomador);
  const criar = useMutation({
    mutationFn: () => api<NotaResumo>(`${base}/notas`, { metodo: 'POST', corpo: { tomador, descricao: descricao.trim() || null, valorCentavos } }),
    onSuccess: (n) => {
      void cliente.invalidateQueries({ queryKey: ['nfse-notas'] });
      aoCriar(n.id);
    },
  });
  return (
    <Modal titulo="Nova nota avulsa" aberto aoFechar={aoFechar}>
      <div className="space-y-3 text-sm">
        <Campo rotulo="Tomador (nome ou razão social)" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} />
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="CPF ou CNPJ" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={18} ajuda="Em branco: tomador não identificado." />
          <Campo rotulo="E-mail do tomador" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={80} />
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Descrição do serviço</span>
          <textarea className="h-24 w-full rounded-lg border border-slate-300 px-3 py-2" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={2000} placeholder="Em branco: a descrição padrão da configuração." />
        </label>
        <Campo rotulo="Valor do serviço (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        {(valor || nome || documento) && problema && <Alerta tipo="aviso">{problema}</Alerta>}
        {criar.error && <Alerta>{criar.error.message}</Alerta>}
        <Botao onClick={() => criar.mutate()} disabled={!!problema || criar.isPending}>
          {criar.isPending ? 'Enviando…' : 'Emitir nota'}
        </Botao>
      </div>
    </Modal>
  );
}

function DetalheNota({ base, id, podeEmitir, aoFechar }: { base: string; id: string; podeEmitir: boolean; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const nota = useQuery({
    queryKey: ['nfse-nota', base, id],
    queryFn: () => api<NotaResumo>(`${base}/notas/${id}`),
    refetchInterval: (q) => (q.state.data && ['PENDENTE', 'PROCESSANDO', 'CANCELANDO'].includes(q.state.data.situacao) ? 2_000 : false),
  });
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState<number>(1);
  const [texto, setTexto] = useState('');
  const atualizar = (n: NotaResumo) => {
    cliente.setQueryData(['nfse-nota', base, id], n);
    void cliente.invalidateQueries({ queryKey: ['nfse-notas'] });
  };
  const deNovo = useMutation({ mutationFn: () => api<NotaResumo>(`${base}/notas/${id}/emitir-de-novo`, { metodo: 'POST' }), onSuccess: atualizar });
  const cancelar = useMutation({
    mutationFn: () => api<NotaResumo>(`${base}/notas/${id}/cancelar`, { metodo: 'POST', corpo: { motivo, texto } }),
    onSuccess: (n) => {
      setCancelando(false);
      atualizar(n);
    },
  });
  const pdf = useMutation({ mutationFn: () => baixar(`${base}/notas/${id}/pdf`, `nfse-${nota.data?.numeroNfse ?? id}.pdf`) });
  const xml = useMutation({ mutationFn: () => baixar(`${base}/notas/${id}/xml`, `nfse-${nota.data?.numeroNfse ?? id}.xml`) });
  const n = nota.data;
  const problemaCancelar = problemaNoCancelamento(motivo, texto);
  return (
    <Modal titulo={n ? (n.numeroNfse ? `NFS-e nº ${n.numeroNfse}` : `Nota (DPS ${n.serie}/${n.numeroDps})`) : 'Nota fiscal'} aberto aoFechar={aoFechar} largo>
      {nota.error && <Alerta>{nota.error.message}</Alerta>}
      {n && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Selo cor={COR[n.situacao]}>{ROTULO_SITUACAO_NOTA[n.situacao]}</Selo>
            <span className="text-slate-500">{ROTULO_ORIGEM_NOTA[n.origem]}{n.pedidoNumero !== null && ` · pedido nº ${n.pedidoNumero}`}</span>
            {n.ambiente === 'PRODUCAO_RESTRITA' && <Selo cor="cinza">Sem valor fiscal (testes)</Selo>}
          </div>
          {n.situacao === 'ERRO' && n.erro && <Alerta>{n.erro}</Alerta>}
          {n.situacao === 'PENDENTE' && n.erro && <Alerta tipo="aviso">A Sefin não respondeu; o Flow tenta de novo sozinho. ({n.erro})</Alerta>}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Emitente</dt>
              <dd>{n.emitente}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Tomador</dt>
              <dd>
                {n.tomador?.nome || 'Não identificado'} {n.tomador?.documento && <span className="text-slate-500">· {documentoFormatado(n.tomador.documento)}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Valor</dt>
              <dd className="font-semibold">{formatarCentavos(n.valorCentavos)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Competência</dt>
              <dd>{dataBr(n.competencia)}</dd>
            </div>
            {n.chaveAcesso && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Chave de acesso</dt>
                <dd className="font-mono text-xs break-all" data-testid="chave-acesso">{n.chaveAcesso}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Serviço</dt>
              <dd className="whitespace-pre-wrap">{n.descricao}</dd>
            </div>
            {n.motivoCancelamento && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Motivo do cancelamento</dt>
                <dd>{n.motivoCancelamento}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            {n.chaveAcesso && (
              <>
                <Botao variante="secundario" onClick={() => pdf.mutate()} disabled={pdf.isPending}>
                  Baixar PDF (DANFSe)
                </Botao>
                <Botao variante="secundario" onClick={() => xml.mutate()} disabled={xml.isPending}>
                  Baixar XML
                </Botao>
              </>
            )}
            {podeEmitir && podeEmitirDeNovo(n.situacao) && (
              <Botao onClick={() => deNovo.mutate()} disabled={deNovo.isPending}>
                Emitir de novo
              </Botao>
            )}
            {podeEmitir && podeCancelarNota(n.situacao) && !cancelando && (
              <Botao variante="perigo" onClick={() => setCancelando(true)}>
                Cancelar nota
              </Botao>
            )}
          </div>
          {(pdf.error || xml.error || deNovo.error) && <Alerta>{(pdf.error ?? xml.error ?? deNovo.error)!.message}</Alerta>}
          {cancelando && (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-3">
              <p className="font-medium">Cancelar a NFS-e na Sefin Nacional</p>
              <p className="text-xs text-slate-600">O prazo e as condições para cancelar são do município. Depois de cancelada, a nota não volta.</p>
              <Selecao rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(Number(e.target.value))}>
                {MOTIVOS_CANCELAMENTO_NFSE.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.rotulo}
                  </option>
                ))}
              </Selecao>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Explique (de 15 a 255 letras)</span>
                <textarea className="h-20 w-full rounded-lg border border-slate-300 px-3 py-2" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={255} />
              </label>
              {texto && problemaCancelar && <Alerta tipo="aviso">{problemaCancelar}</Alerta>}
              {cancelar.error && <Alerta>{cancelar.error.message}</Alerta>}
              <div className="flex gap-2">
                <Botao variante="perigo" onClick={() => cancelar.mutate()} disabled={!!problemaCancelar || cancelar.isPending}>
                  {cancelar.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
                </Botao>
                <Botao variante="secundario" onClick={() => setCancelando(false)}>
                  Voltar
                </Botao>
              </div>
            </div>
          )}
          {n.historico.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">Histórico</p>
              <ul className="space-y-0.5 text-xs text-slate-600">
                {n.historico.map((h, i) => (
                  <li key={i}>
                    {formatarData(h.em)} · {h.texto}
                    {h.autor && ` (${h.autor})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const VAZIO: DadosEmissorNfse = {
  ambiente: 'PRODUCAO_RESTRITA',
  cnpj: '',
  inscricaoMunicipal: '',
  razaoSocial: '',
  codigoMunicipio: '',
  regime: 'SIMPLES',
  regimeEspecial: 0,
  email: '',
  telefone: '',
  serie: '1',
  proximoNumero: 1,
  servico: { codigoTributacaoNacional: '', codigoTributacaoMunicipal: '', codigoNbs: '', descricao: '', aliquotaIss: null, issRetido: false, percentualTributos: null },
  automatico: {},
};

function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

function Configuracao({ base, plataforma, emissor }: { base: string; plataforma: boolean; emissor: EmissorNfseResumo | null }) {
  const cliente = useQueryClient();
  const [d, setD] = useState<DadosEmissorNfse>(VAZIO);
  const [aliquota, setAliquota] = useState('');
  const [tributos, setTributos] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  useEffect(() => {
    if (!emissor) return;
    const { certificado: _c, diasParaVencer: _d, problema: _p, ...dados } = emissor;
    setD(dados);
    setAliquota(dados.servico.aliquotaIss != null ? String(dados.servico.aliquotaIss).replace('.', ',') : '');
    setTributos(dados.servico.percentualTributos != null ? String(dados.servico.percentualTributos).replace('.', ',') : '');
  }, [emissor]);
  const num = (t: string) => (t.trim() ? Number(t.replace(',', '.')) : null);
  const dados: DadosEmissorNfse = { ...d, servico: { ...d.servico, aliquotaIss: num(aliquota), percentualTributos: num(tributos) } };
  const problema = problemaNoEmissor(dados);
  const recarregar = (e: EmissorNfseResumo) => cliente.setQueryData(['nfse-emissor', base], { emissor: e });
  const salvar = useMutation({ mutationFn: () => api<EmissorNfseResumo>(`${base}/emissor`, { metodo: 'PUT', corpo: dados }), onSuccess: recarregar });
  const enviar = useMutation({
    mutationFn: async () => api<EmissorNfseResumo>(`${base}/emissor/certificado`, { metodo: 'POST', corpo: { arquivo: await lerComoBase64(arquivo!), senha } }),
    onSuccess: (e) => {
      setArquivo(null);
      setSenha('');
      recarregar(e);
    },
  });
  const remover = useMutation({ mutationFn: () => api<EmissorNfseResumo>(`${base}/emissor/certificado`, { metodo: 'DELETE' }), onSuccess: recarregar });
  const s = d.servico;
  const mudarServico = (m: Partial<typeof s>) => setD({ ...d, servico: { ...s, ...m } });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-display text-base font-bold">Dados fiscais do emissor</h2>
        <Selecao rotulo="Ambiente" value={d.ambiente} onChange={(e) => setD({ ...d, ambiente: e.target.value as DadosEmissorNfse['ambiente'] })}>
          {AMBIENTES_NFSE.map((a) => (
            <option key={a} value={a}>
              {ROTULO_AMBIENTE_NFSE[a]}
            </option>
          ))}
        </Selecao>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="CNPJ" value={d.cnpj} onChange={(e) => setD({ ...d, cnpj: e.target.value })} maxLength={18} />
          <Campo rotulo="Inscrição municipal" value={d.inscricaoMunicipal ?? ''} onChange={(e) => setD({ ...d, inscricaoMunicipal: e.target.value })} maxLength={15} />
        </div>
        <Campo rotulo="Razão social" value={d.razaoSocial} onChange={(e) => setD({ ...d, razaoSocial: e.target.value })} maxLength={150} />
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Código do município (IBGE)" value={d.codigoMunicipio} onChange={(e) => setD({ ...d, codigoMunicipio: e.target.value.replace(/\D/g, '') })} maxLength={7} ajuda="7 dígitos, ex.: 3550308 (São Paulo)." />
          <Selecao rotulo="Regime tributário" value={d.regime} onChange={(e) => setD({ ...d, regime: e.target.value as DadosEmissorNfse['regime'], regimeEspecial: 0 })}>
            {REGIMES_NFSE.map((r) => (
              <option key={r} value={r}>
                {ROTULO_REGIME_NFSE[r]}
              </option>
            ))}
          </Selecao>
        </div>
        {d.regime === 'NORMAL' && (
          <Selecao rotulo="Regime especial" value={d.regimeEspecial ?? 0} onChange={(e) => setD({ ...d, regimeEspecial: Number(e.target.value) })}>
            {REGIMES_ESPECIAIS_NFSE.map((r) => (
              <option key={r.codigo} value={r.codigo}>
                {r.rotulo}
              </option>
            ))}
          </Selecao>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="E-mail (opcional)" type="email" value={d.email ?? ''} onChange={(e) => setD({ ...d, email: e.target.value })} maxLength={80} />
          <Campo rotulo="Telefone (opcional)" value={d.telefone ?? ''} onChange={(e) => setD({ ...d, telefone: e.target.value })} maxLength={20} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Série da DPS" value={d.serie} onChange={(e) => setD({ ...d, serie: e.target.value.replace(/\D/g, '') })} maxLength={5} ajuda="De 1 a 49999." />
          <Campo rotulo="Próximo número da DPS" type="number" min={1} value={d.proximoNumero} onChange={(e) => setD({ ...d, proximoNumero: Number(e.target.value) })} ajuda="Ao trocar de ambiente, confira." />
        </div>

        <h3 className="pt-2 font-display font-bold">Serviço</h3>
        <div className="grid grid-cols-3 gap-3">
          <Campo rotulo="Código nacional" value={s.codigoTributacaoNacional} onChange={(e) => mudarServico({ codigoTributacaoNacional: e.target.value.replace(/\D/g, '') })} maxLength={6} ajuda="6 dígitos (LC 116)." />
          <Campo rotulo="Código municipal" value={s.codigoTributacaoMunicipal ?? ''} onChange={(e) => mudarServico({ codigoTributacaoMunicipal: e.target.value.replace(/\D/g, '') })} maxLength={3} ajuda="Se o município pede." />
          <Campo rotulo="NBS" value={s.codigoNbs ?? ''} onChange={(e) => mudarServico({ codigoNbs: e.target.value.replace(/\D/g, '') })} maxLength={9} ajuda="9 dígitos, opcional." />
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Descrição padrão do serviço</span>
          <textarea className="h-20 w-full rounded-lg border border-slate-300 px-3 py-2" value={s.descricao} onChange={(e) => mudarServico({ descricao: e.target.value })} maxLength={2000} placeholder={plataforma ? 'Ex.: Licença de uso do sistema Flow' : 'Ex.: Serviço de entrega'} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Alíquota do ISS (%)" inputMode="decimal" value={aliquota} onChange={(e) => setAliquota(e.target.value)} disabled={d.regime === 'MEI'} ajuda="Só vai na nota do Simples com ISS retido; senão vale a do município." />
          <Campo rotulo="Tributos aproximados (%)" inputMode="decimal" value={tributos} onChange={(e) => setTributos(e.target.value)} disabled={d.regime === 'MEI'} ajuda="Lei 12.741; em branco, 0." />
        </div>
        {d.regime !== 'MEI' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!s.issRetido} onChange={(e) => mudarServico({ issRetido: e.target.checked })} />
            ISS retido pelo tomador
          </label>
        )}

        <h3 className="pt-2 font-display font-bold">Emissão automática</h3>
        {plataforma ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!d.automatico.mensalidade} onChange={(e) => setD({ ...d, automatico: { mensalidade: e.target.checked } })} />
            Emitir a nota da mensalidade ao registrar o pagamento em Cobrança
          </label>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!d.automatico.pedidos} onChange={(e) => setD({ ...d, automatico: { ...d.automatico, pedidos: e.target.checked } })} />
              Emitir a nota do pedido quando ele for concluído
            </label>
            <Selecao rotulo="Valor da nota do pedido" value={d.automatico.valorPedido ?? 'TAXA_ENTREGA'} onChange={(e) => setD({ ...d, automatico: { ...d.automatico, valorPedido: e.target.value as 'TAXA_ENTREGA' | 'TOTAL' } })}>
              <option value="TAXA_ENTREGA">Só a taxa de entrega (produtos vão em NF-e)</option>
              <option value="TOTAL">O total do pedido (quando o que vende é serviço)</option>
            </Selecao>
          </>
        )}
        <p className="text-xs text-slate-500">Só o que acontecer depois de ligar vira nota sozinho. O resto pode ser emitido pelo botão.</p>
        {problema && (d.cnpj || d.razaoSocial) && <Alerta tipo="aviso">{problema}</Alerta>}
        {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
        {salvar.isSuccess && !salvar.isPending && <Alerta tipo="info">Dados fiscais salvos.</Alerta>}
        <Botao onClick={() => salvar.mutate()} disabled={!!problema || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar dados fiscais'}
        </Botao>
      </section>

      <section className="space-y-3 self-start rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-display text-base font-bold">Certificado digital A1</h2>
        <p className="text-slate-600">O arquivo .pfx e a senha ficam cifrados e nunca voltam para o navegador. Ele assina as notas e identifica o emissor na Sefin Nacional.</p>
        {emissor?.certificado ? (
          <div className="rounded-lg bg-slate-50 p-3" data-testid="certificado-atual">
            <p className="font-medium">{emissor.certificado.titular}</p>
            <p className="text-slate-600">
              {emissor.certificado.documento && `${documentoFormatado(emissor.certificado.documento)} · `}
              válido até {emissor.certificado.validoAte ? new Date(emissor.certificado.validoAte).toLocaleDateString('pt-BR') : '—'}
            </p>
            <button type="button" className="mt-2 text-xs text-red-700 underline" onClick={() => remover.mutate()} disabled={remover.isPending}>
              Remover certificado
            </button>
          </div>
        ) : (
          <Alerta tipo="info">Nenhum certificado enviado.</Alerta>
        )}
        {!emissor && <Alerta tipo="aviso">Salve os dados fiscais antes de enviar o certificado.</Alerta>}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{emissor?.certificado ? 'Trocar pelo arquivo' : 'Arquivo do certificado'} (.pfx ou .p12)</span>
          <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} disabled={!emissor} data-testid="arquivo-certificado" />
        </label>
        <Campo rotulo="Senha do certificado" type="password" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} disabled={!emissor} />
        {enviar.error && <Alerta>{enviar.error.message}</Alerta>}
        <Botao onClick={() => enviar.mutate()} disabled={!emissor || !arquivo || !senha || enviar.isPending}>
          {enviar.isPending ? 'Enviando…' : 'Enviar certificado'}
        </Botao>
      </section>
    </div>
  );
}
