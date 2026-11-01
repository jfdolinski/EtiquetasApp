import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

const CANAL = 'avisos';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function prepararNotificacoes(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CANAL, { name: 'Avisos', importance: Notifications.AndroidImportance.HIGH });
  }
  const atual = await Notifications.getPermissionsAsync();
  if (atual.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Token do Firebase. Sem Firebase neste build, null: os avisos só aparecem com o app aberto. */
export async function tokenDePush(): Promise<string | null> {
  if (Platform.OS === 'web' || !(Constants.expoConfig?.extra as { temFirebase?: boolean } | undefined)?.temFirebase) return null;
  try {
    return (await Notifications.getDevicePushTokenAsync()).data as string;
  } catch {
    return null;
  }
}

export async function avisarAgora(titulo: string, mensagem: string) {
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({ content: { title: titulo, body: mensagem, data: { tela: 'avisos' } }, trigger: null });
}
