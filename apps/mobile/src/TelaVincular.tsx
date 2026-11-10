import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { ErroApi, gravarSessao, vincular, type Sessao } from './api';
import { codigoValido, lerQrDeVinculo, servidorValido, type DadosVinculo } from './regras';
import { Alerta, Botao, cores } from './ui';

const aceitarHttp = __DEV__ || Platform.OS === 'web' || Boolean((Constants.expoConfig?.extra as { testeHttp?: boolean } | undefined)?.testeHttp);

export function TelaVincular({ aoVincular, motivo }: { aoVincular: (s: Sessao) => void; motivo?: string | null }) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [modo, setModo] = useState<'inicio' | 'camera' | 'digitar'>('inicio');
  const [dados, setDados] = useState<DadosVinculo | null>(null);
  const [servidor, setServidor] = useState('https://');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // O QR também abre o app direto pela câmera do celular, pelo link etiquetas://.
  useEffect(() => {
    const abrir = (url: string | null | undefined) => {
      const lido = url ? lerQrDeVinculo(url, aceitarHttp) : null;
      if (lido) setDados(lido);
    };
    void Linking.getInitialURL().then(abrir);
    const s = Linking.addEventListener('url', (e) => abrir(e.url));
    return () => s.remove();
  }, []);

  function aoLer(texto: string) {
    const lido = lerQrDeVinculo(texto, aceitarHttp);
    if (lido) {
      setErro(null);
      setDados(lido);
      setModo('inicio');
    } else {
      setErro('Este QR code não é de vínculo. Use o de Minha conta, no sistema.');
      setModo('inicio');
    }
  }

  async function abrirCamera() {
    setErro(null);
    const p = permissao?.granted ? permissao : await pedirPermissao();
    if (p.granted) setModo('camera');
    else setErro('Sem permissão para usar a câmera. Você pode digitar o código.');
  }

  function usarDigitado() {
    const s = servidorValido(servidor, aceitarHttp);
    const c = codigoValido(codigo);
    if (!s) return setErro('Endereço do sistema inválido. Ele começa com https://');
    if (!c) return setErro('O código tem 10 letras e números.');
    setErro(null);
    setDados({ servidor: s, codigo: c });
  }

  async function confirmar() {
    if (!dados) return;
    setErro(null);
    setEnviando(true);
    try {
      const nome = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'Celular';
      const r = await vincular(dados.servidor, dados.codigo, nome, Platform.OS === 'ios' ? 'IOS' : 'ANDROID', Constants.expoConfig?.version ?? '');
      const sessao: Sessao = { servidor: dados.servidor, ...r };
      await gravarSessao(sessao);
      aoVincular(sessao);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível vincular.');
      setDados(null);
      setModo('inicio');
    } finally {
      setEnviando(false);
    }
  }

  if (modo === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => aoLer(r.data)} />
        <View style={{ padding: 16, backgroundColor: cores.branco }}>
          <Text style={estilos.texto}>Aponte para o QR code em Minha conta, no sistema.</Text>
          <Botao titulo="Cancelar" variante="secundario" onPress={() => setModo('inicio')} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={estilos.pagina} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={estilos.titulo}>Flow</Text>
      {motivo ? <Alerta tipo="aviso">{motivo}</Alerta> : null}
      {erro ? <Alerta>{erro}</Alerta> : null}

      {dados ? (
        <>
          <Text style={estilos.texto}>Vincular este celular à sua conta em:</Text>
          <Text style={estilos.servidor}>{new URL(dados.servidor).host}</Text>
          <Text style={estilos.ajuda}>Confira se é o endereço que você usa no computador.</Text>
          <Botao titulo="Vincular" ocupado={enviando} onPress={() => void confirmar()} />
          <View style={{ height: 8 }} />
          <Botao titulo="Cancelar" variante="secundario" disabled={enviando} onPress={() => setDados(null)} />
        </>
      ) : modo === 'digitar' ? (
        <>
          <Text style={estilos.rotulo}>Endereço do sistema</Text>
          <TextInput accessibilityLabel="Endereço do sistema" style={estilos.campo} value={servidor} onChangeText={setServidor} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Text style={estilos.rotulo}>Código</Text>
          <TextInput accessibilityLabel="Código" style={estilos.campo} value={codigo} onChangeText={setCodigo} autoCapitalize="characters" autoCorrect={false} maxLength={14} />
          <Botao titulo="Continuar" onPress={usarDigitado} />
          <View style={{ height: 8 }} />
          <Botao titulo="Voltar" variante="secundario" onPress={() => setModo('inicio')} />
        </>
      ) : (
        <>
          <Text style={estilos.texto}>No computador, abra o sistema, entre em Minha conta e clique em “Mostrar QR code”. Depois, leia o código aqui.</Text>
          {Platform.OS !== 'web' && <Botao titulo="Ler QR code" onPress={() => void abrirCamera()} />}
          <View style={{ height: 8 }} />
          <Botao titulo="Digitar o código" variante="secundario" onPress={() => { setErro(null); setModo('digitar'); }} />
        </>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pagina: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: cores.fundo },
  titulo: { fontSize: 30, fontWeight: '700', color: cores.azul, marginBottom: 20 },
  texto: { fontSize: 16, color: cores.texto, marginBottom: 16, lineHeight: 23 },
  servidor: { fontSize: 20, fontWeight: '700', color: cores.texto, marginBottom: 4 },
  ajuda: { fontSize: 14, color: cores.suave, marginBottom: 20 },
  rotulo: { fontSize: 14, color: cores.texto, fontWeight: '600', marginBottom: 4 },
  campo: { minHeight: 48, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, paddingHorizontal: 12, fontSize: 16, color: cores.texto, marginBottom: 14 },
});
