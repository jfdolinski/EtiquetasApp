import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import {
  extrairPlaceholders,
  FINALIDADES_CONSULTA,
  ROTULO_FINALIDADE,
  ROTULO_TIPO_BANCO,
  TIPOS_BANCO,
  type CampoEsperado,
  type FinalidadeConsulta,
  type SistemaErpDetalhe,
  type TemplateConsultaResumo,
  type TipoBanco,
} from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Campo, Modal, Selecao, Selo } from '../../components/ui';

export function EditorErp() {
  const { id } = useParams();
  const { data: erp, error, isLoading } = useQuery({ queryKey: ['erp', id], queryFn: () => api<SistemaErpDetalhe>(`/erps/${id}`) });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (isLoading || !erp) return <div className="text-sm text-slate-500">Carregando…</div>;
  return <Editor key={erp.id + erp.atualizadoEm} erp={erp} />;
}

function Editor({ erp }: { erp: SistemaErpDetalhe }) {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const [f, setF] = useState({ nome: erp.nome, fabricante: erp.fabricante ?? '', tipoBanco: erp.tipoBanco, descricao: erp.descricao ?? '', ativo: erp.ativo });
  const [edicao, setEdicao] = useState<{ consulta: TemplateConsultaResumo | null } | null>(null);
  const invalidar = () => {
    void cliente.invalidateQueries({ queryKey: ['erp', erp.id] });
    void cliente.invalidateQueries({ queryKey: ['erps'] });
  };

  const salvar = useMutation({ mutationFn: () => api(`/erps/${erp.id}`, { metodo: 'PATCH', corpo: f }), onSuccess: invalidar });
  const excluir = useMutation({
    mutationFn: () => api(`/erps/${erp.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['erps'] });
      navegar('/erps');
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/erps" className="text-sm text-blue-700 hover:underline">← Sistemas ERP</Link>
        <h1 className="text-xl font-semibold">{erp.nome}</h1>
        <p className="text-sm text-slate-500">{erp.totalEmpresas} empresa(s) vinculada(s)</p>
      </div>

      <form onSubmit={enviar} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        {(salvar.error ?? excluir.error) && <Alerta>{(salvar.error ?? excluir.error)!.message}</Alerta>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Nome" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          <Campo rotulo="Fabricante" value={f.fabricante} onChange={(e) => setF({ ...f, fabricante: e.target.value })} />
          <Selecao rotulo="Banco de dados" value={f.tipoBanco} onChange={(e) => setF({ ...f, tipoBanco: e.target.value as TipoBanco })}>
            {TIPOS_BANCO.map((t) => (
              <option key={t} value={t}>{ROTULO_TIPO_BANCO[t]}</option>
            ))}
          </Selecao>
        </div>
        <Campo rotulo="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
            ERP ativo (pode ser vinculado a empresas)
          </label>
          <div className="flex gap-2">
            <Botao variante="perigo" disabled={excluir.isPending} onClick={() => window.confirm(`Excluir o ERP "${erp.nome}"?`) && excluir.mutate()}>
              Excluir
            </Botao>
            <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
          </div>
        </div>
      </form>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Template: consultas padrão</h2>
            <p className="text-sm text-slate-500">Copiadas para a empresa ao vincular. Alterar aqui não muda as cópias; a empresa vê que o template foi atualizado.</p>
          </div>
          <Botao onClick={() => setEdicao({ consulta: null })}>Nova consulta</Botao>
        </div>
        {erp.consultas.length === 0 && <Alerta tipo="info">O template ainda não tem consultas.</Alerta>}
        {erp.consultas.map((c) => (
          <article key={c.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{c.nome} <Selo cor="cinza">{ROTULO_FINALIDADE[c.finalidade]}</Selo></h3>
                {c.descricao && <p className="text-sm text-slate-500">{c.descricao}</p>}
              </div>
              <Botao variante="secundario" onClick={() => setEdicao({ consulta: c })}>Editar</Botao>
            </div>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 font-mono text-xs">{c.sql}</pre>
            {c.camposEsperados.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {c.camposEsperados.map((m) => (
                  <span key={m.campo} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5" title={m.descricao}>
                    <span className="font-mono">{m.campo}</span>
                    {m.origem && <span className="text-slate-500"> ← {m.origem}</span>}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      <Modal titulo={edicao?.consulta ? 'Editar consulta do template' : 'Nova consulta do template'} aberto={edicao !== null} aoFechar={() => setEdicao(null)} largo>
        {edicao && (
          <FormTemplate
            erp={erp}
            consulta={edicao.consulta}
            aoConcluir={() => {
              setEdicao(null);
              invalidar();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function FormTemplate({ erp, consulta, aoConcluir }: { erp: SistemaErpDetalhe; consulta: TemplateConsultaResumo | null; aoConcluir: () => void }) {
  const [f, setF] = useState({
    nome: consulta?.nome ?? '',
    descricao: consulta?.descricao ?? '',
    finalidade: consulta?.finalidade ?? ('LISTA_DIARIA' as FinalidadeConsulta),
    sql: consulta?.sql ?? '',
  });
  const [campos, setCampos] = useState<CampoEsperado[]>(consulta?.camposEsperados ?? []);
  const erroSql = useMemo(() => {
    try {
      extrairPlaceholders(f.sql, erp.tipoBanco);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [f.sql, erp.tipoBanco]);

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, descricao: f.descricao || undefined, camposEsperados: campos.filter((c) => c.campo.trim()) };
      return consulta
        ? api(`/erps/${erp.id}/consultas/${consulta.id}`, { metodo: 'PATCH', corpo })
        : api(`/erps/${erp.id}/consultas`, { metodo: 'POST', corpo });
    },
    onSuccess: aoConcluir,
  });
  const excluir = useMutation({ mutationFn: () => api(`/erps/${erp.id}/consultas/${consulta!.id}`, { metodo: 'DELETE' }), onSuccess: aoConcluir });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {(salvar.error ?? excluir.error) && <Alerta>{(salvar.error ?? excluir.error)!.message}</Alerta>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Nome" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        <Selecao rotulo="Finalidade" value={f.finalidade} onChange={(e) => setF({ ...f, finalidade: e.target.value as FinalidadeConsulta })}>
          {FINALIDADES_CONSULTA.map((v) => (
            <option key={v} value={v}>{ROTULO_FINALIDADE[v]}</option>
          ))}
        </Selecao>
        <Campo rotulo="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">SQL ({ROTULO_TIPO_BANCO[erp.tipoBanco]}, com placeholders)</span>
        <textarea
          value={f.sql}
          onChange={(e) => setF({ ...f, sql: e.target.value })}
          rows={10}
          spellCheck={false}
          required
          className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm"
        />
        {erroSql && <span className="text-sm text-red-700">{erroSql}</span>}
      </label>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Mapeamento de campos</span>
          <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setCampos([...campos, { campo: '' }])}>
            + Campo
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">Colunas que a consulta deve devolver (apelido no SELECT) e de onde vêm no ERP. A empresa é avisada se a cópia deixar de devolver alguma.</p>
        <div className="space-y-1.5">
          {campos.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_1.4fr_auto] gap-1.5">
              <input placeholder="campo (ex.: preco)" value={c.campo} onChange={(e) => setCampos(campos.map((x, j) => (j === i ? { ...x, campo: e.target.value } : x)))} className="rounded border border-slate-300 px-2 py-1 font-mono text-sm" />
              <input placeholder="origem (ex.: PRODUTOS.PRECO_VENDA)" value={c.origem ?? ''} onChange={(e) => setCampos(campos.map((x, j) => (j === i ? { ...x, origem: e.target.value } : x)))} className="rounded border border-slate-300 px-2 py-1 text-sm" />
              <input placeholder="descrição" value={c.descricao ?? ''} onChange={(e) => setCampos(campos.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} className="rounded border border-slate-300 px-2 py-1 text-sm" />
              <button type="button" className="px-2 text-sm text-red-700" onClick={() => setCampos(campos.filter((_, j) => j !== i))} aria-label="Remover campo">✕</button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-2 pt-2">
        <div>{consulta && <Botao variante="perigo" disabled={excluir.isPending} onClick={() => window.confirm('Excluir esta consulta do template? As cópias nas empresas continuam.') && excluir.mutate()}>Excluir</Botao>}</div>
        <div className="flex gap-2">
          <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
          <Botao type="submit" disabled={salvar.isPending || Boolean(erroSql)}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </div>
    </form>
  );
}
