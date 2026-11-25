import type { ReactNode } from 'react';
import { Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold, useFonts } from '@expo-google-fonts/archivo';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';

export const cores = {
  /** A cor de agir (botões principais, links, guia ativa): o laranja da logomarca. */
  azul: '#e2570b',
  laranja: '#e2570b',
  azulClaro: '#fff1e6',
  grafite: '#1d2831',
  grafiteClaro: '#2a3641',
  fundo: '#f2f4f6',
  borda: '#d7dde2',
  texto: '#18222b',
  suave: '#5d6a76',
  branco: '#ffffff',
  erro: '#b42318',
  erroFundo: '#fdf0ee',
  aviso: '#8a4b07',
  avisoFundo: '#fff7e8',
  ok: '#0e6b4f',
  okFundo: '#ebf7f2',
};

/** Archivo: a cara de etiqueta e de número de preço (carregada em `useFontesFlow`). */
export const fontes = {
  titulo: 'Archivo_800ExtraBold',
  forte: 'Archivo_700Bold',
  media: 'Archivo_600SemiBold',
};

/** Carrega a Archivo; enquanto não chega, as telas usam a fonte do sistema (não trava a abertura). */
export function useFontesFlow(): boolean {
  const [ok] = useFonts({ Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold });
  return ok;
}

/** O rótulo da guia: a ativa vira uma etiqueta laranja com o furinho do barbante. */
export function RotuloGuia({ texto, ativa }: { texto: string; ativa: boolean }) {
  return ativa ? (
    <View style={estilos.etiqueta}>
      <View style={estilos.furo} />
      <Text numberOfLines={1} style={estilos.etiquetaTexto}>
        {texto}
      </Text>
    </View>
  ) : (
    <Text numberOfLines={1} style={estilos.guiaTexto}>
      {texto}
    </Text>
  );
}

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
  etiqueta: { flexDirection: 'row', alignItems: 'center', backgroundColor: cores.azul, borderRadius: 6, paddingVertical: 6, paddingLeft: 5, paddingRight: 7, gap: 4 },
  furo: { width: 4, height: 4, borderRadius: 2, backgroundColor: cores.grafite },
  etiquetaTexto: { color: cores.branco, fontSize: 13, fontFamily: fontes.forte, fontWeight: '700' },
  guiaTexto: { color: '#b9c3cc', fontSize: 13, fontFamily: fontes.media, fontWeight: '600', textAlign: 'center' },
  botao: { minHeight: 50, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primario: { backgroundColor: cores.azul, borderColor: cores.azul, borderBottomWidth: 3, borderBottomColor: '#b8470a' },
  secundario: { backgroundColor: cores.branco, borderColor: cores.borda, borderBottomWidth: 2 },
  perigo: { backgroundColor: cores.branco, borderColor: '#f3b8b0', borderBottomWidth: 2 },
  botaoTexto: { fontSize: 16, fontFamily: fontes.forte, fontWeight: '700' },
  alerta: { borderRadius: 10, padding: 12, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: 'rgba(0,0,0,0.18)' },
  cartao: { backgroundColor: cores.branco, borderRadius: 14, borderWidth: 1, borderColor: cores.borda, padding: 16, marginBottom: 12 },
  numero: { flexBasis: '47%', flexGrow: 1, backgroundColor: cores.branco, borderRadius: 14, borderWidth: 1, borderColor: cores.borda, padding: 16 },
  numeroRotulo: { fontSize: 13, color: cores.suave },
  numeroValor: { fontSize: 30, fontFamily: fontes.titulo, fontWeight: '800', color: cores.texto, marginTop: 2, fontVariant: ['tabular-nums'] },
  numeroDetalhe: { fontSize: 12, color: cores.suave, marginTop: 2 },
});
