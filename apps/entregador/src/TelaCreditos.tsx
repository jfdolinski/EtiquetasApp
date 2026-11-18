import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { CreditosEntregador, PedidoCreditoResumo } from '../../../packages/shared/src/entregas';
import type { Api } from './api';
import { escolherImagem } from './imagens';
import { dataCurta, formatarCentavos, ROTULO_PEDIDO_CREDITO } from './regras';
import { Alerta, Botao, Cartao, cores, Numero, Texto, Titulo } from './ui';

export function TelaCreditos({ api, aoMudarSaldo }: { api: Api; aoMudarSaldo: (saldo: number) => void }) {
  const [dados, setDados] = useState<CreditosEntregador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await api<CreditosEntregador>('/entregador/creditos');
      setDados(d);
      aoMudarSaldo(d.saldo);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api, aoMudarSaldo]);

  useEffect(() => void carregar(), [carregar]);

  async function rodar(chave: string, f: () => Promise<unknown>) {
    setErro(null);
    setOcupado(chave);
    try {
      await f();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function copiar(p: PedidoCreditoResumo) {
    if (!p.pixCopiaECola) return;
    await Clipboard.setStringAsync(p.pixCopiaECola);
    setCopiado(p.id);
  }

  async function informar(p: PedidoCreditoResumo, comComprovante: boolean) {
    let comprovante: string | null = null;
    if (comComprovante) {
      comprovante = await escolherImagem('galeria');
      if (!comprovante) return;
    }
    await api(`/entregador/creditos/pedidos/${p.id}/pagamento`, { metodo: 'POST', corpo: { comprovante } });
  }

  const abertos = dados?.pedidos.filter((p) => p.situacao === 'AGUARDANDO') ?? [];
  const decididos = dados?.pedidos.filter((p) => p.situacao !== 'AGUARDANDO') ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}>
      {erro && <Alerta>{erro}</Alerta>}
      {dados && (
        <>
          <View style={{ flexDirection: 'row', marginBottom: 16 }}>
            <Numero rotulo="Diárias disponíveis" valor={dados.saldo} detalhe="Cada dia em que você fica online usa uma." alerta={dados.saldo === 0} />
          </View>

          {abertos.map((p) => (
            <Cartao key={p.id}>
              <Text style={estilos.pacote}>
                {p.pacote}: {formatarCentavos(p.precoCentavos)}
              </Text>
              {p.pagamentoInformadoEm ? (
                <Alerta tipo="ok">Pagamento informado. As diárias entram assim que a plataforma conferir o Pix.</Alerta>
              ) : (
                <Texto suave>1. Copie o código e pague no aplicativo do seu banco (Pix copia e cola). 2. Volte aqui e toque em "Já paguei".</Texto>
              )}
              {p.pixCopiaECola && (
                <>
                  <Text selectable style={estilos.pix}>
                    {p.pixCopiaECola}
                  </Text>
                  <View style={{ gap: 8 }}>
                    <Botao titulo={copiado === p.id ? 'Código copiado' : 'Copiar código Pix'} variante="secundario" onPress={() => void copiar(p)} />
                    {!p.pagamentoInformadoEm && (
                      <>
                        <Botao titulo="Já paguei" onPress={() => void rodar(`pago-${p.id}`, () => informar(p, false))} ocupado={ocupado === `pago-${p.id}`} />
                        {Platform.OS !== 'web' && <Botao titulo="Já paguei e quero anexar o comprovante" variante="secundario" onPress={() => void rodar(`comp-${p.id}`, () => informar(p, true))} ocupado={ocupado === `comp-${p.id}`} />}
                      </>
                    )}
                    <Botao titulo="Cancelar esta compra" variante="perigo" onPress={() => void rodar(`cancelar-${p.id}`, () => api(`/entregador/creditos/pedidos/${p.id}`, { metodo: 'DELETE' }))} ocupado={ocupado === `cancelar-${p.id}`} />
                  </View>
                </>
              )}
              <Text style={estilos.txid}>Identificador: {p.txid}</Text>
            </Cartao>
          ))}

          <Titulo>Comprar diárias</Titulo>
          {!dados.pixDisponivel && <Alerta tipo="aviso">A compra de diárias ainda não está disponível. Tente mais tarde.</Alerta>}
          {dados.pacotes.length === 0 && <Texto suave>Nenhum pacote à venda no momento.</Texto>}
          {dados.pixDisponivel &&
            dados.pacotes.map((k) => (
              <Pressable key={k.id} accessibilityRole="button" accessibilityLabel={`Comprar ${k.nome}`} disabled={ocupado !== null} onPress={() => void rodar(`pacote-${k.id}`, () => api('/entregador/creditos/pedidos', { metodo: 'POST', corpo: { pacoteId: k.id } }))} style={({ pressed }) => [estilos.pacoteCartao, pressed && { opacity: 0.7 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={estilos.pacote}>{k.nome}</Text>
                  <Text style={{ color: cores.suave }}>
                    {k.diarias} diária{k.diarias === 1 ? '' : 's'} · usar em até {k.validadeDias} dias
                  </Text>
                </View>
                <Text style={estilos.preco}>{ocupado === `pacote-${k.id}` ? '…' : formatarCentavos(k.precoCentavos)}</Text>
              </Pressable>
            ))}

          {decididos.length > 0 && <Titulo>Compras anteriores</Titulo>}
          {decididos.map((p) => (
            <View key={p.id} style={estilos.linha}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: cores.texto }}>
                  {p.pacote} · {formatarCentavos(p.precoCentavos)}
                </Text>
                <Text style={{ color: cores.suave, fontSize: 12 }}>
                  {dataCurta(p.criadoEm)}
                  {p.motivo ? ` · ${p.motivo}` : ''}
                </Text>
              </View>
              <Text style={{ color: p.situacao === 'CONFIRMADO' ? cores.ok : cores.suave, fontWeight: '600' }}>{ROTULO_PEDIDO_CREDITO[p.situacao]}</Text>
            </View>
          ))}

          {dados.extrato.length > 0 && <Titulo>Extrato de diárias</Titulo>}
          {dados.extrato.map((m, i) => (
            <View key={`${m.em}-${i}`} style={estilos.linha}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: cores.texto }}>{m.descricao}</Text>
                <Text style={{ color: cores.suave, fontSize: 12 }}>
                  {dataCurta(m.em)}
                  {m.venceEm ? ` · vale até ${dataCurta(m.venceEm)}` : ''}
                </Text>
              </View>
              <Text style={{ fontWeight: '700', color: m.quantidade > 0 ? cores.ok : cores.texto }}>{m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pacote: { fontSize: 16, fontWeight: '700', color: cores.texto, marginBottom: 4 },
  pacoteCartao: { flexDirection: 'row', alignItems: 'center', backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 14, marginBottom: 10 },
  preco: { fontSize: 18, fontWeight: '800', color: cores.azul },
  pix: { fontFamily: Platform.OS === 'android' ? 'monospace' : undefined, fontSize: 12, color: cores.texto, backgroundColor: cores.fundo, padding: 10, borderRadius: 6, marginVertical: 8 },
  txid: { fontSize: 12, color: cores.suave, marginTop: 8 },
  linha: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: cores.borda, gap: 8 },
});
