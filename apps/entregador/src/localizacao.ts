import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { RespostaPosicao } from '../../../packages/shared/src/entregas';
import { lerSessao, pedir, versaoDoApp } from './api';
import { avisarOferta } from './avisos';
import { INTERVALO_POSICAO_SEGUNDOS } from './regras';

/**
 * Online = serviço do Android em primeiro plano, com notificação fixa, mandando a posição a
 * cada 20 s mesmo com a tela apagada. Parado também manda: a empresa precisa saber que ele
 * continua ali, e sem aviso por 10 min o servidor o tira do mapa.
 */
export const TAREFA_POSICAO = 'flow-entregas-posicao';

type Ouvinte = (r: RespostaPosicao | { erro: string }) => void;
const ouvintes = new Set<Ouvinte>();
export function aoReceberResposta(f: Ouvinte): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

function corpoDa(p: Location.LocationObject) {
  return { lat: p.coords.latitude, lon: p.coords.longitude, precisao: p.coords.accuracy ?? null, simulada: p.mocked === true, versao: versaoDoApp() };
}

/** Manda uma posição; o servidor decide se continua online (sem crédito, suspenso…). */
export async function enviarPosicao(p: Location.LocationObject, ficarOnline = false): Promise<RespostaPosicao> {
  const sessao = await lerSessao();
  if (!sessao) {
    await pararRastreio();
    throw new Error('Sem sessão.');
  }
  const r = await pedir<RespostaPosicao>(sessao.servidor, ficarOnline ? '/entregador/online' : '/entregador/posicao', { metodo: 'POST', corpo: corpoDa(p), token: sessao.token });
  if (!r.online) await pararRastreio();
  if (r.oferta) await avisarOferta(r.oferta).catch(() => undefined);
  return r;
}

// A tarefa precisa existir já no carregamento do app (index.ts importa este arquivo): o Android
// pode acordá-la com o app fechado.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(TAREFA_POSICAO, async ({ data, error }) => {
    if (error) return;
    const locais = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    const ultima = locais[locais.length - 1];
    if (!ultima) return;
    try {
      const r = await enviarPosicao(ultima);
      ouvintes.forEach((f) => f(r));
    } catch (e) {
      ouvintes.forEach((f) => f({ erro: (e as Error).message }));
    }
  });
}

let vigiaWeb: Location.LocationSubscription | null = null;

export type ProblemaPermissao = 'NEGADA' | 'SEM_SEGUNDO_PLANO' | 'GPS_DESLIGADO' | null;

/** Pede as permissões; no Android 11+ o "Permitir o tempo todo" fica nas configurações. */
export async function pedirPermissoes(): Promise<ProblemaPermissao> {
  if (!(await Location.hasServicesEnabledAsync())) return 'GPS_DESLIGADO';
  const frente = await Location.requestForegroundPermissionsAsync();
  if (frente.status !== 'granted') return 'NEGADA';
  if (Platform.OS === 'web') return null;
  const fundo = await Location.requestBackgroundPermissionsAsync();
  return fundo.status === 'granted' ? null : 'SEM_SEGUNDO_PLANO';
}

export async function posicaoAtual(): Promise<Location.LocationObject> {
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}

export async function rastreando(): Promise<boolean> {
  if (Platform.OS === 'web') return vigiaWeb !== null;
  return Location.hasStartedLocationUpdatesAsync(TAREFA_POSICAO).catch(() => false);
}

export async function iniciarRastreio(): Promise<void> {
  if (await rastreando()) return;
  if (Platform.OS === 'web') {
    // Só para desenvolver no navegador: manda enquanto a aba estiver aberta.
    vigiaWeb = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: INTERVALO_POSICAO_SEGUNDOS * 1000, distanceInterval: 0 }, (p) => {
      void enviarPosicao(p)
        .then((r) => ouvintes.forEach((f) => f(r)))
        .catch((e: Error) => ouvintes.forEach((f) => f({ erro: e.message })));
    });
    return;
  }
  await Location.startLocationUpdatesAsync(TAREFA_POSICAO, {
    accuracy: Location.Accuracy.High,
    timeInterval: INTERVALO_POSICAO_SEGUNDOS * 1000,
    // 0: parado também avisa (com distância mínima, quem espera na porta da loja sumiria do mapa).
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Você está online',
      notificationBody: 'O Flow Entregas está usando sua localização para receber chamadas.',
      notificationColor: '#ea580c',
      killServiceOnDestroy: false,
    },
  });
}

export async function pararRastreio(): Promise<void> {
  if (Platform.OS === 'web') {
    vigiaWeb?.remove();
    vigiaWeb = null;
    return;
  }
  if (await rastreando()) await Location.stopLocationUpdatesAsync(TAREFA_POSICAO).catch(() => undefined);
}
