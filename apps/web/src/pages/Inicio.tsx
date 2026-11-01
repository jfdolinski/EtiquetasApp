import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatarCnpj, PERIODOS_PAINEL, textoDuracao, type PainelEmpresa, type PainelPlataformaLinha } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Cabecalho, Selo, Tabela, formatarData } from '../components/ui';

const ROTULO_PERIODO: Record<number, string> = { 1: 'Hoje', 7: '7 dias', 30: '30 dias' };
const ROTULO_ORIGEM: Record<string, string> = { LISTA: 'Lista do dia', AVULSA: 'Avulsa', AGENDAMENTO: 'Agendamento' };
const ROTULO_CONEXAO: Record<string, string> = { POSTGRES: 'PostgreSQL', MYSQL: 'MySQL', SQLSERVER: 'SQL Server', PASTA: 'Pasta de planilhas', GOOGLE_DRIVE: 'Google Drive' };

const numero = (n: number) => n.toLocaleString('pt-BR');
const tempoMs = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const desde = (iso: string | null) => (iso ? `há ${textoDuracao(Date.now() - new Date(iso).getTime())}` : 'nunca');

export function Inicio() {
  const { usuario, empresaId, pode } = useAuth();
  const [dias, setDias] = useState<number>(7);
  if (!usuario) return null;

  const verEmpresa = !!empresaId && pode('painel.ver');
  return (
    <>
      <Cabecalho
        titulo={`Olá, ${usuario.nome.split(' ')[0]}`}
        descricao={usuario.empresa ? `${usuario.empresa.nomeFantasia || usuario.empresa.razaoSocial} · CNPJ ${formatarCnpj(usuario.empresa.cnpj)}` : undefined}
        acoes={
          (verEmpresa || usuario.superAdmin) && (
            <div className="flex gap-1" role="group" aria-label="Período">
              {PERIODOS_PAINEL.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={dias === p}
                  onClick={() => setDias(p)}
                  className={`rounded-md px-3 py-1.5 text-sm ring-1 ${dias === p ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
                >
                  {ROTULO_PERIODO[p]}
                </button>
              ))}
            </div>
          )
        }
      />
      <div className="space-y-6">
        {usuario.superAdmin && <VisaoPlataforma dias={dias} />}
        {verEmpresa && <PainelDaEmpresa dias={dias} />}
        {!verEmpresa && !usuario.superAdmin && <p className="text-sm text-slate-500">Use o menu ao lado para começar. O painel técnico aparece para quem tem a permissão de vê-lo.</p>}
      </div>
    </>
  );
}

function Cartao({ titulo, valor, detalhe, alerta, para }: { titulo: string; valor: ReactNode; detalhe?: ReactNode; alerta?: boolean; para?: string }) {
  const conteudo = (
    <>
      <div className="text-xs font-medium text-slate-500">{titulo}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? 'text-red-700' : 'text-slate-900'}`}>{valor}</div>
      {detalhe && <div className="mt-1 text-xs text-slate-500">{detalhe}</div>}
    </>
  );
  const classe = 'block rounded-lg border border-slate-200 bg-white p-4';
  return para ? <Link to={para} className={`${classe} hover:border-blue-300`}>{conteudo}</Link> : <div className={classe}>{conteudo}</div>;
}

function Bloco({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Grafico({ dias }: { dias: PainelEmpresa['impressao']['porDia'] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const maximo = Math.max(1, ...dias.map((d) => d.etiquetas));
  const total = dias.reduce((s, d) => s + d.etiquetas, 0);
  if (total === 0) return <p className="py-8 text-center text-sm text-slate-500">Nenhuma etiqueta concluída no período.</p>;
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const atual = foco === null ? null : dias[foco];
  return (
    <figure>
      <div className="mb-1 h-5 text-xs text-slate-600" aria-live="polite">
        {atual ? `${dia(atual.dia)}: ${numero(atual.etiquetas)} etiqueta(s)` : `Pico de ${numero(maximo)} etiquetas por dia`}
      </div>
      <div className="flex h-36 items-end gap-0.5 border-b border-slate-200" role="img" aria-label={`Etiquetas concluídas por dia, total ${numero(total)}`} onMouseLeave={() => setFoco(null)}>
        {dias.map((d, i) => (
          // A área de passar o mouse é a coluna inteira, maior que a barra.
          <div key={d.dia} className="flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setFoco(i)}>
            <div className={`w-full max-w-6 rounded-t ${foco === i ? 'bg-blue-800' : 'bg-blue-600'}`} style={{ height: d.etiquetas ? `${Math.max(2, (d.etiquetas / maximo) * 100)}%` : 0 }} />
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{dia(dias[0].dia)}</span>
        <span>{dia(dias[dias.length - 1].dia)}</span>
      </figcaption>
    </figure>
  );
}

function Linhas({ itens, vazio }: { itens: { rotulo: string; valor: string; alerta?: boolean }[]; vazio?: string }) {
  if (itens.length === 0) return <p className="text-sm text-slate-500">{vazio ?? 'Nada no período.'}</p>;
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {itens.map((i) => (
        <div key={i.rotulo} className="flex justify-between gap-3 py-1.5">
          <dt className="min-w-0 truncate text-slate-600" title={i.rotulo}>{i.rotulo}</dt>
          <dd className={`shrink-0 font-medium tabular-nums ${i.alerta ? 'text-red-700' : ''}`}>{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function PainelDaEmpresa({ dias }: { dias: number }) {
  const { empresaId } = useAuth();
  const { data: p, isLoading, error } = useQuery({
    queryKey: ['painel', empresaId, dias],
    queryFn: () => api<PainelEmpresa>(`/painel?dias=${dias}`),
    refetchInterval: 60_000,
  });
  if (isLoading) return <div className="text-sm text-slate-500">Carregando…</div>;
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!p) return null;

  const { uso, impressao: imp, agentes, consultas: sql, cadastros: cad, listaHoje } = p;
  const semGerarMs = uso.ultimaEm ? Date.now() - new Date(uso.ultimaEm).getTime() : null;
  const parado = semGerarMs === null || semGerarMs > 24 * 3_600_000;
  const taxaFalhas = sql.execucoes ? Math.round((sql.falhas / sql.execucoes) * 100) : 0;
  const hojeTexto = ROTULO_PERIODO[dias].toLowerCase();
  const sufixo = dias === 1 ? 'hoje' : `em ${hojeTexto}`;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo="Tempo sem gerar etiquetas"
          valor={semGerarMs === null ? 'Nunca gerou' : textoDuracao(semGerarMs)}
          alerta={parado}
          detalhe={uso.ultimaEm ? `Última: ${uso.ultimoModelo}${uso.ultimoAutor ? `, por ${uso.ultimoAutor}` : ''}. Feita por pessoa: ${desde(uso.ultimaManualEm)}.` : 'Nenhum trabalho de impressão até agora.'}
          para="/historico"
        />
        <Cartao titulo={`Etiquetas impressas ${sufixo}`} valor={numero(imp.etiquetasConcluidas)} detalhe={`${numero(imp.trabalhosConcluidos)} trabalho(s) · hoje ${numero(imp.etiquetasHoje)}`} para="/historico" />
        <Cartao titulo="Pendentes de impressão" valor={numero(imp.trabalhosPendentes)} alerta={imp.trabalhosPendentes > 0} detalhe={`${numero(imp.etiquetasPendentes)} etiqueta(s) na fila · ${numero(listaHoje.pendentes)} produto(s) na lista de hoje`} para="/hoje" />
        <Cartao titulo={`Trabalhos com erro ${sufixo}`} valor={numero(imp.trabalhosComErro)} alerta={imp.trabalhosComErro > 0} detalhe={`${numero(imp.trabalhosCancelados)} cancelado(s)`} para="/historico" />
        <Cartao titulo="Agentes online / offline" valor={`${agentes.online} / ${agentes.offline}`} alerta={agentes.offline > 0} detalhe={agentes.aguardandoAtivacao ? `${agentes.aguardandoAtivacao} aguardando ativação` : undefined} para="/agentes" />
        <Cartao titulo={`Tempo médio dos SQL ${sufixo}`} valor={tempoMs(sql.mediaMs)} detalhe={`95% até ${tempoMs(sql.p95Ms)} · maior ${tempoMs(sql.maximoMs)}`} para="/consultas" />
        <Cartao titulo="Agendamentos automáticos / manuais" valor={`${cad.agendamentos.automaticos} / ${cad.agendamentos.manuais}`} alerta={cad.agendamentos.comFalha > 0} detalhe={`${cad.agendamentos.comFalha} com falha · ${cad.agendamentos.inativos} desligado(s)`} para="/agendamentos" />
        <Cartao titulo="Notificações em aberto" valor={numero(p.notificacoesAbertas)} alerta={p.notificacoesAbertas > 0} detalhe="Problemas avisados e ainda sem solução" para="/notificacoes" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Bloco titulo={`Etiquetas concluídas por dia (${hojeTexto})`}>
            {dias === 1 ? <p className="py-8 text-center text-2xl font-semibold tabular-nums">{numero(imp.etiquetasHoje)} <span className="text-sm font-normal text-slate-500">etiqueta(s) hoje</span></p> : <Grafico dias={imp.porDia} />}
          </Bloco>
        </div>
        <Bloco titulo="Por origem">
          <Linhas itens={imp.porOrigem.map((o) => ({ rotulo: ROTULO_ORIGEM[o.origem] ?? o.origem, valor: numero(o.etiquetas) }))} />
        </Bloco>
      </div>

      <Bloco titulo={`Uso por usuário (${hojeTexto})`} acao={<span className="text-xs text-slate-500">Quem está há mais tempo sem imprimir vem primeiro. Agendamento não conta.</span>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">Usuário</th>
                <th className="px-3 py-2 text-right font-medium">Etiquetas</th>
                <th className="px-3 py-2 text-right font-medium">Trabalhos</th>
                <th className="px-3 py-2 font-medium">Última impressão</th>
                <th className="px-3 py-2 font-medium">Último acesso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3">
                    {u.nome} {u.etiquetas === 0 && <Selo cor="amarelo">Sem uso no período</Selo>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{numero(u.etiquetas)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{numero(u.trabalhos)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{desde(u.ultimaImpressaoEm)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{desde(u.ultimoLoginEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloco>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo={`Consultas SQL (${hojeTexto})`} acao={<span className={`text-xs ${taxaFalhas ? 'text-red-700' : 'text-slate-500'}`}>{numero(sql.execucoes)} execuções · {sql.falhas} falha(s){sql.execucoes ? ` (${taxaFalhas}%)` : ''}</span>}>
          {sql.maisLentas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma consulta executada no período. A medição começou com esta versão.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-2 pr-3 font-medium">Mais lentas</th>
                    <th className="px-2 py-2 text-right font-medium">Média</th>
                    <th className="px-2 py-2 text-right font-medium">Maior</th>
                    <th className="px-2 py-2 text-right font-medium">Vezes</th>
                    <th className="pl-2 py-2 text-right font-medium">Falhas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sql.maisLentas.map((c) => (
                    <tr key={c.nome}>
                      <td className="max-w-56 truncate py-1.5 pr-3" title={c.nome}>{c.nome}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{tempoMs(c.execucoes ? c.mediaMs : null)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{tempoMs(c.execucoes ? c.maximoMs : null)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{numero(c.execucoes)}</td>
                      <td className={`pl-2 py-1.5 text-right tabular-nums ${c.falhas ? 'font-medium text-red-700' : ''}`}>{numero(c.falhas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sql.ultimaFalha && <p className="mt-2 text-xs text-slate-500">Última falha: {sql.ultimaFalha.nome}, {formatarData(sql.ultimaFalha.em)}. {sql.ultimaFalha.erro.slice(0, 160)}</p>}
        </Bloco>

        <Bloco titulo="Agentes">
          {agentes.lista.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum agente ativado.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {agentes.lista.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{a.nome}</span>
                    <span className="block text-xs text-slate-500">{[a.hostname, a.versao && `versão ${a.versao}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  {a.online ? <Selo cor="verde">Online</Selo> : <Selo cor="vermelho">Offline {desde(a.ultimoContatoEm)}</Selo>}
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Bloco titulo="Modelos de etiqueta">
          <Linhas
            itens={[
              { rotulo: 'Cadastrados e ativos', valor: numero(cad.modelos.ativos) },
              { rotulo: 'Na lista do dia', valor: numero(cad.modelos.naLista) },
              { rotulo: 'Sem impressora', valor: numero(cad.modelos.semImpressora), alerta: cad.modelos.semImpressora > 0 },
              { rotulo: 'Sem consulta', valor: numero(cad.modelos.semConsulta) },
              { rotulo: 'Desativados', valor: numero(cad.modelos.inativos) },
            ]}
          />
        </Bloco>
        <Bloco titulo="Conexões configuradas">
          <Linhas
            itens={[
              { rotulo: 'Ativas', valor: numero(cad.conexoes.ativas) },
              ...cad.conexoes.porTipo.map((t) => ({ rotulo: ROTULO_CONEXAO[t.tipo] ?? t.tipo, valor: numero(t.quantidade) })),
              { rotulo: 'Consultas SQL ativas', valor: numero(sql.cadastradas) },
              { rotulo: 'Desativadas', valor: numero(cad.conexoes.inativas) },
            ]}
          />
        </Bloco>
        <Bloco titulo="Impressoras">
          <Linhas
            itens={[
              { rotulo: 'Ativas', valor: numero(cad.impressoras.ativas) },
              { rotulo: 'Sem uso no período', valor: numero(cad.impressoras.semUso), alerta: cad.impressoras.semUso > 0 },
              ...imp.porImpressora.map((i) => ({ rotulo: i.nome, valor: numero(i.etiquetas) + (i.erros ? ` · ${i.erros} erro(s)` : ''), alerta: i.erros > 0 })),
            ]}
          />
        </Bloco>
        <Bloco titulo="Hoje na lista do dia">
          <Linhas
            itens={[
              { rotulo: 'Pendentes', valor: numero(listaHoje.pendentes), alerta: listaHoje.pendentes > 0 },
              { rotulo: 'Na fila', valor: numero(listaHoje.naFila) },
              { rotulo: 'Impressos', valor: numero(listaHoje.impressos) },
              { rotulo: 'Descartados', valor: numero(listaHoje.descartados) },
              { rotulo: 'Produtos banidos', valor: numero(cad.banidos) },
            ]}
          />
        </Bloco>
      </div>

      {imp.porModelo.length > 0 && (
        <Bloco titulo={`Modelos mais impressos (${hojeTexto})`}>
          <Linhas itens={imp.porModelo.map((m) => ({ rotulo: m.nome, valor: `${numero(m.etiquetas)} etiqueta(s)` }))} />
        </Bloco>
      )}
    </>
  );
}

function VisaoPlataforma({ dias }: { dias: number }) {
  const { selecionarEmpresa } = useAuth();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['painel-plataforma', dias],
    queryFn: () => api<PainelPlataformaLinha[]>(`/painel/plataforma?dias=${dias}`),
    refetchInterval: 60_000,
  });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (isLoading) return <div className="text-sm text-slate-500">Carregando…</div>;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Uso por empresa ({ROTULO_PERIODO[dias].toLowerCase()})</h2>
      <p className="mb-2 text-xs text-slate-500">Quem está há mais tempo sem gerar etiquetas vem primeiro. Clique no nome para ver o painel da empresa.</p>
      <Tabela colunas={['Empresa', 'Última etiqueta', 'Etiquetas', 'Erros', 'Agentes online', 'Último acesso', 'Assinatura']} vazio={data.length === 0}>
        {data.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2.5">
              <button type="button" className="text-left text-blue-700 hover:underline" onClick={() => selecionarEmpresa(e.id)}>{e.nome}</button>
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">{desde(e.ultimaEtiquetaEm)}</td>
            <td className="px-4 py-2.5 tabular-nums">{numero(e.etiquetas)}</td>
            <td className={`px-4 py-2.5 tabular-nums ${e.trabalhosComErro ? 'font-medium text-red-700' : ''}`}>{numero(e.trabalhosComErro)}</td>
            <td className="px-4 py-2.5 tabular-nums">{e.agentesOnline} de {e.agentesTotal}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{desde(e.ultimoLoginEm)}</td>
            <td className="px-4 py-2.5 text-slate-600">{e.statusAssinatura}</td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
