import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PerfilEntregador } from '../../../packages/shared/src/entregas';
import type { Api } from './api';
import { formatarCelular, ROTULO_DOCUMENTO, ROTULO_SITUACAO_ENTREGADOR, ROTULO_VEICULO } from './regras';
import { Alerta, Botao, Campo, Cartao, cores, Texto } from './ui';

export function TelaPerfil({ api, perfil, aoMudar, sair, versao }: { api: Api; perfil: PerfilEntregador; aoMudar: (p: PerfilEntregador) => void; sair: () => void; versao: string }) {
  const [celular, setCelular] = useState(formatarCelular(perfil.celular));
  const [chavePix, setChavePix] = useState(perfil.chavePix);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvo(false);
    setOcupado(true);
    try {
      aoMudar(await api<PerfilEntregador>('/entregador/dados', { metodo: 'PUT', corpo: { celular, chavePix } }));
      setSalvo(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Cartao>
        <Text style={estilos.nome}>{perfil.nome}</Text>
        <Linha rotulo="CPF" valor={perfil.cpf} />
        <Linha rotulo="E-mail" valor={perfil.email} />
        <Linha rotulo="Veículo" valor={`${ROTULO_VEICULO[perfil.veiculo]}${perfil.placa ? ` · ${perfil.placa}` : ''}`} />
        <Linha rotulo="Situação" valor={ROTULO_SITUACAO_ENTREGADOR[perfil.situacao]} />
        <Linha rotulo="Documentos" valor={perfil.documentos.map((d) => ROTULO_DOCUMENTO[d.tipo]).join(', ') || 'Nenhum'} />
      </Cartao>
      <Campo rotulo="Celular" value={celular} onChangeText={setCelular} keyboardType="phone-pad" />
      <Campo rotulo="Chave Pix para receber das empresas" value={chavePix} onChangeText={setChavePix} autoCapitalize="none" />
      {erro && <Alerta>{erro}</Alerta>}
      {salvo && <Alerta tipo="ok">Dados salvos.</Alerta>}
      <View style={{ gap: 10 }}>
        <Botao titulo="Salvar" onPress={() => void salvar()} ocupado={ocupado} />
        <Botao titulo="Sair" variante="perigo" onPress={sair} />
      </View>
      <Texto suave>Para trocar o veículo ou um documento depois da aprovação, fale com o suporte.</Texto>
      <Text style={{ color: cores.suave, fontSize: 12, textAlign: 'center', marginTop: 16 }}>Flow Entregas {versao}</Text>
    </ScrollView>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={estilos.linha}>
      <Text style={{ color: cores.suave }}>{rotulo}</Text>
      <Text style={{ color: cores.texto, flexShrink: 1, textAlign: 'right' }}>{valor}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  nome: { fontSize: 18, fontWeight: '700', color: cores.texto, marginBottom: 8 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
});
