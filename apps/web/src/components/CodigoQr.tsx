import { useEffect, useRef } from 'react';

/** QR code desenhado no navegador: o conteúdo (segredos, inclusive) não sai para nenhum serviço. */
export function CodigoQr({ texto, tamanho = 200 }: { texto: string; tamanho?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let ativo = true;
    // bwip-js é pesado: só é baixado por quem abre um QR code.
    void import('bwip-js/browser').then(({ default: bwipjs }) => {
      if (ativo && canvas.current) bwipjs.toCanvas(canvas.current, { bcid: 'qrcode', text: texto, scale: 6, paddingwidth: 4, paddingheight: 4, backgroundcolor: 'FFFFFF' });
    });
    return () => {
      ativo = false;
    };
  }, [texto]);

  return <canvas ref={canvas} role="img" aria-label="QR code" style={{ width: tamanho, height: tamanho, imageRendering: 'pixelated' }} className="rounded border border-slate-200" />;
}
