import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { PerfilEntregador, SessaoEntregadorResposta } from '../../../packages/shared/src/entregas';
import type { ChamadaEntregador, OfertaResumo } from '../../../packages/shared/src/entregas-chamadas';
import { apagarSessao, clienteDa, ErroApi, gravarSessao, lerSessao, versaoDoApp, versaoPublicada, type Sessao } from './api';
import { aoReceberResposta, pararRastreio } from './localizacao';
import { CartaoOferta, TelaChamada } from './TelaChamada';
import { GuiaBateria, marcarGuiaVisto } from './Bateria';
import { PegarNoBalcao, TermoCustodia } from './Balcao';
import { pendencias, TelaAvisos, useSituacaoDoCelular } from './TelaAvisos';
import { TelaGanhos } from './TelaGanhos';
import { TelaTurnos } from './Escala';
import { TelaMetas, TelaSuporte } from './Extras';
import { versaoMaisNova } from './regras';
import { TelaCreditos } from './TelaCreditos';
import { TelaDocumentos } from './TelaDocumentos';
import { TelaEntrar } from './TelaEntrar';
import { TelaInicio } from './TelaInicio';
import { TelaPerfil } from './TelaPerfil';
import { enviarGuardadas, etapasGuardadas } from './fila';
import { Alerta, Botao, cores, RotuloGuia, useFontesFlow } from './ui';

type Aba = 'inicio' | 'avisos' | 'ganhos' | 'creditos' | 'perfil';
const INTERVALO_TRABALHO_MS = 5_000;

export function App() {
  useFontesFlow();
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
      <StatusBar style="light" />
      {/* Grafite atrás da barra de status e das guias; o conteúdo fica no fundo claro. */}
      <SafeAreaView style={{ flex: 1, backgroundColor: cores.grafite }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, backgroundColor: cores.fundo }}>
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
        </View>
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

  // Oferta e chamada: com o app aberto, a cada 5 s; com a tela apagada, pela tarefa de localização (aviso local).
  const [oferta, setOferta] = useState<OfertaResumo | null>(null);
  const [chamadas, setChamadas] = useState<ChamadaEntregador[]>([]);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const chamada = chamadas.find((c) => c.id === escolhida) ?? chamadas[0] ?? null;
  const [guia, setGuia] = useState(false);
  const [termo, setTermo] = useState(false);
  // Telas abertas por cima das guias: turnos, metas e suporte.
  const [turnos, setTurnos] = useState<'turnos' | 'metas' | 'suporte' | null>(null);
  // Permissões, bateria, versão nova e diárias: tudo na guia Avisos, com o número de pendências na guia.
  const [situacao, conferirSituacao] = useSituacaoDoCelular();
  /** Troca a chamada que mudou na lista; terminada ou cancelada sai dela. */
  const atualizarChamada = useCallback((id: string, c: ChamadaEntregador | null) => {
    setChamadas((l) => {
      const resto = l.filter((x) => x.id !== id);
      return c && c.situacao !== 'CONCLUIDA' && c.situacao !== 'CANCELADA' ? l.map((x) => (x.id === id ? c : x)).concat(l.some((x) => x.id === id) ? [] : [c]) : resto;
    });
  }, []);
  const trabalhando = !!perfil && perfil.situacao === 'APROVADO' && (perfil.online || !!chamada);
  const [recusas, setRecusas] = useState<string[]>([]);
  const buscarTrabalho = useCallback(async () => {
    try {
      // Etapas feitas sem internet vão primeiro: a chamada que vem depois já reflete o que aconteceu.
      const fila = await enviarGuardadas(api);
      if (fila.recusas.length) setRecusas((r) => [...r, ...fila.recusas]);
      if ((await etapasGuardadas()).length) return;
      const [o, c] = await Promise.all([api<OfertaResumo | null>('/entregador/oferta'), api<ChamadaEntregador[]>('/entregador/chamadas')]);
      setOferta(o);
      setChamadas(c);
    } catch {
      // Sem internet agora: tenta de novo no próximo ciclo.
    }
  }, [api]);
  useEffect(() => {
    if (!trabalhando) return;
    void buscarTrabalho();
    const t = setInterval(() => void buscarTrabalho(), INTERVALO_TRABALHO_MS);
    return () => clearInterval(t);
  }, [trabalhando, buscarTrabalho]);
  useEffect(() => aoReceberResposta((r) => { if (!('erro' in r) && r.oferta) setOferta(r.oferta); }), []);

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

  const avisoFila = recusas.length ? (
    <Pressable accessibilityRole="button" onPress={() => setRecusas([])} style={{ padding: 12 }}>
      <Alerta>{recusas.join('\n')} (toque para fechar)</Alerta>
    </Pressable>
  ) : null;

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

  const ofertaValida = oferta && new Date(oferta.expiraEm).getTime() > Date.now() ? oferta : null;
  const baixarVersao = () => void Linking.openURL(`${sessao.servidor}/downloads/flow-entregas.apk`);
  const pendentes = pendencias(situacao, perfil, versaoNova).length;
  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'inicio', rotulo: chamadas.length > 1 ? `Chamadas (${chamadas.length})` : chamada ? 'Chamada' : 'Início' },
    { id: 'ganhos', rotulo: 'Extrato' },
    { id: 'creditos', rotulo: 'Créditos' },
    { id: 'avisos', rotulo: pendentes ? `Avisos (${pendentes})` : 'Avisos' },
    { id: 'perfil', rotulo: 'Perfil' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo }}>
      {avisoFila}
      {erro && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Alerta>{erro}</Alerta>
        </View>
      )}
      <View style={{ flex: 1 }}>
        {termo && (
          <TermoCustodia
            api={api}
            aoFechar={() => setTermo(false)}
            aoAceitar={() => {
              setTermo(false);
              void recarregar();
            }}
          />
        )}
        {!termo && guia ? (
          <GuiaBateria
            aoFechar={() => {
              marcarGuiaVisto();
              setGuia(false);
              conferirSituacao();
            }}
          />
        ) : null}
        {!guia && !termo && !turnos && aba === 'inicio' &&
          (chamada ? (
            <View style={{ flex: 1 }}>
              {ofertaValida && (
                <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                  <CartaoOferta key={ofertaValida.id} api={api} oferta={ofertaValida} aoResponder={(c) => { setOferta(null); if (c) { atualizarChamada(c.id, c); setEscolhida(c.id); } }} />
                </View>
              )}
              {chamadas.length > 1 && (
                <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 }} accessibilityRole="tablist">
                  {chamadas.map((c) => (
                    <Pressable key={c.id} accessibilityRole="tab" accessibilityState={{ selected: c.id === chamada.id }} onPress={() => setEscolhida(c.id)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: cores.borda, backgroundColor: c.id === chamada.id ? cores.azul : cores.branco }}>
                      <Text style={{ color: c.id === chamada.id ? cores.branco : cores.texto, fontWeight: '600' }}>Chamada {c.numero}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                <PegarNoBalcao api={api} aoPegar={(c) => { atualizarChamada(c.id, c); setEscolhida(c.id); }} />
              </View>
              <TelaChamada key={chamada.id} api={api} chamada={chamada} aoMudar={(c) => atualizarChamada(chamada.id, c)} />
            </View>
          ) : (
            <TelaInicio
              api={api}
              perfil={perfil}
              aoMudar={setPerfil}
              irParaCreditos={() => setAba('creditos')}
              irParaAvisos={() => setAba('avisos')}
              abrirTurnos={() => setTurnos('turnos')}
              abrirMetas={() => setTurnos('metas')}
              aoPegar={(c) => { atualizarChamada(c.id, c); setEscolhida(c.id); }}
              oferta={ofertaValida ? <CartaoOferta key={ofertaValida.id} api={api} oferta={ofertaValida} aoResponder={(c) => { setOferta(null); if (c) atualizarChamada(c.id, c); }} /> : null}
            />
          ))}
        {turnos === 'turnos' && <TelaTurnos api={api} aoFechar={() => setTurnos(null)} />}
        {turnos === 'metas' && <TelaMetas api={api} aoFechar={() => setTurnos(null)} />}
        {turnos === 'suporte' && <TelaSuporte api={api} aoFechar={() => setTurnos(null)} aoLer={() => void recarregar()} />}
        {!guia && !termo && !turnos && aba === 'ganhos' && <TelaGanhos api={api} servidor={sessao.servidor} aoMudarAvarias={() => void recarregar()} />}
        {!guia && !termo && !turnos && aba === 'creditos' && <TelaCreditos api={api} aoMudarSaldo={mudarSaldo} />}
        {!guia && !termo && !turnos && aba === 'avisos' && <TelaAvisos situacao={situacao} conferir={conferirSituacao} perfil={perfil} versaoNova={versaoNova} baixarVersao={baixarVersao} abrirGuia={() => setGuia(true)} irParaCreditos={() => setAba('creditos')} abrirTermo={() => setTermo(true)} irParaExtrato={() => setAba('ganhos')} abrirSuporte={() => setTurnos('suporte')} />}
        {!guia && !termo && !turnos && aba === 'perfil' && <TelaPerfil api={api} perfil={perfil} aoMudar={setPerfil} sair={() => void sair()} versao={versaoDoApp()} />}
      </View>
      <View style={estilos.guias} accessibilityRole="tablist">
        {abas.map((a) => (
          <Pressable key={a.id} accessibilityRole="tab" accessibilityState={{ selected: aba === a.id }} accessibilityLabel={a.rotulo} onPress={() => setAba(a.id)} style={estilos.guia}>
            <RotuloGuia texto={a.rotulo} ativa={aba === a.id} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guias: { flexDirection: 'row', backgroundColor: cores.grafite, paddingHorizontal: 4, paddingVertical: 6 },
  guia: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  versao: { backgroundColor: cores.azul, padding: 12 },
});
