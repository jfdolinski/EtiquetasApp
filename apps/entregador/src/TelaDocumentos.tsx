import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PerfilEntregador, TipoDocumentoEntregador } from '../../../packages/shared/src/entregas';
import type { Api } from './api';
import { escolherImagem } from './imagens';
import { ROTULO_DOCUMENTO, ROTULO_SITUACAO_ENTREGADOR, veiculoMotorizado } from './regras';
import { Alerta, Botao, Cartao, cores, Texto, Titulo } from './ui';

const AJUDA: Record<TipoDocumentoEntregador, string> = {
  SELFIE: 'Rosto de frente, sem óculos escuros nem boné, com boa luz.',
  CNH: 'A carteira aberta, com a foto e os dados legíveis.',
  CRLV: 'O documento do veículo com a placa legível.',
};

/** Cadastro em análise: documentos e situação. Volta à tela inicial quando aprovado. */
export function TelaDocumentos({ api, perfil, aoMudar, sair }: { api: Api; perfil: PerfilEntregador; aoMudar: (p: PerfilEntregador) => void; sair: () => void }) {
  const [enviando, setEnviando] = useState<TipoDocumentoEntregador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const tipos: TipoDocumentoEntregador[] = veiculoMotorizado(perfil.veiculo) ? ['SELFIE', 'CNH', 'CRLV'] : ['SELFIE'];
  const podeEnviar = perfil.situacao === 'PENDENTE' || perfil.situacao === 'RECUSADO';

  async function enviar(tipo: TipoDocumentoEntregador, origem: 'camera' | 'galeria') {
    setErro(null);
    try {
      const imagem = await escolherImagem(origem);
      if (!imagem) return;
      setEnviando(tipo);
      aoMudar(await api<PerfilEntregador>(`/entregador/documentos/${tipo}`, { metodo: 'PUT', corpo: { imagem } }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(null);
    }
  }

  async function acao(caminho: string) {
    setErro(null);
    setOcupado(true);
    try {
      aoMudar(await api<PerfilEntregador>(caminho, caminho === '/entregador/eu' ? {} : { metodo: 'POST' }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Titulo>Olá, {perfil.nome.split(' ')[0]}</Titulo>
      {perfil.situacao === 'PENDENTE' && (
        <Alerta tipo={perfil.documentosFaltando.length ? 'aviso' : 'ok'}>
          {perfil.documentosFaltando.length ? 'Envie os documentos abaixo para a análise do seu cadastro.' : 'Documentos enviados. Seu cadastro está em análise; você recebe acesso assim que for aprovado.'}
        </Alerta>
      )}
      {perfil.situacao === 'RECUSADO' && <Alerta>Cadastro recusado{perfil.motivo ? `: ${perfil.motivo}` : '.'} Corrija e envie para análise de novo.</Alerta>}
      {perfil.situacao === 'SUSPENSO' && <Alerta>Cadastro suspenso{perfil.motivo ? `: ${perfil.motivo}` : '.'} Fale com o suporte.</Alerta>}
      <Texto suave>Situação: {ROTULO_SITUACAO_ENTREGADOR[perfil.situacao]}</Texto>

      {tipos.map((t) => {
        const enviado = perfil.documentos.find((d) => d.tipo === t);
        return (
          <Cartao key={t}>
            <View style={estilos.linha}>
              <Text style={estilos.doc}>{ROTULO_DOCUMENTO[t]}</Text>
              <Text style={{ color: enviado ? cores.ok : cores.aviso, fontWeight: '600' }}>{enviado ? 'Enviado' : 'Falta'}</Text>
            </View>
            <Texto suave>{AJUDA[t]}</Texto>
            {podeEnviar && (
              <View style={estilos.botoes}>
                {Platform.OS !== 'web' && (
                  <View style={{ flex: 1 }}>
                    <Botao titulo={enviado ? 'Tirar outra' : 'Tirar foto'} onPress={() => void enviar(t, 'camera')} ocupado={enviando === t} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Botao titulo="Da galeria" variante="secundario" onPress={() => void enviar(t, 'galeria')} disabled={enviando !== null} />
                </View>
              </View>
            )}
          </Cartao>
        );
      })}

      {erro && <Alerta>{erro}</Alerta>}
      <View style={{ gap: 10 }}>
        {perfil.situacao === 'RECUSADO' && <Botao titulo="Enviar para análise de novo" onPress={() => void acao('/entregador/reenviar')} ocupado={ocupado} disabled={perfil.documentosFaltando.length > 0} />}
        <Botao titulo="Atualizar situação" variante="secundario" onPress={() => void acao('/entregador/eu')} ocupado={ocupado} />
        <Botao titulo="Sair" variante="perigo" onPress={sair} />
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  doc: { fontSize: 16, fontWeight: '600', color: cores.texto, flex: 1 },
  botoes: { flexDirection: 'row', gap: 8, marginTop: 6 },
});
