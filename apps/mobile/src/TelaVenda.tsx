import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import type { CatalogoVenda, VendaCriada } from '../../../packages/shared/src/pedidos';
import type { UsuarioLogado } from '../../../packages/shared/src/tipos';
import { ErroApi, guardarVenda, lerVendaGuardada, type Api } from './api';
import { LeitorCodigo } from './LeitorCodigo';
import {
  buscarNoCatalogo,
  carrinhoConferido,
  centavosDoTexto,
  descontoMaximoCentavos,
  formatarCentavos,
  linkWhatsApp,
  mensagemWhatsApp,
  normalizarCelular,
  normalizarCep,
  somarAoCarrinho,
  textoDaMudanca,
  textoFaixa,
  TITULO_MODALIDADE,
  TITULO_PAGAMENTO,
  type ItemCatalogoApp,
  type ItemVendaApp,
  type ModalidadeApp,
  type MudancaApp,
} from './regras';
import { Alerta, Botao, cores } from './ui';

type Pagamento = 'PIX' | 'CARTAO' | 'DINHEIRO';

interface Cliente {
  nome: string;
  telefone: string;
  modalidade: ModalidadeApp | null;
  cep: string;
  rua: string;
  numero: string;
  semNumero: boolean;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** "data|inicio|fim" da faixa escolhida. */
  faixa: string | null;
  pagamento: Pagamento | null;
  troco: string;
  desconto: string;
  observacao: string;
}

interface Rascunho {
  itens: ItemVendaApp[];
  cliente: Cliente;
}

const CLIENTE_VAZIO: Cliente = { nome: '', telefone: '', modalidade: null, cep: '', rua: '', numero: '', semNumero: false, complemento: '', bairro: '', cidade: '', uf: '', faixa: null, pagamento: null, troco: '', desconto: '', observacao: '' };
const RASCUNHO_VAZIO: Rascunho = { itens: [], cliente: CLIENTE_VAZIO };

const chaveFaixa = (f: { data: string; inicio: string; fim: string }) => `${f.data}|${f.inicio}|${f.fim}`;
/** Vazio vale zero; texto que não é número vira -1 e o servidor recusa com a mensagem certa. */
const centavosDoCampo = (t: string) => (t.trim() === '' ? 0 : (centavosDoTexto(t) ?? -1));

/**
 * O vendedor monta o pedido do cliente no celular: busca ou lê o código, ajusta as quantidades, preenche
 * os dados do cliente e lança. Preço, estoque e regras são conferidos de novo no servidor.
 */
export function TelaVenda({ api, usuario, servidor, aoSair }: { api: Api; usuario: UsuarioLogado; servidor: string; aoSair: () => void }) {
  const podeImprimir = usuario.superAdmin || usuario.permissoes.includes('pedido.gerenciar');
  const [catalogo, setCatalogo] = useState<CatalogoVenda | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  const lido = useRef(false);
  const [etapa, setEtapa] = useState<'produtos' | 'cliente' | 'feita'>('produtos');
  const [busca, setBusca] = useState('');
  const [camera, setCamera] = useState(false);
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mudancas, setMudancas] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [feita, setFeita] = useState<{ venda: VendaCriada; nome: string; telefone: string; total: number } | null>(null);

  async function carregar() {
    try {
      setCatalogo(await api<CatalogoVenda>('/pedidos/venda/catalogo'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    void carregar();
    void lerVendaGuardada().then((t) => {
      try {
        if (t) setRascunho({ ...RASCUNHO_VAZIO, ...(JSON.parse(t) as Rascunho) });
      } catch {
        // Guardado estragado: começa do zero.
      }
      lido.current = true;
    });
    // Só ao abrir a tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lido.current) return;
    guardarVenda(rascunho.itens.length || rascunho.cliente.nome ? JSON.stringify(rascunho) : null);
  }, [rascunho]);

  const itens = rascunho.itens;
  const c = rascunho.cliente;
  const mudarCliente = (m: Partial<Cliente>) => setRascunho((r) => ({ ...r, cliente: { ...r.cliente, ...m } }));
  const porCodigo = useMemo(() => new Map((catalogo?.itens ?? []).map((i) => [i.codigo, i])), [catalogo]);
  const resultados = useMemo(() => (catalogo ? buscarNoCatalogo(catalogo.itens, busca, 20) : []), [catalogo, busca]);

  const subtotal = itens.reduce((s, i) => s + i.quantidade * i.precoCentavos, 0);
  const unidades = itens.reduce((s, i) => s + i.quantidade, 0);
  const modalidade = catalogo?.modalidades.find((m) => m.modalidade === c.modalidade) ?? null;
  const taxa = modalidade?.precoCentavos ?? 0;
  const desconto = centavosDoCampo(c.desconto);
  const maximoDesconto = catalogo ? descontoMaximoCentavos(subtotal, catalogo.descontoMaximoPercentual) : 0;
  const total = Math.max(0, subtotal + taxa - Math.max(0, desconto));

  function adicionar(item: ItemCatalogoApp, quantos = 1) {
    const r = somarAoCarrinho(itens, item, quantos);
    setRascunho((x) => ({ ...x, itens: r.carrinho }));
    const agora = r.carrinho.find((i) => i.codigo === item.codigo)?.quantidade ?? 0;
    setAviso(r.aviso ?? (quantos > 0 ? `${item.nome}: ${agora} no carrinho.` : null));
  }

  /** O que está no carrinho e saiu do catálogo ainda pode ser diminuído ou retirado. */
  const doCatalogo = (i: ItemVendaApp): ItemCatalogoApp => porCodigo.get(i.codigo) ?? { codigo: i.codigo, nome: i.nome, precoCentavos: i.precoCentavos, estoque: i.estoque };

  function mudarObservacao(codigo: string, observacao: string) {
    setRascunho((r) => ({ ...r, itens: r.itens.map((i) => (i.codigo === codigo ? { ...i, observacao } : i)) }));
  }

  async function abrirCamera() {
    setErro(null);
    const p = permissao?.granted ? permissao : await pedirPermissao();
    if (p.granted) setCamera(true);
    else setErro('Sem permissão para usar a câmera. Libere nas configurações do Android ou digite o código.');
  }

  function lerCodigo(codigo: string) {
    setCamera(false);
    if (!catalogo) return;
    const achados = buscarNoCatalogo(catalogo.itens, codigo, 5);
    if (achados.length === 1) {
      adicionar(achados[0]);
      setBusca('');
    } else if (achados.length > 1) setBusca(codigo);
    else setErro(`O código ${codigo} não está no catálogo (ou está sem estoque).`);
  }

  async function buscarCep() {
    const cep = normalizarCep(c.cep);
    if (!cep) return setErro('Digite os 8 números do CEP.');
    setOcupado(true);
    setErro(null);
    try {
      const d = await api<{ rua: string; bairro: string; cidade: string; uf: string }>(`/pedidos/venda/cep/${cep}`);
      mudarCliente({ rua: d.rua || c.rua, bairro: d.bairro || c.bairro, cidade: d.cidade, uf: d.uf });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function lancar() {
    if (!catalogo) return;
    setErro(null);
    setMudancas([]);
    if (!c.modalidade) return setErro('Escolha a forma de entrega.');
    if (!c.pagamento) return setErro('Escolha a forma de pagamento.');
    if (!normalizarCelular(c.telefone)) return setErro('Informe o celular do cliente com DDD, como (11) 98765-4321.');
    const faixa = c.modalidade === 'AGENDADA' ? (catalogo.faixas.find((f) => chaveFaixa(f) === c.faixa) ?? null) : null;
    const corpo = {
      itens: itens.map((i) => ({ codigo: i.codigo, quantidade: i.quantidade, precoCentavos: i.precoCentavos, ...(i.observacao?.trim() ? { observacao: i.observacao.trim() } : {}) })),
      nome: c.nome,
      telefone: c.telefone,
      modalidade: c.modalidade,
      endereco: c.modalidade === 'RETIRADA' ? null : { cep: c.cep.replace(/\D/g, ''), rua: c.rua, numero: c.numero, semNumero: c.semNumero, complemento: c.complemento, bairro: c.bairro, cidade: c.cidade, uf: c.uf.trim().toUpperCase() },
      agendamento: faixa,
      pagamento: c.pagamento,
      trocoParaCentavos: c.pagamento === 'DINHEIRO' && c.troco.trim() ? centavosDoCampo(c.troco) : null,
      observacao: c.observacao,
      descontoCentavos: desconto,
    };
    setOcupado(true);
    try {
      const venda = await api<VendaCriada>('/pedidos/venda', { metodo: 'POST', corpo });
      setFeita({ venda, nome: c.nome.trim(), telefone: normalizarCelular(c.telefone)!, total });
      setRascunho(RASCUNHO_VAZIO);
      guardarVenda(null);
      setEtapa('feita');
      void carregar();
    } catch (e) {
      const dados = e instanceof ErroApi && e.status === 409 ? (e.dados as { mudancas?: MudancaApp[]; itens?: { codigo: string; quantidade: number; precoCentavos: number }[] } | null) : null;
      if (dados?.itens) {
        setRascunho((r) => ({ ...r, itens: carrinhoConferido(r.itens, dados.itens!) }));
        setMudancas((dados.mudancas ?? []).map(textoDaMudanca));
        void carregar();
      }
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function imprimirFolha() {
    if (!feita) return;
    setOcupado(true);
    setErro(null);
    try {
      await api(`/pedidos/${feita.venda.id}/folha/imprimir`, { metodo: 'POST' });
      setAviso('Folha enviada para a impressora. Acompanhe no Histórico de impressão.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (camera) return <LeitorCodigo aoLer={lerCodigo} aoCancelar={() => setCamera(false)} />;

  const cabecalho = (
    <>
      <Text accessibilityRole="link" style={estilos.voltar} onPress={aoSair}>‹ Pedidos</Text>
      <Text accessibilityRole="header" style={estilos.titulo}>{etapa === 'feita' ? 'Venda lançada' : 'Nova venda'}</Text>
      {catalogo ? <Text style={estilos.sub}>{catalogo.empresa}{catalogo.aberta ? '' : ' · loja fechada agora'}</Text> : null}
      {erro ? <Alerta>{erro}</Alerta> : null}
      {mudancas.length ? <Alerta tipo="aviso">{mudancas.join('\n')}</Alerta> : null}
      {aviso && etapa !== 'cliente' ? <Alerta tipo="ok">{aviso}</Alerta> : null}
    </>
  );

  if (etapa === 'feita' && feita) {
    const link = `${servidor}/loja/pedido/${feita.venda.codigo}`;
    return (
      <ScrollView style={{ backgroundColor: cores.fundo }} contentContainerStyle={estilos.pagina}>
        {cabecalho}
        <View style={estilos.cartao}>
          <Text style={estilos.nome}>Pedido nº {feita.venda.numero} · {feita.nome}</Text>
          <Text style={estilos.detalhe}>Total {formatarCentavos(feita.total)} · já aceito por você (Em separação).</Text>
          <View style={{ gap: 8 }}>
            <Botao titulo="Mandar o acompanhamento no WhatsApp" onPress={() => void Linking.openURL(linkWhatsApp(feita.telefone, mensagemWhatsApp('contato', { numero: feita.venda.numero, clienteNome: feita.nome }, catalogo?.empresa ?? '', link)))} />
            {podeImprimir ? <Botao titulo="Imprimir a folha de lançamento" variante="secundario" ocupado={ocupado} onPress={() => void imprimirFolha()} /> : null}
            <Botao titulo="Nova venda" variante="secundario" onPress={() => { setFeita(null); setAviso(null); setEtapa('produtos'); }} />
          </View>
        </View>
      </ScrollView>
    );
  }

  if (etapa === 'cliente' && catalogo) {
    return (
      <ScrollView style={{ backgroundColor: cores.fundo }} contentContainerStyle={estilos.pagina} keyboardShouldPersistTaps="handled">
        {cabecalho}
        <Text accessibilityRole="link" style={estilos.link} onPress={() => setEtapa('produtos')}>‹ Voltar aos produtos ({unidades} {unidades === 1 ? 'item' : 'itens'})</Text>

        <Text style={estilos.secao}>Cliente</Text>
        <TextInput accessibilityLabel="Nome do cliente" placeholder="Nome do cliente" style={estilos.campo} value={c.nome} onChangeText={(t) => mudarCliente({ nome: t })} maxLength={80} />
        <TextInput accessibilityLabel="Celular do cliente" placeholder="Celular com DDD" style={estilos.campo} value={c.telefone} onChangeText={(t) => mudarCliente({ telefone: t })} keyboardType="phone-pad" maxLength={20} />

        <Text style={estilos.secao}>Entrega</Text>
        <View style={estilos.chips}>
          {catalogo.modalidades.map((m) => (
            <Chip key={m.modalidade} rotulo={`${TITULO_MODALIDADE[m.modalidade]}${m.precoCentavos ? ` · ${formatarCentavos(m.precoCentavos)}` : ''}`} ativo={c.modalidade === m.modalidade} aoTocar={() => mudarCliente({ modalidade: m.modalidade })} />
          ))}
        </View>
        {catalogo.modalidades.length === 0 ? <Alerta tipo="aviso">Nenhuma forma de entrega disponível agora.</Alerta> : null}
        {c.modalidade === 'RETIRADA' && catalogo.enderecoRetirada ? <Text style={estilos.detalhe}>Retirada em: {catalogo.enderecoRetirada}</Text> : null}
        {c.modalidade === 'AGENDADA' ? (
          <View style={estilos.chips}>
            {catalogo.faixas.slice(0, 30).map((f) => (
              <Chip key={chaveFaixa(f)} rotulo={textoFaixa(f)} ativo={c.faixa === chaveFaixa(f)} aoTocar={() => mudarCliente({ faixa: chaveFaixa(f) })} />
            ))}
          </View>
        ) : null}
        {c.modalidade && c.modalidade !== 'RETIRADA' ? (
          <>
            <View style={estilos.linha}>
              <TextInput accessibilityLabel="CEP" placeholder="CEP" style={[estilos.campo, { flex: 1 }]} value={c.cep} onChangeText={(t) => mudarCliente({ cep: t })} keyboardType="number-pad" maxLength={9} />
              <View style={{ width: 130 }}><Botao titulo="Buscar CEP" variante="secundario" ocupado={ocupado} onPress={() => void buscarCep()} /></View>
            </View>
            <TextInput accessibilityLabel="Rua" placeholder="Rua" style={estilos.campo} value={c.rua} onChangeText={(t) => mudarCliente({ rua: t })} maxLength={120} />
            <View style={estilos.linha}>
              <TextInput accessibilityLabel="Número" placeholder="Número" editable={!c.semNumero} style={[estilos.campo, { flex: 1 }]} value={c.semNumero ? '' : c.numero} onChangeText={(t) => mudarCliente({ numero: t })} maxLength={10} />
              <Chip rotulo="Sem número" ativo={c.semNumero} aoTocar={() => mudarCliente({ semNumero: !c.semNumero })} />
            </View>
            <TextInput accessibilityLabel="Complemento" placeholder="Complemento (opcional)" style={estilos.campo} value={c.complemento} onChangeText={(t) => mudarCliente({ complemento: t })} maxLength={80} />
            <TextInput accessibilityLabel="Bairro" placeholder="Bairro" style={estilos.campo} value={c.bairro} onChangeText={(t) => mudarCliente({ bairro: t })} maxLength={80} />
            <View style={estilos.linha}>
              <TextInput accessibilityLabel="Cidade" placeholder="Cidade" style={[estilos.campo, { flex: 1 }]} value={c.cidade} onChangeText={(t) => mudarCliente({ cidade: t })} maxLength={80} />
              <TextInput accessibilityLabel="UF" placeholder="UF" style={[estilos.campo, { width: 70 }]} value={c.uf} onChangeText={(t) => mudarCliente({ uf: t.toUpperCase() })} autoCapitalize="characters" maxLength={2} />
            </View>
          </>
        ) : null}

        <Text style={estilos.secao}>Pagamento</Text>
        <View style={estilos.chips}>
          {(['PIX', 'CARTAO', 'DINHEIRO'] as const).map((p) => (
            <Chip key={p} rotulo={TITULO_PAGAMENTO[p]} ativo={c.pagamento === p} aoTocar={() => mudarCliente({ pagamento: p })} />
          ))}
        </View>
        {c.pagamento === 'DINHEIRO' ? <TextInput accessibilityLabel="Troco para quanto" placeholder="Troco para quanto? (vazio: sem troco)" style={estilos.campo} value={c.troco} onChangeText={(t) => mudarCliente({ troco: t })} keyboardType="decimal-pad" /> : null}
        {catalogo.descontoMaximoPercentual > 0 ? (
          <>
            <TextInput accessibilityLabel="Desconto em reais" placeholder="Desconto em R$ (opcional)" style={estilos.campo} value={c.desconto} onChangeText={(t) => mudarCliente({ desconto: t })} keyboardType="decimal-pad" />
            <Text style={estilos.detalhe}>Até {formatarCentavos(maximoDesconto)} ({catalogo.descontoMaximoPercentual}% dos produtos).</Text>
          </>
        ) : null}
        <TextInput accessibilityLabel="Observação do pedido" placeholder="Observação do pedido (opcional)" style={estilos.campo} value={c.observacao} onChangeText={(t) => mudarCliente({ observacao: t })} maxLength={300} />

        <View style={estilos.cartao}>
          <Linha rotulo="Produtos" valor={formatarCentavos(subtotal)} />
          <Linha rotulo="Entrega" valor={formatarCentavos(taxa)} />
          {desconto > 0 ? <Linha rotulo="Desconto" valor={`-${formatarCentavos(desconto)}`} /> : null}
          <Linha rotulo="Total" valor={formatarCentavos(total)} forte />
          {catalogo.pedidoMinimoCentavos && subtotal < catalogo.pedidoMinimoCentavos ? <Text style={[estilos.detalhe, { color: cores.aviso }]}>O pedido mínimo é {formatarCentavos(catalogo.pedidoMinimoCentavos)}.</Text> : null}
        </View>
        <Botao titulo="Lançar venda" ocupado={ocupado} disabled={itens.length === 0} onPress={() => void lancar()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: cores.fundo }} contentContainerStyle={estilos.pagina} keyboardShouldPersistTaps="handled">
      {cabecalho}
      {!catalogo ? (
        erro ? <Botao titulo="Tentar de novo" variante="secundario" onPress={() => void carregar()} /> : <Text style={estilos.vazio}>Carregando os produtos…</Text>
      ) : (
        <>
          <View style={estilos.linha}>
            <TextInput accessibilityLabel="Buscar produto" placeholder="Nome ou código" style={[estilos.campo, { flex: 1 }]} value={busca} onChangeText={setBusca} autoCorrect={false} returnKeyType="search" />
            <View style={{ width: 120 }}><Botao titulo="Ler código" variante="secundario" onPress={() => void abrirCamera()} /></View>
          </View>
          {busca.trim() && resultados.length === 0 ? <Text style={estilos.detalhe}>Nenhum produto com “{busca.trim()}”.</Text> : null}
          {resultados.map((i) => (
            <Pressable key={i.codigo} accessibilityRole="button" accessibilityLabel={`Adicionar ${i.nome}`} onPress={() => adicionar(i)} style={estilos.resultado}>
              <Text style={[estilos.detalhe, { flex: 1, color: cores.texto, marginBottom: 0 }]} numberOfLines={2}>{i.nome}</Text>
              <Text style={[estilos.detalhe, { marginBottom: 0 }]}>{formatarCentavos(i.precoCentavos)}{i.estoque !== undefined ? ` · ${i.estoque} em estoque` : ''}</Text>
            </Pressable>
          ))}

          <Text style={estilos.secao}>Carrinho</Text>
          {itens.length === 0 ? <Text style={estilos.detalhe}>Busque ou leia o código dos produtos para adicionar.</Text> : null}
          {itens.map((i) => (
            <View key={i.codigo} style={estilos.cartao}>
              <View style={estilos.cabeca}>
                <Text style={[estilos.nome, { flex: 1 }]}>{i.nome}</Text>
                <Text style={estilos.nome}>{formatarCentavos(i.quantidade * i.precoCentavos)}</Text>
              </View>
              <View style={[estilos.linha, { alignItems: 'center' }]}>
                <View style={{ width: 52 }}><Botao titulo="−" accessibilityLabel={`Tirar um ${i.nome}`} variante="secundario" onPress={() => adicionar(doCatalogo(i), -1)} /></View>
                <Text accessibilityLabel={`Quantidade de ${i.nome}`} style={estilos.quantidade}>{i.quantidade}</Text>
                <View style={{ width: 52 }}><Botao titulo="+" accessibilityLabel={`Mais um ${i.nome}`} variante="secundario" onPress={() => adicionar(doCatalogo(i))} /></View>
                <Text style={[estilos.detalhe, { marginBottom: 0 }]}>× {formatarCentavos(i.precoCentavos)}</Text>
              </View>
              <TextInput accessibilityLabel={`Observação de ${i.nome}`} placeholder="Observação deste produto (opcional)" style={[estilos.campo, { marginTop: 8, marginBottom: 0 }]} value={i.observacao ?? ''} onChangeText={(t) => mudarObservacao(i.codigo, t)} maxLength={200} />
            </View>
          ))}
          {itens.length ? (
            <View style={{ gap: 8 }}>
              <Botao titulo={`Continuar · ${unidades} ${unidades === 1 ? 'item' : 'itens'} · ${formatarCentavos(subtotal)}`} onPress={() => { setAviso(null); setEtapa('cliente'); }} />
              <Botao titulo="Limpar a venda" variante="perigo" onPress={() => { setRascunho(RASCUNHO_VAZIO); setAviso(null); setMudancas([]); }} />
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function Chip({ rotulo, ativo, aoTocar }: { rotulo: string; ativo: boolean; aoTocar: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={rotulo} accessibilityState={{ selected: ativo }} onPress={aoTocar} style={[estilos.chip, ativo && estilos.chipAtivo]}>
      <Text style={[{ fontSize: 14, color: cores.texto }, ativo && { color: cores.azul, fontWeight: '700' }]}>{rotulo}</Text>
    </Pressable>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <View style={estilos.cabeca}>
      <Text style={forte ? estilos.nome : estilos.detalhe}>{rotulo}</Text>
      <Text style={forte ? estilos.nome : estilos.detalhe}>{valor}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  pagina: { padding: 16, paddingBottom: 32 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, marginBottom: 12 },
  secao: { fontSize: 16, fontWeight: '700', color: cores.texto, marginTop: 12, marginBottom: 8 },
  vazio: { textAlign: 'center', color: cores.suave, fontSize: 16, marginTop: 24 },
  voltar: { color: cores.azul, fontSize: 16, fontWeight: '600', paddingVertical: 6, marginBottom: 4 },
  link: { color: cores.azul, fontSize: 15, fontWeight: '600', paddingVertical: 6, marginBottom: 4 },
  cartao: { backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 12, marginBottom: 8 },
  resultado: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, backgroundColor: cores.branco, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 },
  cabeca: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  nome: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: cores.texto, marginBottom: 4 },
  detalhe: { fontSize: 14, color: cores.suave, marginBottom: 6 },
  linha: { flexDirection: 'row', gap: 8 },
  quantidade: { minWidth: 36, textAlign: 'center', fontSize: 17, fontWeight: '700', color: cores.texto },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: cores.borda, borderRadius: 20, backgroundColor: cores.branco },
  chipAtivo: { borderColor: cores.azul, backgroundColor: cores.azulClaro },
  campo: { minHeight: 48, borderWidth: 1, borderColor: cores.borda, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, color: cores.texto, backgroundColor: cores.branco, marginBottom: 8 },
});
