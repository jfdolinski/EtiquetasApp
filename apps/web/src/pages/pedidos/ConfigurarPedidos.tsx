import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  caminhoCatalogo,
  centavosDe,
  colunasSugeridasPedidos,
  DIAS_SEMANA,
  DURACOES_FAIXA,
  formatarCentavos,
  LIMITES_PEDIDOS,
  MAX_PERIODOS_POR_DIA,
  MODALIDADES_ENTREGA,
  problemaNaConfigPedidos,
  problemaNoHorario,
  problemaNosPrazosPedidos,
  ROTULO_MODALIDADE,
  ROTULO_SITUACAO_CATALOGO,
  type ColunasCatalogo,
  type ConfigPedidos,
  type ConfiguracaoPedidosResumo,
  type ConsultaParaPedidos,
  type HorarioFuncionamento,
  type ModalidadeEntrega,
  type PreviaCatalogo,
  type SalvarConfiguracaoPedidos,
  type SituacaoCatalogo,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, Selecao, Selo, formatarData } from '../../components/ui';

const COR_SITUACAO: Record<SituacaoCatalogo, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  DESLIGADO: 'cinza',
  SEM_DADOS: 'vermelho',
  DADOS_VENCIDOS: 'vermelho',
  NO_AR: 'verde',
};

const COLUNAS: { chave: keyof ColunasCatalogo; rotulo: string; obrigatoria?: boolean; ajuda?: string }[] = [
  { chave: 'colunaCodigo', rotulo: 'Código do produto', obrigatoria: true },
  { chave: 'colunaNome', rotulo: 'Nome', obrigatoria: true },
  { chave: 'colunaPreco', rotulo: 'Preço', obrigatoria: true },
  { chave: 'colunaPrecoDe', rotulo: 'Preço anterior', ajuda: 'Aparece riscado quando é maior que o preço.' },
  { chave: 'colunaUnidade', rotulo: 'Unidade', ajuda: 'Como kg, un ou cx.' },
  { chave: 'colunaCategoria', rotulo: 'Categoria', ajuda: 'Vira as abas do catálogo.' },
  { chave: 'colunaEstoque', rotulo: 'Estoque', ajuda: 'Só aparece quem tem estoque, e o cliente não pede mais do que há.' },
  { chave: 'colunaCodigoBarras', rotulo: 'Código de barras', ajuda: 'Para as fotos e a folha de lançamento. Sem ela, vale o código.' },
];

/** O formulário guarda o dinheiro como o texto digitado; vira centavos só ao conferir e salvar. */
interface Formulario {
  ativo: boolean;
  consultaId: string;
  colunas: ColunasCatalogo;
  comFotos: boolean;
  minimo: string;
  modalidades: Record<ModalidadeEntrega, { ativa: boolean; preco: string }>;
  mensagem: string;
  enderecoRetirada: string;
  intervalo: string;
  validade: string;
  horario: HorarioFuncionamento;
  agDias: string;
  agDuracao: number;
}

const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');

function formularioDe(c: ConfiguracaoPedidosResumo): Formulario {
  const { config: k } = c;
  return {
    ativo: c.ativo,
    consultaId: c.consultaId ?? '',
    colunas: { colunaCodigo: k.colunaCodigo, colunaNome: k.colunaNome, colunaPreco: k.colunaPreco, colunaPrecoDe: k.colunaPrecoDe, colunaUnidade: k.colunaUnidade, colunaCategoria: k.colunaCategoria, colunaEstoque: k.colunaEstoque, colunaCodigoBarras: k.colunaCodigoBarras },
    comFotos: k.comFotos,
    minimo: k.pedidoMinimoCentavos ? reais(k.pedidoMinimoCentavos) : '',
    modalidades: Object.fromEntries(MODALIDADES_ENTREGA.map((m) => [m, { ativa: k.modalidades[m].ativa, preco: reais(k.modalidades[m].precoCentavos) }])) as Formulario['modalidades'],
    mensagem: k.mensagem,
    enderecoRetirada: k.enderecoRetirada,
    intervalo: String(c.intervaloMinutos),
    validade: String(c.validadeMinutos),
    horario: c.horario,
    agDias: String(k.agendamento?.dias ?? 7),
    agDuracao: k.agendamento?.duracaoMinutos ?? 120,
  };
}

/** Dinheiro vazio vale zero; texto que não é número vira -1, e a conferência recusa. */
const centavosDoCampo = (t: string) => (t.trim() === '' ? 0 : (centavosDe(t.trim()) ?? -1));

function corpoDe(f: Formulario): SalvarConfiguracaoPedidos {
  const config: ConfigPedidos = {
    ...f.colunas,
    comFotos: f.comFotos,
    pedidoMinimoCentavos: f.minimo.trim() ? centavosDoCampo(f.minimo) : null,
    modalidades: Object.fromEntries(MODALIDADES_ENTREGA.map((m) => [m, { ativa: f.modalidades[m].ativa, precoCentavos: f.modalidades[m].ativa ? centavosDoCampo(f.modalidades[m].preco) : 0 }])) as ConfigPedidos['modalidades'],
    mensagem: f.mensagem,
    enderecoRetirada: f.enderecoRetirada,
    agendamento: { dias: Number(f.agDias), duracaoMinutos: f.agDuracao },
  };
  return { ativo: f.ativo, consultaId: f.consultaId, config, intervaloMinutos: Number(f.intervalo), validadeMinutos: Number(f.validade), horario: f.horario };
}

export function ConfigurarPedidos() {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const chave = ['pedidos-configuracao', empresaId];
  const { data: atual, error } = useQuery({ queryKey: chave, queryFn: () => api<ConfiguracaoPedidosResumo>('/pedidos/configuracao') });
  const { data: consultas = [] } = useQuery({ queryKey: ['pedidos-consultas', empresaId], queryFn: () => api<ConsultaParaPedidos[]>('/pedidos/configuracao/consultas') });
  const [f, setF] = useState<Formulario | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    if (atual && !f) setF(formularioDe(atual));
  }, [atual, f]);

  const aplicar = (c: ConfiguracaoPedidosResumo) => {
    cliente.setQueryData(chave, c);
    setF(formularioDe(c));
  };
  const salvar = useMutation({
    mutationFn: (corpo: SalvarConfiguracaoPedidos) => api<ConfiguracaoPedidosResumo>('/pedidos/configuracao', { metodo: 'PUT', corpo }),
    onSuccess: (c) => {
      aplicar(c);
      setMensagem(c.erro ? 'Configuração salva, mas a leitura dos produtos falhou: veja o motivo no quadro Situação.' : 'Configuração salva.');
    },
  });
  const novoLink = useMutation({ mutationFn: () => api<ConfiguracaoPedidosResumo>('/pedidos/configuracao/novo-link', { metodo: 'POST' }), onSuccess: (c) => cliente.setQueryData(chave, c) });
  const atualizar = useMutation({ mutationFn: () => api<ConfiguracaoPedidosResumo>('/pedidos/configuracao/atualizar', { metodo: 'POST' }), onSuccess: (c) => cliente.setQueryData(chave, c) });
  const previa = useMutation({ mutationFn: (x: { consultaId: string; colunas: ColunasCatalogo }) => api<PreviaCatalogo>('/pedidos/configuracao/previa', { metodo: 'POST', corpo: x }) });

  const consulta = consultas.find((c) => c.id === f?.consultaId);
  const colunasDaConsulta = useMemo(() => (previa.data?.colunas.length ? previa.data.colunas : (consulta?.colunas ?? [])), [previa.data, consulta]);

  if (error) return <Alerta>{(error as Error).message}</Alerta>;
  if (!atual || !f) return <p className="text-sm text-slate-500">Carregando…</p>;

  const mudar = (parte: Partial<Formulario>) => {
    setMensagem(null);
    setF({ ...f, ...parte });
  };
  const corpo = corpoDe(f);
  const problema = !f.consultaId ? 'Escolha a consulta dos produtos.' : (problemaNaConfigPedidos(corpo.config) ?? problemaNosPrazosPedidos(corpo.intervaloMinutos, corpo.validadeMinutos) ?? problemaNoHorario(f.horario));
  const semHorario = f.horario.every((d) => d.length === 0);
  const link = atual.codigoLink ? `${window.location.origin}${caminhoCatalogo(atual.codigoLink)}` : null;

  const escolherConsulta = (id: string) => {
    const c = consultas.find((x) => x.id === id);
    previa.reset();
    // As colunas conhecidas vêm sugeridas; o que já foi escolhido e existe na consulta nova fica.
    const sugeridas = colunasSugeridasPedidos(c?.colunas ?? []);
    const colunas = Object.fromEntries(Object.entries(f.colunas).map(([k, v]) => [k, v && c?.colunas.includes(v) ? v : sugeridas[k as keyof ColunasCatalogo]])) as unknown as ColunasCatalogo;
    mudar({ consultaId: id, colunas });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problema) salvar.mutate(corpo);
        }}
      >
        <Secao titulo="Catálogo">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={f.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-900">Receber pedidos pelo link</span>
              <span className="mt-0.5 block text-xs text-slate-500">Desligado, quem abrir o link vê “catálogo indisponível”.</span>
            </span>
          </label>
          <Campo rotulo="Mensagem de boas-vindas" value={f.mensagem} maxLength={LIMITES_PEDIDOS.mensagem} placeholder="Pedidos até as 17h saem no mesmo dia" onChange={(e) => mudar({ mensagem: e.target.value })} />
        </Secao>

        <Secao titulo="Produtos">
          <Selecao rotulo="Consulta" value={f.consultaId} onChange={(e) => escolherConsulta(e.target.value)}>
            <option value="">Escolher…</option>
            {consultas.map((c) => (
              <option key={c.id} value={c.id} disabled={c.pedeParametro}>{c.nome}{c.pedeParametro ? ' (pede valores digitados)' : ''}</option>
            ))}
          </Selecao>
          {f.consultaId && colunasDaConsulta.length === 0 && <p className="text-xs text-amber-700">As colunas desta consulta ainda não foram lidas. Clique em “Ler a consulta agora”.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {COLUNAS.map(({ chave: k, rotulo, obrigatoria, ajuda }) => (
              <div key={k}>
                <Selecao rotulo={obrigatoria ? rotulo : `${rotulo} (opcional)`} value={f.colunas[k] ?? ''} onChange={(e) => mudar({ colunas: { ...f.colunas, [k]: e.target.value || (obrigatoria ? '' : null) } })}>
                  <option value="">{obrigatoria ? 'Escolher…' : 'Nenhuma'}</option>
                  {[...new Set([...(f.colunas[k] ? [f.colunas[k] as string] : []), ...colunasDaConsulta])].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Selecao>
                {ajuda && <p className="mt-1 text-xs text-slate-500">{ajuda}</p>}
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={f.comFotos} onChange={(e) => mudar({ comFotos: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-900">Mostrar a foto dos produtos</span>
              <span className="mt-0.5 block text-xs text-slate-500">As fotos vêm do catálogo, pelo código de barras, e são as mesmas das telas. Cada busca conta no consumo da empresa no catálogo.</span>
            </span>
          </label>
          <div>
            <Botao variante="secundario" disabled={!f.consultaId || previa.isPending} onClick={() => previa.mutate({ consultaId: f.consultaId, colunas: f.colunas })}>
              {previa.isPending ? 'Lendo…' : 'Ler a consulta agora'}
            </Botao>
          </div>
          {previa.error && <Alerta>{(previa.error as Error).message}</Alerta>}
          {previa.data && <ResultadoPrevia previa={previa.data} />}
        </Secao>

        <Secao titulo="Entrega e pedido mínimo">
          <div className="space-y-2">
            {MODALIDADES_ENTREGA.map((m) => (
              <div key={m} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-2.5">
                <label className="flex min-w-[220px] flex-1 items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={f.modalidades[m].ativa} onChange={(e) => mudar({ modalidades: { ...f.modalidades, [m]: { ...f.modalidades[m], ativa: e.target.checked } } })} />
                  <span>
                    <span className="font-medium text-slate-900">{ROTULO_MODALIDADE[m].titulo}</span>
                    <span className="block text-xs text-slate-500">{ROTULO_MODALIDADE[m].ajuda}</span>
                  </span>
                </label>
                {f.modalidades[m].ativa && (
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    Taxa R$
                    <input aria-label={`Taxa de ${ROTULO_MODALIDADE[m].titulo}`} inputMode="decimal" className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={f.modalidades[m].preco} onChange={(e) => mudar({ modalidades: { ...f.modalidades, [m]: { ...f.modalidades[m], preco: e.target.value } } })} />
                  </label>
                )}
              </div>
            ))}
          </div>
          {f.modalidades.AGENDADA.ativa && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Agendar até quantos dias à frente" type="number" min={1} max={30} value={f.agDias} onChange={(e) => mudar({ agDias: e.target.value })} />
              <Selecao rotulo="Tamanho de cada faixa de horário" value={f.agDuracao} onChange={(e) => mudar({ agDuracao: Number(e.target.value) })}>
                {DURACOES_FAIXA.map((d) => (
                  <option key={d} value={d}>{d < 60 ? `${d} minutos` : d === 60 ? '1 hora' : `${d / 60} horas`}</option>
                ))}
              </Selecao>
            </div>
          )}
          {f.modalidades.RETIRADA.ativa && <Campo rotulo="Endereço para retirada" value={f.enderecoRetirada} maxLength={LIMITES_PEDIDOS.enderecoRetirada} placeholder="Rua das Flores, 100 – Centro" onChange={(e) => mudar({ enderecoRetirada: e.target.value })} />}
          <Campo rotulo="Pedido mínimo (R$, opcional)" inputMode="decimal" value={f.minimo} placeholder="Sem mínimo" onChange={(e) => mudar({ minimo: e.target.value })} ajuda="Conta só os produtos, sem a taxa de entrega." />
        </Secao>

        <Secao titulo="Horário de funcionamento">
          <p className="text-xs text-slate-500">Fora do horário, o catálogo fica só para olhar, e só a entrega agendada continua aceitando pedidos.</p>
          <EditorHorario horario={f.horario} aoMudar={(horario) => mudar({ horario })} />
          {semHorario && <p className="text-xs text-amber-700">Sem horário cadastrado, a loja aparece sempre fechada: só a entrega agendada recebe pedidos.</p>}
        </Secao>

        <Secao titulo="Atualização dos produtos">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Atualizar a cada (minutos)" type="number" min={LIMITES_PEDIDOS.intervaloMinutos[0]} max={LIMITES_PEDIDOS.intervaloMinutos[1]} value={f.intervalo} onChange={(e) => mudar({ intervalo: e.target.value })} ajuda="Cada atualização consulta o banco do sistema." />
            <Campo rotulo="Validade (minutos)" type="number" min={LIMITES_PEDIDOS.validadeMinutos[0]} max={LIMITES_PEDIDOS.validadeMinutos[1]} value={f.validade} onChange={(e) => mudar({ validade: e.target.value })} ajuda="Passou disso sem atualizar, o catálogo sai do ar para não mostrar preço velho." />
          </div>
        </Secao>

        {problema && <p className="text-sm text-amber-700">{problema}</p>}
        {salvar.error && <Alerta>{(salvar.error as Error).message}</Alerta>}
        {mensagem && <Alerta tipo={atual.erro ? 'aviso' : 'info'}>{mensagem}</Alerta>}
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => setF(formularioDe(atual))} disabled={salvar.isPending}>Desfazer mudanças</Botao>
          <Botao type="submit" disabled={!!problema || salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </form>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Situação</h3>
          <Selo cor={COR_SITUACAO[atual.situacao]}>{ROTULO_SITUACAO_CATALOGO[atual.situacao]}</Selo>
          <dl className="mt-3 space-y-1 text-sm text-slate-600">
            <div>{atual.quantidadeItens} produtos no catálogo</div>
            <div>Atualizado: {atual.dadosEm ? formatarData(atual.dadosEm) : 'nunca'}</div>
            {atual.consultaNome && <div>Consulta: {atual.consultaNome}</div>}
            {atual.responsavelNome && <div>Roda em nome de: {atual.responsavelNome}</div>}
          </dl>
          {atual.erro && <div className="mt-3"><Alerta tipo="aviso">Última atualização falhou: {atual.erro}</Alerta></div>}
          {atual.ativo && (
            <Botao variante="secundario" className="mt-3" disabled={atualizar.isPending} onClick={() => atualizar.mutate()}>
              {atualizar.isPending ? 'Atualizando…' : 'Atualizar agora'}
            </Botao>
          )}
          {atualizar.error && <div className="mt-2"><Alerta>{(atualizar.error as Error).message}</Alerta></div>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Link para os clientes</h3>
          {link ? (
            <>
              <a href={link} target="_blank" rel="noreferrer" className="block break-all rounded bg-slate-100 px-2 py-1.5 font-mono text-xs text-blue-700 hover:underline" data-testid="link-catalogo">{link}</a>
              <p className="mt-2 text-xs text-slate-500">O mesmo link para todos: mande no WhatsApp, no status ou na bio do Instagram.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Botao variante="secundario" onClick={() => void navigator.clipboard?.writeText(link)}>Copiar</Botao>
                <Botao
                  variante="secundario"
                  disabled={novoLink.isPending}
                  onClick={() => window.confirm('Gerar um link novo? O link atual para de funcionar na hora, inclusive onde você já divulgou.') && novoLink.mutate()}
                >
                  Gerar link novo
                </Botao>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">O link é criado quando você salva a configuração pela primeira vez.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function ResultadoPrevia({ previa }: { previa: PreviaCatalogo }) {
  const fora = [
    previa.descartados && `${previa.descartados} sem código, nome ou preço`,
    previa.semEstoque && `${previa.semEstoque} sem estoque`,
    previa.repetidos && `${previa.repetidos} com código repetido`,
    previa.banidos && `${previa.banidos} banidos`,
    previa.cortados && `${previa.cortados} além do limite`,
  ].filter(Boolean);
  return (
    <div className="rounded-md border border-slate-200">
      <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <strong>{previa.total}</strong> produtos entram no catálogo{fora.length ? `; ficaram de fora: ${fora.join(', ')}` : ''}.
      </p>
      {previa.itens.length > 0 && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Código</th>
                <th className="px-3 py-1.5 font-medium">Produto</th>
                <th className="px-3 py-1.5 font-medium">Categoria</th>
                <th className="px-3 py-1.5 text-right font-medium">Estoque</th>
                <th className="px-3 py-1.5 text-right font-medium">Preço</th>
              </tr>
            </thead>
            <tbody>
              {previa.itens.map((i) => (
                <tr key={i.codigo} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-mono">{i.codigo}</td>
                  <td className="px-3 py-1.5">{i.nome}{i.unidade ? ` (${i.unidade})` : ''}</td>
                  <td className="px-3 py-1.5">{i.categoria ?? ''}</td>
                  <td className="px-3 py-1.5 text-right">{i.estoque ?? ''}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {i.precoDeCentavos && <span className="mr-1 text-slate-400 line-through">{formatarCentavos(i.precoDeCentavos)}</span>}
                    {formatarCentavos(i.precoCentavos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EditorHorario({ horario, aoMudar }: { horario: HorarioFuncionamento; aoMudar: (h: HorarioFuncionamento) => void }) {
  const mudarDia = (d: number, periodos: HorarioFuncionamento[number]) => aoMudar(horario.map((x, i) => (i === d ? periodos : x)));
  // Seg a sex costumam ser iguais: copiar evita digitar cinco vezes.
  const copiarParaDiasUteis = (d: number) => aoMudar(horario.map((x, i) => (i >= 1 && i <= 5 ? horario[d].map((p) => ({ ...p })) : x)));
  return (
    <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {DIAS_SEMANA.map((nome, d) => (
        <div key={nome} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="w-20 font-medium text-slate-700">{nome}</span>
          {horario[d].length === 0 && <span className="text-slate-400">Fechado</span>}
          {horario[d].map((p, n) => (
            <span key={n} className="flex items-center gap-1">
              <input type="time" aria-label={`${nome}, período ${n + 1}, início`} className="rounded-md border border-slate-300 px-1.5 py-1" value={p.inicio} onChange={(e) => mudarDia(d, horario[d].map((x, i) => (i === n ? { ...x, inicio: e.target.value } : x)))} />
              até
              <input type="time" aria-label={`${nome}, período ${n + 1}, fim`} className="rounded-md border border-slate-300 px-1.5 py-1" value={p.fim} onChange={(e) => mudarDia(d, horario[d].map((x, i) => (i === n ? { ...x, fim: e.target.value } : x)))} />
              <button type="button" aria-label={`Tirar o período ${n + 1} de ${nome}`} className="px-1 text-slate-400 hover:text-red-600" onClick={() => mudarDia(d, horario[d].filter((_, i) => i !== n))}>✕</button>
            </span>
          ))}
          <span className="ml-auto flex gap-2">
            {horario[d].length < MAX_PERIODOS_POR_DIA && (
              <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => mudarDia(d, [...horario[d], horario[d].length ? { inicio: '14:00', fim: '18:00' } : { inicio: '08:00', fim: '18:00' }])}>
                {horario[d].length ? '+ período' : 'Abrir neste dia'}
              </button>
            )}
            {d >= 1 && d <= 5 && horario[d].length > 0 && (
              <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => copiarParaDiasUteis(d)}>Copiar para seg a sex</button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
