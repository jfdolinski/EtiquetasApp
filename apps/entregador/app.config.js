const { withAndroidManifest } = require('expo/config-plugins');
const pacote = require('./package.json');

// Cresce a cada versão: o Android só atualiza por cima se o número subir. O CI informa o da execução.
const versionCode = Number(process.env.APP_VERSION_CODE) || 1;

// Endereço do Flow, gravado no APK pelo CI (segredo ENTREGADOR_SERVIDOR): o repositório é público.
// Sem ele, a tela de entrada pede o endereço.
const servidor = (process.env.APP_SERVIDOR || '').trim().replace(/\/+$/, '');

// Só em teste no emulador: fala com a API local, sem HTTPS.
const testeHttp = process.env.APP_TESTE_HTTP === '1';
const liberarHttp = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return c;
  });

const USO_LOCALIZACAO = 'Enquanto você está online, o Flow Entregas usa sua localização para mostrar às empresas que há um entregador por perto e oferecer chamadas. Offline, nada é coletado.';

module.exports = {
  expo: {
    name: 'Flow Entregas',
    slug: 'etiquetas-entregador',
    version: pacote.version,
    orientation: 'portrait',
    scheme: 'etiquetas-entregador',
    userInterfaceStyle: 'light',
    icon: './assets/icone.png',
    android: {
      package: 'br.com.etiquetas.entregador',
      versionCode,
      adaptiveIcon: { foregroundImage: './assets/icone-frente.png', backgroundColor: '#ea580c' },
      permissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.CAMERA',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.VIBRATE',
      ],
    },
    ios: {
      bundleIdentifier: 'br.com.etiquetas.entregador',
    },
    plugins: [
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: USO_LOCALIZACAO,
          locationWhenInUsePermission: USO_LOCALIZACAO,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      ['expo-image-picker', { cameraPermission: 'A câmera fotografa seus documentos e o comprovante do Pix.', photosPermission: 'Para escolher a foto de um documento ou do comprovante.', microphonePermission: false }],
      'expo-secure-store',
      ['expo-camera', { cameraPermission: 'A câmera lê o número de série das máquinas e fotografa documentos.', microphonePermission: false, recordAudioAndroid: false }],
      ['expo-notifications', { color: '#ea580c' }],
      ...(testeHttp ? [liberarHttp] : []),
    ],
    extra: { servidor, testeHttp },
  },
};
