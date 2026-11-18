import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { PerfilEntregador, SessaoEntregadorResposta } from '../../../packages/shared/src/entregas';
import { apagarSessao, clienteDa, ErroApi, gravarSessao, lerSessao, versaoDoApp, versaoPublicada, type Sessao } from './api';
import { pararRastreio } from './localizacao';
import { versaoMaisNova } from './regras';
import { TelaCreditos } from './TelaCreditos';
import { TelaDocumentos } from './TelaDocumentos';
import { TelaEntrar } from './TelaEntrar';
import { TelaInicio } from './TelaInicio';
import { TelaPerfil } from './TelaPerfil';
import { Alerta, Botao, cores } from './ui';

type Aba = 'inicio' | 'creditos' | 'perfil';

export function App() {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [perfilInicial, setPerfilInicial] = useState<PerfilEntregador | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    void lerSessao().then((s) => {
      setSessao(s);
      setCarregando(false);
    });
  }, []);

  const encerrar = useCallback((razao: string | null) => {
    void pararRastreio();
    void apagarSessao();
    setSessao(null);
    setPerfilInicial(null);
    setMotivo(razao);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: cores.branco }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
          {carregando ? (
            <View style={estilos.centro}>
              <ActivityIndicator size="large" color={cores.azul} />
            </View>
          ) : sessao ? (
            <Principal sessao={sessao} perfilInicial={perfilInicial} encerrar={encerrar} />
          ) : (
            <TelaEntrar
              motivo={motivo}
              aoEntrar={(s: Sessao, r: SessaoEntregadorResposta) => {
                void gravarSessao(s);
                setMotivo(null);
                setPerfilInicial(r.perfil);
                setSessao(s);
              }}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Principal({ sessao, perfilInicial, encerrar }: { sessao: Sessao; perfilInicial: PerfilEntregador | null; encerrar: (razao: string | null) => void }) {
  const api = useMemo(() => clienteDa(sessao, () => encerrar('Sua sessão terminou. Entre de novo.')), [sessao, encerrar]);
  const [perfil, setPerfil] = useState<PerfilEntregador | null>(perfilInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('inicio');
  const [versaoNova, setVersaoNova] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setPerfil(await api<PerfilEntregador>('/entregador/eu'));
      setErro(null);
    } catch (e) {
      if (!(e instanceof ErroApi && e.status === 401)) setErro((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void recarregar();
    void versaoPublicada(sessao.servidor).then((v) => v && versaoMaisNova(v, versaoDoApp()) && setVersaoNova(v));
    // Voltou para o app: a aprovação ou a compra podem ter saído.
    const s = AppState.addEventListener('change', (estado) => estado === 'active' && void recarregar());
    return () => s.remove();
  }, [recarregar, sessao.servidor]);

  const mudarSaldo = useCallback((saldo: number) => setPerfil((p) => (p && p.saldoDiarias !== saldo ? { ...p, saldoDiarias: saldo } : p)), []);

  async function sair() {
    try {
      await api('/entregador/sair', { metodo: 'POST' });
    } catch {
      // Sem internet: sai mesmo assim; a sessão fica no servidor até alguém encerrar.
    }
    encerrar(null);
  }

  if (!perfil) {
    return (
      <View style={estilos.centro}>
        {erro ? (
          <View style={{ padding: 16, alignSelf: 'stretch' }}>
            <Alerta>{erro}</Alerta>
            <Botao titulo="Tentar de novo" onPress={() => void recarregar()} />
          </View>
        ) : (
          <ActivityIndicator size="large" color={cores.azul} />
        )}
      </View>
    );
  }

  const aviso = versaoNova ? (
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${sessao.servidor}/downloads/flow-entregas.apk`)} style={estilos.versao}>
      <Text style={{ color: cores.branco, fontWeight: '600' }}>Há uma versão nova do aplicativo ({versaoNova}). Toque para baixar.</Text>
    </Pressable>
  ) : null;

  if (perfil.situacao !== 'APROVADO') {
    return (
      <View style={{ flex: 1, backgroundColor: cores.fundo }}>
        {aviso}
        <TelaDocumentos api={api} perfil={perfil} aoMudar={setPerfil} sair={() => void sair()} />
      </View>
    );
  }

  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'inicio', rotulo: 'Início' },
    { id: 'creditos', rotulo: 'Créditos' },
    { id: 'perfil', rotulo: 'Perfil' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo }}>
      {aviso}
      {erro && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Alerta>{erro}</Alerta>
        </View>
      )}
      <View style={{ flex: 1 }}>
        {aba === 'inicio' && <TelaInicio api={api} perfil={perfil} aoMudar={setPerfil} irParaCreditos={() => setAba('creditos')} />}
        {aba === 'creditos' && <TelaCreditos api={api} aoMudarSaldo={mudarSaldo} />}
        {aba === 'perfil' && <TelaPerfil api={api} perfil={perfil} aoMudar={setPerfil} sair={() => void sair()} versao={versaoDoApp()} />}
      </View>
      <View style={estilos.guias} accessibilityRole="tablist">
        {abas.map((a) => (
          <Pressable key={a.id} accessibilityRole="tab" accessibilityState={{ selected: aba === a.id }} accessibilityLabel={a.rotulo} onPress={() => setAba(a.id)} style={estilos.guia}>
            <Text style={[estilos.guiaTexto, aba === a.id && { color: cores.azul }]}>{a.rotulo}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guias: { flexDirection: 'row', borderTopWidth: 1, borderColor: cores.borda, backgroundColor: cores.branco },
  guia: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  guiaTexto: { fontSize: 14, fontWeight: '600', color: cores.suave },
  versao: { backgroundColor: cores.azul, padding: 12 },
});
