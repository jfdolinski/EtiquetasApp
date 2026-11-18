import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ExtratoEntregador, LinhaExtrato, PeriodoExtrato } from '../../../packages/shared/src/entregas-fechamento';
import type { Api } from './api';
import { dataCurta, formatarCentavos, formatarKm, ROTULO_TIPO_CHAMADA } from './regras';
import { Alerta, Botao, Campo, cores, Numero, Texto, Titulo } from './ui';

const PERIODOS: { id: PeriodoExtrato; rotulo: string }[] = [
  { id: 'HOJE', rotulo: 'Hoje' },
  { id: 'SEMANA', rotulo: '7 dias' },
  { id: 'MES', rotulo: '30 dias' },
  { id: 'TUDO', rotulo: 'Tudo' },
];

const dataIso = (aaaaMmDd: string) => aaaaMmDd.split('-').reverse().join('/');

/** Extrato: o que fez no período, o que cada empresa já pagou e o que falta, com contestação por linha. */
export function TelaGanhos({ api, servidor }: { api: Api; servidor: string }) {
  const [periodo, setPeriodo] = useState<PeriodoExtrato>('SEMANA');
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [dados, setDados] = useState<ExtratoEntregador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  /** O PDF abre no navegador do celular por um link de uso único (2 min), sem levar o token. */
  async function baixarPdf() {
    setBaixando(true);
    try {
      const { caminho } = await api<{ caminho: string }>(`/entregador/extrato/link?periodo=${periodo}`, { metodo: 'POST' });
      await Linking.openURL(`${servidor}/api${caminho}`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBaixando(false);
    }
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await api<ExtratoEntregador>(`/entregador/extrato?periodo=${periodo}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api, periodo]);
  useEffect(() => void carregar(), [carregar]);

  const linhas = (dados?.linhas ?? []).filter((l) => !empresa || l.empresa === empresa);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}>
      <View style={estilos.chips}>
        {PERIODOS.map((p) => (
          <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: periodo === p.id }} onPress={() => setPeriodo(p.id)} style={[estilos.chip, periodo === p.id && estilos.chipAtivo]}>
            <Text style={{ color: periodo === p.id ? cores.branco : cores.texto }}>{p.rotulo}</Text>
          </Pressable>
        ))}
      </View>
      {erro && <Alerta>{erro}</Alerta>}
      {dados && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <Numero rotulo="Feito no período" valor={formatarCentavos(dados.periodoCentavos)} />
            <Numero rotulo="Recebido no período" valor={formatarCentavos(dados.pagoCentavos)} />
            <Numero rotulo="A receber (total)" valor={formatarCentavos(dados.aReceberCentavos)} detalhe="Cada empresa paga direto a você, pelo Pix do seu perfil." />
          </View>
          {dados.empresas.length > 1 && (
            <View style={estilos.chips}>
              {[null, ...dados.empresas].map((e) => (
                <Pressable key={e ?? 'todas'} accessibilityRole="button" onPress={() => setEmpresa(e)} style={[estilos.chip, empresa === e && estilos.chipAtivo]}>
                  <Text style={{ color: empresa === e ? cores.branco : cores.texto }}>{e ?? 'Todas as empresas'}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Botao titulo="Baixar comprovante (PDF)" variante="secundario" onPress={() => void baixarPdf()} ocupado={baixando} />
          <Titulo>Entregas concluídas</Titulo>
          {linhas.length === 0 && <Texto suave>Nenhuma no período.</Texto>}
          {linhas.map((l) => (
            <Linha key={l.chamadaId} l={l} api={api} servidor={servidor} aberta={aberta === l.chamadaId} alternar={() => setAberta(aberta === l.chamadaId ? null : l.chamadaId)} aoContestar={() => void carregar()} />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Linha({ l, api, servidor, aberta, alternar, aoContestar }: { l: LinhaExtrato; api: Api; servidor: string; aberta: boolean; alternar: () => void; aoContestar: () => void }) {
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const total = l.valorCentavos + l.extraCentavos;

  async function comprovante() {
    setErro(null);
    try {
      const { caminho } = await api<{ caminho: string }>(`/entregador/pagamentos/${l.fechamentoId}/link`, { metodo: 'POST' });
      await Linking.openURL(`${servidor}/api${caminho}`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function contestar() {
    setErro(null);
    setOcupado(true);
    try {
      await api(`/entregador/chamadas/${l.chamadaId}/contestar`, { metodo: 'POST', corpo: { mensagem } });
      setMensagem('');
      aoContestar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <View style={estilos.linha}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Chamada ${l.numero} de ${l.empresa}`} onPress={alternar} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: cores.texto }}>
            {ROTULO_TIPO_CHAMADA[l.tipo]} · {l.empresa}
          </Text>
          <Text style={{ color: cores.suave, fontSize: 12 }}>
            {dataCurta(l.concluidaEm)} · {formatarKm(l.metros)} · nº {l.numero}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontWeight: '700', color: l.situacao === 'PAGO' ? cores.ok : cores.texto }}>{formatarCentavos(total)}</Text>
          <Text style={{ fontSize: 12, color: l.situacao === 'PAGO' ? cores.ok : cores.aviso }}>{l.situacao === 'PAGO' ? `Pago em ${dataIso(l.pagoEm!)}` : 'A receber'}</Text>
          {l.contestacao && !l.contestacao.respondidaEm && <Text style={{ fontSize: 12, color: cores.erro }}>Contestada</Text>}
        </View>
      </Pressable>
      {aberta && (
        <View style={{ marginTop: 8, gap: 6 }}>
          <Texto suave>Valor aceito: {formatarCentavos(l.valorCentavos)}</Texto>
          {l.extraCentavos > 0 && (
            <Texto suave>
              Extra: {formatarCentavos(l.extraCentavos)} ({l.extraMotivo})
            </Texto>
          )}
          {l.cancelada && <Texto suave>Cancelada depois do aceite: você recebe a taxa de deslocamento.</Texto>}
          {l.fechamentoId && <Botao titulo="Comprovante do pagamento (PDF)" variante="secundario" onPress={() => void comprovante()} />}
          {!l.podeContestar && erro && <Alerta>{erro}</Alerta>}
          {l.contestacao && (
            <View style={{ backgroundColor: cores.azulClaro, borderRadius: 8, padding: 8, gap: 4 }}>
              <Text style={{ color: cores.texto }}>Sua contestação: {l.contestacao.mensagem}</Text>
              <Text style={{ color: cores.suave }}>{l.contestacao.resposta ? `Resposta da empresa: ${l.contestacao.resposta}` : 'Esperando resposta da empresa.'}</Text>
            </View>
          )}
          {l.podeContestar && (
            <>
              <Campo rotulo="Algo errado? Explique para a empresa" value={mensagem} onChangeText={setMensagem} multiline placeholder="Ex.: esperei 30 min no cliente; não recebi o pagamento" />
              {erro && <Alerta>{erro}</Alerta>}
              <Botao titulo="Enviar contestação" variante="secundario" onPress={() => void contestar()} ocupado={ocupado} disabled={mensagem.trim().length < 5} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.branco },
  chipAtivo: { backgroundColor: cores.azul, borderColor: cores.azul },
  linha: { paddingVertical: 10, borderBottomWidth: 1, borderColor: cores.borda },
});
