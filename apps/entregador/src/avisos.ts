import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { OfertaResumo } from '../../../packages/shared/src/entregas-chamadas';
import { formatarCentavos, ROTULO_TIPO_CHAMADA } from './regras';

/**
 * Aviso de oferta sem Firebase: a tarefa de localização roda a cada 20 s mesmo com a tela
 * apagada e a resposta traz a oferta; daqui sai uma notificação local, com som.
 */
const CANAL = 'ofertas';
let ultimaAvisada: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function prepararNotificacoes(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CANAL, {
      name: 'Ofertas de chamada',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400, 200, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const atual = await Notifications.getPermissionsAsync();
  if (atual.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Uma vez por oferta. */
export async function avisarOferta(o: OfertaResumo): Promise<void> {
  if (Platform.OS === 'web' || ultimaAvisada === o.id) return;
  ultimaAvisada = o.id;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Nova chamada: ${formatarCentavos(o.valorCentavos)}`,
      body: `${ROTULO_TIPO_CHAMADA[o.tipo]} · ${o.empresa} · ${o.origemResumo} → ${o.destinoResumo}. Abra para aceitar.`,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      data: { ofertaId: o.id },
    },
    trigger: Platform.OS === 'android' ? { channelId: CANAL } : null,
  });
}

/** Notificações liberadas? No navegador não se aplica (nulo). */
export async function notificacoesPermitidas(): Promise<boolean | null> {
  if (Platform.OS === 'web') return null;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return null;
  }
}
