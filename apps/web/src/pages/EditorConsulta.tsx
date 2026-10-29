import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ehParametro,
  extrairPlaceholders,
  FINALIDADES_CONSULTA,
  PLACEHOLDERS,
  PREFIXO_PARAMETRO,
  ROTULO_CATEGORIA,
  ROTULO_FINALIDADE,
  type CampoDinamico,
  type ConexaoBancoResumo,
  type ConsultaSqlResumo,
  type FinalidadeConsulta,
  type PreviaConsulta,
  type SalvarConsultaResposta,
} from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { TabelaResultado } from '../components/TabelaResultado';
import { Alerta, Botao, Cabecalho, Campo, Selecao, Selo, formatarData } from '../components/ui';

export function EditorConsulta() {
  return (
    <ExigeEmpresa>
      <CarregarConsulta />
    </ExigeEmpresa>
  );
}

function CarregarConsulta() {
  const { id } = useParams();
  const { empresaId } = useAuth();
  const nova = !id || id === 'nova';
  const { data: consulta, error, isLoading } = useQuery({
    queryKey: ['consulta', empresaId, id],
    queryFn: () => api<ConsultaSqlResumo>(`/consultas/${id}`),
    enabled: !nova,
  });
  const { data: conexoes, error: erroConexoes } = useQuery({
    queryKey: ['conexoes', empresaId],
    queryFn: () => api<ConexaoBancoResumo[]>('/consultas/conexoes'),
  });

  if (error || erroConexoes) return <Alerta>{(error ?? erroConexoes)!.message}</Alerta>;
  if ((!nova && isLoading) || !conexoes) return <div className="text-sm text-slate-500">Carregando…</div>;
  // key: ao salvar uma nova, a rota muda e o formulário recomeça com os dados gravados.
  return <Formulario key={consulta?.id ?? 'nova'} consulta={consulta ?? null} conexoes={conexoes} />;
}

const SQL_EXEMPLO = `SELECT p.codigo, p.descricao, p.preco_venda AS preco, p.ean
FROM produtos p
WHERE p.empresa = {empresa.codigo_erp}
  AND p.data_alteracao >= {data_hoje}`;

function Formulario({ consulta, conexoes }: { consulta: ConsultaSqlResumo | null; conexoes: ConexaoBancoResumo[] }) {
  const { empresaId, pode } = useAuth();
  const podeEditar = pode('sql.editar');
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const areaSql = useRef<HTMLTextAreaElement>(null);

  const [f, setF] = useState({
    nome: consulta?.nome ?? '',
    descricao: consulta?.descricao ?? '',
    finalidade: consulta?.finalidade ?? ('LISTA_DIARIA' as FinalidadeConsulta),
    conexaoId: consulta?.conexaoId ?? conexoes.find((c) => c.ativo)?.id ?? '',
    sql: consulta?.sql ?? SQL_EXEMPLO,
    ativo: consulta?.ativo ?? true,
  });
  const [valoresParam, setValoresParam] = useState<Record<string, string>>({});
  const [previa, setPrevia] = useState<{ sql: string; conexaoId: string; dados: PreviaConsulta } | null>(null);
  const [avisosSalvar, setAvisosSalvar] = useState<string[]>([]);

  const conexao = conexoes.find((c) => c.id === f.conexaoId);

  // Placeholders detectados enquanto digita, com a mesma regra do servidor.
  const analise = useMemo(() => {
    if (!conexao) return { placeholders: [] as string[], erro: null };
    try {
      return { placeholders: extrairPlaceholders(f.sql, conexao.tipo), erro: null };
    } catch (e) {
      return { placeholders: [] as string[], erro: (e as Error).message };
    }
  }, [f.sql, conexao]);
  const parametros = analise.placeholders.filter(ehParametro).map((p) => p.slice(PREFIXO_PARAMETRO.length));

  const testar = useMutation({
    mutationFn: () =>
      api<PreviaConsulta>('/consultas/previa', {
        metodo: 'POST',
        corpo: {
          conexaoId: f.conexaoId,
          sql: f.sql,
          parametros: Object.fromEntries(parametros.map((p) => [p, valoresParam[p] ?? ''])),
        },
      }),
    onSuccess: (dados) => setPrevia({ sql: f.sql, conexaoId: f.conexaoId, dados }),
  });

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, descricao: f.descricao || undefined };
      if (!consulta) {
        const { ativo, ...criar } = corpo;
        return api<SalvarConsultaResposta>('/consultas', { metodo: 'POST', corpo: criar });
      }
      return api<SalvarConsultaResposta>(`/consultas/${consulta.id}`, { metodo: 'PATCH', corpo });
    },
    onSuccess: (r) => {
      setAvisosSalvar(r.avisos);
      cliente.setQueryData(['consulta', empresaId, r.consulta.id], r.consulta);
      void cliente.invalidateQueries({ queryKey: ['consultas', empresaId] });
      if (!consulta) navegar(`/consultas/${r.consulta.id}`, { replace: true });
    },
  });

  const relerCampos = useMutation({
    mutationFn: () => api<SalvarConsultaResposta>(`/consultas/${consulta!.id}/atualizar-campos`, { metodo: 'POST' }),
    onSuccess: (r) => {
      setAvisosSalvar(r.avisos);
      cliente.setQueryData(['consulta', empresaId, r.consulta.id], r.consulta);
      void cliente.invalidateQueries({ queryKey: ['consultas', empresaId] });
    },
  });

  const excluir = useMutation({
    mutationFn: () => api(`/consultas/${consulta!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['consultas', empresaId] });
      navegar('/consultas');
    },
  });

  function inserir(texto: string) {
    const area = areaSql.current;
    if (!area) return setF({ ...f, sql: f.sql + texto });
    const { selectionStart: ini, selectionEnd: fim } = area;
    const sql = f.sql.slice(0, ini) + texto + f.sql.slice(fim);
    setF({ ...f, sql });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(ini + texto.length, ini + texto.length);
    });
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  // Campos: os da prévia, se ela foi feita com o SQL atual; senão, os gravados.
  const previaAtual = previa && previa.sql === f.sql && previa.conexaoId === f.conexaoId ? previa.dados : null;
  const salvoIgual = consulta && consulta.sql === f.sql && consulta.conexaoId === f.conexaoId;
  const campos: CampoDinamico[] = previaAtual?.campos ?? consulta?.campos ?? [];
  const camposDesatualizados = previaAtual ? false : !salvoIgual || Boolean(consulta?.camposDesatualizados);
  const erro = salvar.error ?? excluir.error ?? relerCampos.error;

  return (
    <>
      <Cabecalho
        titulo={consulta ? consulta.nome : 'Nova consulta'}
        descricao="Use placeholders entre chaves no lugar de valores. Eles são enviados ao banco como parâmetros, nunca colados no SQL."
        acoes={
          <Link to="/consultas" className="text-sm text-blue-700 hover:underline">
            ← Consultas
          </Link>
        }
      />
      {conexoes.length === 0 && <Alerta tipo="info">Cadastre uma conexão em Bancos de dados antes de criar consultas.</Alerta>}

      <form onSubmit={enviar} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <fieldset disabled={!podeEditar} className="min-w-0 space-y-4">
          {erro && <Alerta>{erro.message}</Alerta>}
          {avisosSalvar.map((a) => (
            <Alerta key={a} tipo="aviso">{a}</Alerta>
          ))}

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome" required minLength={2} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
            <Selecao rotulo="Conexão" required value={f.conexaoId} onChange={(e) => setF({ ...f, conexaoId: e.target.value })}>
              <option value="">Selecione…</option>
              {conexoes.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.ativo}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
            <Selecao rotulo="Finalidade" value={f.finalidade} onChange={(e) => setF({ ...f, finalidade: e.target.value as FinalidadeConsulta })}>
              {FINALIDADES_CONSULTA.map((v) => (
                <option key={v} value={v}>{ROTULO_FINALIDADE[v]}</option>
              ))}
            </Selecao>
            <Campo rotulo="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-700">SQL</span>
              <span className="text-xs text-slate-500">Somente leitura (SELECT/WITH) · Ctrl+Enter testa</span>
            </div>
            <textarea
              ref={areaSql}
              value={f.sql}
              onChange={(e) => setF({ ...f, sql: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (!analise.erro) testar.mutate();
                }
              }}
              rows={12}
              spellCheck={false}
              required
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              aria-label="SQL"
            />
            {analise.erro && <p className="mt-1 text-sm text-red-700">{analise.erro}</p>}
            {podeEditar && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.nome}
                    type="button"
                    title={`${p.descricao} — ex.: ${p.exemplo}`}
                    onClick={() => inserir(`{${p.nome}}`)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {`{${p.nome}}`}
                  </button>
                ))}
                <button
                  type="button"
                  title="Valor informado na hora da execução (ex.: código buscado na etiqueta avulsa)"
                  onClick={() => inserir('{param.busca}')}
                  className="rounded border border-dashed border-slate-400 bg-white px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-100"
                >
                  {'{param.…}'}
                </button>
              </div>
            )}
          </div>

          {parametros.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="mb-2 text-sm font-medium text-slate-700">Valores para testar</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {parametros.map((p) => (
                  <Campo
                    key={p}
                    rotulo={`{param.${p}}`}
                    value={valoresParam[p] ?? ''}
                    onChange={(e) => setValoresParam({ ...valoresParam, [p]: e.target.value })}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Botao
                variante="secundario"
                disabled={testar.isPending || !f.conexaoId || Boolean(analise.erro)}
                onClick={() => testar.mutate()}
              >
                {testar.isPending ? 'Testando…' : 'Testar'}
              </Botao>
              <Botao type="submit" disabled={salvar.isPending || Boolean(analise.erro)}>
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Botao>
            </div>
            {consulta && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
                  Ativa
                </label>
                <Botao
                  variante="perigo"
                  disabled={excluir.isPending}
                  onClick={() => window.confirm(`Excluir a consulta "${consulta.nome}"?`) && excluir.mutate()}
                >
                  Excluir
                </Botao>
              </div>
            )}
          </div>

          {testar.error && <Alerta>{testar.error.message}</Alerta>}
          {previa && (
            <div className="space-y-2">
              {previa.dados.avisos.map((a) => (
                <Alerta key={a} tipo="aviso">{a}</Alerta>
              ))}
              <details className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
                <summary className="cursor-pointer text-slate-600">SQL enviado ao banco e parâmetros</summary>
                <pre className="mt-2 overflow-x-auto font-mono whitespace-pre-wrap">{previa.dados.sqlExecutado}</pre>
                <ol className="mt-2 list-decimal pl-5 font-mono">
                  {previa.dados.parametros.map((v, i) => (
                    <li key={i}>{v === null ? 'NULL' : JSON.stringify(v)}</li>
                  ))}
                </ol>
              </details>
              <TabelaResultado resultado={previa.dados.resultado} />
            </div>
          )}
        </fieldset>

        <aside className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold">Campos disponíveis</h2>
              {camposDesatualizados && campos.length > 0 && <Selo cor="amarelo">Desatualizados</Selo>}
            </div>
            {campos.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">Teste ou salve a consulta para ler as colunas.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {campos.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="truncate font-mono">{c.nome || '(sem nome)'}</span>
                    <span className="shrink-0 text-xs text-slate-500" title={c.tipoBanco}>
                      {ROTULO_CATEGORIA[c.categoria]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
              {previaAtual
                ? 'Da última prévia. Salve para atualizar os campos da consulta.'
                : consulta?.camposAtualizadosEm
                  ? `Lidos em ${formatarData(consulta.camposAtualizadosEm)}.`
                  : 'Ainda não lidos.'}
              {consulta && camposDesatualizados && salvoIgual && podeEditar && (
                <button
                  type="button"
                  onClick={() => relerCampos.mutate()}
                  disabled={relerCampos.isPending}
                  className="ml-1 text-blue-700 hover:underline"
                >
                  {relerCampos.isPending ? 'Lendo…' : 'Ler agora'}
                </button>
              )}
            </div>
          </div>
          <p className="px-1 text-xs text-slate-500">
            Os campos aparecem no editor de etiquetas. Ao adicionar ou remover colunas no SQL, salve a consulta para atualizar a
            lista.
          </p>
        </aside>
      </form>
    </>
  );
}
