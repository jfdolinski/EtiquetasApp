import { useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import type { TracoAssinatura } from '../../../packages/shared/src/entregas-comprovacao';
import { PROPORCAO_ASSINATURA } from './regras';
import { cores } from './ui';

const ESPESSURA = 3;

/**
 * Área para quem recebe assinar com o dedo. Sem biblioteca de desenho: cada trecho do traço é uma
 * linha (View girada). Os pontos vão em frações da área (0 a 1) e a API desenha a imagem guardada.
 */
export function AreaAssinatura({ tracos, mudar }: { tracos: TracoAssinatura[]; mudar: (t: TracoAssinatura[]) => void }) {
  const [tamanho, setTamanho] = useState({ largura: 0, altura: 0 });
  const atual = useRef<TracoAssinatura[]>(tracos);
  atual.current = tracos;
  const medida = useRef(tamanho);
  medida.current = tamanho;
  const ponto = (x: number, y: number): [number, number] => {
    const { largura, altura } = medida.current;
    const lim = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    return [lim(x / Math.max(1, largura)), lim(y / Math.max(1, altura))];
  };
  const toque = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => mudar([...atual.current, [ponto(e.nativeEvent.locationX, e.nativeEvent.locationY)]]),
      onPanResponderMove: (e) => {
        const lista = atual.current;
        if (!lista.length) return;
        const ultimo = lista[lista.length - 1];
        const p = ponto(e.nativeEvent.locationX, e.nativeEvent.locationY);
        const [ax, ay] = ultimo[ultimo.length - 1];
        // Ignora o tremido de menos de meio por cento: menos pontos para mandar.
        if (Math.abs(p[0] - ax) + Math.abs(p[1] - ay) < 0.005) return;
        mudar([...lista.slice(0, -1), [...ultimo, p]]);
      },
    }),
  ).current;

  const aoMedir = (e: LayoutChangeEvent) => setTamanho({ largura: e.nativeEvent.layout.width, altura: e.nativeEvent.layout.height });
  const { largura, altura } = tamanho;
  const linhas: { x: number; y: number; comprimento: number; angulo: number }[] = [];
  for (const t of tracos)
    for (let i = 0; i < t.length; i++) {
      const [x0, y0] = i ? [t[i - 1][0] * largura, t[i - 1][1] * altura] : [t[i][0] * largura, t[i][1] * altura];
      const [x1, y1] = [t[i][0] * largura, t[i][1] * altura];
      const comprimento = Math.max(ESPESSURA, Math.hypot(x1 - x0, y1 - y0));
      linhas.push({ x: (x0 + x1) / 2 - comprimento / 2, y: (y0 + y1) / 2 - ESPESSURA / 2, comprimento, angulo: Math.atan2(y1 - y0, x1 - x0) });
    }

  return (
    <View style={{ gap: 6 }}>
      <View
        onLayout={aoMedir}
        {...toque.panHandlers}
        accessibilityLabel="Área da assinatura"
        style={{ width: '100%', aspectRatio: PROPORCAO_ASSINATURA, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, overflow: 'hidden' }}
      >
        {tracos.length === 0 && (
          <Text pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', top: '42%', color: cores.suave }}>
            Assine aqui com o dedo
          </Text>
        )}
        {/* Um ponto em cada junta: sem ele, as curvas ficam com falhas entre os trechos. */}
        {tracos.flatMap((t, j) => t.map(([x, y], i) => <View key={`p${j}-${i}`} pointerEvents="none" style={{ position: 'absolute', left: x * largura - ESPESSURA / 2, top: y * altura - ESPESSURA / 2, width: ESPESSURA, height: ESPESSURA, borderRadius: ESPESSURA / 2, backgroundColor: cores.texto }} />))}
        {linhas.map((l, i) => (
          <View key={i} pointerEvents="none" style={{ position: 'absolute', left: l.x, top: l.y, width: l.comprimento, height: ESPESSURA, borderRadius: ESPESSURA / 2, backgroundColor: cores.texto, transform: [{ rotate: `${l.angulo}rad` }] }} />
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => mudar([])} style={{ alignSelf: 'flex-end', padding: 4 }}>
        <Text style={{ color: cores.azul }}>Limpar assinatura</Text>
      </Pressable>
    </View>
  );
}
