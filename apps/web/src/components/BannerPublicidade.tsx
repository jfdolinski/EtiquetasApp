import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BannerVigente } from '@etiquetas/shared';
import { api } from '../api';

const TROCA_MS = 30_000;
/** A mesma propaganda conta de novo só depois disto: trocar de tela não vira exibição nova. */
const INTERVALO_EXIBICAO_MS = 10 * 60_000;

/** Espaço pago: não tem botão de fechar. Com mais de um anunciante, revezam. */
export function BannerPublicidade() {
  const { data: banners = [] } = useQuery({
    queryKey: ['banners-vigentes'],
    queryFn: () => api<BannerVigente[]>('/banners/vigentes'),
    refetchInterval: 10 * 60_000,
  });
  const [indice, setIndice] = useState(0);
  const contados = useRef(new Map<string, number>());

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => setIndice((i) => i + 1), TROCA_MS);
    return () => clearInterval(t);
  }, [banners.length]);

  const banner = banners.length ? banners[indice % banners.length] : null;

  useEffect(() => {
    if (!banner || document.visibilityState !== 'visible') return;
    const ultima = contados.current.get(banner.id) ?? 0;
    if (Date.now() - ultima < INTERVALO_EXIBICAO_MS) return;
    contados.current.set(banner.id, Date.now());
    void api(`/banners/${banner.id}/exibicao`, { metodo: 'POST' }).catch(() => undefined);
  }, [banner]);

  if (!banner) return null;

  const conteudo = banner.imagem ? (
    <img src={banner.imagem} alt={banner.texto || banner.anunciante} className="mx-auto max-h-24 max-w-full object-contain" />
  ) : (
    <span className="block px-4 py-3 text-center text-sm font-medium text-slate-800">{banner.texto}</span>
  );

  return (
    <aside aria-label="Publicidade" className="mb-4 rounded-md border border-slate-200 bg-white print:hidden">
      {banner.link ? (
        <a href={banner.link} target="_blank" rel="noopener noreferrer sponsored" onClick={() => void api(`/banners/${banner.id}/clique`, { metodo: 'POST' }).catch(() => undefined)} className="block hover:opacity-90">
          {conteudo}
        </a>
      ) : (
        conteudo
      )}
      <div className="border-t border-slate-100 px-3 py-0.5 text-right text-[11px] text-slate-400">Publicidade · {banner.anunciante}</div>
    </aside>
  );
}
