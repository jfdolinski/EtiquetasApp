import { StyleSheet, Text, View } from 'react-native';
import { textoCelula } from './regras';
import { cores } from './ui';

/** Os campos do produto um abaixo do outro: o nome da coluna e, ao lado, o valor. */
export function CamposDoProduto({ colunas, registro }: { colunas: string[]; registro: Record<string, unknown> }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {colunas.map((c) => (
        <View key={c} style={estilos.linha}>
          <Text style={estilos.rotulo} numberOfLines={1}>{c}</Text>
          <Text style={estilos.valor}>{textoCelula(registro[c]) || '—'}</Text>
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
