import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PainelEmpresa } from '../../../packages/shared/src/painel';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import type { Api } from './api';
import { tempoDesde } from './regras';
import { Alerta, Cartao, Numero, cores } from './ui';

export function TelaInicio({ api, usuario, irParaLista }: { api: Api; usuario: UsuarioLogado; irParaLista: () => void }) {
  const podeVer = usuario.superAdmin || usuario.permissoes.includes('painel.ver');
  const [painel, setPainel] = useState<PainelEmpresa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!podeVer) return setCarregando(false);
    setCarregando(true);
    try {
      setPainel(await api<PainelEmpresa>('/painel?dias=7'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [api, podeVer]);

  useEffect(() => void carregar(), [carregar]);

  const p = painel;
  return (
    <ScrollView style={{ backgroundColor: cores.fundo }} contentContainerStyle={estilos.pagina} refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void carregar()} />}>
      <Text accessibilityRole="header" style={estilos.titulo}>Olá, {usuario.nome.split(' ')[0]}</Text>
      {usuario.empresa ? <Text style={estilos.sub}>{usuario.empresa.nomeFantasia || usuario.empresa.razaoSocial}</Text> : null}
      {erro ? <Alerta>{erro}</Alerta> : null}
      {!podeVer ? <Alerta tipo="aviso">Seu perfil não tem acesso ao painel. Fale com o administrador da empresa.</Alerta> : null}

      {p && (
        <>
          <Text style={estilos.secao}>Hoje</Text>
          <View style={estilos.grade}>
            <Numero rotulo="Etiquetas hoje" valor={p.impressao.etiquetasHoje} />
            <Numero rotulo="Lista pendente" valor={p.listaHoje.pendentes} detalhe={`${p.listaHoje.impressos} impressos`} alerta={p.listaHoje.pendentes > 0} />
            <Numero rotulo="Na fila" valor={p.impressao.trabalhosPendentes} detalhe={`${p.impressao.etiquetasPendentes} etiquetas`} />
            <Numero rotulo="Com erro" valor={p.impressao.trabalhosComErro} alerta={p.impressao.trabalhosComErro > 0} />
          </View>
          {p.listaHoje.pendentes > 0 && (
            <Text accessibilityRole="link" onPress={irParaLista} style={estilos.link}>Ver a lista do dia</Text>
          )}

          <Text style={estilos.secao}>Situação</Text>
          <View style={estilos.grade}>
            <Numero rotulo="Agentes online" valor={p.agentes.online} detalhe={`${p.agentes.offline} fora do ar`} alerta={p.agentes.offline > 0} />
            <Numero rotulo="Última etiqueta" valor={tempoDesde(p.uso.ultimaEm)} detalhe={p.uso.ultimoModelo ?? undefined} />
            <Numero rotulo="Avisos abertos" valor={p.notificacoesAbertas} alerta={p.notificacoesAbertas > 0} />
            <Numero rotulo="Etiquetas em 7 dias" valor={p.impressao.etiquetasConcluidas} />
          </View>

          {p.agentes.lista.length > 0 && (
            <>
              <Text style={estilos.secao}>Agentes</Text>
              <Cartao>
                {p.agentes.lista.map((a) => (
                  <View key={a.id} style={estilos.linha}>
                    <Text style={estilos.linhaNome} numberOfLines={1}>{a.nome}</Text>
                    <Text style={{ color: a.online ? cores.ok : cores.erro, fontWeight: '600' }}>{a.online ? 'Online' : `Fora ${tempoDesde(a.ultimoContatoEm)}`}</Text>
                  </View>
                ))}
              </Cartao>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 32 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 8 },
  secao: { fontSize: 15, fontWeight: '600', color: cores.texto, marginTop: 16, marginBottom: 8 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  link: { color: cores.azul, fontSize: 15, fontWeight: '600', marginTop: 10, paddingVertical: 6 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  linhaNome: { flex: 1, fontSize: 15, color: cores.texto },
});
