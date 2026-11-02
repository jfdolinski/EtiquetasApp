import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Image as KImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import { chaveImagemPost, type AjusteElemento, type ElementoPost, type TextoPost } from '@etiquetas/shared';
import type { ImagemCarregada } from './apoio';

const FONTE = 'Arial, Helvetica, sans-serif';
const ENTRELINHA = 1.15;

/** Reduz o tamanho até o texto caber no quadro. */
function tamanhoQueCabe(t: TextoPost): number {
  const medidor = new Konva.Text({ text: t.texto, width: t.largura, fontFamily: FONTE, fontStyle: t.negrito ? 'bold' : 'normal', lineHeight: ENTRELINHA, wrap: 'word', fontSize: t.tamanho });
  let n = t.tamanho;
  while (n > 12 && medidor.height() > t.altura) {
    n = Math.floor(n * 0.94);
    medidor.fontSize(n);
  }
  medidor.destroy();
  return n;
}

function Imagem({ el, foto }: { el: { largura: number; altura: number }; foto: ImagemCarregada | undefined }) {
  if (!foto) return null;
  if (foto === 'erro') {
    return (
      <>
        <Rect width={el.largura} height={el.altura} fill="#f1f5f9" />
        <Text text="Imagem indisponível" width={el.largura} height={el.altura} align="center" verticalAlign="middle" fontFamily={FONTE} fontSize={Math.min(32, el.altura / 3)} fill="#64748b" />
      </>
    );
  }
  // Inteira no quadro, sem cortar a embalagem.
  const r = Math.min(el.largura / foto.naturalWidth, el.altura / foto.naturalHeight);
  const largura = foto.naturalWidth * r;
  const altura = foto.naturalHeight * r;
  return <KImage image={foto} x={(el.largura - largura) / 2} y={(el.altura - altura) / 2} width={largura} height={altura} />;
}

export interface TelaPostControle {
  exportar: () => Promise<Blob | null>;
}

interface Props {
  elementos: ElementoPost[];
  largura: number;
  altura: number;
  imagens: Map<string, ImagemCarregada>;
  editavel: boolean;
  aoAjustar: (id: string, ajuste: AjusteElemento) => void;
}

const ALTURA_MAXIMA = 640;

/** Mostra a arte em escala; a exportação sai no tamanho real, em pixels da rede social. */
export const TelaPost = forwardRef<TelaPostControle, Props>(function TelaPost({ elementos, largura, altura, imagens, editavel, aoAjustar }, ref) {
  const caixa = useRef<HTMLDivElement>(null);
  const palco = useRef<Konva.Stage>(null);
  const transformador = useRef<Konva.Transformer>(null);
  const [disponivel, setDisponivel] = useState(480);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    if (!caixa.current) return;
    const o = new ResizeObserver(([e]) => setDisponivel(e.contentRect.width));
    o.observe(caixa.current);
    return () => o.disconnect();
  }, []);

  const escala = Math.min(disponivel / largura, ALTURA_MAXIMA / altura);

  useEffect(() => {
    if (!editavel) setSelecionado(null);
  }, [editavel]);

  useEffect(() => {
    const t = transformador.current;
    if (!t) return;
    const no = selecionado ? palco.current?.findOne(`#${selecionado}`) : null;
    t.nodes(no ? [no] : []);
    t.getLayer()?.batchDraw();
  }, [selecionado, elementos]);

  useImperativeHandle(ref, () => ({
    exportar: () =>
      new Promise((resolver) => {
        const stage = palco.current;
        if (!stage) return resolver(null);
        // A moldura da edição livre não sai na imagem.
        transformador.current?.hide();
        const canvas = stage.toCanvas({ pixelRatio: 1 / escala });
        transformador.current?.show();
        canvas.toBlob(resolver, 'image/png');
      }),
  }));

  const tamanhos = useMemo(() => new Map(elementos.filter((e): e is TextoPost => e.tipo === 'texto').map((t) => [t.id, tamanhoQueCabe(t)])), [elementos]);

  function fimDoArraste(el: ElementoPost, e: Konva.KonvaEventObject<DragEvent>) {
    aoAjustar(el.id, { x: Math.round(e.target.x()), y: Math.round(e.target.y()), largura: el.largura, altura: el.altura });
  }

  function fimDoRedimensionamento(el: ElementoPost, e: Konva.KonvaEventObject<Event>) {
    const no = e.target;
    const novo = { x: Math.round(no.x()), y: Math.round(no.y()), largura: Math.max(20, Math.round(el.largura * no.scaleX())), altura: Math.max(20, Math.round(el.altura * no.scaleY())) };
    no.scale({ x: 1, y: 1 });
    aoAjustar(el.id, novo);
  }

  return (
    <div ref={caixa} className="w-full">
      <div className="mx-auto overflow-hidden rounded-md shadow" style={{ width: largura * escala, height: altura * escala }}>
        <Stage ref={palco} width={largura * escala} height={altura * escala} scaleX={escala} scaleY={escala} onMouseDown={(e) => e.target === e.target.getStage() && setSelecionado(null)}>
          <Layer>
            {elementos.map((el) => {
              const movel = editavel && !el.fixo;
              return (
                <Group
                  key={el.id}
                  id={el.id}
                  x={el.x}
                  y={el.y}
                  draggable={movel}
                  onClick={() => (movel ? setSelecionado(el.id) : setSelecionado(null))}
                  onTap={() => (movel ? setSelecionado(el.id) : setSelecionado(null))}
                  onDragEnd={(e) => fimDoArraste(el, e)}
                  onTransformEnd={(e) => fimDoRedimensionamento(el, e)}
                >
                  {/* Área de toque: uma imagem com sobra no quadro também é clicável fora dela. */}
                  <Rect width={el.largura} height={el.altura} fill={el.tipo === 'retangulo' ? el.cor : 'transparent'} cornerRadius={el.tipo === 'retangulo' ? el.raio : 0} />
                  {el.tipo === 'imagem' && <Imagem el={el} foto={imagens.get(chaveImagemPost(el.imagem))} />}
                  {el.tipo === 'texto' && (
                    <Text text={el.texto} width={el.largura} height={el.altura} align={el.alinhamento} verticalAlign="middle" fontFamily={FONTE} fontStyle={el.negrito ? 'bold' : 'normal'} fontSize={tamanhos.get(el.id) ?? el.tamanho} lineHeight={ENTRELINHA} fill={el.cor} />
                  )}
                </Group>
              );
            })}
            {editavel && <Transformer ref={transformador} rotateEnabled={false} keepRatio={false} />}
          </Layer>
        </Stage>
      </div>
    </div>
  );
});
