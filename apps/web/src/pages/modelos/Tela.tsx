import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import { Group, Image as KImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import { ptParaMm, textoDoElemento, type ElementoEtiqueta, type LayoutEtiqueta, type Registro } from '@etiquetas/shared';
import { arredondar, imagemCodigo } from './elementos';
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

function Conteudo({ el, escala, registro }: { el: ElementoEtiqueta; escala: number; registro: Registro | null }) {
  const w = el.largura * escala;
  const h = el.altura * escala;
  switch (el.tipo) {
    case 'texto': {
      const c = conteudoGirado(el, escala);
      return (
        <Text
          x={c.x}
          y={c.y}
          width={c.largura}
          height={c.altura}
          rotation={el.rotacao}
          text={textoPrevia(el, registro)}
          fontFamily="Helvetica, Arial, sans-serif"
          fontSize={ptParaMm(el.tamanhoPt) * escala}
          fontStyle={el.negrito ? 'bold' : 'normal'}
          align={{ esquerda: 'left', centro: 'center', direita: 'right' }[el.alinhamento]}
          wrap="word"
          ellipsis
          fill="#111827"
        />
      );
    }
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
    case 'retangulo': {
      const t = el.espessuraMm * escala;
      return el.preenchido ? (
        <Rect width={w} height={h} fill="#111827" />
      ) : (
        <Rect x={t / 2} y={t / 2} width={w - t} height={h - t} stroke="#111827" strokeWidth={t} />
      );
    }
    case 'linha': {
      const t = Math.max(1, el.espessuraMm * escala);
      return w >= h ? <Rect width={w} height={t} fill="#111827" /> : <Rect width={t} height={h} fill="#111827" />;
    }
    case 'imagem':
      return <KImage image={canvasImagem(el)} width={w} height={h} />;
  }
}

export function Tela({ layout, escala, registro, selecionado, editavel, aoSelecionar, aoAlterar }: Props) {
  const transformador = useRef<Konva.Transformer>(null);
  const nos = useRef(new Map<string, Konva.Group>());
  const L = layout.larguraMm * escala;
  const A = layout.alturaMm * escala;

  useEffect(() => {
    const t = transformador.current;
    if (!t) return;
    const no = selecionado ? nos.current.get(selecionado) : undefined;
    t.nodes(no && editavel ? [no] : []);
    t.getLayer()?.batchDraw();
  }, [selecionado, editavel, layout]);

  // Grade de 5 mm.
  const grade: number[][] = [];
  for (let x = 5; x < layout.larguraMm; x += 5) grade.push([x * escala, 0, x * escala, A]);
  for (let y = 5; y < layout.alturaMm; y += 5) grade.push([0, y * escala, L, y * escala]);

  return (
    <Stage
      width={L + MARGEM * 2}
      height={A + MARGEM * 2}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage() || e.target.name() === 'fundo') aoSelecionar(null);
      }}
    >
      <Layer x={MARGEM} y={MARGEM}>
        <Rect name="fundo" width={L} height={A} fill="#ffffff" stroke="#94a3b8" strokeWidth={1} cornerRadius={4} shadowColor="#0f172a" shadowOpacity={0.12} shadowBlur={8} />
        {grade.map((p, i) => (
          <Line key={i} points={p} stroke="#e2e8f0" strokeWidth={1} listening={false} />
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
            draggable={editavel}
            onMouseDown={() => aoSelecionar(el.id)}
            onTap={() => aoSelecionar(el.id)}
            dragBoundFunc={(p) => ({
              x: Math.max(MARGEM, Math.min(MARGEM + L - el.largura * escala, p.x)),
              y: Math.max(MARGEM, Math.min(MARGEM + A - el.altura * escala, p.y)),
            })}
            onDragEnd={(e) => aoAlterar(el.id, { x: arredondar(e.target.x() / escala), y: arredondar(e.target.y() / escala) })}
            onTransformEnd={(e) => {
              const no = e.target;
              const largura = Math.max(1, Math.min(layout.larguraMm, arredondar((el.largura * no.scaleX()))));
              const altura = Math.max(0.5, Math.min(layout.alturaMm, arredondar((el.altura * no.scaleY()))));
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
            <Rect width={el.largura * escala} height={el.altura * escala} fill="transparent" stroke={selecionado === el.id ? '#2563eb' : '#cbd5e1'} strokeWidth={1} dash={selecionado === el.id ? undefined : [3, 3]} />
            <Conteudo el={el} escala={escala} registro={registro} />
          </Group>
        ))}
        {/* Imagem mantém a proporção pelos cantos; as alças laterais ainda permitem esticar. */}
        <Transformer
          ref={transformador}
          rotateEnabled={false}
          keepRatio={layout.elementos.find((e) => e.id === selecionado)?.tipo === 'imagem'} ignoreStroke flipEnabled={false} anchorSize={7} borderStroke="#2563eb" anchorStroke="#2563eb" />
      </Layer>
    </Stage>
  );
}
