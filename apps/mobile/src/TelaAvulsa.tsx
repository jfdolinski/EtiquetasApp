import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import type { BuscaAvulsaResposta, ImprimirResposta, ModeloAvulso } from '../../../packages/shared/src/impressao';
import type { Api } from './api';
import { TitulosColunas, ValoresColunas } from './colunas';
import { LeitorCodigo } from './LeitorCodigo';
import { adicionarProduto, colunasVisiveis, parametrosDaBusca, quantidadeValida, registrosDoCodigo, type LinhaAvulsa, type Registro } from './regras';
import { Alerta, Botao, cores } from './ui';

function confirmar(titulo: string, mensagem: string, acao: string, aoConfirmar: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${titulo}\n${mensagem}`)) aoConfirmar();
    return;
  }
  Alert.alert(titulo, mensagem, [{ text: 'Cancelar', style: 'cancel' }, { text: acao, onPress: aoConfirmar }]);
}

/** Monta uma lista lendo ou digitando o código e manda imprimir na impressora padrão do modelo. */
export function TelaAvulsa({ api }: { api: Api }) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [modelos, setModelos] = useState<ModeloAvulso[] | null>(null);
  const [modeloId, setModeloId] = useState<string | null>(null);
  // Uma lista por modelo: trocar de modelo e voltar não perde o que foi lido.
  const [listas, setListas] = useState<Record<string, LinhaAvulsa[]>>({});
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState('');
  const [escolha, setEscolha] = useState<Registro[] | null>(null);
  const [camera, setCamera] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const carregarModelos = useCallback(async () => {
    try {
      setModelos(await api<ModeloAvulso[]>('/avulsa/modelos'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api]);
  useEffect(() => void carregarModelos(), [carregarModelos]);

  const modelo = modelos?.find((m) => m.id === modeloId) ?? modelos?.[0] ?? null;
  const linhas = useMemo(() => (modelo ? (listas[modelo.id] ?? []) : []), [listas, modelo]);
  const colunas = useMemo(() => colunasVisiveis(modelo?.campos ?? [], linhas.map((l) => l.registro)), [modelo, linhas]);
  const semImpressora = modelo && !modelo.impressoraId ? 'Este modelo não tem impressora padrão. Defina no sistema, em Modelos de etiqueta.' : modelo?.impressoraLinguagem === 'PDF' ? 'Este modelo sai em PDF: imprima pelo computador.' : null;

  function guardar(novas: LinhaAvulsa[]) {
    if (modelo) setListas((l) => ({ ...l, [modelo.id]: novas }));
  }

  function incluir(registro: Registro) {
    // O que foi digitado vale como base: ler o mesmo produto soma em cima disso.
    const atuais = linhas.map((l) => ({ ...l, quantidade: quantidadeValida(quantidades[l.id] ?? '') ?? l.quantidade }));
    const { linhas: novas, repetida } = adicionarProduto(atuais, registro, () => `${Date.now()}-${Math.random()}`);
    guardar(novas);
    setQuantidades((q) => Object.fromEntries(Object.entries(q).filter(([id]) => !linhas.some((l) => l.id === id))));
    setEscolha(null);
    setBusca('');
    setAviso(repetida ? `Produto já estava na lista: agora com ${repetida.quantidade + 1} etiqueta(s).` : 'Produto adicionado à lista.');
  }

  async function buscar(valor: string) {
    const termo = valor.trim();
    if (!modelo || !termo) return;
    setBuscando(true);
    setErro(null);
    setAviso(null);
    setEscolha(null);
    try {
      const r = await api<BuscaAvulsaResposta>('/avulsa/buscar', { metodo: 'POST', corpo: { modeloId: modelo.id, parametros: parametrosDaBusca(modelo.parametros, termo) } });
      const achados = registrosDoCodigo(r.registros, termo);
      if (achados.length === 0) setAviso(r.banidos ? `O produto “${termo}” está banido: a etiqueta dele não é impressa.` : `Nenhum produto com “${termo}”.`);
      else if (achados.length === 1) incluir(achados[0]);
      else setEscolha(achados.slice(0, 50));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBuscando(false);
    }
  }

  async function abrirCamera() {
    setErro(null);
    const p = permissao?.granted ? permissao : await pedirPermissao();
    if (p.granted) setCamera(true);
    else setErro('Sem permissão para usar a câmera. Libere nas configurações do Android ou digite o código.');
  }

  function imprimir() {
    if (!modelo) return;
    const itens: { registro: Registro; quantidade: number }[] = [];
    for (const l of linhas) {
      const q = quantidadeValida(quantidades[l.id] ?? String(l.quantidade));
      if (q === null) return setErro('Confira as quantidades da lista: use números a partir de 1.');
      itens.push({ registro: l.registro, quantidade: q });
    }
    const total = itens.reduce((s, i) => s + i.quantidade, 0);
    confirmar('Imprimir?', `${itens.length} produto(s), ${total} etiqueta(s). Vão agora para a impressora do modelo ${modelo.nome}.`, 'Imprimir', () => {
      void (async () => {
        setEnviando(true);
        setAviso(null);
        try {
          const r = await api<ImprimirResposta>('/app/avulsa/imprimir', { metodo: 'POST', corpo: { modeloId: modelo.id, itens } });
          const enviadas = r.trabalhos.reduce((s, t) => s + t.quantidadeEtiquetas, 0);
          setAviso([enviadas ? `${enviadas} etiqueta(s) enviada(s) para a fila.` : 'Nada foi enviado.', ...r.avisos].join(' '));
          setErro(null);
          if (enviadas) guardar([]);
        } catch (e) {
          setErro((e as Error).message);
        } finally {
          setEnviando(false);
        }
      })();
    });
  }

  if (camera) {
    return (
      <LeitorCodigo
        aoCancelar={() => setCamera(false)}
        aoLer={(codigo) => {
          setCamera(false);
          setBusca(codigo);
          void buscar(codigo);
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo }}>
      <FlatList
        data={linhas}
        keyExtractor={(l) => l.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={estilos.pagina}
        ListHeaderComponent={
          <>
            <Text accessibilityRole="header" style={estilos.titulo}>Etiqueta avulsa</Text>
            {erro ? <Alerta>{erro}</Alerta> : null}
            {aviso ? <Alerta tipo="ok">{aviso}</Alerta> : null}
            {modelos && modelos.length === 0 ? <Alerta tipo="aviso">Nenhum modelo pronto para etiqueta avulsa. Crie no sistema uma consulta de busca de produto e vincule a um modelo.</Alerta> : null}
            {modelos && modelos.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} keyboardShouldPersistTaps="handled">
                {modelos.map((m) => (
                  <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: m.id === modelo?.id }} onPress={() => { setModeloId(m.id); setEscolha(null); setAviso(null); }} style={[estilos.modelo, m.id === modelo?.id && estilos.modeloAtivo]}>
                    <Text style={[estilos.modeloTexto, m.id === modelo?.id && { color: cores.azul, fontWeight: '700' }]}>{m.nome}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {modelo && (
              <>
                {modelos?.length === 1 ? <Text style={estilos.sub}>{modelo.nome}</Text> : null}
                {semImpressora ? <Alerta tipo="aviso">{semImpressora}</Alerta> : null}
                {modelo.parametros.length === 0 ? (
                  <Alerta tipo="aviso">A consulta deste modelo não recebe código para buscar.</Alerta>
                ) : (
                  <>
                    <Text style={estilos.rotulo}>Código de barras, código ou nome</Text>
                    <View style={estilos.busca}>
                      <TextInput
                        accessibilityLabel="Código de barras, código ou nome"
                        style={estilos.campo}
                        value={busca}
                        onChangeText={setBusca}
                        onSubmitEditing={() => void buscar(busca)}
                        returnKeyType="search"
                        autoCorrect={false}
                      />
                      <Botao titulo="Buscar" variante="secundario" ocupado={buscando} disabled={!busca.trim()} onPress={() => void buscar(busca)} />
                    </View>
                    {Platform.OS !== 'web' && <Botao titulo="Ler código com a câmera" disabled={buscando} onPress={() => void abrirCamera()} />}
                  </>
                )}
              </>
            )}
            {escolha && (
              <View style={estilos.escolha}>
                <Text style={estilos.rotulo}>Vários produtos encontrados. Toque no certo:</Text>
                {escolha.map((r, i) => (
                  <Pressable key={i} accessibilityRole="button" onPress={() => incluir(r)} style={estilos.item}>
                    <ValoresColunas colunas={colunasVisiveis(modelo?.campos ?? [], escolha)} registro={r} />
                  </Pressable>
                ))}
                <Botao titulo="Cancelar" variante="secundario" onPress={() => setEscolha(null)} />
              </View>
            )}
            {linhas.length > 0 && (
              <View style={estilos.cabecalho}>
                <TitulosColunas colunas={colunas} />
                <Text style={estilos.tituloQtd}>Qtd.</Text>
                <View style={{ width: 32 }} />
              </View>
            )}
          </>
        }
        renderItem={({ item: l }) => (
          <View style={estilos.item}>
            <ValoresColunas colunas={colunas} registro={l.registro} />
            <TextInput
              accessibilityLabel={`Quantidade de ${String(Object.values(l.registro)[0] ?? 'produto')}`}
              style={estilos.quantidade}
              keyboardType="number-pad"
              maxLength={5}
              selectTextOnFocus
              value={quantidades[l.id] ?? String(l.quantidade)}
              onChangeText={(t) => setQuantidades((q) => ({ ...q, [l.id]: t }))}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Tirar da lista" hitSlop={8} onPress={() => guardar(linhas.filter((x) => x.id !== l.id))} style={estilos.tirar}>
              <Text style={{ color: cores.erro, fontSize: 18, fontWeight: '700' }}>×</Text>
            </Pressable>
          </View>
        )}
      />
      {linhas.length > 0 && (
        <View style={estilos.rodape}>
          <Botao titulo={`Imprimir ${linhas.length} produto(s)`} ocupado={enviando} disabled={Boolean(semImpressora)} onPress={imprimir} />
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 24 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto, marginBottom: 8 },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 12 },
  rotulo: { fontSize: 14, fontWeight: '600', color: cores.texto, marginBottom: 6 },
  busca: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  campo: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, paddingHorizontal: 12, fontSize: 16, color: cores.texto },
  modelo: { borderWidth: 1, borderColor: cores.borda, borderRadius: 20, backgroundColor: cores.branco, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', marginRight: 8 },
  modeloAtivo: { borderColor: cores.azul, backgroundColor: cores.azulClaro },
  modeloTexto: { fontSize: 14, color: cores.texto },
  escolha: { marginTop: 12 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 6, paddingHorizontal: 10 },
  tituloQtd: { width: 56, textAlign: 'center', fontSize: 11, fontWeight: '700', color: cores.suave, textTransform: 'uppercase' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10, marginBottom: 8 },
  quantidade: { width: 56, height: 44, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, textAlign: 'center', fontSize: 16, color: cores.texto },
  tirar: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  rodape: { padding: 12, backgroundColor: cores.branco, borderTopWidth: 1, borderTopColor: cores.borda },
});
