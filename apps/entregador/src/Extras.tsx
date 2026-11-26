import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { MetaParaEntregador } from '../../../packages/shared/src/entregas-metas';
import type { CategoriaSuporte, ChamadoSuporteDetalhe, ChamadoSuporteResumo } from '../../../packages/shared/src/suporte';
import type { Api } from './api';
import { escolherImagem } from './imagens';
import { CATEGORIAS_SUPORTE, formatarCentavos, problemaNoChamado, ROTULO_CATEGORIA_SUPORTE, ROTULO_SITUACAO_META, ROTULO_SITUACAO_SUPORTE } from './regras';
import { Alerta, Botao, Campo, Cartao, cores, Texto, Titulo } from './ui';

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Metas das empresas: concluir N chamadas no período (e no horário, se houver) rende o bônus. */
export function TelaMetas({ api, aoFechar }: { api: Api; aoFechar: () => void }) {
  const [lista, setLista] = useState<MetaParaEntregador[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try {
      setLista(await api<MetaParaEntregador[]>('/entregador/metas'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api]);
  useEffect(() => void carregar(), [carregar]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} />}>
      <Botao titulo="Voltar" variante="secundario" onPress={aoFechar} />
      <Titulo>Metas e bônus</Titulo>
      <Texto suave>Conclua o número de chamadas da empresa no período para ganhar o bônus. Contam só as chamadas concluídas daquela empresa, no horário da meta. Quando a meta acaba, o bônus entra no seu a receber e a empresa paga junto com as chamadas.</Texto>
      {erro && <Alerta>{erro}</Alerta>}
      {lista && !lista.length && <Texto suave>Nenhuma meta aberta perto de você agora.</Texto>}
      {lista?.map((m) => (
        <Cartao key={m.id}>
          <View accessibilityLabel={`Meta ${m.nome} de ${m.empresa}`} style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: cores.texto }}>
              {m.empresa}: {m.nome}
            </Text>
            <Text style={{ color: cores.texto }}>
              {m.minimoChamadas} chamadas = {formatarCentavos(m.valorCentavos)} de bônus
            </Text>
            <Texto suave>
              De {dia(m.inicio)} a {dia(m.fim)}, {m.faixa} · {ROTULO_SITUACAO_META[m.situacao]}
            </Texto>
            <View style={{ height: 8, backgroundColor: cores.borda, borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
              <View style={{ height: 8, width: `${Math.min(100, (m.feitas / m.minimoChamadas) * 100)}%`, backgroundColor: m.atingida ? cores.ok : cores.azul }} />
            </View>
            <Text style={{ color: m.atingida ? cores.ok : cores.texto, fontWeight: m.atingida ? '700' : '400' }} accessibilityLabel={`${m.feitas} de ${m.minimoChamadas} chamadas`}>
              {m.ganhou ? `Você ganhou o bônus de ${formatarCentavos(m.valorCentavos)}: está no Extrato.` : m.atingida ? (m.situacao === 'ENCERRADA' ? 'Você chegou lá: o bônus entra no Extrato em instantes.' : `Você chegou lá: ${m.feitas} de ${m.minimoChamadas}. O bônus entra quando a meta acabar.`) : `${m.feitas} de ${m.minimoChamadas} chamadas${m.situacao === 'ENCERRADA' ? ' (não deu desta vez)' : ''}`}
            </Text>
          </View>
        </Cartao>
      ))}
    </ScrollView>
  );
}

/** Suporte da plataforma: o entregador abre um chamado e conversa até resolver. */
export function TelaSuporte({ api, aoFechar, aoLer }: { api: Api; aoFechar: () => void; aoLer: () => void }) {
  const [lista, setLista] = useState<ChamadoSuporteResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const carregar = useCallback(async () => {
    try {
      setLista(await api<ChamadoSuporteResumo[]>('/entregador/suporte'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api]);
  useEffect(() => void carregar(), [carregar]);

  if (aberto)
    return (
      <ConversaSuporte
        api={api}
        id={aberto}
        aoVoltar={() => {
          setAberto(null);
          aoLer();
          void carregar();
        }}
      />
    );
  if (novo) return <NovoChamado api={api} aoVoltar={() => setNovo(false)} aoAbrir={(id) => { setNovo(false); setAberto(id); void carregar(); }} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} />}>
      <Botao titulo="Voltar" variante="secundario" onPress={aoFechar} />
      <Titulo>Suporte do Flow</Titulo>
      <Texto suave>Problema no app, nas diárias, no cadastro ou numa entrega? Fale com o suporte da plataforma. A resposta aparece aqui e chega no seu e-mail. Para falar com a empresa de uma chamada, use a conversa da própria chamada.</Texto>
      <Botao titulo="Abrir um chamado" onPress={() => setNovo(true)} />
      {erro && <Alerta>{erro}</Alerta>}
      {lista && !lista.length && <Texto suave>Você ainda não abriu nenhum chamado.</Texto>}
      {lista?.map((c) => (
        <Pressable key={c.id} onPress={() => setAberto(c.id)} accessibilityRole="button" accessibilityLabel={`Chamado ${c.numero}: ${c.assunto}`}>
          <Cartao>
            <View style={{ gap: 2 }}>
              <Text style={{ fontWeight: '700', color: cores.texto }}>
                Nº {c.numero}: {c.assunto}
              </Text>
              <Texto suave>
                {ROTULO_SITUACAO_SUPORTE[c.situacao]} · {quando(c.atualizadoEm)}
              </Texto>
              {c.naoLidas > 0 && <Text style={{ color: cores.azul, fontWeight: '700' }}>{c.naoLidas === 1 ? '1 resposta nova' : `${c.naoLidas} respostas novas`}</Text>}
            </View>
          </Cartao>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function AnexarImagem({ valor, mudar }: { valor: string | null; mudar: (v: string | null) => void }) {
  const [erro, setErro] = useState<string | null>(null);
  async function escolher() {
    setErro(null);
    try {
      const img = await escolherImagem('galeria');
      if (img) mudar(img);
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  return (
    <View style={{ gap: 6 }}>
      {valor ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={{ uri: valor }} style={{ width: 56, height: 56, borderRadius: 6 }} accessibilityLabel="Imagem anexada" />
          <Botao titulo="Tirar a imagem" variante="secundario" onPress={() => mudar(null)} />
        </View>
      ) : (
        <Botao titulo="Anexar um print da tela" variante="secundario" onPress={() => void escolher()} />
      )}
      {erro && <Alerta>{erro}</Alerta>}
    </View>
  );
}

function NovoChamado({ api, aoVoltar, aoAbrir }: { api: Api; aoVoltar: () => void; aoAbrir: (id: string) => void }) {
  const [categoria, setCategoria] = useState<CategoriaSuporte>('APP');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [imagem, setImagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const problema = problemaNoChamado({ categoria, assunto, texto });

  async function enviar() {
    setOcupado(true);
    setErro(null);
    try {
      const c = await api<ChamadoSuporteDetalhe>('/entregador/suporte', { metodo: 'POST', corpo: { categoria, assunto, texto, imagem } });
      aoAbrir(c.id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }} keyboardShouldPersistTaps="handled">
      <Botao titulo="Voltar" variante="secundario" onPress={aoVoltar} />
      <Titulo>Novo chamado</Titulo>
      <Text style={{ fontWeight: '600', color: cores.texto }}>Sobre o quê?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CATEGORIAS_SUPORTE.map((c) => (
          <Pressable key={c} onPress={() => setCategoria(c)} accessibilityRole="radio" accessibilityState={{ selected: categoria === c }} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: categoria === c ? cores.azul : cores.borda, backgroundColor: categoria === c ? cores.azul : cores.branco }}>
            <Text style={{ color: categoria === c ? cores.branco : cores.texto }}>{ROTULO_CATEGORIA_SUPORTE[c]}</Text>
          </Pressable>
        ))}
      </View>
      <Campo rotulo="Título" value={assunto} onChangeText={setAssunto} maxLength={120} placeholder="Ex.: Paguei as diárias e não caiu" />
      <Campo rotulo="O que aconteceu" value={texto} onChangeText={setTexto} maxLength={2000} multiline numberOfLines={5} style={{ minHeight: 110, textAlignVertical: 'top', borderWidth: 1, borderColor: cores.borda, borderRadius: 8, padding: 10, color: cores.texto, backgroundColor: cores.branco }} />
      <AnexarImagem valor={imagem} mudar={setImagem} />
      {(assunto || texto) && problema ? <Alerta tipo="aviso">{problema}</Alerta> : null}
      {erro && <Alerta>{erro}</Alerta>}
      <Botao titulo="Enviar ao suporte" onPress={() => void enviar()} disabled={!!problema} ocupado={ocupado} />
    </ScrollView>
  );
}

function ImagemDaMensagem({ api, chamado, mensagem }: { api: Api; chamado: string; mensagem: string }) {
  const [dados, setDados] = useState<string | null>(null);
  useEffect(() => {
    void api<{ dados: string }>(`/entregador/suporte/${chamado}/imagens/${mensagem}`)
      .then((r) => setDados(r.dados))
      .catch(() => undefined);
  }, [api, chamado, mensagem]);
  return dados ? <Image source={{ uri: dados }} style={{ width: 180, height: 180, borderRadius: 6, marginTop: 4 }} resizeMode="contain" accessibilityLabel="Imagem anexada" /> : <Texto suave>Carregando a imagem…</Texto>;
}

function ConversaSuporte({ api, id, aoVoltar }: { api: Api; id: string; aoVoltar: () => void }) {
  const [c, setC] = useState<ChamadoSuporteDetalhe | null>(null);
  const [texto, setTexto] = useState('');
  const [imagem, setImagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    try {
      setC(await api<ChamadoSuporteDetalhe>(`/entregador/suporte/${id}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [api, id]);
  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function enviar(caminho: 'mensagens' | 'resolver') {
    setOcupado(true);
    setErro(null);
    try {
      setC(await api<ChamadoSuporteDetalhe>(`/entregador/suporte/${id}/${caminho}`, { metodo: 'POST', corpo: caminho === 'mensagens' ? { texto, imagem } : undefined }));
      if (caminho === 'mensagens') {
        setTexto('');
        setImagem(null);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} />}>
      <Botao titulo="Voltar" variante="secundario" onPress={aoVoltar} />
      {erro && <Alerta>{erro}</Alerta>}
      {c && (
        <>
          <Titulo>
            Nº {c.numero}: {c.assunto}
          </Titulo>
          <Texto suave>
            {ROTULO_CATEGORIA_SUPORTE[c.categoria]} · {ROTULO_SITUACAO_SUPORTE[c.situacao]}
          </Texto>
          {c.mensagens.map((m) => (
            <View key={m.id} style={{ alignSelf: m.deSuporte ? 'flex-start' : 'flex-end', maxWidth: '88%', backgroundColor: m.deSuporte ? cores.branco : '#fff1e6', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: cores.borda }} accessibilityLabel={`${m.autor}: ${m.texto}`}>
              <Text style={{ fontSize: 12, color: cores.suave }}>
                {m.autor} · {quando(m.criadoEm)}
              </Text>
              <Text style={{ color: cores.texto }}>{m.texto}</Text>
              {m.temImagem && <ImagemDaMensagem api={api} chamado={c.id} mensagem={m.id} />}
            </View>
          ))}
          <Campo rotulo={c.situacao === 'RESOLVIDO' ? 'Escrever de novo reabre o chamado' : 'Responder'} value={texto} onChangeText={setTexto} maxLength={2000} multiline style={{ minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: cores.borda, borderRadius: 8, padding: 10, color: cores.texto, backgroundColor: cores.branco }} />
          <AnexarImagem valor={imagem} mudar={setImagem} />
          <Botao titulo="Enviar" onPress={() => void enviar('mensagens')} disabled={texto.trim().length < 5} ocupado={ocupado} />
          {c.situacao !== 'RESOLVIDO' && <Botao titulo="Meu problema foi resolvido" variante="secundario" onPress={() => void enviar('resolver')} ocupado={ocupado} />}
        </>
      )}
    </ScrollView>
  );
}
