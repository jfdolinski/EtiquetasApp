import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { NotificacaoResumo } from '../../../packages/shared/src/notificacoes';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import { apagarSessao, clienteDa, gravarSessao, lerSessao, versaoPublicada, type Sessao } from './api';
import { avisarAgora, prepararNotificacoes, tokenDePush } from './avisos';
import { avisosNovos, chavesDosAvisos, versaoMaisNova } from './regras';
import { TelaAvisos } from './TelaAvisos';
import { MEMORIA_AVULSA_VAZIA, TelaAvulsa, type MemoriaAvulsa } from './TelaAvulsa';
import { TelaInicio } from './TelaInicio';
import { TelaLista } from './TelaLista';
import { TelaVincular } from './TelaVincular';
import { Alerta, cores } from './ui';

type Aba = 'inicio' | 'lista' | 'avulsa' | 'avisos';
const INTERVALO_AVISOS_MS = 60_000;

export function App() {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    void lerSessao().then((s) => {
      setSessao(s);
      setCarregando(false);
    });
  }, []);

  const encerrar = useCallback((razao: string | null) => {
    void apagarSessao();
    setSessao(null);
    setMotivo(razao);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: cores.branco }} edges={['top', 'bottom']}>
        {/* A tela encolhe com o teclado: no Android novo ele fica por cima do conteúdo. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        {carregando ? (
          <View style={estilos.centro}><ActivityIndicator size="large" color={cores.azul} /></View>
        ) : sessao ? (
          <Principal sessao={sessao} encerrar={encerrar} atualizarSessao={setSessao} />
        ) : (
          <TelaVincular motivo={motivo} aoVincular={(s) => { setMotivo(null); setSessao(s); }} />
        )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Principal({ sessao, encerrar, atualizarSessao }: { sessao: Sessao; encerrar: (razao: string | null) => void; atualizarSessao: (s: Sessao) => void }) {
  const [aba, setAba] = useState<Aba>('inicio');
  const [avisos, setAvisos] = useState<NotificacaoResumo[]>([]);
  const [erroAvisos, setErroAvisos] = useState<string | null>(null);
  const [carregandoAvisos, setCarregandoAvisos] = useState(false);
  const [recebeFechado, setRecebeFechado] = useState(false);
  const [versaoNova, setVersaoNova] = useState<string | null>(null);
  // Aqui, e não na tela: ir a outra guia e voltar não perde a lista que está sendo lida.
  const [memoriaAvulsa, setMemoriaAvulsa] = useState<MemoriaAvulsa>(MEMORIA_AVULSA_VAZIA);
  const vistos = useRef<Set<string> | null>(null);
  const usuario = sessao.usuario;
  const podeVerAvisos = usuario.superAdmin || usuario.permissoes.includes('notificacao.ver');
  const podeImprimir = usuario.superAdmin || usuario.permissoes.includes('imprimir');

  const api = useMemo(() => clienteDa(sessao, () => encerrar('Este celular foi desvinculado. Para usar de novo, leia outro QR code.')), [sessao, encerrar]);

  const buscarAvisos = useCallback(async () => {
    if (!podeVerAvisos) return;
    setCarregandoAvisos(true);
    try {
      const lista = await api<NotificacaoResumo[]>('/notificacoes');
      setAvisos(lista);
      setErroAvisos(null);
      // Rede de segurança do push: com o app aberto, o que chegou de novo vira notificação local.
      for (const n of avisosNovos(lista, vistos.current).slice(0, 3)) void avisarAgora(n.titulo, n.mensagem);
      vistos.current = chavesDosAvisos(lista);
    } catch (e) {
      setErroAvisos((e as Error).message);
    } finally {
      setCarregandoAvisos(false);
    }
  }, [api, podeVerAvisos]);

  // Permissões mudam no sistema: confere de novo ao abrir, e registra o aparelho para receber avisos.
  useEffect(() => {
    void api<UsuarioLogado>('/auth/me')
      .then((u) => {
        const nova = { ...sessao, usuario: u };
        void gravarSessao(nova);
        if (JSON.stringify(u) !== JSON.stringify(sessao.usuario)) atualizarSessao(nova);
      })
      .catch(() => undefined);
    void (async () => {
      if (!(await prepararNotificacoes())) return;
      const token = await tokenDePush();
      if (!token) return;
      await api('/app/push', { metodo: 'PUT', corpo: { token } });
      setRecebeFechado(true);
    })().catch(() => undefined);
    void versaoPublicada(sessao.servidor).then((v) => {
      const atual = Constants.expoConfig?.version;
      if (v && atual && versaoMaisNova(v, atual)) setVersaoNova(v);
    });
    // Só ao abrir este vínculo: `sessao` muda aqui dentro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao.token]);

  useEffect(() => {
    void buscarAvisos();
    const t = setInterval(() => {
      if (AppState.currentState === 'active') void buscarAvisos();
    }, INTERVALO_AVISOS_MS);
    const s = AppState.addEventListener('change', (e) => e === 'active' && void buscarAvisos());
    return () => {
      clearInterval(t);
      s.remove();
    };
  }, [buscarAvisos]);

  // Tocar num aviso abre a tela certa.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const abrir = (r: Notifications.NotificationResponse | null) => {
      const tela = r?.notification.request.content.data?.tela;
      if (tela === 'lista' || tela === 'avulsa' || tela === 'avisos' || tela === 'inicio') setAba(tela);
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => abrir(r ?? null));
    const s = Notifications.addNotificationResponseReceivedListener(abrir);
    return () => s.remove();
  }, []);

  function desvincular() {
    const executar = () => {
      void api('/app/dispositivos').then(async (lista) => {
        const atual = (lista as { id: string; atual: boolean }[]).find((d) => d.atual);
        if (atual) await api(`/app/dispositivos/${atual.id}`, { metodo: 'DELETE' });
      }).catch(() => undefined).finally(() => encerrar(null));
    };
    const texto = 'O aplicativo deixa de funcionar neste celular até ler um QR code novo.';
    if (Platform.OS === 'web') {
      if (window.confirm(texto)) executar();
    } else {
      Alert.alert('Desvincular este celular?', texto, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Desvincular', style: 'destructive', onPress: executar }]);
    }
  }

  const marcarLida = (id: string) => {
    setAvisos((l) => l.map((a) => (a.id === id ? { ...a, lidaEm: new Date().toISOString() } : a)));
    void api(`/notificacoes/${id}/lida`, { metodo: 'POST' }).catch(() => undefined);
  };
  const marcarTodas = () => {
    setAvisos((l) => l.map((a) => ({ ...a, lidaEm: a.lidaEm ?? new Date().toISOString() })));
    void api('/notificacoes/lidas', { metodo: 'POST' }).catch(() => undefined);
  };
  const naoLidas = avisos.filter((a) => !a.lidaEm && !a.resolvidaEm).length;

  return (
    <View style={{ flex: 1 }}>
      {versaoNova ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${sessao.servidor}/downloads/etiquetas-app.apk`)}>
          <Alerta tipo="aviso">Há uma versão nova do aplicativo ({versaoNova}). Toque para baixar.</Alerta>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {aba === 'inicio' && <TelaInicio api={api} usuario={usuario} irParaLista={() => setAba('lista')} />}
        {aba === 'lista' && <TelaLista api={api} usuario={usuario} />}
        {aba === 'avulsa' && podeImprimir && <TelaAvulsa api={api} sessao={sessao} memoria={memoriaAvulsa} setMemoria={setMemoriaAvulsa} />}
        {aba === 'avisos' && (
          <TelaAvisos
            usuario={usuario}
            avisos={avisos}
            erro={erroAvisos}
            carregando={carregandoAvisos}
            avisosNoCelular={recebeFechado || Platform.OS === 'web'}
            atualizar={() => void buscarAvisos()}
            marcarLida={marcarLida}
            marcarTodas={marcarTodas}
            desvincular={desvincular}
          />
        )}
      </View>
      <View style={estilos.abas} accessibilityRole="tablist">
        <BotaoAba rotulo="Início" ativa={aba === 'inicio'} aoTocar={() => setAba('inicio')} />
        <BotaoAba rotulo="Lista do dia" ativa={aba === 'lista'} aoTocar={() => setAba('lista')} />
        {podeImprimir && <BotaoAba rotulo="Etiqueta avulsa" ativa={aba === 'avulsa'} aoTocar={() => setAba('avulsa')} />}
        <BotaoAba rotulo="Avisos" contagem={naoLidas} ativa={aba === 'avisos'} aoTocar={() => setAba('avisos')} />
      </View>
    </View>
  );
}

function BotaoAba({ rotulo, ativa, contagem, aoTocar }: { rotulo: string; ativa: boolean; contagem?: number; aoTocar: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: ativa }} accessibilityLabel={contagem ? `${rotulo}, ${contagem} sem ler` : rotulo} onPress={aoTocar} style={[estilos.aba, ativa && estilos.abaAtiva]}>
      <Text style={[estilos.abaTexto, ativa && estilos.abaTextoAtivo]}>{rotulo}{contagem ? ` (${contagem})` : ''}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  abas: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: cores.borda, backgroundColor: cores.branco },
  aba: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderTopColor: 'transparent' },
  abaAtiva: { borderTopColor: cores.azul },
  abaTexto: { fontSize: 13, color: cores.suave, fontWeight: '500', textAlign: 'center', paddingHorizontal: 2 },
  abaTextoAtivo: { color: cores.azul, fontWeight: '700' },
});
