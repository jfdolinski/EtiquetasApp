import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import type { BuscaAvulsaResposta, ImprimirResposta, ModeloAvulso } from '../../../packages/shared/src/impressao';
import { abrirPdfDoTrabalho, type Api, type Sessao } from './api';
import { CamposDoProduto } from './colunas';
import { LeitorCodigo } from './LeitorCodigo';
import { adicionarProduto, colunasVisiveis, corpoDaBusca, impressoraDoModelo, quantidadeValida, registrosDoCodigo, type ImpressoraApp, type LinhaAvulsa, type Registro } from './regras';
import { Alerta, Botao, cores } from './ui';

function confirmar(titulo: string, mensagem: string, acao: string, aoConfirmar: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${titulo}\n${mensagem}`)) aoConfirmar();
    return;
  }
  Alert.alert(titulo, mensagem, [{ text: 'Cancelar', style: 'cancel' }, { text: acao, onPress: aoConfirmar }]);
}

/** O que precisa sobreviver à troca de guia. Fica em quem contém as guias. */
export interface MemoriaAvulsa {
  modeloId: string | null;
  /** Uma lista por modelo: trocar de modelo e voltar não perde o que foi lido. */
  listas: Record<string, LinhaAvulsa[]>;
  quantidades: Record<string, string>;
  /** Impressora escolhida à mão, por modelo. */
  impressoras: Record<string, string>;
}

export const MEMORIA_AVULSA_VAZIA: MemoriaAvulsa = { modeloId: null, listas: {}, quantidades: {}, impressoras: {} };

/** Monta uma lista lendo ou digitando o código e manda imprimir. */
export function TelaAvulsa({ api, sessao, memoria, setMemoria }: { api: Api; sessao: Sessao; memoria: MemoriaAvulsa; setMemoria: Dispatch<SetStateAction<MemoriaAvulsa>> }) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [modelos, setModelos] = useState<ModeloAvulso[] | null>(null);
  const [impressoras, setImpressoras] = useState<ImpressoraApp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [escolha, setEscolha] = useState<Registro[] | null>(null);
  const [camera, setCamera] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [m, i] = await Promise.all([api<ModeloAvulso[]>('/avulsa/modelos'), api<ImpressoraApp[]>('/app/impressoras')]);
      setModelos(m);
      setImpressoras(i);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api]);
  useEffect(() => void carregar(), [carregar]);

  const modelo = modelos?.find((m) => m.id === memoria.modeloId) ?? modelos?.[0] ?? null;
  const linhas = useMemo(() => (modelo ? (memoria.listas[modelo.id] ?? []) : []), [memoria.listas, modelo]);
  const colunas = useMemo(() => colunasVisiveis(modelo?.campos ?? [], linhas.map((l) => l.registro)), [modelo, linhas]);
  const impressoraId = modelo ? impressoraDoModelo(memoria.impressoras[modelo.id] ?? null, modelo.impressoraId, impressoras) : null;

  function guardar(novas: LinhaAvulsa[], quantidades?: Record<string, string>) {
    if (modelo) setMemoria((m) => ({ ...m, listas: { ...m.listas, [modelo.id]: novas }, quantidades: quantidades ?? m.quantidades }));
  }

  function incluir(registro: Registro) {
    // O que foi digitado vale como base: ler o mesmo produto soma em cima disso.
    const atuais = linhas.map((l) => ({ ...l, quantidade: quantidadeValida(memoria.quantidades[l.id] ?? '') ?? l.quantidade }));
    const { linhas: novas, repetida } = adicionarProduto(atuais, registro, () => `${Date.now()}-${Math.random()}`);
    guardar(novas, Object.fromEntries(Object.entries(memoria.quantidades).filter(([id]) => !linhas.some((l) => l.id === id))));
    setEscolha(null);
    setBusca('');
    setAviso(repetida ? `Produto já estava na lista: agora com ${repetida.quantidade + 1} etiqueta(s).` : 'Produto adicionado à lista.');
  }

  async function buscar(valor: string) {
    const termo = valor.trim();
    if (!modelo || !termo) return;
    // Aberto, o teclado cobre a lista e o botão de imprimir.
    Keyboard.dismiss();
    setBuscando(true);
    setErro(null);
    setAviso(null);
    setEscolha(null);
    try {
      const r = await api<BuscaAvulsaResposta>('/avulsa/buscar', { metodo: 'POST', corpo: corpoDaBusca(modelo.id, modelo.parametros, termo) });
      const achados = registrosDoCodigo(r.registros, termo);
      const incompleta = r.incompleta ? ' A consulta tem muitas linhas e só as primeiras 5.000 foram procuradas: no sistema, use {param.busca} no SQL dela.' : '';
      if (achados.length === 0) setAviso(r.banidos ? `O produto “${termo}” está banido: a etiqueta dele não é impressa.` : `Nenhum produto com “${termo}”.${incompleta}`);
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
    if (!modelo || !impressoraId) return;
    const itens: { registro: Registro; quantidade: number }[] = [];
    for (const l of linhas) {
      const q = quantidadeValida(memoria.quantidades[l.id] ?? String(l.quantidade));
      if (q === null) return setErro('Confira as quantidades da lista: use números a partir de 1.');
      itens.push({ registro: l.registro, quantidade: q });
    }
    const total = itens.reduce((s, i) => s + i.quantidade, 0);
    const impressora = impressoras.find((i) => i.id === impressoraId);
    const emPdf = impressora?.linguagem === 'PDF';
    confirmar(emPdf ? 'Gerar PDF?' : 'Imprimir?', `${itens.length} produto(s), ${total} etiqueta(s), ${emPdf ? 'em PDF. O arquivo abre aqui no celular.' : `na impressora ${impressora?.nome ?? ''}.`}`, emPdf ? 'Gerar' : 'Imprimir', () => {
      void (async () => {
        setEnviando(true);
        setAviso(null);
        try {
          const r = await api<ImprimirResposta>('/app/avulsa/imprimir', { metodo: 'POST', corpo: { modeloId: modelo.id, impressoraId, itens } });
          const enviadas = r.trabalhos.reduce((s, t) => s + t.quantidadeEtiquetas, 0);
          setAviso([enviadas ? (emPdf ? `PDF com ${enviadas} etiqueta(s) gerado.` : `${enviadas} etiqueta(s) enviada(s) para a fila.`) : 'Nada foi enviado.', ...r.avisos].join(' '));
          setErro(null);
          if (enviadas) guardar([]);
          // Lote grande vira mais de um arquivo; abre um de cada vez.
          if (emPdf) for (const t of r.trabalhos) await abrirPdfDoTrabalho(sessao, t.id);
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

            {carregando && !modelos ? <ActivityIndicator accessibilityLabel="Carregando" size="large" color={cores.azul} style={{ marginVertical: 24 }} /> : null}
            {!carregando && !modelos ? <Botao titulo="Tentar de novo" variante="secundario" onPress={() => void carregar()} /> : null}
            {modelos && modelos.length === 0 ? (
              <>
                <Alerta tipo="aviso">Nenhum modelo pronto para etiqueta avulsa. No sistema, o modelo precisa estar ativo e ligado a uma consulta com a finalidade “Busca de produto” ou a uma planilha.</Alerta>
                <Botao titulo="Conferir de novo" variante="secundario" ocupado={carregando} onPress={() => void carregar()} />
              </>
            ) : null}

            {modelos && modelos.length > 1 ? (
              <>
                <Text style={estilos.rotulo}>Modelo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} keyboardShouldPersistTaps="handled">
                  {modelos.map((m) => (
                    <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: m.id === modelo?.id }} onPress={() => { setMemoria((a) => ({ ...a, modeloId: m.id })); setEscolha(null); setAviso(null); }} style={[estilos.opcao, m.id === modelo?.id && estilos.opcaoAtiva]}>
                      <Text style={[estilos.opcaoTexto, m.id === modelo?.id && { color: cores.azul, fontWeight: '700' }]}>{m.nome}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {modelo ? (
              <>
                {modelos?.length === 1 ? <Text style={estilos.sub}>{modelo.nome}</Text> : null}
                {impressoras.length === 0 ? (
                  <Alerta tipo="aviso">Nenhuma impressora disponível. Cadastre no sistema uma impressora ativa.</Alerta>
                ) : (
                  <>
                    <Text style={estilos.rotulo}>Impressora</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} keyboardShouldPersistTaps="handled">
                      {impressoras.map((i) => (
                        <Pressable key={i.id} accessibilityRole="button" accessibilityState={{ selected: i.id === impressoraId }} onPress={() => setMemoria((a) => ({ ...a, impressoras: { ...a.impressoras, [modelo.id]: i.id } }))} style={[estilos.opcao, i.id === impressoraId && estilos.opcaoAtiva]}>
                          <Text style={[estilos.opcaoTexto, i.id === impressoraId && { color: cores.azul, fontWeight: '700' }]}>{i.nome}{i.linguagem === 'PDF' ? ' (PDF)' : ''}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </>
                )}
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
                    {Platform.OS !== 'web' ? <Botao titulo="Ler código com a câmera" disabled={buscando} onPress={() => void abrirCamera()} /> : null}
                </>
              </>
            ) : null}

            {escolha ? (
              <View style={{ marginTop: 12 }}>
                <Text style={estilos.rotulo}>Vários produtos encontrados. Toque no certo:</Text>
                {escolha.map((r, i) => (
                  <Pressable key={i} accessibilityRole="button" onPress={() => incluir(r)} style={estilos.item}>
                    <CamposDoProduto colunas={colunasVisiveis(modelo?.campos ?? [], escolha)} registro={r} />
                  </Pressable>
                ))}
                <Botao titulo="Cancelar" variante="secundario" onPress={() => setEscolha(null)} />
              </View>
            ) : null}
            {linhas.length > 0 ? <Text style={[estilos.rotulo, { marginTop: 16 }]}>Lista ({linhas.length})</Text> : null}
          </>
        }
        renderItem={({ item: l }) => (
          <View style={estilos.item}>
            <CamposDoProduto colunas={colunas} registro={l.registro} />
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={estilos.tituloQtd}>Qtd.</Text>
              <TextInput
                accessibilityLabel={`Quantidade de ${String(Object.values(l.registro)[0] ?? 'produto')}`}
                style={estilos.quantidade}
                keyboardType="number-pad"
                maxLength={5}
                selectTextOnFocus
                value={memoria.quantidades[l.id] ?? String(l.quantidade)}
                onChangeText={(t) => setMemoria((m) => ({ ...m, quantidades: { ...m.quantidades, [l.id]: t } }))}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Tirar da lista" hitSlop={8} onPress={() => guardar(linhas.filter((x) => x.id !== l.id))} style={estilos.tirar}>
                <Text style={{ color: cores.erro, fontSize: 13, fontWeight: '600' }}>Tirar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
      {linhas.length > 0 ? (
        <View style={estilos.rodape}>
          <Botao titulo={`${impressoras.find((i) => i.id === impressoraId)?.linguagem === 'PDF' ? 'Gerar PDF de' : 'Imprimir'} ${linhas.length} produto(s)`} ocupado={enviando} disabled={!impressoraId} onPress={imprimir} />
        </View>
      ) : null}
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
  opcao: { borderWidth: 1, borderColor: cores.borda, borderRadius: 20, backgroundColor: cores.branco, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', marginRight: 8 },
  opcaoAtiva: { borderColor: cores.azul, backgroundColor: cores.azulClaro },
  opcaoTexto: { fontSize: 14, color: cores.texto },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10, marginBottom: 8 },
  tituloQtd: { fontSize: 11, fontWeight: '700', color: cores.suave, textTransform: 'uppercase' },
  quantidade: { width: 56, height: 44, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, textAlign: 'center', fontSize: 16, color: cores.texto },
  tirar: { paddingVertical: 6, paddingHorizontal: 4 },
  rodape: { padding: 12, backgroundColor: cores.branco, borderTopWidth: 1, borderTopColor: cores.borda },
});
