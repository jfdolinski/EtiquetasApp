import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { FORMATOS_POST, MODELOS_POST, type ImagemGaleria, type PostCompleto, type PostResumo, type SituacaoMarcaPost } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Tabela, formatarData } from '../../components/ui';
import { enviarParaGaleria } from './apoio';

/** O espaçamento dos outros campos deixaria só um risco da cor escolhida. */
const CLASSE_COR = 'h-11 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1';

export function Posts() {
  return (
    <ExigeEmpresa>
      <ListaDePosts />
    </ExigeEmpresa>
  );
}

function ListaDePosts() {
  const { pode } = useAuth();
  const cliente = useQueryClient();
  const [editandoMarca, setEditandoMarca] = useState(false);
  const { data: posts = [], isLoading, error } = useQuery({ queryKey: ['posts'], queryFn: () => api<PostResumo[]>('/posts') });
  const excluir = useMutation({
    mutationFn: (id: string) => api(`/posts/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['posts'] }),
  });
  const podeEditar = pode('post.editar');
  const navegar = useNavigate();
  const [erroCopia, setErroCopia] = useState('');

  /** Abre uma cópia no editor; só vira post novo ao salvar. */
  async function duplicar(p: PostResumo) {
    setErroCopia('');
    try {
      const { id: _id, atualizadoEm: _a, ...dados } = await api<PostCompleto>(`/posts/${p.id}`);
      // A cópia não passa pelo template: é igual ao original.
      navegar('/posts/novo', { state: { copia: { ...dados, titulo: `Cópia de ${dados.titulo}`.slice(0, 120) } } });
    } catch (x) {
      setErroCopia((x as Error).message);
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Posts"
        descricao="Artes para redes sociais, com dados do ERP e imagens do catálogo ou da sua galeria."
        acoes={
          podeEditar && (
            <div className="flex gap-2">
              <Botao variante="secundario" onClick={() => setEditandoMarca(true)}>Marca da empresa</Botao>
              <Link to="/posts/novo" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Novo post</Link>
            </div>
          )
        }
      />
      <div className="space-y-4">
        {(error ?? excluir.error) && <Alerta>{(error ?? excluir.error)!.message}</Alerta>}
        {erroCopia && <Alerta>{erroCopia}</Alerta>}
        {!isLoading && (
          <Tabela colunas={['Nome', 'Modelo', 'Tamanho', 'Criado por', 'Alterado em', '']} vazio={posts.length === 0}>
            {posts.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2.5 font-medium"><Link to={`/posts/${p.id}`} className="text-blue-700 hover:underline">{p.titulo}</Link></td>
                <td className="px-4 py-2.5">{MODELOS_POST[p.modelo].rotulo}</td>
                <td className="whitespace-nowrap px-4 py-2.5">{FORMATOS_POST[p.formato].rotulo}</td>
                <td className="px-4 py-2.5 text-slate-600">{p.autor ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatarData(p.atualizadoEm)}</td>
                <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                  {podeEditar && <Botao variante="secundario" aria-label={`Duplicar ${p.titulo}`} onClick={() => void duplicar(p)}>Duplicar</Botao>}
                  {podeEditar && (
                    <Botao variante="secundario" aria-label={`Excluir ${p.titulo}`} disabled={excluir.isPending} onClick={() => window.confirm(`Excluir o post "${p.titulo}"?`) && excluir.mutate(p.id)}>
                      Excluir
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
        )}
      </div>
      <Modal titulo="Marca da empresa" aberto={editandoMarca} aoFechar={() => setEditandoMarca(false)}>
        {editandoMarca && <FormMarca aoConcluir={() => setEditandoMarca(false)} />}
      </Modal>
    </>
  );
}

function FormMarca({ aoConcluir }: { aoConcluir: () => void }) {
  const { data: marca, error } = useQuery({ queryKey: ['posts-marca'], queryFn: () => api<SituacaoMarcaPost>('/posts/marca') });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!marca) return <p className="text-sm text-slate-500">Carregando…</p>;
  return <CamposMarca marca={marca} aoConcluir={aoConcluir} />;
}

function CamposMarca({ marca, aoConcluir }: { marca: SituacaoMarcaPost; aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({ nome: marca.nome, corPrincipal: marca.corPrincipal, corDestaque: marca.corDestaque, logoId: marca.logoId ?? '' });
  const [chave, setChave] = useState('');
  const [tirarChave, setTirarChave] = useState(false);
  const [erro, setErro] = useState('');
  const { data: imagens = [] } = useQuery({ queryKey: ['posts-imagens'], queryFn: () => api<ImagemGaleria[]>('/posts/imagens') });
  const salvar = useMutation({
    mutationFn: () => api('/posts/marca', { metodo: 'PUT', corpo: { ...f, logoId: f.logoId || null, ...(tirarChave ? { chaveCatalogo: '' } : chave.trim() ? { chaveCatalogo: chave.trim() } : {}) } }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['posts-marca'] });
      aoConcluir();
    },
  });

  async function enviarLogo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro('');
    try {
      const nova = await enviarParaGaleria(arquivo);
      await cliente.invalidateQueries({ queryKey: ['posts-imagens'] });
      setF((a) => ({ ...a, logoId: nova.id }));
    } catch (x) {
      setErro((x as Error).message);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
      {erro && <Alerta>{erro}</Alerta>}
      <Campo rotulo="Nome na arte" required maxLength={120} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} ajuda="Aparece no topo do post quando não há logomarca." />
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Cor principal" type="color" className={CLASSE_COR} value={f.corPrincipal} onChange={(e) => setF({ ...f, corPrincipal: e.target.value })} />
        <Campo rotulo="Cor do preço" type="color" className={CLASSE_COR} value={f.corDestaque} onChange={(e) => setF({ ...f, corDestaque: e.target.value })} />
      </div>
      <Selecao rotulo="Logomarca" value={f.logoId} onChange={(e) => setF({ ...f, logoId: e.target.value })}>
        <option value="">Sem logomarca</option>
        {imagens.map((i) => (
          <option key={i.id} value={i.id}>{i.nome}</option>
        ))}
      </Selecao>
      <label className="block text-sm font-medium text-slate-700">
        Enviar logomarca
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void enviarLogo(e)} className="mt-1 block w-full text-sm font-normal" />
      </label>
      {marca.catalogoConfigurado ? (
        <div className="space-y-1">
          <Campo
            rotulo="Chave da empresa no catálogo"
            type="password"
            autoComplete="off"
            maxLength={300}
            disabled={tirarChave}
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            ajuda={marca.temChaveCatalogo ? 'Já há uma chave salva. Preencha só para trocar. Ela nunca é mostrada de novo.' : 'As consultas ao catálogo são contadas para esta chave.'}
          />
          {marca.temChaveCatalogo && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tirarChave} onChange={(e) => setTirarChave(e.target.checked)} />
              Remover a chave salva
            </label>
          )}
        </div>
      ) : (
        <Alerta tipo="aviso">O catálogo não está configurado neste servidor. Por enquanto, só imagem própria.</Alerta>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
      </div>
    </form>
  );
}
