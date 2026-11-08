import { useCallback, useEffect, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import type { PedidoTelaLido, PerfilTelaResumo, SituacaoTela, TelaResumo } from '../../../packages/shared/src/telas';
import type { Api } from './api';
import { LeitorCodigo } from './LeitorCodigo';
import { codigoDaTela, codigoDaTelaParaLer, tempoDesde } from './regras';
import { Alerta, Botao, cores } from './ui';

const NOME_SITUACAO: Record<SituacaoTela, string> = { ONLINE: 'Online', INSTAVEL: 'Instável', OFFLINE: 'Offline', FORA_DO_HORARIO: 'Fora do horário', AGUARDANDO_VINCULO: 'Sem equipamento' };
const COR_SITUACAO: Record<SituacaoTela, string> = { ONLINE: cores.ok, INSTAVEL: cores.aviso, OFFLINE: cores.erro, FORA_DO_HORARIO: cores.suave, AGUARDANDO_VINCULO: cores.suave };
const INTERVALO_MS = 30_000;
const NOVO = 'novo';

/** Lista os equipamentos e vincula um novo: ler o QR da TV e dizer qual tela ela é. */
export function TelaTelas({ api, usuario }: { api: Api; usuario: UsuarioLogado }) {
  const podeEditar = usuario.superAdmin || usuario.permissoes.includes('tela.editar');
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [telas, setTelas] = useState<TelaResumo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [codigo, setCodigo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setTelas(await api<TelaResumo[]>('/telas'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [carregar]);

  function usarCodigo(texto: string) {
    const c = codigoDaTela(texto);
    if (!c) return setErro('Este não é o código de uma tela. Abra o link /tv no equipamento e leia o QR que aparece nele.');
    setErro(null);
    setAviso(null);
    setDigitado('');
    setCodigo(c);
  }

  async function abrirCamera() {
    setErro(null);
    const p = permissao?.granted ? permissao : await pedirPermissao();
    if (p.granted) setCamera(true);
    else setErro('Sem permissão para usar a câmera. Libere nas configurações do Android ou digite o código.');
  }

  async function identificar(t: TelaResumo) {
    try {
      await api(`/telas/${t.id}/comando`, { metodo: 'POST', corpo: { comando: 'IDENTIFICAR' } });
      setAviso(`Em até 30 segundos, “${t.nome}” mostra o nome em letras grandes.`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (camera) {
    return (
      <LeitorCodigo
        texto="Aponte para o QR que aparece na tela."
        aoCancelar={() => setCamera(false)}
        aoLer={(lido) => {
          setCamera(false);
          usarCodigo(lido);
        }}
      />
    );
  }

  if (codigo) {
    return (
      <FormularioVinculo
        api={api}
        codigo={codigo}
        telas={telas}
        aoCancelar={() => setCodigo(null)}
        aoVincular={(nome) => {
          setCodigo(null);
          setAviso(`“${nome}” vinculada. Em alguns segundos, o QR some da tela.`);
          void carregar();
        }}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: cores.fundo }}
      contentContainerStyle={estilos.pagina}
      data={telas}
      keyExtractor={(t) => t.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}
      ListHeaderComponent={
        <>
          <Text accessibilityRole="header" style={estilos.titulo}>Telas</Text>
          <Text style={estilos.sub}>{telas.filter((t) => t.situacao === 'ONLINE').length} de {telas.length} online</Text>
          {erro ? <Alerta>{erro}</Alerta> : null}
          {aviso ? <Alerta tipo="ok">{aviso}</Alerta> : null}
          {podeEditar ? (
            <View style={estilos.cartao}>
              <Text style={estilos.nome}>Vincular tela</Text>
              <Text style={estilos.detalhe}>Abra o link /tv no equipamento e leia o QR que aparece nele.</Text>
              {Platform.OS !== 'web' ? <Botao titulo="Ler o QR da tela" onPress={() => void abrirCamera()} /> : null}
              <Text style={[estilos.detalhe, { marginTop: 8 }]}>Ou digite o código:</Text>
              <View style={estilos.linha}>
                <TextInput accessibilityLabel="Código da tela" style={estilos.campoLinha} value={digitado} onChangeText={setDigitado} autoCapitalize="characters" autoCorrect={false} placeholder="K7M2-9QXT" />
                <Botao titulo="Continuar" variante="secundario" disabled={!digitado.trim()} onPress={() => usarCodigo(digitado)} />
              </View>
            </View>
          ) : null}
        </>
      }
      ListEmptyComponent={!carregando ? <Text style={estilos.vazio}>Nenhuma tela vinculada.</Text> : undefined}
      renderItem={({ item: t }) => (
        <View style={estilos.cartao}>
          <View style={estilos.cabeca}>
            <Text style={estilos.nome} numberOfLines={1}>{t.nome}</Text>
            <Text style={[estilos.situacao, { color: COR_SITUACAO[t.situacao] }]}>{NOME_SITUACAO[t.situacao]}</Text>
          </View>
          {t.local ? <Text style={estilos.detalhe}>{t.local}</Text> : null}
          <Text style={estilos.detalhe}>{t.perfil.nome} ({t.perfil.largura}×{t.perfil.altura}) · último contato {tempoDesde(t.ultimoContatoEm)}</Text>
          {!t.resolucaoConfere ? <Text style={[estilos.detalhe, { color: cores.aviso }]}>Formato diferente do perfil: informa {t.larguraDetectada}×{t.alturaDetectada}</Text> : null}
          {podeEditar && t.situacao !== 'AGUARDANDO_VINCULO' ? <Text accessibilityRole="button" style={estilos.link} onPress={() => void identificar(t)}>Identificar na tela</Text> : null}
        </View>
      )}
    />
  );
}

function FormularioVinculo({ api, codigo, telas, aoCancelar, aoVincular }: { api: Api; codigo: string; telas: TelaResumo[]; aoCancelar: () => void; aoVincular: (nome: string) => void }) {
  const [pedido, setPedido] = useState<PedidoTelaLido | null>(null);
  const [perfis, setPerfis] = useState<PerfilTelaResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [substituir, setSubstituir] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [local, setLocal] = useState('');
  const [perfilId, setPerfilId] = useState(NOVO);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void Promise.all([api<PedidoTelaLido>(`/telas/pedidos/${codigo}`), api<PerfilTelaResumo[]>('/telas/perfis')])
      .then(([p, l]) => {
        setPedido(p);
        setPerfis(l);
        setPerfilId(p.perfilSugeridoId ?? NOVO);
      })
      .catch((e: Error) => setErro(e.message));
  }, [api, codigo]);

  async function confirmar() {
    if (!pedido) return;
    setEnviando(true);
    setErro(null);
    const substituida = telas.find((t) => t.id === substituir);
    try {
      await api('/telas/vincular', {
        metodo: 'POST',
        corpo: substituida
          ? { codigo, telaId: substituida.id }
          : { codigo, nome, local, ...(perfilId === NOVO ? { novoPerfil: { nome: `Tela ${pedido.largura}×${pedido.altura}`, tipo: 'TV', largura: pedido.largura, altura: pedido.altura } } : { perfilId }) },
      });
      aoVincular(substituida?.nome ?? nome.trim());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: cores.fundo }} contentContainerStyle={estilos.pagina} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={estilos.titulo}>Qual é esta tela?</Text>
      {erro ? <Alerta>{erro}</Alerta> : null}
      {pedido ? (
        <>
          <Alerta tipo="aviso">Tela {codigoDaTelaParaLer(codigo)}, informa {pedido.largura}×{pedido.altura}. Confira se é o mesmo código que está nela.</Alerta>

          <Text style={estilos.rotulo}>Este equipamento é</Text>
          <Opcao rotulo="Uma tela nova" ativa={substituir === null} aoTocar={() => setSubstituir(null)} />
          {telas.map((t) => <Opcao key={t.id} rotulo={`Substituir “${t.nome}”`} ativa={substituir === t.id} aoTocar={() => setSubstituir(t.id)} />)}

          {substituir ? (
            <Text style={estilos.detalhe}>O equipamento novo herda a configuração, e o antigo perde o acesso e volta a mostrar o QR.</Text>
          ) : (
            <>
              <Text style={estilos.rotulo}>Nome da tela</Text>
              <TextInput accessibilityLabel="Nome da tela" style={estilos.campo} value={nome} onChangeText={setNome} placeholder="TV do açougue" maxLength={80} />
              <Text style={estilos.rotulo}>Local</Text>
              <TextInput accessibilityLabel="Local" style={estilos.campo} value={local} onChangeText={setLocal} placeholder="Loja centro, entrada" maxLength={120} />
              <Text style={estilos.rotulo}>Perfil de resolução</Text>
              {perfis.map((p) => <Opcao key={p.id} rotulo={`${p.nome} (${p.largura}×${p.altura})`} ativa={perfilId === p.id} aoTocar={() => setPerfilId(p.id)} />)}
              <Opcao rotulo={`Novo perfil: ${pedido.largura}×${pedido.altura}`} ativa={perfilId === NOVO} aoTocar={() => setPerfilId(NOVO)} />
            </>
          )}
          <View style={{ height: 12 }} />
          <Botao titulo={substituir ? 'Substituir equipamento' : 'Vincular tela'} ocupado={enviando} disabled={!substituir && nome.trim().length < 2} onPress={() => void confirmar()} />
        </>
      ) : null}
      <View style={{ height: 8 }} />
      <Botao titulo="Cancelar" variante="secundario" onPress={aoCancelar} />
    </ScrollView>
  );
}

function Opcao({ rotulo, ativa, aoTocar }: { rotulo: string; ativa: boolean; aoTocar: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: ativa }} onPress={aoTocar} style={[estilos.opcao, ativa && estilos.opcaoAtiva]}>
      <Text style={[{ fontSize: 14, color: cores.texto }, ativa && { color: cores.azul, fontWeight: '700' }]}>{rotulo}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 32 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 12 },
  vazio: { textAlign: 'center', color: cores.suave, fontSize: 16, marginTop: 24 },
  cartao: { backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 12, marginBottom: 8 },
  cabeca: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  nome: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: cores.texto, marginBottom: 2 },
  situacao: { fontSize: 13, fontWeight: '700' },
  detalhe: { fontSize: 13, color: cores.suave, marginBottom: 6 },
  link: { color: cores.azul, fontSize: 14, fontWeight: '600', paddingVertical: 6 },
  linha: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  campoLinha: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, color: cores.texto, backgroundColor: cores.branco },
  campo: { minHeight: 48, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, color: cores.texto, backgroundColor: cores.branco, marginBottom: 8 },
  rotulo: { fontSize: 14, fontWeight: '600', color: cores.texto, marginTop: 8, marginBottom: 6 },
  opcao: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, marginBottom: 6 },
  opcaoAtiva: { borderColor: cores.azul, backgroundColor: cores.azulClaro },
});
