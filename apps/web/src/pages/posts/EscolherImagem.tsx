import { useMemo, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chaveImagemPost, type ImagemGaleria, type ImagemPost, type ProdutoCatalogo } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta } from '../../components/ui';
import { enviarParaGaleria, useImagensPost, type ImagemCarregada } from './apoio';

function Miniatura({ imagem, foto, rotulo, marcada, aoEscolher }: { imagem: ImagemPost; foto: ImagemCarregada | undefined; rotulo: string; marcada: boolean; aoEscolher: () => void }) {
  return (
    <button type="button" aria-label={rotulo} aria-pressed={marcada} title={rotulo} onClick={aoEscolher} className={`relative h-16 w-16 overflow-hidden rounded border bg-white ${marcada ? 'border-blue-600 ring-2 ring-blue-600' : 'border-slate-300'}`} data-imagem={chaveImagemPost(imagem)}>
      {foto && foto !== 'erro' && <img src={foto.src} alt="" className="h-full w-full object-contain" />}
      {foto === 'erro' && <span className="text-[10px] text-slate-500">Indisponível</span>}
      {imagem.origem === 'CATALOGO' && imagem.ia && <span className="absolute bottom-0 left-0 bg-amber-200 px-1 text-[10px] font-medium text-amber-900">IA</span>}
    </button>
  );
}

/** Imagens que dá para escolher: as do catálogo, para o produto, e a galeria da empresa. */
export function EscolherImagem({ titulo, catalogo, marcada, somenteLeitura, aoEscolher }: { titulo: string; catalogo: ProdutoCatalogo | null; marcada: ImagemPost | null; somenteLeitura: boolean; aoEscolher: (i: ImagemPost | null) => void }) {
  const cliente = useQueryClient();
  const [verIa, setVerIa] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { data: galeria = [] } = useQuery({ queryKey: ['posts-imagens'], queryFn: () => api<ImagemGaleria[]>('/posts/imagens') });
  const reais = catalogo?.imagens.filter((i) => !i.ia) ?? [];
  const deIa = catalogo?.imagens.filter((i) => i.ia) ?? [];
  const doCatalogo: ImagemPost[] = [...reais, ...(verIa ? deIa : [])].map((i) => ({ origem: 'CATALOGO', url: i.url, ia: i.ia }));
  const daGaleria: ImagemPost[] = galeria.map((i) => ({ origem: 'GALERIA', id: i.id }));
  const fotos = useImagensPost(useMemo(() => [...doCatalogo, ...daGaleria], [doCatalogo.map(chaveImagemPost).join(), daGaleria.map(chaveImagemPost).join()])); // eslint-disable-line react-hooks/exhaustive-deps
  const chaveMarcada = marcada && chaveImagemPost(marcada);

  async function enviar(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro('');
    setEnviando(true);
    try {
      const nova = await enviarParaGaleria(arquivo);
      await cliente.invalidateQueries({ queryKey: ['posts-imagens'] });
      aoEscolher({ origem: 'GALERIA', id: nova.id });
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const grade = (lista: ImagemPost[], rotulo: string) => (
    <div className="flex flex-wrap gap-2">
      {lista.map((i, n) => (
        <Miniatura key={chaveImagemPost(i)} imagem={i} foto={fotos.get(chaveImagemPost(i))} rotulo={`${rotulo} ${n + 1} para ${titulo}`} marcada={chaveMarcada === chaveImagemPost(i)} aoEscolher={() => aoEscolher(chaveMarcada === chaveImagemPost(i) ? null : i)} />
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      {erro && <Alerta>{erro}</Alerta>}
      {catalogo?.aviso && <Alerta tipo="aviso">{catalogo.aviso}</Alerta>}
      {catalogo && !catalogo.aviso && catalogo.imagens.length === 0 && <p className="text-xs text-slate-500">Sem imagem no catálogo para este produto. Use uma imagem própria.</p>}
      {doCatalogo.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Do catálogo</p>
          {grade(doCatalogo, 'Imagem do catálogo')}
        </div>
      )}
      {deIa.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={verIa} onChange={(e) => setVerIa(e.target.checked)} />
          Mostrar {deIa.length} imagem(ns) gerada(s) por IA. Saem com um aviso na arte e podem não reproduzir a embalagem exata.
        </label>
      )}
      {daGaleria.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Da galeria</p>
          {grade(daGaleria, 'Imagem da galeria')}
        </div>
      )}
      {!somenteLeitura && (
        <label className="block text-xs font-medium text-slate-600">
          {enviando ? 'Enviando…' : `Enviar imagem própria para ${titulo}`}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void enviar(e)} disabled={enviando} className="mt-1 block w-full text-sm font-normal" />
        </label>
      )}
    </div>
  );
}
