import { avisarRecursosDesign, Avisos, codigoValido, deslocamentoAlinhamento, eixos, formaTermica, larguraModulo, posicionar, semAcentos, type ElementoPosicionado, type OpcoesGeracao } from './comum';
import { mmParaPontos } from './valores';
import type { LayoutEtiqueta, Registro, Rotacao, SaidaEtiquetas } from './tipos';

/**
 * PPLA (Argox, derivada do DPL da Datamax). Coordenadas em modo métrico (0,1 mm) a partir
 * do canto inferior esquerdo da etiqueta. Texto na fonte 9 (ASD suave), tamanhos fixos.
 */
const TAMANHOS_ASD = [4, 5, 6, 8, 10, 12, 14, 18, 24, 30, 36, 48, 72];
const ROTACAO: Record<Rotacao, number> = { 0: 1, 90: 4, 180: 3, 270: 2 };
const STX = '\x02';

const d4 = (n: number) => String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, '0');
const d3 = (n: number) => String(Math.max(0, Math.min(999, Math.round(n)))).padStart(3, '0');

export function tamanhoAsd(pt: number): number {
  return TAMANHOS_ASD.reduce((a, b) => (Math.abs(b - pt) < Math.abs(a - pt) ? b : a));
}

/** Converte pontos da página para décimos de mm, com a linha medida de baixo para cima. */
function emDecimos(pontos: number, dpi: number) {
  return (pontos * 254) / dpi;
}

function registro(e: ElementoPosicionado, alturaPagina: number, dpi: number, avisos: Avisos): string[] {
  const { comprimento, espessura } = eixos(e);
  const r = ROTACAO[e.el.rotacao];
  // Base do campo (linha) e coluna em décimos de mm; rotação gira em torno desse ponto.
  const coluna = (x: number) => d4(emDecimos(x, dpi));
  const linha = (yBase: number) => d4(emDecimos(alturaPagina - yBase, dpi));
  if (e.el.rotacao !== 0 && (e.el.tipo === 'texto' || e.el.tipo === 'preco' || e.el.tipo === 'codigo_barras')) {
    avisos.add('PPLA: elementos girados podem sair deslocados; confira a primeira impressão.');
  }

  switch (e.el.tipo) {
    case 'texto':
    case 'preco': {
      if (!e.texto) return [];
      const pt = tamanhoAsd(e.el.tamanhoPt);
      const alturaPontos = (pt * dpi) / 72;
      const ocupado = alturaPontos * 0.55 * e.texto.length;
      const desl = deslocamentoAlinhamento(e.el.alinhamento, comprimento, ocupado);
      const x = e.el.rotacao === 0 ? e.x + desl : e.x;
      const yBase = e.el.rotacao === 0 ? e.y + Math.min(espessura, alturaPontos) : e.y + e.altura;
      const cmd = (dx: number) => `${r}911A${String(pt).padStart(2, '0')}${linha(yBase)}${coluna(x + dx)}${semAcentos(e.texto)}`;
      return e.el.negrito ? [cmd(0), cmd(1)] : [cmd(0)];
    }
    case 'codigo_barras': {
      const c = codigoValido(e, avisos);
      if (!c) return [];
      const ids = { EAN13: 'F', EAN8: 'G', CODE128: 'E', CODE39: 'A' } as const;
      const id = e.el.mostrarTexto ? ids[e.el.simbologia] : ids[e.el.simbologia].toLowerCase();
      const modulo = Math.min(9, larguraModulo(e.el.simbologia, c.dados, comprimento));
      const alturaBarras = Math.max(10, espessura - (e.el.mostrarTexto ? mmParaPontos(3, dpi) : 0));
      // Largo = 3 × estreito (Code 39); nas demais o "largo" é ignorado pela impressora.
      return [`${r}${id}${Math.min(9, modulo * 3)}${modulo}${d3(emDecimos(alturaBarras, dpi))}${linha(e.y + e.altura)}${coluna(e.x)}${c.dados}`];
    }
    case 'qrcode':
      avisos.add('PPLA: QR code ainda não é gerado nesta linguagem; use PPLB, ZPL ou PDF.');
      return [];
    case 'imagem':
      avisos.add('PPLA: imagens ainda não são impressas nesta linguagem; use PPLB, ZPL, ESC/POS ou PDF.');
      return [];
    case 'elipse':
    case 'estrela':
      avisos.add('PPLA: elipses e estrelas não são impressas nesta linguagem.');
      return [];
    case 'retangulo':
    case 'linha': {
      const f = e.el.tipo === 'retangulo' ? formaTermica(e.el) : { preenchido: true, bordaMm: e.el.espessuraMm };
      if (!f) return [];
      // Comando de linha/caixa: 1X11000 linha coluna l (linha) ou b (caixa) largura altura espessura.
      const t = d3(emDecimos(Math.max(1, mmParaPontos(f.bordaMm, dpi)), dpi));
      const larg = d4(emDecimos(e.largura, dpi));
      const alt = d4(emDecimos(e.altura, dpi));
      if (e.el.tipo === 'retangulo' && !f.preenchido) {
        return [`1X1100${linha(e.y + e.altura)}${coluna(e.x)}b${larg}${alt}${t}${t}`];
      }
      return [`1X1100${linha(e.y + e.altura)}${coluna(e.x)}l${larg}${alt}`];
    }
  }
}

/** Gera PPLA: um formato (<STX>L … E) por fileira de etiquetas. */
export function gerarPpla(layout: LayoutEtiqueta, registros: Registro[], opcoes: OpcoesGeracao): SaidaEtiquetas {
  const avisos = new Avisos();
  avisarRecursosDesign(layout, 'PPLA', avisos);
  const paginas = posicionar(layout, registros, opcoes);
  const formatos = paginas.map((p) =>
    [`${STX}L`, 'D11', 'm', ...p.elementos.flatMap((e) => registro(e, p.alturaPontos, opcoes.dpi, avisos)), 'Q0001', 'E'].join('\r\n'),
  );
  if (paginas.some((p) => p.elementos.some((e) => e.texto !== semAcentos(e.texto)))) {
    avisos.add('PPLA: acentos e caracteres especiais foram removidos.');
  }
  avisos.add('PPLA: gerado conforme o manual da linguagem, ainda sem validação em impressora real; confira a primeira impressão.');
  return { linguagem: 'PPLA', mime: 'text/plain; charset=us-ascii', codificacao: 'texto', conteudo: formatos.join('\r\n') + '\r\n', avisos: avisos.lista() };
}
