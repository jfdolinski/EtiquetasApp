import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AJUSTES_IMAGEM_TELA,
  caminhoImagemTela,
  colunasSugeridas,
  CONFIG_CONTEUDO_PADRAO,
  dadosValidosAte,
  imagemCombinaComTela,
  INTERVALO_PADRAO_MINUTOS,
  LIMITES_CONTEUDO_TELA,
  MODELOS_CONTEUDO_TELA,
  modeloUsaConsulta,
  MODELOS_RESOLUCAO,
  nivelEfetivo,
  problemaNaConfigConteudo,
  problemaNasImagensDoConteudo,
  problemaNaVigencia,
  problemaNosPrazosConteudo,
  ROTULO_AJUSTE_IMAGEM,
  ROTULO_MODELO_CONTEUDO,
  ROTULO_SITUACAO_CONTEUDO,
  VALIDADE_PADRAO_MINUTOS,
  type ConfigConteudoTela,
  type AjusteImagemTela,
  type ConsultaParaConteudo,
  type ImagemTelaResumo,
  type ConteudoTelaResumo,
  type ItemConteudoTela,
  type ModeloConteudoTela,
  type NivelAnimacao,
  type PerfilTelaResumo,
  type PreviaConteudoResposta,
  type ProgramaTela,
  type SituacaoConteudoTela,
  type TelaResumo,
  type TipoEquipamento,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Campo, Selecao, Selo, Tabela, formatarData } from '../../components/ui';
import { ExibicaoTela } from './ExibicaoTela';
import { ImagensDoConteudo, useImagensTela } from './ImagensTela';

const COR_SITUACAO: Record<SituacaoConteudoTela, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  RASCUNHO: 'cinza',
  NO_AR: 'verde',
  AGENDADO: 'cinza',
  SEM_DADOS: 'vermelho',
  DADOS_VENCIDOS: 'vermelho',
};

/** Só para ver o desenho antes de ter dados: nunca sai da pré-visualização. */
const ITENS_DE_EXEMPLO: ItemConteudoTela[] = [
  { nome: 'Produto de exemplo com nome comprido', preco: 'R$ 19,90', precoDe: 'R$ 24,90' },
  { nome: 'Produto de exemplo', preco: 'R$ 7,49' },
  { nome: 'Outro produto', preco: 'R$ 129,00' },
  { nome: 'Mais um produto', preco: 'R$ 3,99', detalhe: 'Unidade' },
  { nome: 'Produto de exemplo', preco: 'R$ 1.249,90' },
  { nome: 'Último exemplo', preco: 'R$ 12,50' },
];

export function ConteudosTela() {
  const { pode, empresaId } = useAuth();
  const cliente = useQueryClient();
  const podeEditar = pode('tela.editar');
  const chave = ['telas-conteudos', empresaId];
  const [editando, setEditando] = useState<ConteudoTelaResumo | 'novo' | null>(null);
  const { data: conteudos = [], error } = useQuery({ queryKey: chave, queryFn: () => api<ConteudoTelaResumo[]>('/telas/conteudos'), refetchInterval: editando ? false : 15_000 });
  const { data: telas = [] } = useQuery({ queryKey: ['telas', empresaId], queryFn: () => api<TelaResumo[]>('/telas') });
  const recarregar = () => void cliente.invalidateQueries({ queryKey: chave });
  const acao = useMutation({
    mutationFn: ({ id, caminho, metodo = 'POST' }: { id: string; caminho: string; metodo?: string }) => api(`/telas/conteudos/${id}${caminho}`, { metodo }),
    onSuccess: recarregar,
  });

  if (editando) {
    return <EditorConteudo conteudo={editando === 'novo' ? null : editando} telas={telas} aoFechar={() => setEditando(null)} aoSalvar={recarregar} />;
  }

  return (
    <>
      {podeEditar && (
        <div className="mb-3 flex justify-end">
          <Botao onClick={() => setEditando('novo')}>Novo conteúdo</Botao>
        </div>
      )}
      {error && <Alerta>{(error as Error).message}</Alerta>}
      {acao.error && <Alerta>{(acao.error as Error).message}</Alerta>}
      <Tabela colunas={['Conteúdo', 'Situação', 'Dados', 'Telas', '']} vazio={conteudos.length === 0}>
        {conteudos.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-2.5">
              <div className="font-medium text-slate-900">{c.nome}</div>
              <div className="text-xs text-slate-500">{ROTULO_MODELO_CONTEUDO[c.modelo].titulo}{modeloUsaConsulta(c.modelo) ? (c.consultaNome ? ` · ${c.consultaNome}` : ' · consulta excluída') : ''}</div>
            </td>
            <td className="px-4 py-2.5">
              <Selo cor={COR_SITUACAO[c.situacao]}>{ROTULO_SITUACAO_CONTEUDO[c.situacao]}</Selo>
              {c.erro && c.publicado && <div className="mt-1 max-w-xs text-xs text-red-700">{c.erro}</div>}
            </td>
            <td className="px-4 py-2.5 text-slate-600">
              {!modeloUsaConsulta(c.modelo) ? (
                <div>{(c.config.imagens ?? []).length} imagem(ns)</div>
              ) : c.dadosEm ? (
                <>
                  <div>{c.quantidadeItens} produto(s)</div>
                  <div className="text-xs text-slate-500">Lidos em {formatarData(c.dadosEm)}</div>
                  <div className="text-xs text-slate-500">Valem até {formatarData(dadosValidosAte(c.dadosEm, c.validadeMinutos).toISOString())}</div>
                </>
              ) : (
                <span className="text-slate-400">Ainda não lidos</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-slate-600">{c.telaIds.length}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              {podeEditar && (
                <span className="inline-flex gap-3 text-sm">
                  {c.publicado && modeloUsaConsulta(c.modelo) && (
                    <button type="button" className="text-blue-700 hover:underline" disabled={acao.isPending} onClick={() => acao.mutate({ id: c.id, caminho: '/atualizar' })}>Atualizar dados</button>
                  )}
                  <button type="button" className="text-blue-700 hover:underline" onClick={() => setEditando(c)}>Editar</button>
                  {c.publicado && (
                    <button type="button" className="text-red-700 hover:underline" onClick={() => window.confirm(`Tirar “${c.nome}” do ar? Sai das telas em até 30 segundos.`) && acao.mutate({ id: c.id, caminho: '/despublicar' })}>Tirar do ar</button>
                  )}
                  <button type="button" className="text-red-700 hover:underline" onClick={() => window.confirm(`Excluir “${c.nome}”?`) && acao.mutate({ id: c.id, caminho: '', metodo: 'DELETE' })}>Excluir</button>
                </span>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
      <p className="mt-3 text-xs text-slate-500">Nos conteúdos de produtos, a TV mostra uma cópia dos dados. Se ela passar da validade, por exemplo com o agente desligado, o conteúdo sai do ar sozinho, para nenhuma tela mostrar preço antigo. Imagens não têm validade: ficam até você tirar do ar.</p>
    </>
  );
}

interface Formulario {
  nome: string;
  modelo: ModeloConteudoTela;
  consultaId: string;
  config: ConfigConteudoTela;
  intervalo: string;
  validade: string;
  horarioInicio: string;
  horarioFim: string;
  dataInicio: string;
  dataFim: string;
  telaIds: string[];
}

function formularioDe(c: ConteudoTelaResumo | null): Formulario {
  return {
    nome: c?.nome ?? '',
    modelo: c?.modelo ?? 'GRADE_OFERTAS',
    consultaId: c?.consultaId ?? '',
    config: c?.config ?? CONFIG_CONTEUDO_PADRAO,
    intervalo: String(c?.intervaloMinutos || INTERVALO_PADRAO_MINUTOS),
    validade: String(c?.validadeMinutos || VALIDADE_PADRAO_MINUTOS),
    horarioInicio: c?.horarioInicio ?? '',
    horarioFim: c?.horarioFim ?? '',
    dataInicio: c?.dataInicio ?? '',
    dataFim: c?.dataFim ?? '',
    telaIds: c?.telaIds ?? [],
  };
}

function EditorConteudo({ conteudo, telas, aoFechar, aoSalvar }: { conteudo: ConteudoTelaResumo | null; telas: TelaResumo[]; aoFechar: () => void; aoSalvar: () => void }) {
  const [f, setF] = useState(() => formularioDe(conteudo));
  const [mensagem, setMensagem] = useState<string | null>(null);
  const { data: consultas = [], error: erroConsultas } = useQuery({ queryKey: ['telas-conteudos-consultas'], queryFn: () => api<ConsultaParaConteudo[]>('/telas/conteudos/consultas') });
  const { data: perfis = [] } = useQuery({ queryKey: ['telas-perfis'], queryFn: () => api<PerfilTelaResumo[]>('/telas/perfis') });
  const consulta = consultas.find((c) => c.id === f.consultaId);
  const ajustar = (parte: Partial<ConfigConteudoTela>) => setF((x) => ({ ...x, config: { ...x.config, ...parte } }));

  const previa = useMutation({
    mutationFn: (dados: Formulario) =>
      api<PreviaConteudoResposta>('/telas/conteudos/previa', {
        metodo: 'POST',
        corpo: { consultaId: dados.consultaId, colunaNome: dados.config.colunaNome || undefined, colunaPreco: dados.config.colunaPreco || undefined, colunaPrecoDe: dados.config.colunaPrecoDe, colunaDetalhe: dados.config.colunaDetalhe, comFotos: !!dados.config.comFotos, colunaCodigo: dados.config.colunaCodigo || undefined },
      }),
  });
  const colunas = previa.data?.colunas.length ? previa.data.colunas : (consulta?.colunas ?? []);

  /** Trocou de consulta: sugere as colunas pelos nomes conhecidos. */
  const aoEscolherConsulta = (id: string) => {
    previa.reset();
    const c = consultas.find((x) => x.id === id);
    const s = colunasSugeridas(c?.colunas ?? []);
    setF((x) => ({ ...x, consultaId: id, config: { ...x.config, colunaNome: s.colunaNome, colunaPreco: s.colunaPreco, colunaPrecoDe: s.colunaPrecoDe, colunaDetalhe: null, colunaCodigo: s.colunaCodigo } }));
  };

  const comConsulta = modeloUsaConsulta(f.modelo);
  const problema = useMemo(() => {
    if (f.nome.trim().length < 2) return 'Informe o nome do conteúdo.';
    const vigencia = { horarioInicio: f.horarioInicio || null, horarioFim: f.horarioFim || null, dataInicio: f.dataInicio || null, dataFim: f.dataFim || null };
    if (!modeloUsaConsulta(f.modelo)) return problemaNasImagensDoConteudo(f.config) ?? problemaNaVigencia(vigencia);
    if (!f.consultaId) return 'Escolha a consulta.';
    if (consulta?.pedeParametro) return 'Esta consulta pede valores digitados, como uma busca: ela não roda sozinha. Use uma consulta de lista.';
    return (
      problemaNaConfigConteudo(f.config) ??
      problemaNosPrazosConteudo(Number(f.intervalo), Number(f.validade)) ??
      problemaNaVigencia(vigencia)
    );
  }, [f, consulta]);

  const salvar = useMutation({
    mutationFn: async (publicar: boolean) => {
      const corpo = {
        nome: f.nome,
        modelo: f.modelo,
        consultaId: comConsulta ? f.consultaId : undefined,
        config: f.config,
        intervaloMinutos: Number(f.intervalo),
        validadeMinutos: Number(f.validade),
        horarioInicio: f.horarioInicio || null,
        horarioFim: f.horarioFim || null,
        dataInicio: f.dataInicio || null,
        dataFim: f.dataFim || null,
      };
      const salvo = await api<ConteudoTelaResumo>(conteudo ? `/telas/conteudos/${conteudo.id}` : '/telas/conteudos', { metodo: conteudo ? 'PUT' : 'POST', corpo });
      return publicar ? api<ConteudoTelaResumo>(`/telas/conteudos/${salvo.id}/publicar`, { metodo: 'POST', corpo: { telaIds: f.telaIds } }) : salvo;
    },
    onSuccess: (salvo, publicar) => {
      aoSalvar();
      // Publicou, mas a consulta falhou: quem publicou precisa ver o motivo antes de sair da tela.
      if (publicar && salvo.situacao !== 'NO_AR' && salvo.situacao !== 'AGENDADO') {
        setMensagem(`Publicado, mas ainda não está na tela: ${salvo.erro ?? 'sem dados.'}`);
        return;
      }
      aoFechar();
    },
  });

  const alternarTela = (id: string) => setF((x) => ({ ...x, telaIds: x.telaIds.includes(id) ? x.telaIds.filter((t) => t !== id) : [...x.telaIds, id] }));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <form
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate(false);
        }}
      >
        <h2 className="font-semibold text-slate-900">{conteudo ? `Editar ${conteudo.nome}` : 'Novo conteúdo'}</h2>
        <Campo rotulo="Nome do conteúdo" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required minLength={2} maxLength={80} />

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Modelo</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODELOS_CONTEUDO_TELA.map((m) => (
              <label key={m} className={`cursor-pointer rounded-md border p-2.5 text-sm ${f.modelo === m ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <input type="radio" name="modelo" className="sr-only" checked={f.modelo === m} onChange={() => setF({ ...f, modelo: m })} />
                <span className="block font-medium text-slate-900">{ROTULO_MODELO_CONTEUDO[m].titulo}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{ROTULO_MODELO_CONTEUDO[m].ajuda}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {!comConsulta && (
          <>
            <ImagensDoConteudo selecionadas={f.config.imagens ?? []} segundosPadrao={f.config.segundosPorCena} aoMudar={(imagens) => ajustar({ imagens })} />
            <Selecao rotulo="Como encaixar na tela" value={f.config.ajuste ?? 'CONTER'} onChange={(e) => ajustar({ ajuste: e.target.value as AjusteImagemTela })}>
              {AJUSTES_IMAGEM_TELA.map((a) => (
                <option key={a} value={a}>{ROTULO_AJUSTE_IMAGEM[a]}</option>
              ))}
            </Selecao>
            <Campo rotulo="Cor de fundo" type="color" className="h-10 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" value={f.config.corFundo} onChange={(e) => ajustar({ corFundo: e.target.value })} />
          </>
        )}

        {comConsulta && (
        <>
        <Selecao rotulo="Consulta" value={f.consultaId} onChange={(e) => aoEscolherConsulta(e.target.value)}>
          <option value="">Escolher…</option>
          {consultas.map((c) => (
            <option key={c.id} value={c.id} disabled={c.pedeParametro}>{c.nome}{c.pedeParametro ? ' (pede valores digitados)' : ''}</option>
          ))}
        </Selecao>
        {erroConsultas && <Alerta>{(erroConsultas as Error).message}</Alerta>}

        <div className="grid gap-3 sm:grid-cols-2">
          <SelecaoColuna rotulo="Coluna do nome" valor={f.config.colunaNome} colunas={colunas} aoMudar={(v) => ajustar({ colunaNome: v })} />
          <SelecaoColuna rotulo="Coluna do preço" valor={f.config.colunaPreco} colunas={colunas} aoMudar={(v) => ajustar({ colunaPreco: v })} />
          <SelecaoColuna rotulo="Preço anterior (opcional)" valor={f.config.colunaPrecoDe ?? ''} colunas={colunas} opcional aoMudar={(v) => ajustar({ colunaPrecoDe: v || null })} />
          <SelecaoColuna rotulo="Detalhe (opcional)" valor={f.config.colunaDetalhe ?? ''} colunas={colunas} opcional aoMudar={(v) => ajustar({ colunaDetalhe: v || null })} />
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!f.config.comFotos}
              onChange={(e) => ajustar({ comFotos: e.target.checked, colunaCodigo: f.config.colunaCodigo || colunasSugeridas(colunas).colunaCodigo })}
            />
            <span>
              <span className="font-medium text-slate-900">Mostrar a foto dos produtos</span>
              <span className="mt-0.5 block text-xs text-slate-500">As fotos vêm do catálogo, pelo código de barras. Produto sem foto aparece só com o texto, e o sistema volta a procurar sozinho. Cada busca conta no consumo da empresa no catálogo.</span>
            </span>
          </label>
          {f.config.comFotos && (
            <div className="mt-3">
              <SelecaoColuna rotulo="Coluna do código de barras" valor={f.config.colunaCodigo ?? ''} colunas={colunas} aoMudar={(v) => ajustar({ colunaCodigo: v || null })} />
            </div>
          )}
        </div>
        {f.consultaId && colunas.length === 0 && <p className="text-xs text-amber-700">As colunas desta consulta ainda não foram lidas. Clique em “Carregar dados reais” na pré-visualização.</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Título" value={f.config.titulo} maxLength={LIMITES_CONTEUDO_TELA.titulo} onChange={(e) => ajustar({ titulo: e.target.value })} />
          <Campo rotulo="Segundos por cena" type="number" min={LIMITES_CONTEUDO_TELA.segundosPorCena[0]} max={LIMITES_CONTEUDO_TELA.segundosPorCena[1]} value={f.config.segundosPorCena} onChange={(e) => ajustar({ segundosPorCena: Number(e.target.value) })} />
        </div>
        <Campo rotulo="Rodapé" value={f.config.rodape} maxLength={LIMITES_CONTEUDO_TELA.rodape} placeholder="Ofertas válidas enquanto durarem os estoques" onChange={(e) => ajustar({ rodape: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Cor de fundo" type="color" className="h-10 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" value={f.config.corFundo} onChange={(e) => ajustar({ corFundo: e.target.value })} />
          <Campo rotulo="Cor do preço" type="color" className="h-10 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1" value={f.config.corDestaque} onChange={(e) => ajustar({ corDestaque: e.target.value })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Atualizar os dados a cada (minutos)" type="number" min={1} max={1440} value={f.intervalo} onChange={(e) => setF({ ...f, intervalo: e.target.value })} ajuda="Cada atualização consulta o banco do cliente." />
          <Campo rotulo="Validade dos dados (minutos)" type="number" min={5} max={10080} value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })} ajuda="Passou disso sem atualizar, sai do ar." />
        </div>
        </>
        )}

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Quando passar (vazio: sempre)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Das" type="time" value={f.horarioInicio} onChange={(e) => setF({ ...f, horarioInicio: e.target.value })} />
            <Campo rotulo="Até as" type="time" value={f.horarioFim} onChange={(e) => setF({ ...f, horarioFim: e.target.value })} />
            <Campo rotulo="A partir de" type="date" value={f.dataInicio} onChange={(e) => setF({ ...f, dataInicio: e.target.value })} />
            <Campo rotulo="Até o dia" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} />
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Telas</legend>
          {telas.length === 0 && <p className="text-sm text-slate-500">Nenhuma tela vinculada ainda.</p>}
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {telas.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={f.telaIds.includes(t.id)} onChange={() => alternarTela(t.id)} />
                {t.nome}
                <span className="text-xs text-slate-500">{t.perfil.largura}×{t.perfil.altura}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {problema && <p className="text-sm text-amber-700">{problema}</p>}
        {salvar.error && <Alerta>{(salvar.error as Error).message}</Alerta>}
        {mensagem && <Alerta tipo="aviso">{mensagem}</Alerta>}
        <div className="flex flex-wrap justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={aoFechar}>{mensagem ? 'Fechar' : 'Cancelar'}</Botao>
          <Botao type="submit" variante="secundario" disabled={!!problema || salvar.isPending}>{conteudo?.publicado ? 'Salvar sem mudar as telas' : 'Salvar rascunho'}</Botao>
          <Botao type="button" disabled={!!problema || f.telaIds.length === 0 || salvar.isPending} onClick={() => salvar.mutate(true)}>{salvar.isPending ? 'Publicando…' : 'Publicar'}</Botao>
        </div>
      </form>

      <PreVisualizacao f={f} comConsulta={comConsulta} perfis={perfis} previa={previa.data ?? null} carregando={previa.isPending} erro={previa.error as Error | null} aoCarregar={() => previa.mutate(f)} />
    </div>
  );
}

function SelecaoColuna({ rotulo, valor, colunas, opcional, aoMudar }: { rotulo: string; valor: string; colunas: string[]; opcional?: boolean; aoMudar: (v: string) => void }) {
  const opcoes = valor && !colunas.some((c) => c === valor) ? [valor, ...colunas] : colunas;
  return (
    <Selecao rotulo={rotulo} value={valor} onChange={(e) => aoMudar(e.target.value)}>
      <option value="">{opcional ? 'Nenhuma' : 'Escolher…'}</option>
      {opcoes.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </Selecao>
  );
}

const RESOLUCOES_DE_MODELO = MODELOS_RESOLUCAO.map((m) => ({ id: m.nome, nome: m.nome, largura: m.largura, altura: m.altura, tipo: m.tipo as TipoEquipamento, margemPct: 0, nivelAnimacao: 'AUTOMATICO' as NivelAnimacao }));

/** A mesma exibição da TV, reduzida para caber na página. */
function PreVisualizacao({ f, comConsulta, perfis, previa, carregando, erro, aoCarregar }: { f: Formulario; comConsulta: boolean; perfis: PerfilTelaResumo[]; previa: PreviaConteudoResposta | null; carregando: boolean; erro: Error | null; aoCarregar: () => void }) {
  const opcoes = useMemo(() => [...perfis.map((p) => ({ id: p.id, nome: p.nome, largura: p.largura, altura: p.altura, tipo: p.tipo, margemPct: p.margemPct, nivelAnimacao: p.nivelAnimacao })), ...RESOLUCOES_DE_MODELO], [perfis]);
  const [perfilId, setPerfilId] = useState('');
  const perfil = opcoes.find((o) => o.id === perfilId) ?? opcoes[0];
  const caixa = useRef<HTMLDivElement>(null);
  const [larguraCaixa, setLarguraCaixa] = useState(560);

  useEffect(() => {
    const medir = () => caixa.current && setLarguraCaixa(caixa.current.clientWidth);
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  const reais = !!previa && previa.itens.length > 0;
  const programa: ProgramaTela = useMemo(
    () => ({
      id: 'previa',
      nome: f.nome,
      modelo: f.modelo,
      config: { titulo: f.config.titulo, rodape: f.config.rodape, segundosPorCena: Math.max(LIMITES_CONTEUDO_TELA.segundosPorCena[0], f.config.segundosPorCena || 8), corFundo: f.config.corFundo, corDestaque: f.config.corDestaque, ajuste: f.config.ajuste },
      // Desligou as fotos depois de carregar: a pré-visualização não espera outra consulta para mostrar sem elas.
      itens: !comConsulta ? [] : reais ? (f.config.comFotos ? previa.itens : previa.itens.map(({ foto: _foto, ...item }) => item)) : ITENS_DE_EXEMPLO,
      ...(comConsulta ? {} : { imagens: (f.config.imagens ?? []).map((i) => ({ url: caminhoImagemTela(i.imagemId), segundos: Math.max(LIMITES_CONTEUDO_TELA.segundosPorCena[0], i.segundos || 8) })) }),
      dadosEm: new Date().toISOString(),
      validoAte: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    [f.nome, f.modelo, f.config, reais, previa, comConsulta],
  );
  const programas = useMemo(() => [programa], [programa]);

  // Muito alta (TV na vertical): limita pela altura, para caber na tela de quem edita.
  const escala = Math.min(larguraCaixa / perfil.largura, 560 / perfil.altura);

  return (
    <section className="lg:sticky lg:top-4 lg:self-start">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-48 flex-1">
            <Selecao rotulo="Ver como" value={perfil.id} onChange={(e) => setPerfilId(e.target.value)}>
              {opcoes.map((o) => (
                <option key={o.id} value={o.id}>{o.nome} ({o.largura}×{o.altura})</option>
              ))}
            </Selecao>
          </div>
          {comConsulta && <Botao variante="secundario" disabled={!f.consultaId || carregando} onClick={aoCarregar}>{carregando ? 'Consultando…' : 'Carregar dados reais'}</Botao>}
        </div>
        <div ref={caixa} className="flex justify-center">
          <div aria-label="Pré-visualização da tela" style={{ position: 'relative', width: perfil.largura * escala, height: perfil.altura * escala, overflow: 'hidden', borderRadius: 4, boxShadow: '0 0 0 1px rgba(0,0,0,.25)' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: perfil.largura, height: perfil.altura, transform: `scale(${escala})`, transformOrigin: 'top left' }}>
              <ExibicaoTela programas={programas} largura={perfil.largura} altura={perfil.altura} margemPct={perfil.margemPct} nivel={nivelEfetivo(perfil.nivelAnimacao, 60, perfil.tipo)} />
            </div>
          </div>
        </div>
        {!comConsulta && <AvisoDeFormato selecionadas={f.config.imagens ?? []} tela={perfil} cobrir={f.config.ajuste === 'COBRIR'} />}
        {comConsulta && (
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          {!reais && <p className="font-medium text-amber-700">Dados de exemplo. Eles nunca vão para a tela.</p>}
          {reais && <p>{previa.itens.length} produto(s) da consulta, como vão aparecer.</p>}
          {previa && previa.descartados > 0 && <p className="text-amber-700">{previa.descartados} linha(s) ficaram de fora por falta de nome ou de preço válido.</p>}
          {previa && previa.cortados > 0 && <p className="text-amber-700">{previa.cortados} produto(s) acima do limite de 200 ficaram de fora. Filtre a consulta.</p>}
          {previa && previa.banidos > 0 && <p>{previa.banidos} produto(s) banido(s) não aparecem.</p>}
          {f.config.comFotos && !previa?.fotos && <p>Clique em “Carregar dados reais” para ver as fotos.</p>}
          {f.config.comFotos && previa?.fotos && (
            <p>
              {previa.fotos.com} produto(s) com foto e {previa.fotos.sem} sem.{previa.fotos.pendentes > 0 ? ` Procurando mais ${previa.fotos.pendentes} no catálogo: elas chegam à tela sozinhas.` : ''}
            </p>
          )}
          {f.config.comFotos && previa?.fotos?.aviso && <p className="text-amber-700">{previa.fotos.aviso}</p>}
          {f.config.comFotos && !!previa?.fotos?.medicamentos && <p className="text-amber-700">{previa.fotos.medicamentos} produto(s) são medicamentos: confira as regras da Anvisa para propaganda antes de publicar.</p>}
          {previa && previa.itens.length === 0 && f.config.colunaNome && f.config.colunaPreco && <p className="text-amber-700">Nenhum produto aproveitável com essas colunas.</p>}
          {previa && !(f.config.colunaNome && f.config.colunaPreco) && <p className="text-amber-700">Escolha as colunas do nome e do preço e carregue de novo.</p>}
        </div>
        )}
        {erro && <div className="mt-3"><Alerta>{erro.message}</Alerta></div>}
      </div>
    </section>
  );
}

/** Imagem horizontal em tela vertical sobra ou corta: melhor saber antes de publicar. */
function AvisoDeFormato({ selecionadas, tela, cobrir }: { selecionadas: { imagemId: string }[]; tela: { largura: number; altura: number }; cobrir: boolean }) {
  const { data: imagens = [] } = useImagensTela();
  const diferentes: ImagemTelaResumo[] = selecionadas.flatMap((s) => imagens.filter((i) => i.id === s.imagemId && !imagemCombinaComTela(i, tela)));
  if (selecionadas.length === 0) return <p className="mt-3 text-xs text-slate-500">Escolha uma imagem para ver como fica.</p>;
  if (diferentes.length === 0) return <p className="mt-3 text-xs text-slate-500">As imagens têm o mesmo formato desta tela.</p>;
  return (
    <p className="mt-3 text-xs text-amber-700">
      {diferentes.length === 1 ? `“${diferentes[0].nome}” tem` : `${diferentes.length} imagens têm`} formato diferente desta tela: {cobrir ? 'as bordas vão ser cortadas' : 'vai sobrar fundo nas laterais ou em cima e embaixo'}.
    </p>
  );
}
