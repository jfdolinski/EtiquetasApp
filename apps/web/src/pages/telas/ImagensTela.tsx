import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { caminhoImagemTela, LIMITES_CONTEUDO_TELA, MAX_IMAGENS_POR_CONTEUDO, PARAMETROS_TELAS_PADRAO, type ImagemNoConteudo, type ImagemTelaResumo } from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao } from '../../components/ui';

/** Acima disso nem adianta mandar: o limite de verdade é o parâmetro, conferido na API. */
const MAIOR_ARQUIVO_MB = 10;

export function useImagensTela() {
  const { empresaId } = useAuth();
  return useQuery({ queryKey: ['telas-imagens', empresaId], queryFn: () => api<ImagemTelaResumo[]>('/telas/conteudos/imagens') });
}

function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.onload = () => resolver(String(leitor.result));
    leitor.readAsDataURL(arquivo);
  });
}

/** As medidas só servem para avisar de formato diferente: sem elas, a imagem é enviada igual. */
function medir(dados: string): Promise<{ largura?: number; altura?: number }> {
  return new Promise((resolver) => {
    const img = new Image();
    img.onload = () => resolver({ largura: img.naturalWidth || undefined, altura: img.naturalHeight || undefined });
    img.onerror = () => resolver({});
    img.src = dados;
  });
}

async function enviar(arquivo: File): Promise<ImagemTelaResumo> {
  if (arquivo.size > MAIOR_ARQUIVO_MB * 1_000_000) throw new Error(`“${arquivo.name}” passa de ${MAIOR_ARQUIVO_MB} MB.`);
  const dados = await lerArquivo(arquivo);
  const medidas = await medir(dados);
  return api<ImagemTelaResumo>('/telas/conteudos/imagens', { metodo: 'POST', corpo: { nome: arquivo.name, dados, ...medidas } });
}

const tamanhoLegivel = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

export function ImagensDoConteudo({ selecionadas, segundosPadrao, aoMudar }: { selecionadas: ImagemNoConteudo[]; segundosPadrao: number; aoMudar: (imagens: ImagemNoConteudo[]) => void }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const { data: imagens = [], error } = useImagensTela();
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const recarregar = () => cliente.invalidateQueries({ queryKey: ['telas-imagens', empresaId] });
  const excluir = useMutation({ mutationFn: (id: string) => api(`/telas/conteudos/imagens/${id}`, { metodo: 'DELETE' }), onSuccess: () => void recarregar() });

  const incluir = (lista: ImagemNoConteudo[], id: string) => (lista.length >= MAX_IMAGENS_POR_CONTEUDO || lista.some((s) => s.imagemId === id) ? lista : [...lista, { imagemId: id, segundos: segundosPadrao || 8 }]);

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = [...(e.target.files ?? [])];
    e.target.value = '';
    if (arquivos.length === 0) return;
    setEnviando(true);
    setErroEnvio(null);
    let lista = selecionadas;
    const erros: string[] = [];
    // Uma por vez: uma imagem recusada não atrapalha as outras.
    for (const arquivo of arquivos) {
      try {
        const nova = await enviar(arquivo);
        lista = incluir(lista, nova.id);
      } catch (erro) {
        erros.push(`${arquivo.name}: ${(erro as Error).message}`);
      }
    }
    aoMudar(lista);
    await recarregar();
    setEnviando(false);
    if (erros.length) setErroEnvio(erros.join(' '));
  }

  const nomeDe = (id: string) => imagens.find((i) => i.id === id)?.nome ?? 'Imagem';
  const mover = (indice: number, passo: number) => {
    const nova = [...selecionadas];
    const [item] = nova.splice(indice, 1);
    nova.splice(indice + passo, 0, item);
    aoMudar(nova);
  };
  const [min, max] = LIMITES_CONTEUDO_TELA.segundosPorCena;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-slate-700">Imagens desta sequência</legend>
      {selecionadas.length === 0 && <p className="text-sm text-slate-500">Nenhuma imagem escolhida ainda.</p>}
      <ol className="space-y-2">
        {selecionadas.map((s, i) => (
          <li key={s.imagemId} className="flex items-center gap-2 rounded-md border border-slate-200 p-2">
            <img src={caminhoImagemTela(s.imagemId)} alt="" className="h-10 w-16 shrink-0 rounded bg-slate-100 object-contain" />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{nomeDe(s.imagemId)}</span>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input aria-label={`Segundos de ${nomeDe(s.imagemId)}`} type="number" min={min} max={max} value={s.segundos} onChange={(e) => aoMudar(selecionadas.map((x, j) => (j === i ? { ...x, segundos: Number(e.target.value) } : x)))} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900" />
              s
            </label>
            <button type="button" aria-label={`Subir ${nomeDe(s.imagemId)}`} disabled={i === 0} className="px-1 text-slate-500 hover:text-slate-900 disabled:opacity-30" onClick={() => mover(i, -1)}>↑</button>
            <button type="button" aria-label={`Descer ${nomeDe(s.imagemId)}`} disabled={i === selecionadas.length - 1} className="px-1 text-slate-500 hover:text-slate-900 disabled:opacity-30" onClick={() => mover(i, 1)}>↓</button>
            <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => aoMudar(selecionadas.filter((_, j) => j !== i))}>Tirar</button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="secundario" disabled={enviando} onClick={() => entrada.current?.click()}>{enviando ? 'Enviando…' : 'Enviar imagens'}</Botao>
        <input ref={entrada} aria-label="Arquivos de imagem" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void aoEscolher(e)} />
        <span className="text-xs text-slate-500">PNG, JPEG, WebP ou GIF, até {PARAMETROS_TELAS_PADRAO.imagemTamanhoMaximoMb} MB. Salve com o tamanho da tela para não sobrar nem cortar.</span>
      </div>
      {error && <Alerta>{(error as Error).message}</Alerta>}
      {erroEnvio && <Alerta>{erroEnvio}</Alerta>}
      {excluir.error && <Alerta>{(excluir.error as Error).message}</Alerta>}

      {imagens.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Galeria desta empresa</p>
          <ul className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {imagens.map((i) => {
              const usada = selecionadas.some((s) => s.imagemId === i.id);
              return (
                <li key={i.id} className={`rounded-md border p-1 ${usada ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}>
                  <button type="button" title={i.nome} aria-label={`Usar ${i.nome}`} aria-pressed={usada} className="block w-full" onClick={() => aoMudar(usada ? selecionadas.filter((s) => s.imagemId !== i.id) : incluir(selecionadas, i.id))}>
                    <img src={caminhoImagemTela(i.id)} alt="" loading="lazy" className="h-14 w-full rounded bg-slate-100 object-contain" />
                  </button>
                  <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-slate-500">
                    <span>{tamanhoLegivel(i.bytes)}</span>
                    {/* Em uso em outro conteúdo a API recusa, e a mensagem aparece acima. */}
                    {!usada && <button type="button" aria-label={`Excluir ${i.nome}`} className="text-red-700 hover:underline" onClick={() => window.confirm(`Excluir “${i.nome}” da galeria?`) && excluir.mutate(i.id)}>Excluir</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
