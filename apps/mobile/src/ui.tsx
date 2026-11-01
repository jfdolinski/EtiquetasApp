import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';

export const cores = {
  azul: '#1d4ed8',
  azulClaro: '#dbeafe',
  fundo: '#f8fafc',
  borda: '#e2e8f0',
  texto: '#0f172a',
  suave: '#64748b',
  branco: '#ffffff',
  erro: '#b91c1c',
  erroFundo: '#fef2f2',
  aviso: '#92400e',
  avisoFundo: '#fffbeb',
  ok: '#166534',
  okFundo: '#f0fdf4',
};

export function Botao({ titulo, variante = 'primario', ocupado, disabled, ...resto }: PressableProps & { titulo: string; variante?: 'primario' | 'secundario' | 'perigo'; ocupado?: boolean }) {
  const inativo = disabled || ocupado;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled: Boolean(inativo), busy: Boolean(ocupado) }}
      disabled={inativo}
      style={({ pressed }) => [estilos.botao, variante === 'primario' ? estilos.primario : variante === 'perigo' ? estilos.perigo : estilos.secundario, (pressed || inativo) && { opacity: 0.6 }]}
      {...resto}
    >
      {ocupado ? (
        <ActivityIndicator color={variante === 'primario' ? cores.branco : cores.azul} />
      ) : (
        <Text style={[estilos.botaoTexto, variante === 'primario' ? { color: cores.branco } : variante === 'perigo' ? { color: cores.erro } : { color: cores.texto }]}>{titulo}</Text>
      )}
    </Pressable>
  );
}

export function Alerta({ tipo = 'erro', children }: { tipo?: 'erro' | 'aviso' | 'ok'; children: ReactNode }) {
  const c = { erro: [cores.erroFundo, cores.erro], aviso: [cores.avisoFundo, cores.aviso], ok: [cores.okFundo, cores.ok] }[tipo];
  return (
    <View accessibilityRole="alert" style={[estilos.alerta, { backgroundColor: c[0] }]}>
      <Text style={{ color: c[1], fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function Cartao({ children }: { children: ReactNode }) {
  return <View style={estilos.cartao}>{children}</View>;
}

export function Numero({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: string | number; detalhe?: string; alerta?: boolean }) {
  return (
    <View style={estilos.numero}>
      <Text style={estilos.numeroRotulo}>{rotulo}</Text>
      <Text style={[estilos.numeroValor, alerta && { color: cores.erro }]}>{valor}</Text>
      {detalhe ? <Text style={estilos.numeroDetalhe}>{detalhe}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  botao: { minHeight: 48, borderRadius: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primario: { backgroundColor: cores.azul, borderColor: cores.azul },
  secundario: { backgroundColor: cores.branco, borderColor: cores.borda },
  perigo: { backgroundColor: cores.branco, borderColor: '#fecaca' },
  botaoTexto: { fontSize: 16, fontWeight: '600' },
  alerta: { borderRadius: 8, padding: 12, marginBottom: 12 },
  cartao: { backgroundColor: cores.branco, borderRadius: 10, borderWidth: 1, borderColor: cores.borda, padding: 14, marginBottom: 12 },
  numero: { flexBasis: '47%', flexGrow: 1, backgroundColor: cores.branco, borderRadius: 10, borderWidth: 1, borderColor: cores.borda, padding: 14 },
  numeroRotulo: { fontSize: 13, color: cores.suave },
  numeroValor: { fontSize: 26, fontWeight: '700', color: cores.texto, marginTop: 2 },
  numeroDetalhe: { fontSize: 12, color: cores.suave, marginTop: 2 },
});
