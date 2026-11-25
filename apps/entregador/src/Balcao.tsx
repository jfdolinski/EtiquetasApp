import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { ChamadaEntregador } from '../../../packages/shared/src/entregas-chamadas';
import type { MensagemChamada } from '../../../packages/shared/src/entregas-balcao';
import type { Api } from './api';
import { LeitorCodigo } from './LeitorCodigo';
import { posicaoAtual } from './localizacao';
import { LIMITE_MENSAGEM, normalizarCodigoColeta } from './regras';
import { Alerta, Botao, Campo, Cartao, cores, fontes, Texto, Titulo } from './ui';

/**
 * Etapa 12 no app: pegar a chamada no balcão lendo a etiqueta de coleta, o termo de custódia e a
 * conversa com a empresa dentro da chamada.
 */

type Conversa = { mensagens: MensagemChamada[]; podeEscrever: boolean };

/** Campo da etiqueta: câmera no celular; no navegador (testes), digitando. */
export function LerEtiqueta({ valor, mudar, rotulo = 'Etiqueta de coleta' }: { valor: string; mudar: (v: string) => void; rotulo?: string }) {
  const [lendo, setLendo] = useState(false);
  if (lendo)
    return (
      <LeitorCodigo
        texto="Aponte para o código de barras da etiqueta de coleta."
        aoLer={(c) => {
          mudar(c);
          setLendo(false);
        }}
        aoCancelar={() => setLendo(false)}
      />
    );
  return (
    <View>
      <Campo rotulo={rotulo} value={valor} onChangeText={mudar} autoCapitalize="characters" placeholder="FC…" />
      {Platform.OS !== 'web' && <Botao titulo="Ler com a câmera" variante="secundario" onPress={() => setLendo(true)} />}
    </View>
  );
}

/** "Pegar no balcão": lê a etiqueta impressa pela empresa e a chamada fica com o entregador. */
export function PegarNoBalcao({ api, aoPegar }: { api: Api; aoPegar: (c: ChamadaEntregador) => void }) {
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function pegar() {
    setErro(null);
    setOk(null);
    const c = normalizarCodigoColeta(codigo);
    if (!c) return setErro('Este código não é uma etiqueta de coleta do Flow.');
    setOcupado(true);
    try {
      const p = await posicaoAtual();
      const chamada = await api<ChamadaEntregador>('/entregador/balcao', { metodo: 'POST', corpo: { codigo: c, lat: p.coords.latitude, lon: p.coords.longitude, precisao: p.coords.accuracy ?? null } });
      setCodigo('');
      setOk(`Chamada ${chamada.numero} é sua. Leia outra etiqueta ou feche.`);
      aoPegar(chamada);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) return <Botao titulo="Pegar no balcão (ler etiqueta)" variante="secundario" onPress={() => setAberto(true)} />;
  return (
    <Cartao>
      <Text style={{ fontFamily: fontes.forte, fontWeight: '700', color: cores.texto, marginBottom: 6 }}>Pegar no balcão</Text>
      <Texto suave>Leia a etiqueta de coleta que a empresa imprimiu: a chamada fica com você na hora.</Texto>
      <LerEtiqueta valor={codigo} mudar={setCodigo} />
      {erro && <Alerta>{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}
      <View style={{ gap: 8 }}>
        <Botao titulo="Pegar esta chamada" onPress={() => void pegar()} ocupado={ocupado} disabled={!codigo.trim()} />
        <Botao
          titulo="Fechar"
          variante="secundario"
          onPress={() => {
            setAberto(false);
            setErro(null);
            setOk(null);
          }}
        />
      </View>
    </Cartao>
  );
}

/** Termo de custódia: precisa estar aceito para receber chamada de máquina. */
export function TermoCustodia({ api, aoAceitar, aoFechar }: { api: Api; aoAceitar: () => void; aoFechar: () => void }) {
  const [texto, setTexto] = useState<string[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    void api<{ versao: number; texto: string[] }>('/entregador/termo-custodia')
      .then((t) => setTexto(t.texto))
      .catch((e: Error) => setErro(e.message));
  }, [api]);
  async function aceitar() {
    setOcupado(true);
    try {
      await api('/entregador/termo-custodia', { metodo: 'POST' });
      aoAceitar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Titulo>Termo de custódia de máquinas</Titulo>
      {texto?.map((p, i) => (
        <Texto key={i}>{p}</Texto>
      ))}
      {erro && <Alerta>{erro}</Alerta>}
      <View style={{ gap: 8, marginTop: 8 }}>
        <Botao titulo="Li e aceito o termo" onPress={() => void aceitar()} ocupado={ocupado} disabled={!texto} />
        <Botao titulo="Agora não" variante="secundario" onPress={aoFechar} />
      </View>
    </ScrollView>
  );
}

/** Conversa com a empresa dentro da chamada (consulta a cada 8 s enquanto aberta). */
export function ConversaChamada({ api, chamadaId, naoLidas }: { api: Api; chamadaId: string; naoLidas: number }) {
  const [aberta, setAberta] = useState(false);
  const [lista, setLista] = useState<MensagemChamada[]>([]);
  const [pode, setPode] = useState(true);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);
  const caminho = `/entregador/chamadas/${chamadaId}/mensagens`;
  useEffect(() => {
    vivo.current = true;
    if (!aberta) return;
    const buscar = () =>
      void api<Conversa>(caminho)
        .then((r) => {
          if (!vivo.current) return;
          setLista(r.mensagens);
          setPode(r.podeEscrever);
        })
        .catch(() => undefined);
    buscar();
    const t = setInterval(buscar, 8_000);
    return () => {
      vivo.current = false;
      clearInterval(t);
    };
  }, [api, caminho, aberta]);

  async function enviar() {
    setErro(null);
    try {
      const r = await api<Conversa>(caminho, { metodo: 'POST', corpo: { texto } });
      setTexto('');
      setLista(r.mensagens);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!aberta) {
    const titulo = naoLidas ? `Conversa com a empresa (${naoLidas} ${naoLidas > 1 ? 'novas' : 'nova'})` : 'Conversa com a empresa';
    return <Botao titulo={titulo} variante="secundario" onPress={() => setAberta(true)} />;
  }
  return (
    <Cartao>
      <Pressable accessibilityRole="button" onPress={() => setAberta(false)}>
        <Text style={{ fontFamily: fontes.forte, fontWeight: '700', color: cores.texto, marginBottom: 6 }}>Conversa com a empresa (fechar)</Text>
      </Pressable>
      {lista.length === 0 && <Texto suave>Nenhuma mensagem ainda.</Texto>}
      {lista.map((m) => (
        <View key={m.id} style={{ alignSelf: m.autor === 'entregador' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: m.autor === 'entregador' ? cores.azulClaro : cores.fundo, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 }}>
          <Text style={{ fontSize: 11, color: cores.suave }}>
            {m.nome} · {new Date(m.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={{ color: cores.texto }}>{m.texto}</Text>
        </View>
      ))}
      {pode && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <TextInput accessibilityLabel="Mensagem para a empresa" value={texto} onChangeText={setTexto} maxLength={LIMITE_MENSAGEM} placeholder="Escreva para a empresa" placeholderTextColor={cores.suave} style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, paddingHorizontal: 10, color: cores.texto, backgroundColor: cores.branco }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" disabled={!texto.trim()} onPress={() => void enviar()} style={{ paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 10, backgroundColor: texto.trim() ? cores.azul : cores.borda }}>
            <Text style={{ color: cores.branco, fontFamily: fontes.forte, fontWeight: '700' }}>Enviar</Text>
          </Pressable>
        </View>
      )}
      {erro && <Alerta>{erro}</Alerta>}
    </Cartao>
  );
}
