import { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PedidoCompleto, PedidoResumo } from '../../../packages/shared/src/pedidos-painel';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import type { Api } from './api';
import {
  formatarCelular,
  formatarCentavos,
  linkWhatsApp,
  mensagemWhatsApp,
  pedidoTerminado,
  PROXIMA_SITUACAO,
  rotuloAvancar,
  rotuloSituacaoPedido,
  linkMapa,
  PRECISAO_BOA_METROS,
  textoEndereco,
  textoFaixa,
  TITULO_MODALIDADE,
  TITULO_PAGAMENTO,
  type SituacaoPedidoApp,
} from './regras';
import { Alerta, Botao, cores } from './ui';

const INTERVALO_MS = 30_000;
const COR_SITUACAO: Record<SituacaoPedidoApp, string> = { NOVO: cores.aviso, EM_SEPARACAO: cores.azul, PRONTO: cores.azul, CONCLUIDO: cores.ok, CANCELADO: cores.erro };

/**
 * Os pedidos do link da empresa, no celular: ver, aceitar, avançar, cancelar, falar com o cliente pelo
 * WhatsApp e mandar a folha para a térmica. Propor alteração é no site, onde cabe a tabela inteira.
 */
export function TelaPedidos({ api, usuario, servidor }: { api: Api; usuario: UsuarioLogado; servidor: string }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [soAbertos, setSoAbertos] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoResumo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setPedidos(await api<PedidoResumo[]>(`/pedidos${soAbertos ? '?situacao=ABERTOS' : ''}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api, soAbertos]);

  useEffect(() => {
    if (aberto) return;
    void carregar();
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [carregar, aberto]);

  if (aberto) return <DetalhePedido api={api} usuario={usuario} servidor={servidor} id={aberto} aoVoltar={() => setAberto(null)} />;

  const novos = pedidos.filter((p) => p.situacao === 'NOVO').length;
  return (
    <FlatList
      style={{ backgroundColor: cores.fundo }}
      contentContainerStyle={estilos.pagina}
      data={pedidos}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}
      ListHeaderComponent={
        <>
          <Text accessibilityRole="header" style={estilos.titulo}>Pedidos</Text>
          <Text style={estilos.sub}>{novos ? `${novos} esperando alguém aceitar` : 'Nenhum pedido esperando'}</Text>
          <View style={estilos.linha}>
            <Filtro rotulo="Em aberto" ativo={soAbertos} aoTocar={() => setSoAbertos(true)} />
            <Filtro rotulo="Todos" ativo={!soAbertos} aoTocar={() => setSoAbertos(false)} />
          </View>
          {erro ? <Alerta>{erro}</Alerta> : null}
        </>
      }
      ListEmptyComponent={!carregando ? <Text style={estilos.vazio}>Nenhum pedido.</Text> : undefined}
      renderItem={({ item: p }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`Pedido ${p.numero}, ${p.clienteNome}`} onPress={() => setAberto(p.id)} style={estilos.cartao}>
          <View style={estilos.cabeca}>
            <Text style={estilos.nome} numberOfLines={1}>nº {p.numero} · {p.clienteNome}</Text>
            <Text style={[estilos.situacao, { color: COR_SITUACAO[p.situacao] }]}>{rotuloSituacaoPedido(p.situacao, p.modalidade)}</Text>
          </View>
          <Text style={estilos.detalhe}>{TITULO_MODALIDADE[p.modalidade]}{p.agendamento ? ` · ${textoFaixa(p.agendamento)}` : ''}</Text>
          <View style={estilos.cabeca}>
            <Text style={estilos.detalhe}>{p.unidades} {p.unidades === 1 ? 'item' : 'itens'} · {formatarCentavos(p.totalCentavos)}</Text>
            {p.aguardandoCliente ? <Text style={[estilos.detalhe, { color: cores.aviso }]}>Esperando o cliente</Text> : null}
          </View>
        </Pressable>
      )}
    />
  );
}

function Filtro({ rotulo, ativo, aoTocar }: { rotulo: string; ativo: boolean; aoTocar: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: ativo }} onPress={aoTocar} style={[estilos.filtro, ativo && estilos.filtroAtivo]}>
      <Text style={[{ fontSize: 14, color: cores.texto }, ativo && { color: cores.azul, fontWeight: '700' }]}>{rotulo}</Text>
    </Pressable>
  );
}

function DetalhePedido({ api, usuario, servidor, id, aoVoltar }: { api: Api; usuario: UsuarioLogado; servidor: string; id: string; aoVoltar: () => void }) {
  const podeGerenciar = usuario.superAdmin || usuario.permissoes.includes('pedido.gerenciar');
  const [p, setP] = useState<PedidoCompleto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    try {
      setP(await api<PedidoCompleto>(`/pedidos/${id}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api, id]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [carregar]);

  async function acao(caminho: string, corpo?: unknown, sucesso?: string) {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await api<PedidoCompleto | { avisos: string[] }>(`/pedidos/${id}${caminho}`, { metodo: 'POST', corpo });
      if ('numero' in r) setP(r);
      else await carregar();
      if (sucesso) setAviso(sucesso);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (!p) {
    return (
      <View style={[estilos.pagina, { flex: 1, backgroundColor: cores.fundo }]}>
        <Botao titulo="Voltar" variante="secundario" onPress={aoVoltar} />
        <View style={{ height: 12 }} />
        {erro ? <Alerta>{erro}</Alerta> : <Text style={estilos.vazio}>Carregando…</Text>}
      </View>
    );
  }

  const link = `${servidor}/loja/pedido/${p.codigoAcompanhamento}`;
  const proxima = PROXIMA_SITUACAO[p.situacao];
  const avancar = rotuloAvancar(p.situacao, p.modalidade);
  const aberto = !pedidoTerminado(p.situacao);

  return (
    <ScrollView style={{ backgroundColor: cores.fundo }} contentContainerStyle={estilos.pagina} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="link" style={estilos.voltar} onPress={aoVoltar}>‹ Pedidos</Text>
      <View style={estilos.cabeca}>
        <Text accessibilityRole="header" style={estilos.titulo}>Pedido nº {p.numero}</Text>
        <Text style={[estilos.situacao, { color: COR_SITUACAO[p.situacao], marginTop: 8 }]}>{rotuloSituacaoPedido(p.situacao, p.modalidade)}</Text>
      </View>
      {p.aceitoPorNome ? <Text style={estilos.sub}>Aceito por {p.aceitoPorNome}</Text> : null}
      {erro ? <Alerta>{erro}</Alerta> : null}
      {aviso ? <Alerta tipo="ok">{aviso}</Alerta> : null}

      {p.proposta ? (
        <View style={[estilos.cartao, { borderColor: '#fcd34d', backgroundColor: cores.avisoFundo }]}>
          <Text style={[estilos.nome, { color: cores.aviso }]}>Alteração esperando o cliente</Text>
          {p.proposta.diferencas.map((d) => <Text key={d} style={[estilos.detalhe, { color: cores.aviso }]}>• {d}</Text>)}
          <Text style={[estilos.detalhe, { color: cores.aviso }]}>Novo total: {formatarCentavos(p.proposta.totais.totalCentavos)}</Text>
          <Botao titulo="Avisar o cliente no WhatsApp" onPress={() => void Linking.openURL(linkWhatsApp(p.clienteTelefone, mensagemWhatsApp('proposta', p, p.empresa, link)))} />
          {podeGerenciar ? <><View style={{ height: 8 }} /><Botao titulo="Desistir da alteração" variante="secundario" ocupado={ocupado} onPress={() => void acao('/proposta/desistir')} /></> : null}
        </View>
      ) : null}
      {p.respostaProposta && !p.proposta ? <Alerta tipo={p.respostaProposta.aceita ? 'ok' : 'aviso'}>O cliente {p.respostaProposta.aceita ? 'aceitou' : 'recusou'} a última alteração.</Alerta> : null}
      {p.motivoCancelamento ? <Alerta>Motivo do cancelamento: {p.motivoCancelamento}</Alerta> : null}

      {podeGerenciar && aberto && !cancelando ? (
        <View style={{ gap: 8, marginBottom: 12 }}>
          {proxima && avancar ? <Botao titulo={avancar} ocupado={ocupado} disabled={p.aguardandoCliente} onPress={() => void acao('/situacao', { situacao: proxima })} /> : null}
          {p.aguardandoCliente ? <Text style={[estilos.detalhe, { color: cores.aviso }]}>A próxima etapa espera a resposta do cliente.</Text> : null}
          {p.situacao !== 'NOVO' ? <Botao titulo="Imprimir a folha de lançamento" variante="secundario" ocupado={ocupado} onPress={() => void acao('/folha/imprimir', undefined, 'Folha enviada para a impressora. Acompanhe no Histórico de impressão.')} /> : null}
          <Botao titulo="Cancelar pedido" variante="perigo" onPress={() => setCancelando(true)} />
        </View>
      ) : null}
      {cancelando ? (
        <View style={estilos.cartao}>
          <Text style={estilos.nome}>Cancelar o pedido nº {p.numero}?</Text>
          <Text style={estilos.detalhe}>O cliente vê o motivo no acompanhamento.</Text>
          <TextInput accessibilityLabel="Motivo do cancelamento" style={estilos.campo} value={motivo} onChangeText={setMotivo} placeholder="Ex.: produto em falta" maxLength={300} />
          <Botao titulo="Cancelar o pedido" variante="perigo" ocupado={ocupado} onPress={() => void acao('/situacao', { situacao: 'CANCELADO', motivo }).then((ok) => ok && setCancelando(false))} />
          <View style={{ height: 8 }} />
          <Botao titulo="Voltar" variante="secundario" onPress={() => setCancelando(false)} />
        </View>
      ) : null}

      <View style={estilos.cartao}>
        <Text style={estilos.nome}>{p.clienteNome}</Text>
        {p.clienteTelefone ? (
          <>
            <Text style={estilos.detalhe}>{formatarCelular(p.clienteTelefone)}</Text>
            <Botao titulo="Conversar no WhatsApp" variante="secundario" onPress={() => void Linking.openURL(linkWhatsApp(p.clienteTelefone, mensagemWhatsApp('contato', p, p.empresa, link)))} />
          </>
        ) : null}
      </View>

      <View style={estilos.cartao}>
        <Text style={estilos.nome}>{TITULO_MODALIDADE[p.modalidade]}</Text>
        {p.agendamento ? <Text style={estilos.detalhe}>{textoFaixa(p.agendamento)}</Text> : null}
        {p.modalidade !== 'RETIRADA' && p.endereco ? (
          <>
            <Text style={estilos.detalhe}>{textoEndereco(p.endereco)}</Text>
            {p.endereco.localizacao ? (
              <Text style={estilos.detalhe}>
                📍 O cliente enviou a localização{p.endereco.localizacao.precisaoMetros > PRECISAO_BOA_METROS ? `, mas aproximada (cerca de ${p.endereco.localizacao.precisaoMetros} m): confira com o endereço.` : '.'}
              </Text>
            ) : null}
            <Text accessibilityRole="link" style={estilos.link} onPress={() => void Linking.openURL(linkMapa(p.endereco!))}>Abrir no mapa</Text>
          </>
        ) : null}
        <Text style={estilos.detalhe}>
          {TITULO_PAGAMENTO[p.pagamento]}
          {p.trocoParaCentavos !== null ? ` · troco para ${formatarCentavos(p.trocoParaCentavos)}${p.totais.trocoCentavos !== null ? `: levar ${formatarCentavos(p.totais.trocoCentavos)}` : ' (não cobre o total)'}` : ''}
        </Text>
        {p.observacao ? <Text style={estilos.detalhe}>Obs.: {p.observacao}</Text> : null}
      </View>

      <View style={estilos.cartao}>
        {p.itens.map((i) => (
          <View key={i.codigo} style={estilos.cabeca}>
            <Text style={[estilos.detalhe, { flexShrink: 1, color: cores.texto }]}>{i.quantidade}× {i.nome}</Text>
            <Text style={[estilos.detalhe, { color: cores.texto }]}>{formatarCentavos(i.quantidade * i.precoCentavos)}</Text>
          </View>
        ))}
        <View style={[estilos.cabeca, { borderTopWidth: 1, borderTopColor: cores.borda, paddingTop: 6 }]}>
          <Text style={estilos.detalhe}>Entrega</Text>
          <Text style={estilos.detalhe}>{formatarCentavos(p.totais.taxaCentavos)}</Text>
        </View>
        {p.totais.descontoCentavos ? (
          <View style={estilos.cabeca}>
            <Text style={estilos.detalhe}>Desconto</Text>
            <Text style={estilos.detalhe}>-{formatarCentavos(p.totais.descontoCentavos)}</Text>
          </View>
        ) : null}
        <View style={estilos.cabeca}>
          <Text style={estilos.nome}>Total</Text>
          <Text style={estilos.nome}>{formatarCentavos(p.totais.totalCentavos)}</Text>
        </View>
      </View>
      {aberto && podeGerenciar ? <Text style={estilos.detalhe}>Para mudar produtos, entrega ou valores com o aceite do cliente, use “Propor alteração” no site.</Text> : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 32 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 12 },
  vazio: { textAlign: 'center', color: cores.suave, fontSize: 16, marginTop: 24 },
  voltar: { color: cores.azul, fontSize: 16, fontWeight: '600', paddingVertical: 6, marginBottom: 4 },
  cartao: { backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 12, marginBottom: 8 },
  cabeca: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  nome: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: cores.texto, marginBottom: 4 },
  situacao: { fontSize: 13, fontWeight: '700' },
  detalhe: { fontSize: 14, color: cores.suave, marginBottom: 6 },
  link: { color: cores.azul, fontSize: 14, fontWeight: '600', paddingVertical: 4, marginBottom: 4 },
  linha: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filtro: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: cores.borda, borderRadius: 20, backgroundColor: cores.branco },
  filtroAtivo: { borderColor: cores.azul, backgroundColor: cores.azulClaro },
  campo: { minHeight: 48, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, color: cores.texto, backgroundColor: cores.branco, marginBottom: 8 },
});
