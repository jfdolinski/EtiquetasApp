import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  familiaDoFormato,
  LIMITES_PARAMETROS_TELAS,
  MODELOS_RESOLUCAO,
  NIVEIS_ANIMACAO,
  PARAMETROS_TELAS_PADRAO,
  ROTULO_EQUIPAMENTO,
  ROTULO_FAMILIA,
  ROTULO_NIVEL_ANIMACAO,
  ROTULO_PARAMETRO_TELA,
  ROTULO_SITUACAO_TELA,
  TIPOS_EQUIPAMENTO,
  type ChaveParametroTela,
  type NivelAnimacao,
  type ParametrosTelas,
  type ParametrosTelasResposta,
  type PerfilTelaResumo,
  type QuedaTelaResumo,
  type SituacaoTela,
  type TelaResumo,
  type TipoEquipamento,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela, formatarData } from '../../components/ui';

const COR_SITUACAO: Record<SituacaoTela, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  ONLINE: 'verde',
  INSTAVEL: 'amarelo',
  OFFLINE: 'vermelho',
  FORA_DO_HORARIO: 'cinza',
  AGUARDANDO_VINCULO: 'cinza',
};

type Aba = 'equipamentos' | 'perfis' | 'parametros';

export function Telas() {
  return (
    <ExigeEmpresa>
      <Conteudo />
    </ExigeEmpresa>
  );
}

function Conteudo() {
  const { pode } = useAuth();
  const [aba, setAba] = useState<Aba>('equipamentos');
  const abas: [Aba, string][] = [
    ['equipamentos', 'Equipamentos'],
    ['perfis', 'Perfis de resolução'],
    ['parametros', 'Parâmetros'],
  ];
  return (
    <>
      <Cabecalho
        titulo="Telas"
        descricao="TVs, painéis de LED, projetores e tablets. Para vincular, abra o link /tv no equipamento."
        acoes={pode('tela.editar') && <Link to="/telas/vincular" className="inline-flex items-center rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">Vincular tela</Link>}
      />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {abas.map(([id, rotulo]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'equipamentos' && <Equipamentos />}
      {aba === 'perfis' && <Perfis />}
      {aba === 'parametros' && <Parametros />}
    </>
  );
}

function Equipamentos() {
  const { pode, empresaId } = useAuth();
  const cliente = useQueryClient();
  const podeEditar = pode('tela.editar');
  const chave = ['telas', empresaId];
  const [filtro, setFiltro] = useState<SituacaoTela | ''>('');
  const [editando, setEditando] = useState<TelaResumo | null>(null);
  const [vendoQuedas, setVendoQuedas] = useState<TelaResumo | null>(null);
  const { data: telas = [], error } = useQuery({ queryKey: chave, queryFn: () => api<TelaResumo[]>('/telas'), refetchInterval: 10_000 });
  const recarregar = () => void cliente.invalidateQueries({ queryKey: chave });

  const acao = useMutation({
    mutationFn: ({ id, caminho, corpo, metodo = 'POST' }: { id: string; caminho: string; corpo?: unknown; metodo?: string }) => api(`/telas/${id}${caminho}`, { metodo, corpo }),
    onSuccess: recarregar,
  });

  const visiveis = filtro ? telas.filter((t) => t.situacao === filtro) : telas;
  const contagem = (s: SituacaoTela) => telas.filter((t) => t.situacao === s).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selo cor="verde">{contagem('ONLINE')} online</Selo>
        <Selo cor="amarelo">{contagem('INSTAVEL')} instável</Selo>
        <Selo cor="vermelho">{contagem('OFFLINE')} offline</Selo>
        <label className="ml-auto text-sm text-slate-600">
          Situação{' '}
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as SituacaoTela | '')} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            {(Object.keys(ROTULO_SITUACAO_TELA) as SituacaoTela[]).map((s) => (
              <option key={s} value={s}>{ROTULO_SITUACAO_TELA[s]}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <Alerta>{(error as Error).message}</Alerta>}
      {acao.error && <Alerta>{(acao.error as Error).message}</Alerta>}
      <Tabela colunas={['Tela', 'Situação', 'Último contato', 'Resolução', 'Quedas em 30 dias', '']} vazio={visiveis.length === 0}>
        {visiveis.map((t) => (
          <tr key={t.id}>
            <td className="px-4 py-2.5">
              <div className="font-medium text-slate-900">{t.nome}</div>
              {t.local && <div className="text-xs text-slate-500">{t.local}</div>}
            </td>
            <td className="px-4 py-2.5">
              <Selo cor={COR_SITUACAO[t.situacao]}>{ROTULO_SITUACAO_TELA[t.situacao]}</Selo>
              {t.emSegundoPlano && t.situacao === 'ONLINE' && <div className="mt-1 text-xs text-amber-700">Página em segundo plano</div>}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatarData(t.ultimoContatoEm)}</td>
            <td className="px-4 py-2.5 text-slate-600">
              <div>{t.perfil.nome} ({t.perfil.largura}×{t.perfil.altura})</div>
              {t.larguraDetectada && <div className={`text-xs ${t.resolucaoConfere ? 'text-slate-500' : 'font-medium text-amber-700'}`}>{t.resolucaoConfere ? 'Informa' : 'Formato diferente: informa'} {t.larguraDetectada}×{t.alturaDetectada}</div>}
            </td>
            <td className="px-4 py-2.5">
              <button type="button" className="text-blue-700 hover:underline" onClick={() => setVendoQuedas(t)}>{t.quedas30Dias}</button>
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              {podeEditar && (
                <span className="inline-flex gap-3 text-sm">
                  {t.situacao !== 'AGUARDANDO_VINCULO' && <button type="button" className="text-blue-700 hover:underline" onClick={() => acao.mutate({ id: t.id, caminho: '/comando', corpo: { comando: 'IDENTIFICAR' } })}>Identificar</button>}
                  {t.situacao !== 'AGUARDANDO_VINCULO' && <button type="button" className="text-blue-700 hover:underline" onClick={() => acao.mutate({ id: t.id, caminho: '/comando', corpo: { comando: 'RECARREGAR' } })}>Recarregar</button>}
                  <button type="button" className="text-blue-700 hover:underline" onClick={() => setEditando(t)}>Editar</button>
                  {t.situacao !== 'AGUARDANDO_VINCULO' && (
                    <button type="button" className="text-red-700 hover:underline" onClick={() => window.confirm(`Desvincular “${t.nome}”? O equipamento volta a mostrar o QR.`) && acao.mutate({ id: t.id, caminho: '/desvincular' })}>Desvincular</button>
                  )}
                  <button type="button" className="text-red-700 hover:underline" onClick={() => window.confirm(`Excluir “${t.nome}” e o histórico dela?`) && acao.mutate({ id: t.id, caminho: '', metodo: 'DELETE' })}>Excluir</button>
                </span>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
      <p className="mt-3 text-xs text-slate-500">Online quer dizer que a página da tela está rodando. Não dá para saber se a TV está ligada nem se está na entrada certa. Comandos chegam em até 30 segundos.</p>
      {editando && <EditarTela tela={editando} aoFechar={() => setEditando(null)} aoSalvar={recarregar} />}
      {vendoQuedas && <Quedas tela={vendoQuedas} aoFechar={() => setVendoQuedas(null)} />}
    </>
  );
}

function EditarTela({ tela, aoFechar, aoSalvar }: { tela: TelaResumo; aoFechar: () => void; aoSalvar: () => void }) {
  const [nome, setNome] = useState(tela.nome);
  const [local, setLocal] = useState(tela.local ?? '');
  const [perfilId, setPerfilId] = useState(tela.perfil.id);
  const [inicio, setInicio] = useState(tela.horarioInicio ?? '');
  const [fim, setFim] = useState(tela.horarioFim ?? '');
  const { data: perfis = [] } = useQuery({ queryKey: ['telas-perfis'], queryFn: () => api<PerfilTelaResumo[]>('/telas/perfis') });
  const salvar = useMutation({
    mutationFn: () => api(`/telas/${tela.id}`, { metodo: 'PATCH', corpo: { nome, local, perfilId, ...(inicio || fim ? { horarioInicio: inicio, horarioFim: fim } : { semHorario: true }) } }),
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });
  return (
    <Modal titulo={`Editar ${tela.nome}`} aberto aoFechar={aoFechar}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <Campo rotulo="Nome da tela" value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} maxLength={80} />
        <Campo rotulo="Local" value={local} onChange={(e) => setLocal(e.target.value)} maxLength={120} />
        <Selecao rotulo="Perfil de resolução" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
          {perfis.map((p) => (
            <option key={p.id} value={p.id}>{p.nome} ({p.largura}×{p.altura})</option>
          ))}
        </Selecao>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Liga às" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} ajuda="Fora do horário, ficar sem aviso não gera alerta." />
          <Campo rotulo="Desliga às" type="time" value={fim} onChange={(e) => setFim(e.target.value)} ajuda="Vazio: o dia inteiro." />
        </div>
        {salvar.error && <Alerta>{(salvar.error as Error).message}</Alerta>}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={salvar.isPending}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function Quedas({ tela, aoFechar }: { tela: TelaResumo; aoFechar: () => void }) {
  const { data: quedas = [], isLoading } = useQuery({ queryKey: ['tela-quedas', tela.id], queryFn: () => api<QuedaTelaResumo[]>(`/telas/${tela.id}/quedas`) });
  return (
    <Modal titulo={`Quedas de ${tela.nome}`} aberto aoFechar={aoFechar}>
      {!isLoading && quedas.length === 0 && <p className="text-sm text-slate-500">Nenhuma queda registrada.</p>}
      <ul className="divide-y divide-slate-100 text-sm">
        {quedas.map((q) => (
          <li key={q.inicio} className="py-1.5 text-slate-700">{formatarData(q.inicio)} até {formatarData(q.fim)}</li>
        ))}
      </ul>
    </Modal>
  );
}

function Perfis() {
  const { pode, empresaId } = useAuth();
  const cliente = useQueryClient();
  const chave = ['telas-perfis', empresaId];
  const [editando, setEditando] = useState<PerfilTelaResumo | 'novo' | null>(null);
  const { data: perfis = [], error } = useQuery({ queryKey: chave, queryFn: () => api<PerfilTelaResumo[]>('/telas/perfis') });
  const recarregar = () => void cliente.invalidateQueries({ queryKey: ['telas-perfis'] });
  const excluir = useMutation({ mutationFn: (id: string) => api(`/telas/perfis/${id}`, { metodo: 'DELETE' }), onSuccess: recarregar });

  return (
    <>
      {pode('tela.editar') && (
        <div className="mb-3 flex justify-end">
          <Botao onClick={() => setEditando('novo')}>Novo perfil</Botao>
        </div>
      )}
      {error && <Alerta>{(error as Error).message}</Alerta>}
      {excluir.error && <Alerta>{(excluir.error as Error).message}</Alerta>}
      <Tabela colunas={['Perfil', 'Equipamento', 'Resolução', 'Formato', 'Telas', '']} vazio={perfis.length === 0}>
        {perfis.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-2.5 font-medium text-slate-900">{p.nome}</td>
            <td className="px-4 py-2.5 text-slate-600">{ROTULO_EQUIPAMENTO[p.tipo]}</td>
            <td className="px-4 py-2.5 text-slate-600">{p.largura}×{p.altura}</td>
            <td className="px-4 py-2.5 text-slate-600">{ROTULO_FAMILIA[familiaDoFormato(p.largura, p.altura)]}</td>
            <td className="px-4 py-2.5 text-slate-600">{p.telas}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              {pode('tela.editar') && (
                <span className="inline-flex gap-3 text-sm">
                  <button type="button" className="text-blue-700 hover:underline" onClick={() => setEditando(p)}>Editar</button>
                  <button type="button" className="text-red-700 hover:underline" onClick={() => window.confirm(`Excluir o perfil “${p.nome}”?`) && excluir.mutate(p.id)}>Excluir</button>
                </span>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
      {editando && <EditarPerfil perfil={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} aoSalvar={recarregar} />}
    </>
  );
}

function EditarPerfil({ perfil, aoFechar, aoSalvar }: { perfil: PerfilTelaResumo | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState({
    nome: perfil?.nome ?? '',
    tipo: (perfil?.tipo ?? 'TV') as TipoEquipamento,
    largura: String(perfil?.largura ?? 1920),
    altura: String(perfil?.altura ?? 1080),
    margemPct: String(perfil?.margemPct ?? 0),
    nivelAnimacao: (perfil?.nivelAnimacao ?? 'AUTOMATICO') as NivelAnimacao,
  });
  const salvar = useMutation({
    mutationFn: () =>
      api(perfil ? `/telas/perfis/${perfil.id}` : '/telas/perfis', {
        metodo: perfil ? 'PUT' : 'POST',
        corpo: { nome: f.nome, tipo: f.tipo, largura: Number(f.largura), altura: Number(f.altura), margemPct: Number(f.margemPct), nivelAnimacao: f.nivelAnimacao },
      }),
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });
  const largura = Number(f.largura);
  const altura = Number(f.altura);
  return (
    <Modal titulo={perfil ? `Editar ${perfil.nome}` : 'Novo perfil de resolução'} aberto aoFechar={aoFechar}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        {!perfil && (
          <Selecao
            rotulo="Partir de um modelo"
            value=""
            onChange={(e) => {
              const m = MODELOS_RESOLUCAO.find((x) => x.nome === e.target.value);
              if (m) setF({ ...f, nome: m.nome, tipo: m.tipo, largura: String(m.largura), altura: String(m.altura) });
            }}
          >
            <option value="">Escolher…</option>
            {MODELOS_RESOLUCAO.map((m) => (
              <option key={m.nome} value={m.nome}>{m.nome} ({m.largura}×{m.altura})</option>
            ))}
          </Selecao>
        )}
        <Campo rotulo="Nome do perfil" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required minLength={2} maxLength={80} />
        <Selecao rotulo="Equipamento" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoEquipamento })}>
          {TIPOS_EQUIPAMENTO.map((t) => (
            <option key={t} value={t}>{ROTULO_EQUIPAMENTO[t]}</option>
          ))}
        </Selecao>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Largura (pixels)" type="number" min={32} max={16384} value={f.largura} onChange={(e) => setF({ ...f, largura: e.target.value })} required />
          <Campo rotulo="Altura (pixels)" type="number" min={32} max={16384} value={f.altura} onChange={(e) => setF({ ...f, altura: e.target.value })} required />
        </div>
        {largura > 0 && altura > 0 && <p className="text-xs text-slate-500">Formato: {ROTULO_FAMILIA[familiaDoFormato(largura, altura)]}</p>}
        <Campo rotulo="Margem de segurança (%)" type="number" min={0} max={25} value={f.margemPct} onChange={(e) => setF({ ...f, margemPct: e.target.value })} ajuda="Algumas TVs e projetores cortam as bordas da imagem." />
        <Selecao rotulo="Animação" value={f.nivelAnimacao} onChange={(e) => setF({ ...f, nivelAnimacao: e.target.value as NivelAnimacao })}>
          {NIVEIS_ANIMACAO.map((n) => (
            <option key={n} value={n}>{ROTULO_NIVEL_ANIMACAO[n]}</option>
          ))}
        </Selecao>
        {salvar.error && <Alerta>{(salvar.error as Error).message}</Alerta>}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" disabled={salvar.isPending}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function Parametros() {
  const { usuario, empresaId } = useAuth();
  const cliente = useQueryClient();
  const chave = ['telas-parametros', empresaId];
  const { data, error } = useQuery({ queryKey: chave, queryFn: () => api<ParametrosTelasResposta>('/telas/parametros') });
  const aoSalvar = (r: ParametrosTelasResposta) => cliente.setQueryData(chave, r);
  if (error) return <Alerta>{(error as Error).message}</Alerta>;
  if (!data) return <p className="text-sm text-slate-500">Carregando…</p>;
  return (
    <div className="space-y-6">
      <FormParametros
        key={`empresa-${JSON.stringify(data.daEmpresa)}`}
        titulo="Nesta empresa"
        descricao="Vazio segue o padrão da plataforma."
        caminho="/telas/parametros/empresa"
        guardados={data.daEmpresa}
        herdados={data.vigentes}
        editaveis={data.editaveis}
        aoSalvar={aoSalvar}
      />
      {usuario?.superAdmin && data.global && (
        <FormParametros
          key={`global-${JSON.stringify(data.global)}`}
          titulo="Padrão da plataforma"
          descricao="Vale para todas as empresas, menos no que a empresa tiver sobrescrito. Só o administrador geral altera."
          caminho="/telas/parametros/global"
          guardados={data.global}
          herdados={PARAMETROS_TELAS_PADRAO}
          editaveis={Object.keys(PARAMETROS_TELAS_PADRAO) as ChaveParametroTela[]}
          aoSalvar={aoSalvar}
        />
      )}
    </div>
  );
}

function FormParametros({ titulo, descricao, caminho, guardados, herdados, editaveis, aoSalvar }: {
  titulo: string;
  descricao: string;
  caminho: string;
  guardados: Partial<ParametrosTelas>;
  herdados: ParametrosTelas;
  editaveis: ChaveParametroTela[];
  aoSalvar: (r: ParametrosTelasResposta) => void;
}) {
  const chaves = Object.keys(PARAMETROS_TELAS_PADRAO) as ChaveParametroTela[];
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(chaves.map((k) => [k, guardados[k] === undefined ? '' : String(guardados[k])])));
  const salvar = useMutation({
    mutationFn: () =>
      api<ParametrosTelasResposta>(caminho, {
        metodo: 'PUT',
        corpo: {
          valores: Object.fromEntries(
            editaveis.map((k) => {
              const v = valores[k];
              if (v === '') return [k, null];
              return [k, typeof PARAMETROS_TELAS_PADRAO[k] === 'boolean' ? v === 'true' : Number(v)];
            }),
          ),
        },
      }),
    onSuccess: aoSalvar,
  });
  const textoHerdado = (k: ChaveParametroTela) => {
    const v = herdados[k];
    return typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : `${v}${ROTULO_PARAMETRO_TELA[k].unidade ? ` ${ROTULO_PARAMETRO_TELA[k].unidade}` : ''}`;
  };
  return (
    <form
      className="rounded-lg border border-slate-200 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <h2 className="font-semibold text-slate-900">{titulo}</h2>
      <p className="mb-4 text-sm text-slate-500">{descricao}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {chaves.map((k) => {
          const r = ROTULO_PARAMETRO_TELA[k];
          const bloqueado = !editaveis.includes(k);
          const limites = LIMITES_PARAMETROS_TELAS[k];
          return (
            <div key={k}>
              {typeof PARAMETROS_TELAS_PADRAO[k] === 'boolean' ? (
                <Selecao rotulo={r.titulo} value={valores[k]} disabled={bloqueado} onChange={(e) => setValores({ ...valores, [k]: e.target.value })}>
                  <option value="">Padrão ({textoHerdado(k)})</option>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </Selecao>
              ) : (
                <Campo rotulo={`${r.titulo}${r.unidade ? ` (${r.unidade})` : ''}`} type="number" min={limites?.[0]} max={limites?.[1]} value={valores[k]} placeholder={`Padrão: ${textoHerdado(k)}`} disabled={bloqueado} onChange={(e) => setValores({ ...valores, [k]: e.target.value })} />
              )}
              <p className="mt-1 text-xs text-slate-500">
                {r.ajuda}
                {!r.emVigor && <span className="text-amber-700"> Passa a valer quando esta parte do módulo chegar.</span>}
              </p>
            </div>
          );
        })}
      </div>
      {salvar.error && <div className="mt-3"><Alerta>{(salvar.error as Error).message}</Alerta></div>}
      {salvar.isSuccess && <div className="mt-3"><Alerta tipo="info">Parâmetros salvos.</Alerta></div>}
      {editaveis.length > 0 && (
        <div className="mt-4">
          <Botao type="submit" disabled={salvar.isPending}>Salvar parâmetros</Botao>
        </div>
      )}
    </form>
  );
}
