import { useEffect, useMemo, useRef, useState } from 'react';
import { caminhoImagemPost, chaveImagemPost, type ImagemPost } from '@etiquetas/shared';
import { api, apiArquivo } from '../../api';

export type ImagemCarregada = HTMLImageElement | 'erro';

/**
 * Baixa as imagens pela nossa API (com a sessão) e usa endereços blob: a arte pode ser exportada
 * como PNG, porque o canvas não fica "contaminado" por imagem de outro site, e a CSP não muda.
 */
export function useImagensPost(imagens: ImagemPost[]): Map<string, ImagemCarregada> {
  const [mapa, setMapa] = useState<Map<string, ImagemCarregada>>(() => new Map());
  const pedidas = useRef(new Set<string>());
  const enderecos = useRef<string[]>([]);
  const assinatura = useMemo(() => imagens.map(chaveImagemPost).join('|'), [imagens]);

  useEffect(() => {
    for (const imagem of imagens) {
      const chave = chaveImagemPost(imagem);
      if (pedidas.current.has(chave)) continue;
      pedidas.current.add(chave);
      const guardar = (v: ImagemCarregada) => setMapa((atual) => new Map(atual).set(chave, v));
      apiArquivo(caminhoImagemPost(imagem))
        .then((blob) => {
          const endereco = URL.createObjectURL(blob);
          enderecos.current.push(endereco);
          const el = new Image();
          el.onload = () => guardar(el);
          el.onerror = () => guardar('erro');
          el.src = endereco;
        })
        .catch(() => guardar('erro'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura já resume a lista.
  }, [assinatura]);

  useEffect(
    () => () => {
      enderecos.current.forEach((e) => URL.revokeObjectURL(e));
    },
    [],
  );
  return mapa;
}

/** Classes dos campos pequenos dos painéis do editor. */
export const CLASSE_PAINEL = 'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none';

export const MAX_ARQUIVO_IMAGEM = 5_000_000;

/** Envia um arquivo para a galeria da empresa. */
export function enviarParaGaleria(arquivo: File): Promise<{ id: string; nome: string }> {
  if (arquivo.size > MAX_ARQUIVO_IMAGEM) return Promise.reject(new Error('A imagem passa de 5 MB.'));
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.onload = () => {
      api<{ id: string; nome: string }>('/posts/imagens', { metodo: 'POST', corpo: { nome: arquivo.name, dados: String(leitor.result) } }).then(resolver, rejeitar);
    };
    leitor.readAsDataURL(arquivo);
  });
}
