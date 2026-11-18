// Entregas, etapa 11: assinatura na entrega, mais de uma chamada por vez e pedidos juntos numa chamada.
// Regras puras; o app do entregador tem cópias conferidas em entregas-app.test.ts.

import type { RasterCinza } from './etiquetas/imagem';
import { MAX_PARADAS_EXTRAS } from './entregas-paradas';

// Assinatura ---------------------------------------------------------------------------------

export const MODOS_ASSINATURA = ['NAO', 'JUNTO_AO_CODIGO', 'NO_LUGAR_DO_CODIGO'] as const;
export type ModoAssinatura = (typeof MODOS_ASSINATURA)[number];

export const ROTULO_MODO_ASSINATURA: Record<ModoAssinatura, string> = {
  NAO: 'Só o código',
  JUNTO_AO_CODIGO: 'Código e assinatura',
  NO_LUGAR_DO_CODIGO: 'Assinatura no lugar do código',
};

/** Traços em frações da área (0 a 1), como o dedo passou na tela. */
export type TracoAssinatura = [number, number][];

export interface AssinaturaEntrega {
  tracos: TracoAssinatura[];
  /** Nome de quem recebeu. */
  recebedor: string;
}

export const LIMITES_ASSINATURA = { tracos: 60, pontos: 3000, recebedorMaximo: 80 };
/** Proporção da área de assinatura (largura ÷ altura), igual no app e na imagem gravada. */
export const PROPORCAO_ASSINATURA = 2.5;

/** Comprimento total dos traços, na escala da largura (rabisco de um ponto só não vale). */
export function comprimentoDaAssinatura(tracos: TracoAssinatura[]): number {
  let total = 0;
  for (const t of tracos)
    for (let i = 1; i < t.length; i++) total += Math.hypot(t[i][0] - t[i - 1][0], (t[i][1] - t[i - 1][1]) / PROPORCAO_ASSINATURA);
  return total;
}

export function problemaNaAssinatura(a: Partial<AssinaturaEntrega> | null | undefined): string | null {
  if (!a || !Array.isArray(a.tracos)) return 'Peça para quem recebe assinar na tela.';
  if ((a.recebedor ?? '').trim().length < 2) return 'Informe o nome de quem recebeu.';
  if ((a.recebedor ?? '').length > LIMITES_ASSINATURA.recebedorMaximo) return 'Nome longo demais.';
  if (a.tracos.length > LIMITES_ASSINATURA.tracos) return 'Assinatura com traços demais: limpe e assine de novo.';
  let pontos = 0;
  for (const t of a.tracos) {
    if (!Array.isArray(t)) return 'Assinatura inválida.';
    for (const p of t) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) return 'Assinatura inválida.';
      pontos++;
    }
  }
  if (pontos > LIMITES_ASSINATURA.pontos) return 'Assinatura com traços demais: limpe e assine de novo.';
  if (comprimentoDaAssinatura(a.tracos) < 0.3) return 'Peça para quem recebe assinar na tela.';
  return null;
}

/** Desenha os traços em preto sobre branco (a API grava como PNG, como as fotos da chamada). */
export function rasterizarAssinatura(tracos: TracoAssinatura[], largura = 600, espessura = 3): RasterCinza {
  const altura = Math.round(largura / PROPORCAO_ASSINATURA);
  const pixels = new Uint8Array(largura * altura).fill(255);
  const r = espessura / 2;
  const ponto = (cx: number, cy: number) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (x >= 0 && y >= 0 && x < largura && y < altura && (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) pixels[y * largura + x] = 0;
  };
  for (const t of tracos) {
    for (let i = 0; i < t.length; i++) {
      const [x1, y1] = [t[i][0] * (largura - 1), t[i][1] * (altura - 1)];
      if (i === 0) ponto(x1, y1);
      else {
        const [x0, y0] = [t[i - 1][0] * (largura - 1), t[i - 1][1] * (altura - 1)];
        const passos = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
        for (let k = 1; k <= passos; k++) ponto(x0 + ((x1 - x0) * k) / passos, y0 + ((y1 - y0) * k) / passos);
      }
    }
  }
  return { largura, altura, pixels };
}

// Mais de uma chamada por vez ------------------------------------------------------------------

export const LIMITES_CHAMADAS_SIMULTANEAS = { minimo: 1, maximo: 3 };

/**
 * Pode pegar mais uma chamada desta empresa? Livre, sempre; ocupado, só se a empresa permite mais de
 * uma, todas as que ele tem são dela e ainda cabe no limite (empresas diferentes não se misturam).
 */
export function podePegarOutra(ativas: { empresaId: string }[], empresaId: string, limite: number): boolean {
  if (ativas.length === 0) return true;
  return ativas.every((c) => c.empresaId === empresaId) && ativas.length < Math.max(1, limite);
}

// Pedidos juntos -----------------------------------------------------------------------------

/** O destino principal mais as paradas extras. */
export const MAX_PEDIDOS_JUNTOS = 1 + MAX_PARADAS_EXTRAS;

export function problemaNosPedidosJuntos(quantidade: number): string | null {
  if (quantidade < 2) return 'Escolha ao menos dois pedidos para juntar.';
  if (quantidade > MAX_PEDIDOS_JUNTOS) return `Uma chamada leva até ${MAX_PEDIDOS_JUNTOS} pedidos.`;
  return null;
}
