import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Ellipse, Group, Image as KImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import { aplicarCaixa, chaveImagemPost, fonteDoCatalogo, partesDoPreco, pontosEstrela, type AjusteElemento, type ElementoEtiqueta, type ElementoPost, type EstiloElemento, type FotoPost, type TextoPost } from '@etiquetas/shared';
import { imagemCodigo } from '../modelos/elementos';
import { cssFonte } from '../modelos/fontes';
import type { ImagemCarregada } from './apoio';

const ENTRELINHA = 1.15;
const IMA_PX = 10;

const familia = (id: string | undefined) => {
  const f = fonteDoCatalogo(id);
  return f.padraoPdf ? f.familia : `"${f.familia}"`;
};
const estiloFonte = (t: EstiloElemento) => [t.italico && 'italic', t.negrito && 'bold'].filter(Boolean).join(' ') || 'normal';
const textoFinal = (t: TextoPost) => aplicarCaixa(t.texto, t.caixa ?? 'normal');

/** Reduz o tamanho até o texto caber no quadro. */
function tamanhoQueCabe(t: TextoPost): number {
  const medidor = new Konva.Text({ text: textoFinal(t), width: t.largura, fontFamily: familia(t.fonte), fontStyle: estiloFonte(t), lineHeight: t.alturaLinha ?? ENTRELINHA, letterSpacing: t.espacamentoLetras ?? 0, wrap: 'word', fontSize: t.tamanho ?? 40 });
  let n = t.tamanho ?? 40;
  while (n > 12 && medidor.height() > t.altura) {
    n = Math.floor(n * 0.94);
    medidor.fontSize(n);
  }
  medidor.destroy();
  return n;
}

/** Carrega as fontes em uso antes de medir; o canvas não redesenha sozinho quando elas chegam. */
function useFontes(elementos: ElementoPost[]): number {
  const [versao, setVersao] = useState(0);
  const chaves = [...new Set(elementos.flatMap((e) => (e.tipo === 'texto' ? [cssFonte(e.fonte, !!e.negrito, !!e.italico, 40)] : [])))].sort();
  const assinatura = chaves.join('|');
  useEffect(() => {
    let ativo = true;
    void Promise.all(chaves.map((c) => document.fonts.load(c).catch(() => []))).then(() => ativo && setVersao((v) => v + 1));
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura resume a lista.
  }, [assinatura]);
  return versao;
}

/** Foto no tamanho do quadro: encaixe, cantos, espelho e filtros, num canvas só, igual na tela e no PNG. */
function desenharFoto(foto: HTMLImageElement, el: FotoPost): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = Math.max(1, Math.round(el.largura));
  const h = Math.max(1, Math.round(el.altura));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const raio = Math.min(el.raio ?? 0, w / 2, h / 2);
  if (raio > 0) {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, raio);
    ctx.clip();
  }
  const filtros = [el.brilho !== undefined && `brightness(${el.brilho}%)`, el.contraste !== undefined && `contrast(${el.contraste}%)`, el.saturacao !== undefined && `saturate(${el.saturacao}%)`].filter(Boolean).join(' ');
  if (filtros) ctx.filter = filtros;
  const medir = el.ajusteImagem === 'cobrir' ? Math.max : Math.min;
  const r = medir(w / foto.naturalWidth, h / foto.naturalHeight);
  const lf = foto.naturalWidth * r;
  const af = foto.naturalHeight * r;
  if (el.espelhar) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(foto, (w - lf) / 2, (h - af) / 2, lf, af);
  return canvas;
}

function Foto({ el, foto }: { el: FotoPost; foto: ImagemCarregada | undefined }) {
  const canvas = useMemo(() => (foto && foto !== 'erro' ? desenharFoto(foto, el) : null), [foto, el]);
  if (!foto) return null;
  if (foto === 'erro' || !canvas) {
    return (
      <>
        <Rect width={el.largura} height={el.altura} fill="#f1f5f9" listening={false} />
        <Text text="Imagem indisponível" width={el.largura} height={el.altura} align="center" verticalAlign="middle" fontSize={Math.min(32, el.altura / 3)} fill="#64748b" listening={false} />
      </>
    );
  }
  return <KImage image={canvas} width={el.largura} height={el.altura} listening={false} />;
}

function Qr({ el }: { el: Extract<ElementoPost, { tipo: 'qr' }> }) {
  const r = useMemo(() => imagemCodigo({ tipo: 'qrcode', rotacao: 0 } as ElementoEtiqueta, el.texto), [el.texto]);
  if (typeof r === 'string') {
    return (
      <>
        <Rect width={el.largura} height={el.altura} fill="#ffffff" stroke="#94a3b8" listening={false} />
        <Text text="Informe o link do QR code" width={el.largura} height={el.altura} align="center" verticalAlign="middle" fontSize={26} fill="#475569" listening={false} />
      </>
    );
  }
  const lado = Math.min(el.largura, el.altura);
  return (
    <>
      <Rect width={el.largura} height={el.altura} fill="#ffffff" cornerRadius={el.raio ?? 0} listening={false} />
      <KImage image={r} x={(el.largura - lado) / 2} y={(el.altura - lado) / 2} width={lado} height={lado} imageSmoothingEnabled={false} listening={false} />
    </>
  );
}

const sombra = (e: EstiloElemento) => (e.sombraCor ? { shadowColor: e.sombraCor, shadowBlur: e.sombraBlur ?? 10, shadowOffsetX: e.sombraX ?? 0, shadowOffsetY: e.sombraY ?? 4, shadowOpacity: 1 } : {});
const contorno = (e: EstiloElemento) => (e.contornoCor ? { stroke: e.contornoCor, strokeWidth: e.contornoEspessura ?? 2, fillAfterStrokeEnabled: true } : {});
const borda = (e: EstiloElemento) => (e.bordaCor && e.bordaEspessura ? { stroke: e.bordaCor, strokeWidth: e.bordaEspessura } : {});

/** Preenchimento da forma: cor sólida ou degradê no ângulo escolhido. */
function preenchimento(e: ElementoPost) {
  if (!e.cor2) return { fill: e.cor ?? '#ffffff' };
  const a = (((e.angulo ?? 135) - 90) * Math.PI) / 180;
  const metadeX = (Math.cos(a) * e.largura) / 2;
  const metadeY = (Math.sin(a) * e.altura) / 2;
  return {
    fillLinearGradientStartPoint: { x: e.largura / 2 - metadeX, y: e.altura / 2 - metadeY },
    fillLinearGradientEndPoint: { x: e.largura / 2 + metadeX, y: e.altura / 2 + metadeY },
    fillLinearGradientColorStops: [0, e.cor ?? '#ffffff', 1, e.cor2],
  };
}

function Escrita({ t, tamanho, versao }: { t: TextoPost; tamanho: number; versao: number }) {
  const comuns = { fontFamily: familia(t.fonte), fontStyle: estiloFonte(t), fill: t.cor ?? '#000000', listening: false, ...contorno(t), ...sombra(t) };
  const partes = t.preco && t.centavosPequenos !== false ? partesDoPreco(t.texto) : null;
  if (partes) {
    // "R$" e centavos menores, alinhados ao topo do valor: o jeito de cartaz de loja.
    const medir = (texto: string, fontSize: number) => {
      const m = new Konva.Text({ text: texto, fontSize, fontFamily: comuns.fontFamily, fontStyle: comuns.fontStyle });
      const largura = m.width();
      m.destroy();
      return largura;
    };
    let s = Math.min(t.tamanho ?? 80, t.altura);
    const total = (n: number) => medir(`${partes.moeda} `, n * 0.42) + medir(partes.valor, n) + medir(partes.centavos, n * 0.5);
    while (s > 12 && total(s) > t.largura) s = Math.floor(s * 0.95);
    const larguraMoeda = medir(`${partes.moeda} `, s * 0.42);
    const larguraValor = medir(partes.valor, s);
    const x0 = t.alinhamento === 'left' ? 0 : t.alinhamento === 'right' ? t.largura - total(s) : (t.largura - total(s)) / 2;
    // Os algarismos ficam na parte de cima da linha da fonte: desce um pouco para parecer centrado.
    const y0 = (t.altura - s) / 2 + s * 0.08;
    return (
      <Group key={versao} listening={false}>
        <Text {...comuns} text={partes.moeda} x={x0} y={y0 + s * 0.08} fontSize={s * 0.42} />
        <Text {...comuns} text={partes.valor} x={x0 + larguraMoeda} y={y0} fontSize={s} />
        <Text {...comuns} text={partes.centavos} x={x0 + larguraMoeda + larguraValor} y={y0 + s * 0.04} fontSize={s * 0.5} />
      </Group>
    );
  }
  return (
    <Text
      key={versao}
      {...comuns}
      text={textoFinal(t)}
      width={t.largura}
      height={t.altura}
      align={t.alinhamento ?? 'center'}
      verticalAlign={t.alinhamentoVertical ?? 'middle'}
      fontSize={tamanho}
      lineHeight={t.alturaLinha ?? ENTRELINHA}
      letterSpacing={t.espacamentoLetras ?? 0}
      textDecoration={[t.sublinhado && 'underline', t.tachado && 'line-through'].filter(Boolean).join(' ')}
    />
  );
}

export interface TelaPostControle {
  exportar: (tipo?: 'image/png' | 'image/jpeg') => Promise<Blob | null>;
}

interface Props {
  elementos: ElementoPost[];
  largura: number;
  altura: number;
  imagens: Map<string, ImagemCarregada>;
  editavel: boolean;
  selecionado: string | null;
  aoSelecionar: (id: string | null) => void;
  aoAjustar: (id: string, ajuste: AjusteElemento) => void;
  /** Fração do tamanho real; `null` ajusta à área disponível. */
  zoom: number | null;
}

const ALTURA_MAXIMA = 640;

/** Mostra a arte em escala; a exportação sai no tamanho real, em pixels da rede social. */
export const TelaPost = forwardRef<TelaPostControle, Props>(function TelaPost({ elementos, largura, altura, imagens, editavel, selecionado, aoSelecionar, aoAjustar, zoom }, ref) {
  const caixa = useRef<HTMLDivElement>(null);
  const palco = useRef<Konva.Stage>(null);
  const transformador = useRef<Konva.Transformer>(null);
  const [disponivel, setDisponivel] = useState(480);
  const [guias, setGuias] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const versao = useFontes(elementos);

  useEffect(() => {
    if (!caixa.current) return;
    const o = new ResizeObserver(([e]) => setDisponivel(e.contentRect.width));
    o.observe(caixa.current);
    return () => o.disconnect();
  }, []);

  const escala = zoom ?? Math.min(disponivel / largura, ALTURA_MAXIMA / altura);
  const visiveis = useMemo(() => elementos.filter((e) => !e.oculto), [elementos]);

  useEffect(() => {
    const t = transformador.current;
    if (!t) return;
    const el = elementos.find((e) => e.id === selecionado);
    const no = el && !el.oculto && !el.travado ? palco.current?.findOne(`#${selecionado}`) : null;
    t.nodes(no ? [no] : []);
    t.getLayer()?.batchDraw();
  }, [selecionado, elementos, editavel]);

  useImperativeHandle(ref, () => ({
    exportar: async (tipo = 'image/png') => {
      const stage = palco.current;
      if (!stage) return null;
      await document.fonts.ready;
      // Moldura da seleção e guias não saem na imagem.
      transformador.current?.hide();
      setGuias({ x: [], y: [] });
      const canvas = stage.toCanvas({ pixelRatio: 1 / escala });
      transformador.current?.show();
      return new Promise((resolver) => canvas.toBlob(resolver, tipo, 0.92));
    },
  }));

  const tamanhos = useMemo(() => new Map(visiveis.filter((e): e is TextoPost => e.tipo === 'texto').map((t) => [t.id, tamanhoQueCabe(t)])), [visiveis, versao]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Puxa o elemento para o centro, as bordas da arte e as linhas dos outros elementos. */
  function aoArrastar(el: ElementoPost, e: Konva.KonvaEventObject<DragEvent>) {
    if (el.rotacao) return;
    const no = e.target;
    const alvosX = [0, largura / 2, largura];
    const alvosY = [0, altura / 2, altura];
    for (const o of visiveis) {
      if (o.id === el.id || o.fixo || o.rotacao) continue;
      alvosX.push(o.x, o.x + o.largura / 2, o.x + o.largura);
      alvosY.push(o.y, o.y + o.altura / 2, o.y + o.altura);
    }
    const ima = IMA_PX / escala;
    const prender = (pos: number, tam: number, alvos: number[]) => {
      for (const borda_ of [0, tam / 2, tam]) {
        const a = alvos.find((v) => Math.abs(v - (pos + borda_)) < ima);
        if (a !== undefined) return { pos: a - borda_, guia: a };
      }
      return null;
    };
    const px = prender(no.x(), el.largura, alvosX);
    const py = prender(no.y(), el.altura, alvosY);
    if (px) no.x(px.pos);
    if (py) no.y(py.pos);
    setGuias({ x: px ? [px.guia] : [], y: py ? [py.guia] : [] });
  }

  function fimDoArraste(el: ElementoPost, e: Konva.KonvaEventObject<DragEvent>) {
    setGuias({ x: [], y: [] });
    aoAjustar(el.id, { x: Math.round(e.target.x()), y: Math.round(e.target.y()) });
  }

  function fimDoRedimensionamento(el: ElementoPost, e: Konva.KonvaEventObject<Event>) {
    const no = e.target;
    const novo = { x: Math.round(no.x()), y: Math.round(no.y()), largura: Math.max(10, Math.round(el.largura * no.scaleX())), altura: Math.max(10, Math.round(el.altura * no.scaleY())), rotacao: Math.round(no.rotation()) };
    no.scale({ x: 1, y: 1 });
    aoAjustar(el.id, novo);
  }

  const selecionar = (el: ElementoPost) => editavel && aoSelecionar(el.fixo ? null : el.id);

  return (
    <div ref={caixa} className="w-full overflow-auto" style={{ maxHeight: zoom ? '75vh' : undefined }}>
      <div className="mx-auto rounded-md shadow" style={{ width: largura * escala, height: altura * escala }}>
        <Stage ref={palco} width={largura * escala} height={altura * escala} scaleX={escala} scaleY={escala}>
          <Layer>
            {visiveis.map((el) => {
              const movel = editavel && !el.fixo && !el.travado;
              return (
                <Group
                  key={el.id}
                  id={el.id}
                  x={el.x}
                  y={el.y}
                  rotation={el.rotacao ?? 0}
                  opacity={el.opacidade ?? 1}
                  draggable={movel}
                  onMouseDown={() => selecionar(el)}
                  onTap={() => selecionar(el)}
                  onDragMove={(e) => aoArrastar(el, e)}
                  onDragEnd={(e) => fimDoArraste(el, e)}
                  onTransformEnd={(e) => fimDoRedimensionamento(el, e)}
                >
                  {el.tipo === 'retangulo' && <Rect width={el.largura} height={el.altura} cornerRadius={el.raio ?? 0} {...preenchimento(el)} {...borda(el)} {...sombra(el)} />}
                  {el.tipo === 'elipse' && <Ellipse x={el.largura / 2} y={el.altura / 2} radiusX={el.largura / 2} radiusY={el.altura / 2} {...preenchimento(el)} {...borda(el)} {...sombra(el)} />}
                  {el.tipo === 'estrela' && <Line closed points={pontosEstrela(el.largura, el.altura, el.pontas ?? 5, el.raioInterno ?? 0.5).flat()} {...preenchimento(el)} {...borda(el)} {...sombra(el)} />}
                  {el.tipo === 'linha' && (
                    <>
                      <Rect width={el.largura} height={Math.max(el.altura, 30)} y={Math.min(0, (el.altura - 30) / 2)} fill="transparent" />
                      <Line points={[0, el.altura / 2, el.largura, el.altura / 2]} stroke={el.cor ?? '#000000'} strokeWidth={el.bordaEspessura ?? 8} lineCap="round" listening={false} {...sombra(el)} />
                    </>
                  )}
                  {el.tipo === 'imagem' && (
                    <>
                      <Rect width={el.largura} height={el.altura} fill="transparent" />
                      <Foto el={el} foto={imagens.get(chaveImagemPost(el.imagem))} />
                      {el.bordaCor && el.bordaEspessura ? <Rect width={el.largura} height={el.altura} cornerRadius={el.raio ?? 0} stroke={el.bordaCor} strokeWidth={el.bordaEspessura} listening={false} /> : null}
                    </>
                  )}
                  {el.tipo === 'qr' && (
                    <>
                      <Rect width={el.largura} height={el.altura} fill="transparent" />
                      <Qr el={el} />
                    </>
                  )}
                  {el.tipo === 'texto' && (
                    <>
                      <Rect width={el.largura} height={el.altura} fill={el.fundoTexto ?? 'transparent'} cornerRadius={el.raio ?? 0} />
                      <Escrita t={el} tamanho={tamanhos.get(el.id) ?? el.tamanho ?? 40} versao={versao} />
                    </>
                  )}
                </Group>
              );
            })}
            {guias.x.map((x) => <Line key={`x${x}`} points={[x, 0, x, altura]} stroke="#ec4899" strokeWidth={2 / escala} listening={false} />)}
            {guias.y.map((y) => <Line key={`y${y}`} points={[0, y, largura, y]} stroke="#ec4899" strokeWidth={2 / escala} listening={false} />)}
            {editavel && (
              <Transformer
                ref={transformador}
                keepRatio={false}
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                anchorSize={10}
                anchorStroke="#2563eb"
                borderStroke="#2563eb"
                boundBoxFunc={(antes, depois) => (Math.abs(depois.width) < 10 || Math.abs(depois.height) < 10 ? antes : depois)}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
});
