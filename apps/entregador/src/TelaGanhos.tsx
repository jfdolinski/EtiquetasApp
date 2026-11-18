import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { GanhosEntregador } from '../../../packages/shared/src/entregas-chamadas';
import type { Api } from './api';
import { dataCurta, formatarCentavos, formatarKm, ROTULO_TIPO_CHAMADA } from './regras';
import { Alerta, cores, Numero, Texto, Titulo } from './ui';

/** Histórico das entregas concluídas e o que ele tem a receber das empresas. */
export function TelaGanhos({ api }: { api: Api }) {
  const [dados, setDados] = useState<GanhosEntregador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await api<GanhosEntregador>('/entregador/ganhos'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api]);
  useEffect(() => void carregar(), [carregar]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}>
      {erro && <Alerta>{erro}</Alerta>}
      {dados && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <Numero rotulo="Hoje" valor={formatarCentavos(dados.hojeCentavos)} />
            <Numero rotulo="Últimos 7 dias" valor={formatarCentavos(dados.semanaCentavos)} />
            <Numero rotulo="A receber das empresas" valor={formatarCentavos(dados.aReceberCentavos)} detalhe="Cada empresa paga direto a você." />
          </View>
          <Titulo>Entregas concluídas</Titulo>
          {dados.chamadas.length === 0 && <Texto suave>Nenhuma ainda.</Texto>}
          {dados.chamadas.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: cores.borda, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: cores.texto }}>
                  {ROTULO_TIPO_CHAMADA[c.tipo]} · {c.empresa}
                </Text>
                <Text style={{ color: cores.suave, fontSize: 12 }}>
                  {c.concluidaEm ? dataCurta(c.concluidaEm) : ''} · {formatarKm(c.metros)}
                </Text>
              </View>
              <Text style={{ fontWeight: '700', color: cores.ok }}>{formatarCentavos(c.valorCentavos)}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
