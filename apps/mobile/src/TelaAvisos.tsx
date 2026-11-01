import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NotificacaoResumo } from '../../../packages/shared/src/notificacoes';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import { tempoDesde } from './regras';
import { Alerta, Botao, cores } from './ui';

const COR_NIVEL = { info: cores.azul, aviso: '#d97706', erro: cores.erro };
const NOME_NIVEL = { info: 'Informação', aviso: 'Atenção', erro: 'Problema' };

export function TelaAvisos(props: {
  usuario: UsuarioLogado;
  avisos: NotificacaoResumo[];
  erro: string | null;
  carregando: boolean;
  avisosNoCelular: boolean;
  atualizar: () => void;
  marcarLida: (id: string) => void;
  marcarTodas: () => void;
  desvincular: () => void;
}) {
  const { usuario, avisos, erro, carregando, avisosNoCelular, atualizar, marcarLida, marcarTodas, desvincular } = props;
  const podeVer = usuario.superAdmin || usuario.permissoes.includes('notificacao.ver');
  const naoLidas = avisos.filter((a) => !a.lidaEm && !a.resolvidaEm).length;

  return (
    <FlatList
      style={{ backgroundColor: cores.fundo }}
      contentContainerStyle={estilos.pagina}
      data={avisos}
      keyExtractor={(a) => a.id}
      refreshControl={<RefreshControl refreshing={carregando} onRefresh={atualizar} />}
      ListHeaderComponent={
        <>
          <Text accessibilityRole="header" style={estilos.titulo}>Avisos</Text>
          <Text style={estilos.sub}>{naoLidas ? `${naoLidas} sem ler` : 'Tudo lido'}</Text>
          {!podeVer ? <Alerta tipo="aviso">Seu perfil não recebe avisos. Fale com o administrador da empresa.</Alerta> : null}
          {podeVer && !avisosNoCelular ? <Alerta tipo="aviso">Com o aplicativo fechado, os avisos ainda não chegam a este celular. Com ele aberto, chegam normalmente.</Alerta> : null}
          {erro ? <Alerta>{erro}</Alerta> : null}
          {naoLidas > 1 && <Text accessibilityRole="button" style={estilos.link} onPress={marcarTodas}>Marcar todos como lidos</Text>}
        </>
      }
      ListEmptyComponent={!carregando && podeVer ? <Text style={estilos.vazio}>Nenhum aviso.</Text> : undefined}
      renderItem={({ item: a }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${a.titulo}. ${a.mensagem}`} onPress={() => !a.lidaEm && marcarLida(a.id)} style={[estilos.aviso, !a.lidaEm && !a.resolvidaEm && estilos.naoLido]}>
          <View style={estilos.cabeca}>
            <Text style={[estilos.nivel, { color: COR_NIVEL[a.nivel] }]}>{NOME_NIVEL[a.nivel]}</Text>
            <Text style={estilos.quando}>{tempoDesde(a.ultimoEnvioEm)}</Text>
          </View>
          <Text style={estilos.avisoTitulo}>{a.titulo}</Text>
          <Text style={estilos.mensagem}>{a.mensagem}</Text>
          {a.resolvidaEm ? <Text style={estilos.resolvido}>Resolvido</Text> : null}
        </Pressable>
      )}
      ListFooterComponent={
        <View style={{ marginTop: 32 }}>
          <Botao titulo="Desvincular este celular" variante="perigo" onPress={desvincular} />
        </View>
      }
    />
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 32 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 12 },
  link: { color: cores.azul, fontSize: 14, fontWeight: '600', paddingVertical: 8, marginBottom: 4 },
  vazio: { textAlign: 'center', color: cores.suave, fontSize: 16, marginTop: 32 },
  aviso: { backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 12, marginBottom: 8 },
  naoLido: { borderLeftWidth: 4, borderLeftColor: cores.azul },
  cabeca: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  nivel: { fontSize: 12, fontWeight: '700' },
  quando: { fontSize: 12, color: cores.suave },
  avisoTitulo: { fontSize: 15, fontWeight: '600', color: cores.texto },
  mensagem: { fontSize: 14, color: cores.texto, marginTop: 2, lineHeight: 20 },
  resolvido: { fontSize: 12, color: cores.ok, fontWeight: '600', marginTop: 4 },
});
