const fs = require('node:fs');
const { withAndroidManifest } = require('expo/config-plugins');
const pacote = require('./package.json');

// Sem este arquivo o APK compila normalmente, mas não recebe avisos com o app fechado.
const googleServices = './google-services.json';
const temFirebase = fs.existsSync(googleServices);

// Cresce a cada versão: o Android só atualiza por cima se o número subir. O CI informa o da execução.
const versionCode = Number(process.env.APP_VERSION_CODE) || 1;

// Só no fluxo de teste do CI (app-fluxo.yml): o emulador fala com a API local, sem HTTPS.
const testeHttp = process.env.APP_TESTE_HTTP === '1';
const liberarHttp = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return c;
  });

module.exports = {
  expo: {
    name: 'Flow',
    slug: 'etiquetas-app',
    version: pacote.version,
    orientation: 'portrait',
    scheme: 'etiquetas',
    userInterfaceStyle: 'light',
    icon: './assets/icone.png',
    android: {
      package: 'br.com.etiquetas.app',
      versionCode,
      adaptiveIcon: { foregroundImage: './assets/icone-frente.png', backgroundColor: '#ea580c' },
      permissions: ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'],
      ...(temFirebase ? { googleServicesFile: googleServices } : {}),
    },
    ios: {
      bundleIdentifier: 'br.com.etiquetas.app',
      infoPlist: { NSCameraUsageDescription: 'A câmera lê o QR code que vincula o celular à sua conta.' },
    },
    plugins: [
      ['expo-camera', { cameraPermission: 'A câmera lê o QR code que vincula o celular à sua conta.', microphonePermission: false, recordAudioAndroid: false }],
      'expo-secure-store',
      ['expo-notifications', { color: '#ea580c', defaultChannel: 'avisos' }],
      ...(testeHttp ? [liberarHttp] : []),
    ],
    extra: { temFirebase, testeHttp },
  },
};
