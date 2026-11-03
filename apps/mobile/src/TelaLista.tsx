import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ImprimirResposta, ItemListaResumo, ListaDiariaResumo } from '../../../packages/shared/src/impressao';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import type { Api } from './api';
import { CamposDoProduto } from './colunas';
import { colunasVisiveis, pendentesPorModelo, quantidadeValida } from './regras';
import { Alerta, Botao, cores } from './ui';

function confirmar(titulo: string, mensagem: string, acao: string, aoConfirmar: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${titulo}\n${mensagem}`)) aoConfirmar();
    return;
  }
  Alert.alert(titulo, mensagem, [{ text: 'Cancelar', style: 'cancel' }, { text: acao, onPress: aoConfirmar }]);
}

type Linha = { tipo: 'modelo'; id: string; nome: string; ids: string[]; colunas: string[] } | { tipo: 'item'; id: string; item: ItemListaResumo; colunas: string[]; rotulos?: Record<string, string> };

export function TelaLista({ api, usuario }: { api: Api; usuario: UsuarioLogado }) {
  const pode = (c: UsuarioLogado['permissoes'][number]) => usuario.superAdmin || usuario.permissoes.includes(c);
  const podeAprovar = pode('imprimir') && pode('app.aprovar');
  const [lista, setLista] = useState<ListaDiariaResumo | null>(null);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const aplicar = useCallback((l: ListaDiariaResumo | null) => {
    setLista(l);
    // O que saiu da lista (impresso no computador, por exemplo) deixa de estar marcado.
    const pendentes = new Set(l?.itens.filter((i) => i.status === 'PENDENTE').map((i) => i.id));
    setMarcados((m) => new Set([...m].filter((id) => pendentes.has(id))));
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await api<{ lista: ListaDiariaResumo | null }>('/listas/hoje');
      aplicar(r.lista);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api, aplicar]);

  useEffect(() => void carregar(), [carregar]);

  const grupos = useMemo(() => pendentesPorModelo(lista?.itens ?? [], lista?.modelos ?? []), [lista]);
  const linhas = useMemo<Linha[]>(
    () =>
      grupos.flatMap((g) => {
        const doModelo = lista?.modelos.find((m) => m.id === g.modeloId);
        const colunas = colunasVisiveis(doModelo?.colunas ?? [], g.itens.map((i) => i.registro));
        return [{ tipo: 'modelo' as const, id: `m-${g.modeloId}`, nome: g.nome, ids: g.itens.map((i) => i.id), colunas }, ...g.itens.map((item) => ({ tipo: 'item' as const, id: item.id, item, colunas, rotulos: doModelo?.rotulos }))];
      }),
    [grupos, lista],
  );
  const pendentes = linhas.filter((l) => l.tipo === 'item').length;
  const impressoraPdf = useMemo(() => new Set(lista?.impressoras.filter((i) => i.linguagem === 'PDF').map((i) => i.id)), [lista]);

  const quantidadeDe = (i: ItemListaResumo) => quantidades[i.id] ?? String(i.quantidade);

  function alternar(ids: string[], ligar: boolean) {
    setMarcados((m) => {
      const n = new Set(m);
      for (const id of ids) {
        if (ligar) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }

  async function atualizarLista() {
    setEnviando(true);
    setAviso(null);
    try {
      aplicar(await api<ListaDiariaResumo>('/listas/hoje/gerar', { metodo: 'POST' }));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function aprovar() {
    const itens = (lista?.itens ?? []).filter((i) => marcados.has(i.id));
    const envio: { id: string; quantidade: number }[] = [];
    for (const i of itens) {
      const q = quantidadeValida(quantidadeDe(i));
      if (q === null) return setErro(`Quantidade inválida em “${i.descricao}”.`);
      envio.push({ id: i.id, quantidade: q });
    }
    const total = envio.reduce((s, i) => s + i.quantidade, 0);
    confirmar('Aprovar e imprimir?', `${envio.length} produto(s), ${total} etiqueta(s). Vão agora para a impressora de cada modelo.`, 'Aprovar', () => {
      void (async () => {
        setEnviando(true);
        setAviso(null);
        try {
          const r = await api<ImprimirResposta>('/app/lista/aprovar', { metodo: 'POST', corpo: { itens: envio } });
          const enviadas = r.trabalhos.reduce((s, t) => s + t.quantidadeEtiquetas, 0);
          setAviso([enviadas ? `${enviadas} etiqueta(s) enviada(s) para a fila.` : 'Nada foi enviado.', ...r.avisos].join(' '));
          setErro(null);
          setMarcados(new Set());
          await carregar();
        } catch (e) {
          setErro((e as Error).message);
        } finally {
          setEnviando(false);
        }
      })();
    });
  }

  function descartar() {
    const ids = [...marcados];
    confirmar('Descartar da lista?', `${ids.length} produto(s) saem da lista de hoje. Dá para trazer de volta no computador, em Descartados hoje.`, 'Descartar', () => {
      void (async () => {
        setEnviando(true);
        setAviso(null);
        try {
          const r = await api<{ descartados: number }>('/app/lista/descartar', { metodo: 'POST', corpo: { ids } });
          setAviso(`${r.descartados} produto(s) descartado(s).`);
          setErro(null);
          setMarcados(new Set());
          await carregar();
        } catch (e) {
          setErro((e as Error).message);
        } finally {
          setEnviando(false);
        }
      })();
    });
  }

  function renderizar({ item: l }: { item: Linha }) {
    if (l.tipo === 'modelo') {
      const todos = l.ids.every((id) => marcados.has(id));
      return (
        <View style={estilos.modelo}>
          <Text accessibilityRole="header" style={estilos.modeloNome} numberOfLines={2}>{l.nome} ({l.ids.length})</Text>
          {podeAprovar && <Text accessibilityRole="button" style={estilos.marcarTodos} onPress={() => alternar(l.ids, !todos)}>{todos ? 'Desmarcar' : 'Marcar todos'}</Text>}
        </View>
      );
    }
    const i = l.item;
    const marcado = marcados.has(i.id);
    const emPdf = i.impressoraId !== null && impressoraPdf.has(i.impressoraId);
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: marcado, disabled: !podeAprovar }}
        accessibilityLabel={i.descricao}
        disabled={!podeAprovar}
        onPress={() => alternar([i.id], !marcado)}
        style={[estilos.item, marcado && estilos.itemMarcado]}
      >
        {podeAprovar && <View style={[estilos.caixa, marcado && estilos.caixaMarcada]}>{marcado && <Text style={estilos.visto}>✓</Text>}</View>}
        <View style={{ flex: 1 }}>
          <CamposDoProduto colunas={l.colunas} rotulos={l.rotulos} registro={i.registro} />
          {!i.impressoraId && <Text style={estilos.problema}>Modelo sem impressora</Text>}
          {emPdf && <Text style={estilos.problema}>Sai em PDF: imprima pelo computador</Text>}
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={estilos.tituloQtd}>Qtd.</Text>
        <TextInput
          accessibilityLabel={`Quantidade de ${i.descricao}`}
          editable={podeAprovar}
          style={estilos.quantidade}
          keyboardType="number-pad"
          value={quantidadeDe(i)}
          maxLength={5}
          selectTextOnFocus
          onChangeText={(t) => setQuantidades((q) => ({ ...q, [i.id]: t }))}
        />
        </View>
      </Pressable>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo }}>
      <FlatList
        data={linhas}
        keyExtractor={(l) => l.id}
        renderItem={renderizar}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={estilos.pagina}
        refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}
        ListHeaderComponent={
          <>
            <Text accessibilityRole="header" style={estilos.titulo}>Lista do dia</Text>
            <Text style={estilos.sub}>{lista ? `${pendentes} produto(s) pendente(s)` : carregando ? 'Carregando…' : 'A lista de hoje ainda não foi gerada.'}</Text>
            {erro ? <Alerta>{erro}</Alerta> : null}
            {aviso ? <Alerta tipo="ok">{aviso}</Alerta> : null}
            {lista?.erros.map((e) => <Alerta key={e.modeloId} tipo="aviso">{e.modeloNome}: {e.mensagem}</Alerta>)}
            {!podeAprovar ? <Alerta tipo="aviso">Seu perfil só pode ver a lista. Para aprovar pelo celular, peça a permissão ao administrador.</Alerta> : null}
            {pode('imprimir') && <Botao titulo="Atualizar a lista" variante="secundario" ocupado={enviando && marcados.size === 0} disabled={enviando} onPress={() => void atualizarLista()} />}
          </>
        }
        ListEmptyComponent={!carregando && lista ? <Text style={estilos.vazio}>Nada pendente por aqui.</Text> : undefined}
      />
      {podeAprovar && marcados.size > 0 && (
        <View style={estilos.rodape}>
          <View style={{ flex: 1 }}><Botao titulo="Descartar" variante="perigo" disabled={enviando} onPress={descartar} /></View>
          <View style={{ flex: 2 }}><Botao titulo={`Aprovar ${marcados.size}`} ocupado={enviando} onPress={aprovar} /></View>
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 24 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 12 },
  vazio: { textAlign: 'center', color: cores.suave, fontSize: 16, marginTop: 32 },
  modelo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, marginBottom: 6 },
  modeloNome: { flex: 1, fontSize: 15, fontWeight: '600', color: cores.texto },
  marcarTodos: { color: cores.azul, fontSize: 14, fontWeight: '600', paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 64, backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10, marginBottom: 8 },
  itemMarcado: { borderColor: cores.azul, backgroundColor: cores.azulClaro },
  caixa: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#94a3b8', backgroundColor: cores.branco, alignItems: 'center', justifyContent: 'center' },
  caixaMarcada: { borderColor: cores.azul, backgroundColor: cores.azul },
  visto: { color: cores.branco, fontWeight: '700', fontSize: 16 },
  tituloQtd: { fontSize: 11, fontWeight: '700', color: cores.suave, textTransform: 'uppercase' },
  problema: { fontSize: 12, color: cores.aviso, marginTop: 2 },
  quantidade: { width: 56, height: 44, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, backgroundColor: cores.branco, textAlign: 'center', fontSize: 16, color: cores.texto },
  rodape: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: cores.branco, borderTopWidth: 1, borderTopColor: cores.borda },
});
