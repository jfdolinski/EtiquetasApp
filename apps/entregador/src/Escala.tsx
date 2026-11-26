import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { AvariaResumo, TurnoParaEntregador } from '../../../packages/shared/src/entregas-escala';
import type { Api } from './api';
import { formatarCentavos, formatarKm, ROTULO_RESPONSAVEL_AVARIA, ROTULO_SITUACAO_AVARIA, ROTULO_TIPO_AVARIA } from './regras';
import { Alerta, Botao, Campo, Cartao, cores, Texto, Titulo } from './ui';

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Turnos das empresas perto de você: inscrito, você recebe as chamadas daquela empresa antes dos outros. */
export function TelaTurnos({ api, aoFechar }: { api: Api; aoFechar: () => void }) {
  const [lista, setLista] = useState<TurnoParaEntregador[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try {
      setLista(await api<TurnoParaEntregador[]>('/entregador/turnos'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api]);
  useEffect(() => void carregar(), [carregar]);

  async function acao(t: TurnoParaEntregador, qual: 'inscrever' | 'sair') {
    setOcupado(t.id);
    setErro(null);
    try {
      setLista(await api<TurnoParaEntregador[]>(`/entregador/turnos/${t.id}/${qual}`, { metodo: 'POST' }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} />}>
      <Botao titulo="Voltar" variante="secundario" onPress={aoFechar} />
      <Titulo>Turnos</Titulo>
      <Texto suave>No turno, você recebe as chamadas daquela empresa antes dos outros entregadores. Fique online no horário. Com valor, a empresa paga o turno junto com as chamadas, se você estiver presente.</Texto>
      {erro && <Alerta>{erro}</Alerta>}
      {lista && !lista.length && <Texto suave>Nenhum turno aberto perto de você nos próximos dias.</Texto>}
      {lista?.map((t) => (
        <Cartao key={t.id}>
          <View accessibilityLabel={`Turno de ${t.empresa}`} style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: cores.texto }}>{t.empresa}</Text>
            <Text style={{ color: cores.texto }}>
              {quando(t.inicio)} às {hora(t.fim)}
            </Text>
            <Texto suave>
              {t.valorCentavos ? `${formatarCentavos(t.valorCentavos)} pelo turno, além das chamadas` : 'Sem valor fixo: só a prioridade nas chamadas'}
              {t.metros !== null ? ` · ${formatarKm(t.metros)} de você` : ''}
            </Texto>
            {t.observacao ? <Texto suave>{t.observacao}</Texto> : null}
            {t.minha === 'INSCRITO' ? (
              <>
                <Text style={{ color: cores.ok, fontWeight: '700' }}>Você está neste turno</Text>
                {t.podeSair ? <Botao titulo="Sair do turno" variante="secundario" onPress={() => void acao(t, 'sair')} ocupado={ocupado === t.id} /> : <Texto suave>Falta pouco para começar: para sair, fale com a empresa.</Texto>}
              </>
            ) : t.minha === 'PRESENTE' || t.minha === 'FALTOU' ? (
              <Texto suave>{t.minha === 'PRESENTE' ? 'A empresa marcou você como presente.' : 'A empresa marcou falta.'}</Texto>
            ) : t.livres > 0 ? (
              <Botao titulo={`Entrar no turno (${t.livres} ${t.livres === 1 ? 'vaga' : 'vagas'})`} onPress={() => void acao(t, 'inscrever')} ocupado={ocupado === t.id} />
            ) : (
              <Texto suave>Sem vagas.</Texto>
            )}
          </View>
        </Cartao>
      ))}
    </ScrollView>
  );
}

/** Avarias e extravios que as empresas registraram nas suas chamadas; as com desconto esperam sua resposta. */
export function AvariasDoEntregador({ api, aoMudar }: { api: Api; aoMudar: () => void }) {
  const [lista, setLista] = useState<AvariaResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try {
      setLista(await api<AvariaResumo[]>('/entregador/avarias'));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api]);
  useEffect(() => void carregar(), [carregar]);
  const visiveis = lista.filter((a) => a.situacao !== 'RETIRADA');
  if (!visiveis.length && !erro) return null;
  return (
    <View style={{ marginBottom: 16, gap: 8 }}>
      <Titulo>Avarias e extravios</Titulo>
      {erro && <Alerta>{erro}</Alerta>}
      {visiveis.map((a) => (
        <Avaria
          key={a.id}
          a={a}
          api={api}
          aoResponder={() => {
            void carregar();
            aoMudar();
          }}
        />
      ))}
    </View>
  );
}

function Avaria({ a, api, aoResponder }: { a: AvariaResumo; api: Api; aoResponder: () => void }) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'aceitar' | 'contestar' | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  async function responder(aceitar: boolean) {
    setOcupado(aceitar ? 'aceitar' : 'contestar');
    setErro(null);
    try {
      await api(`/entregador/avarias/${a.id}/responder`, { metodo: 'POST', corpo: { aceitar, texto } });
      aoResponder();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }
  async function verFoto(n: number) {
    try {
      setFoto((await api<{ dados: string }>(`/entregador/avarias/${a.id}/fotos/${n}`)).dados);
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  return (
    <Cartao>
      <View style={{ gap: 4 }} accessibilityLabel={`Avaria na chamada ${a.numero}`}>
        <Text style={{ fontWeight: '700', color: a.situacao === 'AGUARDANDO' ? cores.aviso : cores.texto }}>{ROTULO_SITUACAO_AVARIA[a.situacao]}</Text>
        <Text style={{ color: cores.texto }}>
          {ROTULO_TIPO_AVARIA[a.tipo]} · {a.empresa} · chamada nº {a.numero}
        </Text>
        <Texto>{a.descricao}</Texto>
        <Texto suave>
          Prejuízo: {formatarCentavos(a.prejuizoCentavos)} · responsável: {ROTULO_RESPONSAVEL_AVARIA[a.responsavel].toLowerCase()}
          {a.valorDeclaradoCentavos !== null ? ` · valor declarado: ${formatarCentavos(a.valorDeclaradoCentavos)}` : ''}
        </Texto>
        {a.descontoCentavos > 0 && <Text style={{ color: cores.texto, fontWeight: '700' }}>Desconto proposto: {formatarCentavos(a.descontoCentavos)}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {Array.from({ length: a.fotos }, (_, n) => (
            <Pressable key={n} accessibilityRole="button" onPress={() => void verFoto(n)}>
              <Text style={{ color: cores.azul, textDecorationLine: 'underline' }}>Ver foto {n + 1}</Text>
            </Pressable>
          ))}
        </View>
        {foto ? (
          <Pressable onPress={() => setFoto(null)}>
            <Image source={{ uri: foto }} style={{ width: '100%', height: 220, resizeMode: 'contain' }} accessibilityLabel="Foto da avaria" />
          </Pressable>
        ) : null}
        {a.resposta ? <Texto suave>Sua resposta: {a.resposta}</Texto> : null}
        {a.situacao === 'ACEITA' && <Texto suave>O desconto entra no próximo pagamento desta empresa.</Texto>}
        {a.situacao === 'CONTESTADA' && <Texto suave>Você não concordou: nada é descontado pelo Flow.</Texto>}
        {erro && <Alerta>{erro}</Alerta>}
        {a.situacao === 'AGUARDANDO' && (
          <>
            <Campo rotulo="Comentário (obrigatório para contestar)" value={texto} onChangeText={setTexto} multiline />
            <Botao titulo={`Aceitar o desconto de ${formatarCentavos(a.descontoCentavos)}`} onPress={() => void responder(true)} ocupado={ocupado === 'aceitar'} disabled={ocupado !== null} />
            <Botao titulo="Não concordo" variante="secundario" onPress={() => void responder(false)} ocupado={ocupado === 'contestar'} disabled={ocupado !== null || texto.trim().length < 5} />
          </>
        )}
      </View>
    </Cartao>
  );
}

/** Nota de 1 a 5 para a empresa, depois de terminar a chamada (até 7 dias). */
export function AvaliarEmpresa({ api, chamadaId, aoAvaliar }: { api: Api; chamadaId: string; aoAvaliar: () => void }) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function enviar() {
    setOcupado(true);
    setErro(null);
    try {
      await api(`/entregador/chamadas/${chamadaId}/avaliar-empresa`, { metodo: 'POST', corpo: { nota, comentario } });
      aoAvaliar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <View style={{ gap: 6, backgroundColor: cores.azulClaro, borderRadius: 8, padding: 8 }}>
      <Texto>Como foi trabalhar com esta empresa? A empresa vê a média e o comentário, sem o seu nome.</Texto>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`Nota ${n}`} accessibilityState={{ checked: nota === n }} onPress={() => setNota(n)} style={{ padding: 4 }}>
            <Text style={{ fontSize: 26, color: n <= nota ? cores.azul : cores.suave }}>{n <= nota ? '★' : '☆'}</Text>
          </Pressable>
        ))}
      </View>
      <Campo rotulo="Comentário (opcional)" value={comentario} onChangeText={setComentario} multiline />
      {erro && <Alerta>{erro}</Alerta>}
      <Botao titulo="Enviar avaliação" variante="secundario" onPress={() => void enviar()} ocupado={ocupado} disabled={!nota} />
    </View>
  );
}
