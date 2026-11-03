import { createContext, useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { textoNaTela } from './regras';
import { cores } from './ui';

/** Quantas linhas cada produto mostra nas telas, escolhido neste celular; null = todas. */
export const LinhasPorProduto = createContext<number | null>(null);

/** Os campos do produto um abaixo do outro: o nome da coluna e, ao lado, o valor, sempre em uma linha só. */
export function CamposDoProduto({ colunas, registro }: { colunas: string[]; registro: Record<string, unknown> }) {
  const limite = useContext(LinhasPorProduto);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {(limite === null ? colunas : colunas.slice(0, limite)).map((c) => (
        <View key={c} style={estilos.linha}>
          <Text style={estilos.rotulo} numberOfLines={1}>{c}</Text>
          <Text style={estilos.valor} numberOfLines={1} ellipsizeMode="tail">{textoNaTela(registro[c]) || '—'}</Text>
        </View>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', gap: 8, paddingVertical: 1 },
  rotulo: { width: 92, fontSize: 12, fontWeight: '600', color: cores.suave, paddingTop: 1 },
  valor: { flex: 1, minWidth: 0, fontSize: 14, color: cores.texto },
});
