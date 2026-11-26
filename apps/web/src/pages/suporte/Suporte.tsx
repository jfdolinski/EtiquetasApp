import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORIAS_SUPORTE,
  LIMITE_TEXTO_SUPORTE,
  problemaNaMensagemDeSuporte,
  problemaNoChamado,
  ROTULO_CATEGORIA_SUPORTE,
  ROTULO_SITUACAO_SUPORTE,
  type CategoriaSuporte,
  type ChamadoSuporteDetalhe,
  type ChamadoSuporteResumo,
  type SituacaoSuporte,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Cabecalho, Campo, formatarData, Modal, Selecao, Selo, Tabela } from '../../components/ui';

const COR: Record<SituacaoSuporte, 'verde' | 'amarelo' | 'cinza'> = { ABERTO: 'amarelo', RESPONDIDO: 'verde', RESOLVIDO: 'cinza' };
/** Para o suporte, "aberto" é o que espera resposta. */
const ROTULO_PARA_SUPORTE: Record<SituacaoSuporte, string> = { ABERTO: 'Esperando resposta', RESPONDIDO: 'Respondido', RESOLVIDO: 'Resolvido' };

function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

function EscolherImagem({ valor, mudar }: { valor: string | null; mudar: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="cursor-pointer text-blue-700 underline">
        {valor ? 'Trocar a imagem' : 'Anexar uma imagem (print da tela)'}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) mudar(await lerArquivo(f)); e.target.value = ''; }} />
      </label>
      {valor && (
        <>
          <img src={valor} alt="" className="h-10 w-10 rounded object-cover" />
          <button type="button" className="text-slate-500 underline" onClick={() => mudar(null)}>
            Tirar
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Suporte da plataforma. A empresa abre chamados e conversa com o suporte; o super-admin vê os de
 * todas as empresas e dos entregadores (que abrem pelo app), responde e marca como resolvido.
 */
export function Suporte() {
  const { usuario } = useAuth();
  const plataforma = !!usuario?.superAdmin;
  const base = plataforma ? '/plataforma/suporte' : '/suporte';
  const [filtro, setFiltro] = useState<'PENDENTES' | 'TODOS'>(plataforma ? 'PENDENTES' : 'TODOS');
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const lista = useQuery({ queryKey: ['suporte', base, filtro], queryFn: () => api<ChamadoSuporteResumo[]>(plataforma ? `${base}?situacao=${filtro}` : base), refetchInterval: 30_000 });

  return (
    <div className="space-y-4">
      <Cabecalho
        titulo="Suporte"
        descricao={plataforma ? 'Chamados das empresas e dos entregadores. Responda e marque como resolvido; quem abriu recebe um e-mail quando há resposta.' : 'Fale com o suporte do Flow: problema no site ou no app, pagamento, cadastro ou uma entrega. A resposta aparece aqui e chega por e-mail.'}
        acoes={!plataforma && <Botao onClick={() => setNovo(true)}>Novo chamado</Botao>}
      />
      {plataforma && (
        <div className="w-56">
          <Selecao rotulo="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as 'PENDENTES' | 'TODOS')}>
            <option value="PENDENTES">Esperando resposta</option>
            <option value="TODOS">Todos</option>
          </Selecao>
        </div>
      )}
      {lista.error && <Alerta>{lista.error.message}</Alerta>}
      {lista.data && (
        <Tabela colunas={plataforma ? ['Nº', 'De', 'Assunto', 'Atualizado', 'Situação'] : ['Nº', 'Assunto', 'Aberto por', 'Atualizado', 'Situação']} vazio={!lista.data.length}>
          {lista.data.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setAberto(c.id)} data-testid="chamado-suporte">
              <td className="px-4 py-2.5 font-medium">{c.numero}</td>
              {plataforma && (
                <td className="px-4 py-2.5">
                  {c.origem === 'ENTREGADOR' ? 'Entregador' : c.empresa}
                  <div className="text-xs text-slate-500">{c.autor}</div>
                </td>
              )}
              <td className="px-4 py-2.5">
                {c.assunto}
                <div className="text-xs text-slate-500">{ROTULO_CATEGORIA_SUPORTE[c.categoria]}</div>
                {c.naoLidas > 0 && <div className="text-xs font-semibold text-blue-700">{c.naoLidas === 1 ? '1 mensagem nova' : `${c.naoLidas} mensagens novas`}</div>}
              </td>
              {!plataforma && <td className="px-4 py-2.5 text-slate-600">{c.autor}</td>}
              <td className="px-4 py-2.5 text-xs text-slate-600">{formatarData(c.atualizadoEm)}</td>
              <td className="px-4 py-2.5">
                <Selo cor={COR[c.situacao]}>{(plataforma ? ROTULO_PARA_SUPORTE : ROTULO_SITUACAO_SUPORTE)[c.situacao]}</Selo>
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      {novo && <NovoChamado aoFechar={() => setNovo(false)} aoAbrir={(id) => { setNovo(false); setAberto(id); }} />}
      {aberto && <DetalheChamado id={aberto} base={base} plataforma={plataforma} aoFechar={() => setAberto(null)} />}
    </div>
  );
}

function NovoChamado({ aoFechar, aoAbrir }: { aoFechar: () => void; aoAbrir: (id: string) => void }) {
  const cliente = useQueryClient();
  const [categoria, setCategoria] = useState<CategoriaSuporte>('APP');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [imagem, setImagem] = useState<string | null>(null);
  const problema = problemaNoChamado({ categoria, assunto, texto });
  const abrir = useMutation({
    mutationFn: () => api<ChamadoSuporteDetalhe>('/suporte', { metodo: 'POST', corpo: { categoria, assunto, texto, imagem } }),
    onSuccess: (c) => {
      void cliente.invalidateQueries({ queryKey: ['suporte'] });
      aoAbrir(c.id);
    },
  });
  return (
    <Modal titulo="Novo chamado" aberto aoFechar={aoFechar}>
      <div className="space-y-3 text-sm">
        <Selecao rotulo="Assunto" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaSuporte)}>
          {CATEGORIAS_SUPORTE.map((c) => (
            <option key={c} value={c}>
              {ROTULO_CATEGORIA_SUPORTE[c]}
            </option>
          ))}
        </Selecao>
        <Campo rotulo="Título" value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={120} placeholder="Ex.: A etiqueta sai cortada na impressora" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">O que aconteceu</span>
          <textarea className="h-32 w-full rounded-lg border border-slate-300 px-3 py-2" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={LIMITE_TEXTO_SUPORTE} placeholder="Conte o que estava fazendo, o que esperava e o que apareceu." />
        </label>
        <EscolherImagem valor={imagem} mudar={setImagem} />
        {(assunto || texto) && problema && <Alerta tipo="aviso">{problema}</Alerta>}
        {abrir.error && <Alerta>{abrir.error.message}</Alerta>}
        <Botao onClick={() => abrir.mutate()} disabled={!!problema || abrir.isPending}>
          {abrir.isPending ? 'Enviando…' : 'Enviar ao suporte'}
        </Botao>
      </div>
    </Modal>
  );
}

function ImagemDaMensagem({ base, chamado, mensagem }: { base: string; chamado: string; mensagem: string }) {
  const { data } = useQuery({ queryKey: ['suporte-imagem', mensagem], queryFn: () => api<{ dados: string }>(`${base}/${chamado}/imagens/${mensagem}`), staleTime: Infinity });
  if (!data) return <span className="text-xs text-slate-500">Carregando a imagem…</span>;
  return (
    <a href={data.dados} target="_blank" rel="noreferrer">
      <img src={data.dados} alt="Imagem anexada" className="mt-1 max-h-48 rounded border border-slate-200" />
    </a>
  );
}

function DetalheChamado({ id, base, plataforma, aoFechar }: { id: string; base: string; plataforma: boolean; aoFechar: () => void }) {
  const cliente = useQueryClient();
  const { data: c, error } = useQuery({ queryKey: ['suporte-chamado', id], queryFn: () => api<ChamadoSuporteDetalhe>(`${base}/${id}`), refetchInterval: 20_000 });
  const [texto, setTexto] = useState('');
  const [imagem, setImagem] = useState<string | null>(null);
  const atualizar = (r: ChamadoSuporteDetalhe) => {
    cliente.setQueryData(['suporte-chamado', id], r);
    void cliente.invalidateQueries({ queryKey: ['suporte'] });
    void cliente.invalidateQueries({ queryKey: ['suporte-nao-lidas'] });
  };
  const responder = useMutation({
    mutationFn: () => api<ChamadoSuporteDetalhe>(`${base}/${id}/mensagens`, { metodo: 'POST', corpo: { texto, imagem } }),
    onSuccess: (r) => {
      setTexto('');
      setImagem(null);
      atualizar(r);
    },
  });
  const resolver = useMutation({ mutationFn: () => api<ChamadoSuporteDetalhe>(`${base}/${id}/resolver`, { metodo: 'POST' }), onSuccess: atualizar });
  const problema = problemaNaMensagemDeSuporte(texto);
  return (
    <Modal titulo={c ? `Chamado nº ${c.numero}: ${c.assunto}` : 'Chamado'} aberto aoFechar={aoFechar} largo>
      {error && <Alerta>{error.message}</Alerta>}
      {c && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3 text-slate-600">
            <Selo cor={COR[c.situacao]}>{(plataforma ? ROTULO_PARA_SUPORTE : ROTULO_SITUACAO_SUPORTE)[c.situacao]}</Selo>
            <span>{ROTULO_CATEGORIA_SUPORTE[c.categoria]}</span>
            <span>Aberto em {formatarData(c.criadoEm)}</span>
            {plataforma && (
              <span>
                {c.origem === 'ENTREGADOR' ? 'Entregador' : c.empresa}: {c.autor}
                {c.contato?.email && ` · ${c.contato.email}`}
                {c.contato?.telefone && ` · ${c.contato.telefone}`}
              </span>
            )}
          </div>
          <ol className="max-h-[50vh] space-y-2 overflow-y-auto" data-testid="mensagens-suporte">
            {c.mensagens.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 ${m.deSuporte === plataforma ? 'ml-auto bg-blue-50' : 'bg-slate-100'}`}>
                <div className="text-xs text-slate-500">
                  {m.autor} · {formatarData(m.criadoEm)}
                </div>
                <div className="whitespace-pre-wrap">{m.texto}</div>
                {m.temImagem && <ImagemDaMensagem base={base} chamado={c.id} mensagem={m.id} />}
              </li>
            ))}
          </ol>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{c.situacao === 'RESOLVIDO' ? 'Escrever de novo reabre o chamado' : 'Responder'}</span>
            <textarea className="h-24 w-full rounded-lg border border-slate-300 px-3 py-2" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={LIMITE_TEXTO_SUPORTE} />
          </label>
          <EscolherImagem valor={imagem} mudar={setImagem} />
          {(responder.error || resolver.error) && <Alerta>{(responder.error ?? resolver.error)!.message}</Alerta>}
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => responder.mutate()} disabled={!!problema || responder.isPending}>
              {responder.isPending ? 'Enviando…' : 'Enviar'}
            </Botao>
            {c.situacao !== 'RESOLVIDO' && (
              <Botao variante="secundario" onClick={() => resolver.mutate()} disabled={resolver.isPending}>
                Marcar como resolvido
              </Botao>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
