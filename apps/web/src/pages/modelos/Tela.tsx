import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Ellipse, Group, Image as KImage, Layer, Line, Rect, Shape, Stage, Text, Transformer } from 'react-konva';
import {
  diagramarPreco,
  planejarTexto,
  pontosEstrela,
  ptParaMm,
  textoDoElemento,
  type ElementoEtiqueta,
  type ElementoImagem,
  type ElementoPreco,
  type ElementoTexto,
  type LayoutEtiqueta,
  type Registro,
} from '@etiquetas/shared';
import { arredondar, imagemCodigo } from './elementos';
import { cssFonte, medidorNavegador, useFontesCarregadas } from './fontes';
import { canvasImagem } from './imagens';

interface Props {
  layout: LayoutEtiqueta;
  /** Pixels por milímetro. */
  escala: number;
  registro: Registro | null;
  selecionado: string | null;
  editavel: boolean;
  aoSelecionar: (id: string | null) => void;
  aoAlterar: (id: string, mudancas: Partial<ElementoEtiqueta>) => void;
}

const MARGEM = 12;
const hoje = () => new Date().toLocaleDateString('en-CA');

/** Texto mostrado no editor: valor real da amostra ou o nome do campo entre colchetes. */
function textoPrevia(el: ElementoEtiqueta, registro: Registro | null): string {
  if (!('valor' in el)) return '';
  if (el.valor.tipo === 'campo') {
    const campo = el.valor.campo.toLowerCase();
    const temNaAmostra = registro !== null && Object.keys(registro).some((k) => k.toLowerCase() === campo);
    if (!temNaAmostra) {
      if (el.tipo === 'codigo_barras') return '7891000000045';
      if (el.tipo === 'preco') return el.simbolo ? `${el.simbolo} 9,99` : '9,99';
      const nome = `[${el.valor.campo}]`;
      return el.tipo === 'texto' ? `${el.prefixo}${nome}${el.sufixo}` : nome;
    }
  }
  return textoDoElemento(el, { registro: registro ?? {}, indice: 0, hoje: hoje() });
}

/** Posição e tamanho do conteúdo dentro da caixa, conforme a rotação (giro horário). */
function conteudoGirado(el: ElementoEtiqueta, e: number) {
  const w = el.largura * e;
  const h = el.altura * e;
  switch (el.rotacao) {
    case 90:
      return { x: w, y: 0, largura: h, altura: w };
    case 180:
      return { x: w, y: h, largura: w, altura: h };
    case 270:
      return { x: 0, y: h, largura: h, altura: w };
    default:
      return { x: 0, y: 0, largura: w, altura: h };
  }
}

interface Traco {
  texto: string;
  u: number;
  v: number;
  tamanho: number;
  largura: number;
}

/**
 * Texto e preço desenhados à mão no canvas, a partir do mesmo plano (linhas, linha de base,
 * ajuste) que o PDF usa: o que se vê aqui é o que sai na impressão.
 */
function TextoDesenhado({ el, texto, escala }: { el: ElementoTexto | ElementoPreco; texto: string; escala: number }) {
  const c = conteudoGirado(el, escala);
  const ptPx = ptParaMm(1) * escala;
  const italico = el.italico ?? false;
  const medir = medidorNavegador(el.fonte, el.negrito, italico);
  const comprimento = c.largura / ptPx;
  const espessura = c.altura / ptPx;
  let tracos: Traco[];
  if (el.tipo === 'texto') {
    const plano = planejarTexto(el, texto, comprimento, espessura, medir);
    tracos = plano.linhas.map((l) => ({ ...l, tamanho: plano.tamanhoPt }));
  } else {
    tracos = diagramarPreco(el, texto, comprimento, espessura, medir).map((p) => ({ ...p, tamanho: p.tamanhoPt, largura: medir(p.texto, p.tamanhoPt) }));
  }
  const espacamento = el.tipo === 'texto' ? (el.espacamentoLetras ?? 0) : 0;
  return (
    <Shape
      x={c.x}
      y={c.y}
      rotation={el.rotacao}
      listening={false}
      sceneFunc={(contexto) => {
        const ctx = (contexto as unknown as { _context: CanvasRenderingContext2D })._context;
        ctx.save();
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = el.cor ?? '#000000';
        for (const t of tracos) {
          ctx.font = cssFonte(el.fonte, el.negrito, italico, t.tamanho * ptPx);
          const escrever = (desenhar: (s: string, x: number, y: number) => void) => {
            if (!espacamento) desenhar(t.texto, t.u * ptPx, t.v * ptPx);
            else {
              let u = t.u;
              for (const ch of t.texto) {
                desenhar(ch, u * ptPx, t.v * ptPx);
                u += medir(ch, t.tamanho) + espacamento;
              }
            }
          };
          if (el.contorno) {
            ctx.strokeStyle = el.contorno.cor;
            ctx.lineWidth = el.contorno.espessuraPt * 2 * ptPx;
            ctx.lineJoin = 'round';
            escrever((s, x, y) => ctx.strokeText(s, x, y));
          }
          escrever((s, x, y) => ctx.fillText(s, x, y));
          if (el.tipo === 'texto') {
            const espessuraLinha = Math.max(0.5, t.tamanho * 0.06) * ptPx;
            if (el.sublinhado) ctx.fillRect(t.u * ptPx, (t.v + t.tamanho * 0.12) * ptPx - espessuraLinha / 2, t.largura * ptPx, espessuraLinha);
            if (el.tachado) ctx.fillRect(t.u * ptPx, (t.v - t.tamanho * 0.28) * ptPx - espessuraLinha / 2, t.largura * ptPx, espessuraLinha);
          }
        }
        ctx.restore();
      }}
    />
  );
}

const imagensCarregadas = new Map<string, HTMLImageElement>();

/** Imagem colorida do elemento (data URL), carregada uma vez. */
function useImagemOriginal(src: string | undefined) {
  const [, setPronta] = useState(0);
  const existente = src ? imagensCarregadas.get(src) : undefined;
  useEffect(() => {
    if (!src || imagensCarregadas.has(src)) return;
    const img = new window.Image();
    img.onload = () => {
      imagensCarregadas.set(src, img);
      setPronta((v) => v + 1);
    };
    img.src = src;
  }, [src]);
  return existente;
}

function ImagemDesenhada({ el, escala }: { el: ElementoImagem; escala: number }) {
  const original = useImagemOriginal(el.original);
  if (!el.original || !original) return <KImage image={canvasImagem(el)} width={el.largura * escala} height={el.altura * escala} />;
  const c = conteudoGirado(el, escala);
  return <KImage image={original} x={c.x} y={c.y} width={c.largura} height={c.altura} rotation={el.rotacao} />;
}

const tracejado = (t: number) => [Math.max(2, t * 3), Math.max(1.5, t * 2)];

function Conteudo({ el, escala, registro }: { el: ElementoEtiqueta; escala: number; registro: Registro | null }) {
  const w = el.largura * escala;
  const h = el.altura * escala;
  switch (el.tipo) {
    case 'texto':
    case 'preco':
      return (
        <>
          {el.corFundo && <Rect width={w} height={h} fill={el.corFundo} listening={false} />}
          <TextoDesenhado el={el} texto={textoPrevia(el, registro)} escala={escala} />
        </>
      );
    case 'codigo_barras':
    case 'qrcode': {
      const img = imagemCodigo(el, textoPrevia(el, registro));
      if (typeof img === 'string') {
        return (
          <>
            <Rect width={w} height={h} fill="#fef2f2" stroke="#fca5a5" strokeWidth={1} dash={[4, 3]} />
            <Text width={w} height={h} padding={2} text={img} fontSize={Math.max(8, Math.min(11, h / 3))} fill="#b91c1c" align="center" verticalAlign="middle" />
          </>
        );
      }
      const lado = Math.min(w, h);
      return el.tipo === 'qrcode' ? <KImage image={img} width={lado} height={lado} /> : <KImage image={img} width={w} height={h} />;
    }
    case 'retangulo':
    case 'elipse':
    case 'estrela': {
      const t = el.espessuraMm * escala;
      const estilo = {
        fill: el.preenchido ? (el.corPreenchimento ?? '#000000') : undefined,
        stroke: t > 0 ? (el.corBorda ?? '#000000') : undefined,
        strokeWidth: t,
        dash: el.tracejado && t > 0 ? tracejado(t) : undefined,
        listening: false,
      };
      // Borda por dentro da caixa, como no PDF.
      const wi = Math.max(0.1, w - t);
      const hi = Math.max(0.1, h - t);
      if (el.tipo === 'elipse') return <Ellipse x={w / 2} y={h / 2} radiusX={wi / 2} radiusY={hi / 2} {...estilo} />;
      if (el.tipo === 'estrela') {
        const pontos = pontosEstrela(wi, hi, el.pontas, el.raioInterno).flat();
        return <Line x={t / 2} y={t / 2} points={pontos} closed {...estilo} />;
      }
      return <Rect x={t / 2} y={t / 2} width={wi} height={hi} cornerRadius={(el.raioMm ?? 0) * escala} {...estilo} />;
    }
    case 'linha': {
      const t = Math.max(1, el.espessuraMm * escala);
      const pontos = w >= h ? [0, t / 2, w, t / 2] : [t / 2, 0, t / 2, h];
      return <Line points={pontos} stroke={el.cor ?? '#000000'} strokeWidth={t} dash={el.tracejado ? tracejado(t) : undefined} listening={false} />;
    }
    case 'imagem':
      return <ImagemDesenhada el={el} escala={escala} />;
  }
}

export function Tela({ layout, escala, registro, selecionado, editavel, aoSelecionar, aoAlterar }: Props) {
  const transformador = useRef<Konva.Transformer>(null);
  const nos = useRef(new Map<string, Konva.Group>());
  const L = layout.larguraMm * escala;
  const A = layout.alturaMm * escala;
  // Re-renderiza (e remede os textos) quando as fontes do layout terminam de carregar.
  useFontesCarregadas(layout.elementos);
  const elSelecionado = layout.elementos.find((e) => e.id === selecionado);

  useEffect(() => {
    const t = transformador.current;
    if (!t) return;
    const no = selecionado ? nos.current.get(selecionado) : undefined;
    t.nodes(no && editavel && !elSelecionado?.travado ? [no] : []);
    t.getLayer()?.batchDraw();
  }, [selecionado, editavel, layout, elSelecionado?.travado]);

  // Grade de 5 mm (10 mm em cartazes, para não poluir).
  const passoGrade = Math.max(layout.larguraMm, layout.alturaMm) > 150 ? 10 : 5;
  const grade: number[][] = [];
  for (let x = passoGrade; x < layout.larguraMm; x += passoGrade) grade.push([x * escala, 0, x * escala, A]);
  for (let y = passoGrade; y < layout.alturaMm; y += passoGrade) grade.push([0, y * escala, L, y * escala]);

  return (
    <Stage
      width={L + MARGEM * 2}
      height={A + MARGEM * 2}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage() || e.target.name() === 'fundo') aoSelecionar(null);
      }}
    >
      <Layer x={MARGEM} y={MARGEM}>
        <Rect name="fundo" width={L} height={A} fill={layout.corFundo ?? '#ffffff'} stroke="#94a3b8" strokeWidth={1} cornerRadius={4} shadowColor="#0f172a" shadowOpacity={0.12} shadowBlur={8} />
        {grade.map((p, i) => (
          <Line key={i} points={p} stroke="#94a3b8" strokeWidth={1} opacity={0.18} listening={false} />
        ))}
        {layout.elementos.map((el) => (
          <Group
            key={el.id}
            ref={(no) => {
              if (no) nos.current.set(el.id, no);
              else nos.current.delete(el.id);
            }}
            x={el.x * escala}
            y={el.y * escala}
            width={el.largura * escala}
            height={el.altura * escala}
            opacity={el.opacidade ?? 1}
            draggable={editavel && !el.travado}
            onMouseDown={() => aoSelecionar(el.id)}
            onTap={() => aoSelecionar(el.id)}
            dragBoundFunc={(p) => ({
              x: Math.max(MARGEM, Math.min(MARGEM + L - el.largura * escala, p.x)),
              y: Math.max(MARGEM, Math.min(MARGEM + A - el.altura * escala, p.y)),
            })}
            onDragEnd={(e) => aoAlterar(el.id, { x: arredondar(e.target.x() / escala), y: arredondar(e.target.y() / escala) })}
            onTransformEnd={(e) => {
              const no = e.target;
              const largura = Math.max(1, Math.min(layout.larguraMm, arredondar(el.largura * no.scaleX())));
              const altura = Math.max(0.5, Math.min(layout.alturaMm, arredondar(el.altura * no.scaleY())));
              no.scale({ x: 1, y: 1 });
              aoAlterar(el.id, {
                x: Math.max(0, Math.min(layout.larguraMm - largura, arredondar(no.x() / escala))),
                y: Math.max(0, Math.min(layout.alturaMm - altura, arredondar(no.y() / escala))),
                largura,
                altura,
              });
            }}
          >
            {/* Área clicável mesmo em elementos finos ou vazios. */}
            <Rect
              width={el.largura * escala}
              height={el.altura * escala}
              fill="transparent"
              stroke={selecionado === el.id ? '#2563eb' : '#cbd5e1'}
              strokeWidth={1}
              dash={selecionado === el.id ? undefined : [3, 3]}
              strokeScaleEnabled={false}
            />
            <Conteudo el={el} escala={escala} registro={registro} />
          </Group>
        ))}
        {/* Imagem e estrela mantêm a proporção pelos cantos; as alças laterais ainda permitem esticar. */}
        <Transformer
          ref={transformador}
          rotateEnabled={false}
          keepRatio={elSelecionado?.tipo === 'imagem' || elSelecionado?.tipo === 'estrela'}
          ignoreStroke
          flipEnabled={false}
          anchorSize={7}
          borderStroke="#2563eb"
          anchorStroke="#2563eb"
        />
      </Layer>
    </Stage>
  );
}
