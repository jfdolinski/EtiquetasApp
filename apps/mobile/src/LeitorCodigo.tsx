import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Botao, cores } from './ui';

/** Câmera em tela cheia para ler o código de barras do produto. */
export function LeitorCodigo({ aoLer, aoCancelar }: { aoLer: (codigo: string) => void; aoCancelar: () => void }) {
  const [lanterna, setLanterna] = useState(false);
  // A câmera dispara várias vezes para o mesmo código: só a primeira leitura vale.
  const lido = useRef(false);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={lanterna}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14', 'qr'] }}
        onBarcodeScanned={(r) => {
          if (lido.current || !r.data) return;
          lido.current = true;
          aoLer(r.data.trim());
        }}
      />
      <View style={estilos.rodape}>
        <Text style={estilos.texto}>Aponte para o código de barras do produto.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Botao titulo={lanterna ? 'Apagar luz' : 'Acender luz'} variante="secundario" onPress={() => setLanterna(!lanterna)} /></View>
          <View style={{ flex: 1 }}><Botao titulo="Cancelar" variante="secundario" onPress={aoCancelar} /></View>
        </View>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  rodape: { padding: 16, backgroundColor: cores.branco },
  texto: { fontSize: 15, color: cores.texto, marginBottom: 12 },
});
