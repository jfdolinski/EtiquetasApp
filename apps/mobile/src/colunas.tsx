import { StyleSheet, Text, View } from 'react-native';
import { textoCelula } from './regras';
import { cores } from './ui';

/** Títulos das colunas, alinhados com as linhas abaixo deles. */
export function TitulosColunas({ colunas, recuoEsquerda = 0 }: { colunas: string[]; recuoEsquerda?: number }) {
  return (
    <View style={[estilos.linha, { paddingLeft: recuoEsquerda }]}>
      {colunas.map((c) => (
        <Text key={c} style={estilos.titulo} numberOfLines={1}>{c}</Text>
      ))}
    </View>
  );
}

export function ValoresColunas({ colunas, registro }: { colunas: string[]; registro: Record<string, unknown> }) {
  return (
    <View style={estilos.linha}>
      {colunas.map((c) => (
        <Text key={c} style={estilos.valor} numberOfLines={3}>{textoCelula(registro[c]) || '—'}</Text>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flex: 1, flexDirection: 'row', gap: 6 },
  titulo: { flex: 1, minWidth: 0, fontSize: 11, fontWeight: '700', color: cores.suave, textTransform: 'uppercase' },
  valor: { flex: 1, minWidth: 0, fontSize: 13, color: cores.texto },
});
