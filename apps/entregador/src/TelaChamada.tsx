import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChamadaEntregador, MotivoOcorrencia, OfertaResumo, ParadaChamada } from '../../../packages/shared/src/entregas-chamadas';
import type { Api } from './api';
import { escolherImagem } from './imagens';
import { LeitorCodigo } from './LeitorCodigo';
import { posicaoAtual } from './localizacao';
import { ESPERA_BLOCO_MINUTOS, ESTADOS_MAQUINA, formatarCelular, formatarCentavos, formatarKm, ITENS_CHECKLIST, linkNavegacao, MOTIVOS_OCORRENCIA, normalizarSerie, problemaNoChecklist, PROXIMA_ETAPA, ROTULO_ESTADO_MAQUINA, ROTULO_MOTIVO_OCORRENCIA, ROTULO_SITUACAO_CHAMADA, ROTULO_TIPO_CHAMADA } from './regras';
import type { ChecklistMaquina } from '../../../packages/shared/src/entregas-servico';
import type { TracoAssinatura } from '../../../packages/shared/src/entregas-comprovacao';
import { AreaAssinatura } from './Assinatura';
import { ConversaChamada, LerEtiqueta } from './Balcao';
import { normalizarCodigoColeta, problemaNosVolumes, textoVolumes } from './regras';
import { problemaNaAssinatura } from './regras';

const CHECKLIST_VAZIO: ChecklistMaquina = { carregador: false, bobina: false, chip: false, estado: 'BOA', observacao: '' };

/** Minutos no local desde o "cheguei" (atualiza a cada 30 s). */
function useMinutosNoLocal(desde: string | null | undefined): number | null {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!desde) return;
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [desde]);
  return desde ? Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60_000)) : null;
}

/** Maquininha: o que veio junto e o estado, na coleta e na entrega. */
function Checklist({ valor, mudar }: { valor: ChecklistMaquina; mudar: (c: ChecklistMaquina) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Texto>Confira a máquina:</Texto>
      {ITENS_CHECKLIST.map((i) => (
        <Pressable key={i.chave} accessibilityRole="checkbox" accessibilityState={{ checked: valor[i.chave] }} onPress={() => mudar({ ...valor, [i.chave]: !valor[i.chave] })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
          <Text style={{ fontSize: 20, color: valor[i.chave] ? cores.ok : cores.suave }}>{valor[i.chave] ? '☑' : '☐'}</Text>
          <Text style={{ color: cores.texto }}>Veio {i.rotulo.toLowerCase()}</Text>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {ESTADOS_MAQUINA.map((e) => (
          <Pressable key={e} accessibilityRole="radio" accessibilityState={{ selected: valor.estado === e }} onPress={() => mudar({ ...valor, estado: e })} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: cores.borda, backgroundColor: valor.estado === e ? cores.azul : 'transparent' }}>
            <Text style={{ color: valor.estado === e ? cores.branco : cores.texto }}>{ROTULO_ESTADO_MAQUINA[e]}</Text>
          </Pressable>
        ))}
      </View>
      {valor.estado === 'AVARIADA' && <Campo rotulo="Qual a avaria?" value={valor.observacao} onChangeText={(v) => mudar({ ...valor, observacao: v })} multiline />}
    </View>
  );
}
import { Emergencia } from './Emergencia';
import { aplicarLocal, etapasGuardadas, guardarEtapa, semInternet } from './fila';
import { ErroApi } from './api';
import { Alerta, Botao, Campo, Cartao, cores, Texto, Titulo, fontes } from './ui';

/** Oferta recebida: valor, caminho resumido e prazo para responder. */
export function CartaoOferta({ api, oferta, aoResponder }: { api: Api; oferta: OfertaResumo; aoResponder: (aceita: ChamadaEntregador | null) => void }) {
  const [agora, setAgora] = useState(Date.now());
  const [ocupado, setOcupado] = useState<'aceitar' | 'recusar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const restam = Math.max(0, Math.round((new Date(oferta.expiraEm).getTime() - agora) / 1000));

  async function responder(aceitar: boolean) {
    setErro(null);
    setOcupado(aceitar ? 'aceitar' : 'recusar');
    try {
      if (aceitar) aoResponder(await api<ChamadaEntregador>(`/entregador/ofertas/${oferta.id}/aceitar`, { metodo: 'POST' }));
      else {
        await api(`/entregador/ofertas/${oferta.id}/recusar`, { metodo: 'POST' });
        aoResponder(null);
      }
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(null);
    }
  }

  return (
    <View style={estilos.oferta} accessibilityLabel="Nova chamada">
      <Text style={estilos.ofertaTitulo}>Nova chamada</Text>
      <Text style={estilos.valor}>{formatarCentavos(oferta.valorCentavos)}</Text>
      <Text style={estilos.linha}>
        {ROTULO_TIPO_CHAMADA[oferta.tipo]} · {oferta.empresa}
      </Text>
      <Text style={estilos.linha}>Coleta: {oferta.origemResumo || 'ver no mapa'}{oferta.metrosAteColeta != null ? ` (${formatarKm(oferta.metrosAteColeta)} de você)` : ''}{(oferta.coletas ?? 1) > 1 ? ` e mais ${(oferta.coletas ?? 1) - 1} lugar${(oferta.coletas ?? 1) > 2 ? 'es' : ''} para pegar` : ''}</Text>
      <Text style={estilos.linha}>Destino: {oferta.destinoResumo || 'ver no mapa'}{(oferta.entregas ?? 1) > 1 ? ` e mais ${(oferta.entregas ?? 1) - 1} entrega${(oferta.entregas ?? 1) > 2 ? 's' : ''}` : ''}</Text>
      <Text style={estilos.linha}>
        Percurso: {formatarKm(oferta.metros)}
        {oferta.estimada ? ' (estimado)' : ''}
      </Text>
      {oferta.agendadaPara ? <Text style={[estilos.linha, { fontFamily: fontes.forte, fontWeight: '700' }]}>Coleta agendada: {new Date(oferta.agendadaPara).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text> : null}
      {oferta.notaEmpresa != null ? <Text style={estilos.linha}>Empresa: nota {oferta.notaEmpresa.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} de 5 ({oferta.avaliacoesEmpresa} avaliações de entregadores)</Text> : null}
      {oferta.valorDeclaradoCentavos != null ? <Text style={estilos.linha}>Valor declarado do pacote: {formatarCentavos(oferta.valorDeclaradoCentavos)}</Text> : null}
      {oferta.motivo ? <Texto suave>{oferta.motivo}</Texto> : null}
      <Text style={[estilos.prazo, restam <= 10 && { color: cores.erro }]}>{restam > 0 ? `${restam} s para responder` : 'Tempo esgotado'}</Text>
      {erro && <Alerta>{erro}</Alerta>}
      <View style={{ gap: 8 }}>
        <Botao titulo="Aceitar" onPress={() => void responder(true)} ocupado={ocupado === 'aceitar'} disabled={restam === 0 || ocupado !== null} />
        <Botao titulo="Recusar" variante="secundario" onPress={() => void responder(false)} ocupado={ocupado === 'recusar'} disabled={ocupado !== null} />
      </View>
    </View>
  );
}

function Parada({ titulo, p, ativa }: { titulo: string; p: ParadaChamada; ativa: boolean }) {
  return (
    <Cartao>
      <Text style={[estilos.parada, ativa && { color: cores.azul }]}>{titulo}</Text>
      <Texto>{p.endereco}</Texto>
      {p.instrucoes ? <Texto suave>{p.instrucoes}</Texto> : null}
      {p.contato || p.telefone ? (
        <Texto suave>
          {p.contato}
          {p.telefone ? ` · ${formatarCelular(p.telefone)}` : ''}
        </Texto>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Botao titulo="Navegar" variante={ativa ? 'primario' : 'secundario'} onPress={() => void Linking.openURL(linkNavegacao(p))} />
        </View>
        {p.telefone ? (
          <View style={{ flex: 1 }}>
            <Botao titulo="Ligar" variante="secundario" onPress={() => void Linking.openURL(`tel:${p.telefone}`)} />
          </View>
        ) : null}
      </View>
    </Cartao>
  );
}

/** Chamada aceita: as etapas, uma de cada vez. */
export function TelaChamada({ api, chamada, aoMudar }: { api: Api; chamada: ChamadaEntregador; aoMudar: (c: ChamadaEntregador | null) => void }) {
  const [serie, setSerie] = useState('');
  const [checklist, setChecklist] = useState<ChecklistMaquina>(CHECKLIST_VAZIO);
  const [tracos, setTracos] = useState<TracoAssinatura[]>([]);
  const [recebedor, setRecebedor] = useState('');
  // Etapa 12: volumes na coleta, etiqueta (se a empresa imprimiu) e os volumes conferidos na entrega.
  const [volumes, setVolumes] = useState('1');
  const [etiqueta, setEtiqueta] = useState('');
  const [entregouTodos, setEntregouTodos] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ocorrendo, setOcorrendo] = useState(false);
  const [motivo, setMotivo] = useState<MotivoOcorrencia>('CLIENTE_AUSENTE');
  const [texto, setTexto] = useState('');
  const [desistindo, setDesistindo] = useState(false);
  const [guardadas, setGuardadas] = useState(0);
  useEffect(() => {
    let vivo = true;
    const contar = () => void etapasGuardadas().then((l) => vivo && setGuardadas(l.filter((e) => e.chamadaId === chamada.id).length));
    contar();
    const t = setInterval(contar, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [chamada.id]);
  const [motivoDesistencia, setMotivoDesistencia] = useState('');
  const etapa = PROXIMA_ETAPA[chamada.situacao];
  const pedeFoto = (etapa?.para === 'COLETADA' && chamada.pedeFotoColeta) || (etapa?.para === 'CONCLUIDA' && chamada.pedeFotoEntrega);
  const indoColetar = chamada.situacao === 'ACEITA' || chamada.situacao === 'NA_COLETA';
  // Maquininha: série, checklist e foto na coleta e na entrega do destino principal (na devolução à origem, não).
  const pedeMaquina = !!chamada.pedeChecklist && !chamada.devolvendo && (etapa?.para === 'COLETADA' || (etapa?.para === 'CONCLUIDA' && (chamada.paradaAtual ?? 0) === 0));
  const pedeSerie = pedeMaquina || (etapa?.para === 'COLETADA' && chamada.pedeSerie && !chamada.devolvendo);
  const noLocal = chamada.situacao === 'NA_COLETA' || chamada.situacao === 'NO_DESTINO';
  // Assinatura de quem recebe (a empresa escolhe: junto ao código ou no lugar dele); na devolução à origem, não.
  const modoAssinatura = chamada.devolvendo ? 'NAO' : (chamada.assinatura ?? 'NAO');
  const pedeAssinatura = etapa?.para === 'CONCLUIDA' && modoAssinatura !== 'NAO';
  const pedeCodigo = etapa?.para === 'CONCLUIDA' && modoAssinatura !== 'NO_LUGAR_DO_CODIGO';
  const pedeVolumes = etapa?.para === 'COLETADA' && !chamada.devolvendo;
  const pedeLeitura = etapa?.para === 'COLETADA' && !!chamada.pedeEtiqueta && !chamada.devolvendo;
  const confereVolumes = etapa?.para === 'CONCLUIDA' && !!chamada.volumes && !chamada.devolvendo && (chamada.destinos?.length ?? 1) <= 1;
  const minutosNoLocal = useMinutosNoLocal(noLocal ? chamada.chegouNoPontoEm : null);

  if (lendo) return <LeitorCodigo aoLer={(c) => { setSerie(normalizarSerie(c)); setLendo(false); }} aoCancelar={() => setLendo(false)} />;

  async function avancar() {
    if (!etapa) return;
    setErro(null);
    setOcupado(true);
    try {
      if (pedeVolumes) {
        const problema = problemaNosVolumes(Number(volumes));
        if (problema) return setErro(problema);
      }
      if (pedeLeitura && !normalizarCodigoColeta(etiqueta)) return setErro('Leia a etiqueta de coleta do pacote.');
      if (confereVolumes && !entregouTodos) return setErro(`Confirme que entregou ${textoVolumes(chamada.volumes!)}, ou registre uma ocorrência.`);
      if (pedeMaquina) {
        const problema = problemaNoChecklist(checklist);
        if (problema) return setErro(problema);
      }
      const assinatura = pedeAssinatura ? { tracos, recebedor: recebedor.trim() } : undefined;
      if (assinatura) {
        const problema = problemaNaAssinatura(assinatura);
        if (problema) return setErro(problema);
      }
      // A empresa pode exigir a foto da coleta ou da entrega (a maquininha sempre pede).
      const foto = pedeFoto ? await escolherImagem(Platform.OS === 'web' ? 'galeria' : 'camera') : null;
      if (pedeFoto && !foto) return setErro(etapa.para === 'COLETADA' ? 'Tire a foto da coleta para continuar.' : 'Tire a foto da entrega para continuar.');
      const p = await posicaoAtual();
      const corpo = { para: etapa.para, lat: p.coords.latitude, lon: p.coords.longitude, precisao: p.coords.accuracy ?? null, simulada: p.mocked === true, serie: serie || undefined, codigo: codigo || undefined, foto: foto ?? undefined, checklist: pedeMaquina ? checklist : undefined, assinatura, volumes: pedeVolumes ? Number(volumes) : undefined, etiqueta: pedeLeitura ? normalizarCodigoColeta(etiqueta) ?? undefined : undefined, volumesEntregues: confereVolumes ? chamada.volumes! : undefined, em: new Date().toISOString() };
      let c: ChamadaEntregador;
      try {
        // Com outra etapa ainda esperando a internet, esta vai para a fila também, na ordem.
        if ((await etapasGuardadas()).length) throw new ErroApi(0, 'fila');
        c = await api<ChamadaEntregador>(`/entregador/chamadas/${chamada.id}/avancar`, { metodo: 'POST', corpo });
      } catch (e) {
        if (!semInternet(e)) throw e;
        await guardarEtapa({ chamadaId: chamada.id, corpo });
        setGuardadas((n) => n + 1);
        c = aplicarLocal(chamada, etapa.para);
      }
      setCodigo('');
      setSerie('');
      setChecklist(CHECKLIST_VAZIO);
      setTracos([]);
      setRecebedor('');
      setEtiqueta('');
      setEntregouTodos(false);
      aoMudar(c);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function desistir() {
    setErro(null);
    setOcupado(true);
    try {
      await api(`/entregador/chamadas/${chamada.id}/desistir`, { metodo: 'POST', corpo: { motivo: motivoDesistencia } });
      aoMudar(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function registrarOcorrencia() {
    setErro(null);
    try {
      const foto = await escolherImagem(Platform.OS === 'web' ? 'galeria' : 'camera');
      if (!foto) return setErro('A ocorrência precisa de uma foto.');
      setOcupado(true);
      aoMudar(await api<ChamadaEntregador>(`/entregador/chamadas/${chamada.id}/ocorrencia`, { metodo: 'POST', corpo: { motivo, texto, foto } }));
      setOcorrendo(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Titulo>
        Chamada {chamada.numero} · {ROTULO_TIPO_CHAMADA[chamada.tipo]}
      </Titulo>
      <Texto suave>
        {chamada.empresa} · {formatarCentavos(chamada.valorCentavos)} · {formatarKm(chamada.metros)}
      </Texto>
      <View style={estilos.situacao}>
        <Text style={estilos.situacaoTexto}>{ROTULO_SITUACAO_CHAMADA[chamada.situacao]}</Text>
      </View>
      {guardadas > 0 && (
        <Alerta tipo="aviso">
          Sem internet: {guardadas === 1 ? 'uma etapa guardada' : `${guardadas} etapas guardadas`} no celular. Vão sozinhas para a empresa quando a internet voltar.
        </Alerta>
      )}
      {chamada.situacao === 'CONCLUIDA' && <Alerta tipo="ok">Entrega guardada. Assim que a internet voltar, ela é enviada e a chamada termina.</Alerta>}
      {chamada.agendadaPara && (chamada.situacao === 'ACEITA' || chamada.situacao === 'NA_COLETA') ? <Alerta tipo="aviso">Coleta agendada para {new Date(chamada.agendadaPara).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</Alerta> : null}
      {chamada.volumes ? <Texto suave>Levando {textoVolumes(chamada.volumes)}.</Texto> : null}
      {chamada.observacao ? <Alerta tipo="aviso">{chamada.observacao}</Alerta> : null}

      {chamada.situacao === 'OCORRENCIA' && (
        <Alerta tipo="aviso">
          Ocorrência registrada{chamada.ocorrencia ? `: ${ROTULO_MOTIVO_OCORRENCIA[chamada.ocorrencia.motivo]}` : ''}. Aguarde a empresa decidir: seguir, liberar você, devolver à origem ou cancelar.
        </Alerta>
      )}
      {chamada.devolvendo && chamada.situacao !== 'CONCLUIDA' && (
        <Alerta tipo="aviso">A entrega não deu certo: leve de volta para a coleta. Ao chegar, peça o código à empresa. A volta já está somada ao valor.</Alerta>
      )}
      {minutosNoLocal !== null && chamada.espera && chamada.espera.porBlocoCentavos > 0 && (
        <Alerta tipo="ok">
          No local há {minutosNoLocal} min.{' '}
          {minutosNoLocal < chamada.espera.toleranciaMinutos
            ? `Depois de ${chamada.espera.toleranciaMinutos} min, cada ${ESPERA_BLOCO_MINUTOS} min de espera somam ${formatarCentavos(chamada.espera.porBlocoCentavos)}.`
            : `Espera até agora: ${formatarCentavos(Math.floor((minutosNoLocal - chamada.espera.toleranciaMinutos) / ESPERA_BLOCO_MINUTOS) * chamada.espera.porBlocoCentavos)}.`}
        </Alerta>
      )}
      {(chamada.esperaCentavos ?? 0) > 0 && <Texto suave>Espera já somada: {formatarCentavos(chamada.esperaCentavos!)}</Texto>}

      {chamada.valorDeclaradoCentavos != null ? <Texto suave>Valor declarado do pacote: {formatarCentavos(chamada.valorDeclaradoCentavos)}</Texto> : null}
      <Parada titulo={(chamada.coletas?.length ?? 1) > 1 && !chamada.devolvendo ? `Coleta ${(chamada.coletaAtual ?? 0) + 1} de ${chamada.coletas!.length}` : 'Coleta'} p={chamada.origem} ativa={indoColetar} />
      {(chamada.coletas?.length ?? 1) > 1 && indoColetar && (
        <Cartao>
          {chamada.coletas!.map((d) => (
            <Text key={d.ordem} style={{ color: d.coletada ? cores.ok : d.ordem === chamada.coletaAtual ? cores.texto : cores.suave, fontWeight: d.ordem === chamada.coletaAtual ? '700' : '400' }}>
              {d.coletada ? '✓ ' : `${d.ordem + 1}. `}
              {d.parada.endereco}
            </Text>
          ))}
        </Cartao>
      )}
      <Parada titulo={chamada.devolvendo ? 'Devolver em' : (chamada.destinos?.length ?? 1) > 1 ? `Entrega ${(chamada.paradaAtual ?? 0) + 1} de ${chamada.destinos!.length}` : 'Destino'} p={chamada.destino} ativa={!indoColetar} />
      {(chamada.destinos?.length ?? 1) > 1 && (
        <Cartao>
          {chamada.destinos!.map((d) => (
            <Text key={d.ordem} style={{ color: d.entregue ? cores.ok : d.ordem === chamada.paradaAtual ? cores.texto : cores.suave, fontWeight: d.ordem === chamada.paradaAtual ? '700' : '400' }}>
              {d.entregue ? '✓ ' : `${d.ordem + 1}. `}
              {d.parada.endereco}
            </Text>
          ))}
        </Cartao>
      )}

      {pedeSerie && (
        <Cartao>
          <Campo rotulo="Número de série da máquina" value={serie} onChangeText={(v) => setSerie(normalizarSerie(v))} autoCapitalize="characters" />
          {Platform.OS !== 'web' && <Botao titulo="Ler com a câmera" variante="secundario" onPress={() => setLendo(true)} />}
          {pedeMaquina && <Checklist valor={checklist} mudar={setChecklist} />}
        </Cartao>
      )}
      {pedeAssinatura && (
        <Cartao>
          <Texto>Peça para quem recebe assinar:</Texto>
          <AreaAssinatura tracos={tracos} mudar={setTracos} />
          <Campo rotulo="Nome de quem recebeu" value={recebedor} onChangeText={setRecebedor} />
        </Cartao>
      )}
      {(pedeVolumes || pedeLeitura) && (
        <Cartao>
          {pedeLeitura && <LerEtiqueta valor={etiqueta} mudar={setEtiqueta} rotulo="Etiqueta de coleta do pacote" />}
          {pedeVolumes && <Campo rotulo="Quantos volumes você está levando?" value={volumes} onChangeText={(v) => setVolumes(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />}
        </Cartao>
      )}
      {confereVolumes && (
        <Cartao>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: entregouTodos }} onPress={() => setEntregouTodos(!entregouTodos)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 20, color: entregouTodos ? cores.ok : cores.suave }}>{entregouTodos ? '☑' : '☐'}</Text>
            <Text style={{ color: cores.texto, flex: 1 }}>Entreguei os {textoVolumes(chamada.volumes!)}</Text>
          </Pressable>
        </Cartao>
      )}
      {pedeCodigo && (
        <Cartao>
          {chamada.devolvendo ? (
            <Campo rotulo="Código da empresa" value={codigo} onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" ajuda="Quem recebe de volta na empresa vê o código no sistema." />
          ) : (
            <Campo rotulo="Código do destinatário" value={codigo} onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" ajuda="Peça o código de 4 números que a empresa mandou para quem recebe." />
          )}
        </Cartao>
      )}

      <ConversaChamada api={api} chamadaId={chamada.id} naoLidas={chamada.mensagensNaoLidas ?? 0} />
      {erro && <Alerta>{erro}</Alerta>}
      {etapa && <Botao titulo={(() => { const r = chamada.devolvendo && etapa.para === 'CONCLUIDA' ? 'Devolvi' : etapa.rotulo; return pedeFoto ? `Tirar foto e ${r.toLowerCase()}` : r; })()} onPress={() => void avancar()} ocupado={ocupado} />}
      {(chamada.situacao === 'ACEITA' || chamada.situacao === 'NA_COLETA') && (
        <View style={{ marginTop: 12 }}>
          {desistindo ? (
            <Cartao>
              <Campo rotulo="Por que vai desistir? (opcional)" value={motivoDesistencia} onChangeText={setMotivoDesistencia} />
              <Texto suave>A chamada volta para outro entregador. Desistir só conta na sua taxa de aceite.</Texto>
              <View style={{ gap: 8 }}>
                <Botao titulo="Confirmar desistência" variante="perigo" onPress={() => void desistir()} ocupado={ocupado} />
                <Botao titulo="Voltar" variante="secundario" onPress={() => setDesistindo(false)} />
              </View>
            </Cartao>
          ) : (
            <Botao titulo="Desistir da chamada" variante="secundario" onPress={() => setDesistindo(true)} />
          )}
        </View>
      )}

      {chamada.situacao !== 'OCORRENCIA' && (
        <View style={{ marginTop: 16 }}>
          {ocorrendo ? (
            <Cartao>
              <Text style={estilos.parada}>Ocorrência</Text>
              <View style={estilos.chips}>
                {MOTIVOS_OCORRENCIA.map((m) => (
                  <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: motivo === m }} onPress={() => setMotivo(m)} style={[estilos.chip, motivo === m && estilos.chipAtivo]}>
                    <Text style={{ color: motivo === m ? cores.branco : cores.texto }}>{ROTULO_MOTIVO_OCORRENCIA[m]}</Text>
                  </Pressable>
                ))}
              </View>
              <Campo rotulo="O que aconteceu" value={texto} onChangeText={setTexto} multiline />
              <View style={{ gap: 8 }}>
                <Botao titulo="Tirar foto e registrar" onPress={() => void registrarOcorrencia()} ocupado={ocupado} />
                <Botao titulo="Voltar" variante="secundario" onPress={() => setOcorrendo(false)} />
              </View>
            </Cartao>
          ) : (
            <Botao titulo="Registrar ocorrência" variante="perigo" onPress={() => setOcorrendo(true)} />
          )}
        </View>
      )}
      <Emergencia api={api} chamada={chamada} aoMudar={aoMudar} />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  oferta: { backgroundColor: cores.branco, borderWidth: 2, borderColor: cores.laranja, borderRadius: 14, padding: 18, marginBottom: 16, gap: 4 },
  ofertaTitulo: { fontSize: 16, fontWeight: '700', color: cores.laranja },
  valor: { fontSize: 34, fontWeight: '800', color: cores.texto },
  linha: { fontSize: 15, color: cores.texto },
  prazo: { fontSize: 15, fontWeight: '700', color: cores.aviso, marginVertical: 8 },
  parada: { fontSize: 15, fontWeight: '700', color: cores.texto, marginBottom: 6 },
  situacao: { backgroundColor: cores.azulClaro, borderRadius: 10, padding: 12, marginVertical: 12, alignItems: 'center' },
  situacaoTexto: { fontSize: 18, fontWeight: '800', color: cores.azul },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.branco },
  chipAtivo: { backgroundColor: cores.azul, borderColor: cores.azul },
});
