import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cenasDosItens, corDoTextoSobre, entradaDaCena, familiaDoFormato, formatoMostraFundo, formatoMostraLogo, gradeDaCena, gradeParaItens, horaDosDados, type EfeitoPreco, type EntradaConcreta, type GradeDaCena, type ItemConteudoTela, type NivelEfetivo, type ProgramaTela } from '@etiquetas/shared';

/**
 * Desenha as cenas em pixels, a partir da largura e altura recebidas: a pré-visualização e a TV usam
 * este mesmo código, então o que se aprova é o que aparece. Só CSS, que as TVs mais fracas aguentam.
 */
const ANIMACOES = `
@keyframes tvSobe { from { opacity: 0; transform: translateY(6%); } to { opacity: 1; transform: none; } }
@keyframes tvZoom { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
@keyframes tvSurge { from { opacity: 0; } to { opacity: 1; } }
@keyframes tvDesliza { from { opacity: 0; transform: translateX(-14%); } to { opacity: 1; transform: none; } }
@keyframes tvVira { from { opacity: 0; transform: perspective(1400px) rotateY(-75deg); } to { opacity: 1; transform: perspective(1400px) rotateY(0); } }
@keyframes tvQuica { 0% { opacity: 0; transform: translateY(-18%); } 55% { opacity: 1; transform: translateY(3%); } 75% { transform: translateY(-1.5%); } 90% { transform: translateY(.6%); } 100% { opacity: 1; transform: none; } }
@keyframes tvGira { from { opacity: 0; transform: rotate(-10deg) scale(.6); } to { opacity: 1; transform: none; } }
@keyframes tvPulso { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes tvBrilho { 0%, 55% { background-position: 130% 0; } 100% { background-position: -30% 0; } }
@keyframes tvBalanca { 0%, 78%, 100% { transform: rotate(0); } 82% { transform: rotate(-5deg); } 86% { transform: rotate(5deg); } 90% { transform: rotate(-3deg); } 94% { transform: rotate(2deg); } }
@keyframes tvPisca { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
`;

/** Só transformação e opacidade nas entradas: a TV faz isso na placa de vídeo, sem redesenhar a página. */
const ENTRADAS: Record<EntradaConcreta, { nome: string; duracao: number; curva: string }> = {
  SUBIR: { nome: 'tvSobe', duracao: 0.55, curva: 'ease-out' },
  DESLIZAR: { nome: 'tvDesliza', duracao: 0.6, curva: 'cubic-bezier(.2,.8,.2,1)' },
  APROXIMAR: { nome: 'tvZoom', duracao: 0.6, curva: 'ease-out' },
  VIRAR: { nome: 'tvVira', duracao: 0.7, curva: 'cubic-bezier(.2,.8,.2,1)' },
  QUICAR: { nome: 'tvQuica', duracao: 0.85, curva: 'ease-out' },
  GIRAR: { nome: 'tvGira', duracao: 0.6, curva: 'cubic-bezier(.2,.8,.2,1)' },
  SURGIR: { nome: 'tvSurge', duracao: 0.5, curva: 'ease-out' },
};

/** Texto secundário. Sobre imagem de fundo fica inteiro (`--tv-suave`, na cena): transparente, some nas partes claras. */
const SUAVE = 'var(--tv-suave, .75)';

/** A animação de cada produto. Leve: a cena inteira entra de uma vez (`entradaDaCenaInteira`), e cada um fica parado. */
function entrada(nivel: NivelEfetivo, indice: number, tipo: EntradaConcreta): CSSProperties {
  if (nivel !== 'COMPLETO') return {};
  const e = ENTRADAS[tipo];
  return { animation: `${e.nome} ${e.duracao}s ${e.curva} ${indice * 90}ms both` };
}

/** Um movimento só, para a cena toda: é o que uma TV fraca aguenta sem engasgar. */
function entradaDaCenaInteira(nivel: NivelEfetivo, tipo: EntradaConcreta): CSSProperties {
  if (nivel === 'ESTATICO') return {};
  if (nivel === 'COMPLETO') return { animation: 'tvSurge .35s ease-out both' };
  const e = ENTRADAS[tipo];
  return { animation: `${e.nome} ${e.duracao}s ${e.curva} both` };
}

function efeitoDoPreco(nivel: NivelEfetivo, efeito: EfeitoPreco, indice: number, cor: string): CSSProperties {
  if (nivel !== 'COMPLETO') return {};
  const atraso = `${0.7 + indice * 0.09}s`;
  switch (efeito) {
    case 'NENHUM':
      return {};
    case 'BRILHAR':
      return {
        backgroundColor: cor,
        backgroundImage: 'linear-gradient(105deg, transparent 35%, rgba(255,255,255,.65) 50%, transparent 65%)',
        backgroundSize: '250% 100%',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: '130% 0',
        animation: `tvBrilho 3.2s ease-in-out ${atraso} infinite`,
      };
    case 'BALANCAR':
      return { animation: `tvBalanca 4s ease-in-out ${atraso} infinite` };
    case 'PISCAR':
      return { animation: `tvPisca 1.8s ease-in-out ${atraso} infinite` };
    default:
      return { animation: `tvPulso 2.4s ease-in-out ${atraso} infinite` };
  }
}

/** A folga dos lados é para as reticências: em texto centralizado, o navegador as deixa um pouco fora da caixa. */
const linhas = (n: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', paddingInline: '.25em', boxSizing: 'border-box' });

/**
 * Texto em uma linha que diminui até caber. Mede de verdade, porque cada TV tem a sua fonte de sistema,
 * e algumas são bem mais largas. Quem usa define o resto em `em`, que acompanha o tamanho.
 */
function TextoQueCabe({ tamanho, maxLargura, style, testId, children }: { tamanho: number; maxLargura: number; style?: CSSProperties; testId?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = `${tamanho}px`;
    const largura = el.offsetWidth;
    if (largura > maxLargura) el.style.fontSize = `${Math.floor((tamanho * maxLargura * 100) / largura) / 100}px`;
  }, [tamanho, maxLargura, children]);
  return (
    <span ref={ref} data-testid={testId} style={{ display: 'inline-block', whiteSpace: 'nowrap', ...style, fontSize: tamanho }}>
      {children}
    </span>
  );
}

function Preco({ item, tamanho, maxLargura, cor, nivel, indice, efeito }: { item: ItemConteudoTela; tamanho: number; maxLargura: number; cor: string; nivel: NivelEfetivo; indice: number; efeito: EfeitoPreco }) {
  return (
    <TextoQueCabe tamanho={tamanho} maxLargura={maxLargura} testId="preco-tela" style={{ backgroundColor: cor, color: corDoTextoSobre(cor), fontWeight: 800, lineHeight: 1.15, padding: '.08em .28em', borderRadius: '.16em', ...efeitoDoPreco(nivel, efeito, indice, cor) }}>
      {item.preco}
    </TextoQueCabe>
  );
}

function PrecoDe({ item, tamanho, maxLargura }: { item: ItemConteudoTela; tamanho: number; maxLargura: number }) {
  if (!item.precoDe) return null;
  return (
    <TextoQueCabe tamanho={tamanho} maxLargura={maxLargura} style={{ opacity: SUAVE, textDecoration: 'line-through' }}>
      de {item.precoDe}
    </TextoQueCabe>
  );
}

/** Foto que não abre some e o cartão volta ao desenho só com texto: nunca um quadro quebrado na vitrine. */
function useFoto(item: ItemConteudoTela) {
  const [falhou, setFalhou] = useState(false);
  return { url: falhou ? undefined : item.foto, aoFalhar: () => setFalhou(true) };
}

/** Sobre branco: a maioria das fotos de produto tem fundo branco, e num fundo escuro ficaria um recorte. */
function FotoProduto({ url, largura, altura, aoFalhar }: { url: string; largura: number; altura: number; aoFalhar: () => void }) {
  const menor = Math.min(largura, altura);
  return (
    <div data-testid="foto-produto" style={{ width: largura, height: altura, flexShrink: 0, boxSizing: 'border-box', padding: menor * 0.04, background: '#ffffff', borderRadius: menor * 0.08, overflow: 'hidden' }}>
      <img src={url} alt="" onError={aoFalhar} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}

interface Celula {
  item: ItemConteudoTela;
  indice: number;
  largura: number;
  altura: number;
  corDestaque: string;
  nivel: NivelEfetivo;
  /** Algum produto da cena tem foto: todos usam as mesmas letras, senão o preço de quem não tem foto parece maior. */
  fotosNaCena: boolean;
  tipoEntrada: EntradaConcreta;
  efeitoPreco: EfeitoPreco;
}

function CartaoGrade({ item, indice, largura, altura, corDestaque, nivel, fotosNaCena, tipoEntrada, efeitoPreco }: Celula) {
  const foto = useFoto(item);
  const margem = Math.min(largura, altura) * 0.07;
  // Cartão largo: foto ao lado. Cartão alto ou quadrado: foto em cima, e o texto fica com o resto.
  const largo = largura / altura >= 1.25;
  const aoLado = !!foto.url && largo;
  const ladoSeTiver = largo ? Math.min(altura - 2 * margem, largura * 0.38) : altura * 0.42;
  const ladoFoto = foto.url ? ladoSeTiver : 0;
  const vao = foto.url ? margem * 0.6 : 0;
  const larguraTexto = largura - 2 * margem - (aoLado ? ladoFoto + vao : 0);
  const alturaTexto = altura - 2 * margem - (foto.url && !aoLado ? ladoFoto + vao : 0);
  // As letras saem do espaço que sobraria com foto, mesmo no cartão sem foto da mesma cena.
  const larguraBase = largura - 2 * margem - (largo ? ladoSeTiver + margem * 0.6 : 0);
  const alturaBase = altura - 2 * margem - (largo ? 0 : ladoSeTiver + margem * 0.6);
  const nome = !fotosNaCena ? Math.min(altura * 0.115, largura * 0.075) : largo ? Math.min(alturaBase * 0.13, larguraBase * 0.12) : Math.min(alturaBase * 0.16, larguraBase * 0.087);
  const preco = !fotosNaCena ? Math.min(altura * 0.2, largura * 0.125) : largo ? Math.min(alturaBase * 0.23, larguraBase * 0.2) : Math.min(alturaBase * 0.27, larguraBase * 0.145);
  const util = (fotosNaCena ? larguraBase : larguraTexto) * 0.95;
  // O nome usa as linhas que sobram: em cartão alto (TV na vertical) cabe bem mais que em um largo.
  const blocoPreco = preco * 1.31 + nome * 1.4;
  const blocoDetalhe = item.detalhe ? nome * 1.1 : 0;
  const sobra = alturaTexto - blocoPreco - blocoDetalhe;
  const linhasDoNome = Math.max(1, Math.min(6, Math.floor(sobra / (nome * 1.15))));
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, boxSizing: 'border-box', padding: margem, borderRadius: Math.min(largura, altura) * 0.05, background: 'rgba(127,127,127,.16)', display: 'flex', flexDirection: aoLado ? 'row' : 'column', alignItems: 'center', gap: vao, textAlign: 'center', overflow: 'hidden', ...entrada(nivel, indice, tipoEntrada) }}>
      {foto.url && <FotoProduto url={foto.url} largura={aoLado ? ladoFoto : Math.min(larguraTexto, ladoFoto * 1.6)} altura={ladoFoto} aoFalhar={foto.aoFalhar} />}
      <div style={{ width: larguraTexto, height: alturaTexto, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }}>
        <div data-testid="texto-celula" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ ...linhas(linhasDoNome), fontSize: nome, fontWeight: 600, lineHeight: 1.15 }}>{item.nome}</div>
          {item.detalhe && <div style={{ ...linhas(1), fontSize: nome * 0.72, opacity: SUAVE, marginTop: nome * 0.25 }}>{item.detalhe}</div>}
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: nome * 0.2, marginTop: nome * 0.2 }}>
          <PrecoDe item={item} tamanho={nome * 0.8} maxLargura={util} />
          <Preco item={item} tamanho={preco} maxLargura={util} cor={corDestaque} nivel={nivel} indice={indice} efeito={efeitoPreco} />
        </div>
      </div>
    </div>
  );
}

function CartaoDestaque({ item, indice, largura, altura, corDestaque, nivel, faixa, tipoEntrada, efeitoPreco }: Celula & { faixa: boolean }) {
  const foto = useFoto(item);
  const animacao = entrada(nivel, indice, tipoEntrada);
  // Lado a lado não cabe: nome em uma linha e o preço embaixo, que é o que importa de longe.
  if (faixa && largura < 400) {
    const nome = Math.min(altura * 0.28, largura * 0.11);
    const preco = Math.min(altura * 0.42, largura * 0.11);
    return (
      <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: altura * 0.06, overflow: 'hidden', ...animacao }}>
        <div style={{ maxWidth: largura, fontSize: nome, fontWeight: 600, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.nome}</div>
        <Preco item={item} tamanho={preco} maxLargura={largura} cor={corDestaque} nivel="LEVE" indice={indice} efeito={efeitoPreco} />
      </div>
    );
  }
  if (faixa) {
    const nome = Math.min(altura * 0.32, largura * 0.05);
    const preco = Math.min(altura * 0.6, largura * 0.09);
    // Faixa baixa não tem como mostrar produto reconhecível: nome e preço leem melhor sozinhos.
    if (foto.url && altura >= 100) {
      // Foto, nome e preço na mesma fileira espremem o nome: o preço vai para baixo dele.
      const lado = altura * 0.92;
      const vao = largura * 0.02;
      const larguraTexto = largura - lado - vao;
      const nomeAqui = Math.min(altura * 0.17, larguraTexto * 0.055);
      const precoAqui = Math.min(altura * 0.36, larguraTexto * 0.11);
      return (
        <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', alignItems: 'center', gap: vao, overflow: 'hidden', ...animacao }}>
          <FotoProduto url={foto.url} largura={lado} altura={lado} aoFalhar={foto.aoFalhar} />
          <div style={{ width: larguraTexto, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: altura * 0.04, textAlign: 'center' }}>
            <div data-testid="nome-tela" style={{ ...linhas(2), maxWidth: larguraTexto, fontSize: nomeAqui, fontWeight: 700, lineHeight: 1.1 }}>{item.nome}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: nomeAqui * 0.6 }}>
              <PrecoDe item={item} tamanho={nomeAqui * 0.7} maxLargura={larguraTexto * 0.3} />
              <Preco item={item} tamanho={precoAqui} maxLargura={larguraTexto * 0.65} cor={corDestaque} nivel={nivel} indice={indice} efeito={efeitoPreco} />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: largura * 0.02, overflow: 'hidden', ...animacao }}>
        <div style={{ ...linhas(2), fontSize: nome, fontWeight: 700, lineHeight: 1.1, textAlign: 'left', minWidth: 0 }}>{item.nome}</div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: nome * 0.1 }}>
          <PrecoDe item={item} tamanho={nome * 0.6} maxLargura={largura * 0.5} />
          <Preco item={item} tamanho={preco} maxLargura={largura * 0.5} cor={corDestaque} nivel={nivel} indice={indice} efeito={efeitoPreco} />
        </div>
      </div>
    );
  }
  if (foto.url) {
    const deitada = largura >= altura;
    const larguraFoto = deitada ? Math.min(altura * 0.92, largura * 0.46) : largura * 0.86;
    const alturaFoto = deitada ? larguraFoto : altura * 0.45;
    const vao = Math.min(largura, altura) * 0.04;
    const larguraTexto = deitada ? largura - larguraFoto - vao : largura;
    const alturaTexto = deitada ? altura : altura - alturaFoto - vao;
    const nome = Math.min(alturaTexto * (deitada ? 0.1 : 0.14), larguraTexto * 0.085);
    const preco = Math.min(alturaTexto * (deitada ? 0.22 : 0.3), larguraTexto * 0.17);
    return (
      <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', flexDirection: deitada ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: vao, textAlign: 'center', overflow: 'hidden', ...animacao }}>
        <FotoProduto url={foto.url} largura={larguraFoto} altura={alturaFoto} aoFalhar={foto.aoFalhar} />
        <div style={{ width: larguraTexto, height: alturaTexto, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: alturaTexto * 0.04, overflow: 'hidden' }}>
          <div data-testid="nome-tela" style={{ ...linhas(3), fontSize: nome, fontWeight: 700, lineHeight: 1.12, maxWidth: larguraTexto * 0.95 }}>{item.nome}</div>
          {item.detalhe && <div style={{ ...linhas(1), fontSize: nome * 0.55, opacity: SUAVE }}>{item.detalhe}</div>}
          <PrecoDe item={item} tamanho={nome * 0.7} maxLargura={larguraTexto * 0.92} />
          <Preco item={item} tamanho={preco} maxLargura={larguraTexto * 0.92} cor={corDestaque} nivel={nivel} indice={indice} efeito={efeitoPreco} />
        </div>
      </div>
    );
  }
  const nome = Math.min(altura * 0.11, largura * 0.07);
  const preco = Math.min(altura * 0.27, largura * 0.125);
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: altura * 0.05, textAlign: 'center', overflow: 'hidden', ...animacao }}>
      <div style={{ ...linhas(3), fontSize: nome, fontWeight: 700, lineHeight: 1.12, maxWidth: largura * 0.92 }}>{item.nome}</div>
      {item.detalhe && <div style={{ ...linhas(1), fontSize: nome * 0.55, opacity: SUAVE }}>{item.detalhe}</div>}
      <PrecoDe item={item} tamanho={nome * 0.7} maxLargura={largura * 0.92} />
      <Preco item={item} tamanho={preco} maxLargura={largura * 0.92} cor={corDestaque} nivel={nivel} indice={indice} efeito={efeitoPreco} />
    </div>
  );
}

function LinhaLista({ item, indice, largura, altura, corDestaque, nivel, fotosNaCena, tipoEntrada, efeitoPreco }: Celula) {
  const foto = useFoto(item);
  const fonte = Math.min(altura * 0.46, largura * 0.055);
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: largura * 0.02, borderBottom: '1px solid rgba(127,127,127,.35)', overflow: 'hidden', ...entrada(nivel, indice, tipoEntrada) }}>
      {foto.url && altura >= 40 && <FotoProduto url={foto.url} largura={altura * 0.86} altura={altura * 0.86} aoFalhar={foto.aoFalhar} />}
      {/* Reserva o lugar, para os nomes começarem todos na mesma coluna. */}
      {!foto.url && fotosNaCena && altura >= 40 && <div style={{ width: altura * 0.86, flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1, textAlign: 'left', fontSize: fonte, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.nome}
        {item.detalhe && <span style={{ opacity: SUAVE, fontSize: fonte * 0.72 }}> · {item.detalhe}</span>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: fonte * 0.5 }}>
        {/* Em linha estreita o preço anterior espreme o nome, que é o que identifica o produto. */}
        {largura >= 1200 && <PrecoDe item={item} tamanho={fonte * 0.68} maxLargura={largura * 0.2} />}
        <Preco item={item} tamanho={fonte * 0.92} maxLargura={largura * 0.42} cor={corDestaque} nivel="LEVE" indice={indice} efeito={efeitoPreco} />
      </div>
    </div>
  );
}

interface PropsCena {
  programa: ProgramaTela;
  itens: ItemConteudoTela[];
  grade: GradeDaCena;
  largura: number;
  altura: number;
  margemPct: number;
  nivel: NivelEfetivo;
  fuso?: string;
  /** A imagem de fundo fica atrás da cena e não entra de novo a cada troca. */
  comFundo: boolean;
  logo?: string;
  aoFalharLogo: () => void;
  tipoEntrada: EntradaConcreta;
}

/** O lugar é reservado, sem esperar o arquivo abrir: assim o título não muda de tamanho a cada cena. */
const LARGURA_LOGO = 0.18;

function CenaProdutos({ programa, itens, grade: gradeCheia, largura, altura, margemPct, nivel, fuso, comFundo, logo, aoFalharLogo, tipoEntrada }: PropsCena) {
  const { config, modelo } = programa;
  const grade = gradeParaItens(modelo, gradeCheia, itens.length);
  const pequena = Math.min(largura, altura) < 200;
  const faixa = familiaDoFormato(largura, altura) === 'FAIXA';
  const margemX = (largura * margemPct) / 100;
  const margemY = (altura * margemPct) / 100;
  const respiro = Math.min(largura, altura) * (pequena ? 0.02 : 0.025);
  const uteisL = largura - 2 * margemX - 2 * respiro;
  const uteisA = altura - 2 * margemY - 2 * respiro;
  const temTitulo = !pequena && !faixa && !!config.titulo.trim();
  const logoNaCena = logo && formatoMostraLogo(largura, altura) ? logo : undefined;
  const temRodape = !pequena && !faixa;
  const altTitulo = temTitulo || logoNaCena ? uteisA * 0.13 : 0;
  const altRodape = temRodape ? uteisA * 0.05 : 0;
  const espaco = pequena ? respiro / 2 : respiro * 0.7;
  const corpoA = uteisA - altTitulo - altRodape;
  const celL = (uteisL - espaco * (grade.colunas - 1)) / grade.colunas;
  const celA = (corpoA - espaco * (grade.linhas - 1)) / grade.linhas;
  const texto = corDoTextoSobre(config.corFundo);

  return (
    <div
      data-testid="cena-tela"
      style={{
        position: 'absolute',
        inset: 0,
        boxSizing: 'border-box',
        padding: `${margemY + respiro}px ${margemX + respiro}px`,
        background: comFundo ? 'transparent' : config.corFundo,
        ...(comFundo ? ({ '--tv-suave': 1 } as CSSProperties) : {}),
        color: texto,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        overflow: 'hidden',
        ...entradaDaCenaInteira(nivel, tipoEntrada),
      }}
    >
      {altTitulo > 0 && (
        <div style={{ position: 'relative', height: altTitulo }}>
          {logoNaCena && (
            <img
              data-testid="logo-tela"
              src={logoNaCena}
              alt=""
              onError={aoFalharLogo}
              // Sem título, a logomarca fica no centro e pode ser bem mais larga.
              style={{ position: 'absolute', top: altTitulo * 0.07, height: altTitulo * 0.86, ...(temTitulo ? { left: 0, width: uteisL * LARGURA_LOGO, objectPosition: 'left center' } : { left: uteisL * 0.2, width: uteisL * 0.6, objectPosition: 'center' }), objectFit: 'contain' }}
            />
          )}
          {temTitulo && (
            <div data-testid="titulo-tela" style={{ height: altTitulo, lineHeight: `${altTitulo}px`, textAlign: 'center', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', ...(nivel === 'COMPLETO' ? { animation: 'tvSobe .5s ease-out both' } : {}) }}>
              <TextoQueCabe tamanho={altTitulo * 0.68} maxLargura={logoNaCena ? uteisL * (1 - 2 * LARGURA_LOGO - 0.05) : uteisL}>{config.titulo}</TextoQueCabe>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grade.colunas}, ${celL}px)`, gridAutoRows: `${celA}px`, gap: espaco, justifyContent: 'center' }}>
        {itens.map((item, i) => {
          const comum = { item, indice: i, largura: celL, altura: celA, corDestaque: config.corDestaque, nivel, fotosNaCena: itens.some((x) => x.foto), tipoEntrada, efeitoPreco: config.animacaoPreco ?? 'PULSAR' };
          // Painel bem pequeno mostra um produto por vez, seja qual for o modelo.
          if (modelo === 'DESTAQUE' || (pequena && grade.colunas === 1)) return <CartaoDestaque key={i} {...comum} faixa={faixa || pequena} />;
          if (modelo === 'LISTA_PRECOS') return <LinhaLista key={i} {...comum} />;
          return <CartaoGrade key={i} {...comum} />;
        })}
      </div>
      {temRodape && (
        <div style={{ position: 'absolute', left: margemX + respiro, right: margemX + respiro, bottom: margemY + respiro, height: altRodape, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: respiro, fontSize: altRodape * 0.5, opacity: SUAVE, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{config.rodape}</span>
          <span style={{ flexShrink: 0 }}>Preços de {horaDosDados(programa.dadosEm, fuso)}</span>
        </div>
      )}
    </div>
  );
}

type Cena = { tipo: 'produtos'; programa: ProgramaTela; itens: ItemConteudoTela[]; grade: GradeDaCena; segundos: number } | { tipo: 'imagem'; programa: ProgramaTela; url: string; segundos: number };

interface PropsExibicao {
  programas: ProgramaTela[];
  largura: number;
  altura: number;
  margemPct: number;
  nivel: NivelEfetivo;
  fuso?: string;
}

function CenaImagem({ programa, url, largura, altura, margemPct, nivel, aoFalhar, tipoEntrada }: { programa: ProgramaTela; url: string; largura: number; altura: number; margemPct: number; nivel: NivelEfetivo; aoFalhar: () => void; tipoEntrada: EntradaConcreta }) {
  const cobrir = programa.config.ajuste === 'COBRIR';
  // Cobrindo, a imagem vai até a borda de propósito: quem escolheu aceitou cortar.
  const margemX = cobrir ? 0 : (largura * margemPct) / 100;
  const margemY = cobrir ? 0 : (altura * margemPct) / 100;
  // Uma imagem só por cena: o leve aguenta a mesma entrada do completo.
  const e = ENTRADAS[tipoEntrada];
  const animacao: CSSProperties = nivel === 'ESTATICO' ? {} : { animation: `${e.nome} ${e.duracao}s ${e.curva} both` };
  return (
    <div data-testid="cena-imagem" style={{ position: 'absolute', inset: 0, background: programa.config.corFundo, overflow: 'hidden' }}>
      <img src={url} alt="" onError={aoFalhar} style={{ position: 'absolute', left: margemX, top: margemY, width: largura - 2 * margemX, height: altura - 2 * margemY, objectFit: cobrir ? 'cover' : 'contain', ...animacao }} />
    </div>
  );
}

/** A cor de fundo por cima da imagem: é ela que garante a leitura do texto, escolhido conforme essa cor. */
function FundoDaCena({ url, veu, cor, aoFalhar }: { url: string; veu: number; cor: string; aoFalhar: () => void }) {
  return (
    <div data-testid="fundo-tela" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <img src={url} alt="" onError={aoFalhar} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <div data-testid="veu-tela" style={{ position: 'absolute', inset: 0, background: cor, opacity: veu / 100 }} />
    </div>
  );
}

/** Passa pelos programas, cena a cena. Programação nova entra sem interromper: vale a partir da próxima cena. */
export function ExibicaoTela({ programas, largura, altura, margemPct, nivel, fuso }: PropsExibicao) {
  // Imagem que não abre sai do ciclo em vez de deixar a tela vazia. Programação nova tenta de novo.
  const [falhas, setFalhas] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setFalhas(new Set()), [programas]);
  const cenas = useMemo(
    () =>
      programas.flatMap((programa): Cena[] => {
        if (programa.modelo === 'IMAGENS') return (programa.imagens ?? []).filter((i) => !falhas.has(i.url)).map((i) => ({ tipo: 'imagem', programa, url: i.url, segundos: i.segundos }));
        const grade = gradeDaCena(programa.modelo, largura, altura);
        return cenasDosItens(programa.itens, grade).map((itens) => ({ tipo: 'produtos', programa, itens, grade, segundos: programa.config.segundosPorCena }));
      }),
    [programas, largura, altura, falhas],
  );
  const [passo, setPasso] = useState(0);
  const atual = cenas.length ? cenas[passo % cenas.length] : null;
  const segundos = atual?.segundos ?? 8;
  const proxima = cenas.length > 1 ? cenas[(passo + 1) % cenas.length] : null;

  // Baixa a próxima imagem antes da hora, para a troca não mostrar a tela vazia.
  useEffect(() => {
    if (proxima?.tipo === 'imagem') new Image().src = proxima.url;
    if (proxima?.tipo === 'produtos') {
      for (const i of proxima.itens) if (i.foto) new Image().src = i.foto;
      if (proxima.programa.logo) new Image().src = proxima.programa.logo;
      if (proxima.programa.fundo) new Image().src = proxima.programa.fundo.url;
    }
  }, [proxima]);

  useEffect(() => {
    const relogio = setTimeout(() => setPasso((p) => p + 1), segundos * 1000);
    return () => clearTimeout(relogio);
  }, [passo, segundos]);

  if (!atual) return null;
  const falhou = (url: string) => setFalhas((f) => new Set(f).add(url));
  const { fundo, logo } = atual.programa;
  // Logomarca ou fundo que não abrem saem, e a cena fica como seria sem eles.
  const fundoNaCena = atual.tipo === 'produtos' && fundo && !falhas.has(fundo.url) && formatoMostraFundo(largura, altura) ? fundo : null;
  const tipoEntrada = entradaDaCena(atual.programa.config.animacaoEntrada, passo);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: atual.programa.config.corFundo }}>
      <style>{ANIMACOES}</style>
      {fundoNaCena && <FundoDaCena key={fundoNaCena.url} url={fundoNaCena.url} veu={fundoNaCena.veu} cor={atual.programa.config.corFundo} aoFalhar={() => falhou(fundoNaCena.url)} />}
      {atual.tipo === 'imagem' ? (
        <CenaImagem key={passo} programa={atual.programa} url={atual.url} largura={largura} altura={altura} margemPct={margemPct} nivel={nivel} aoFalhar={() => falhou(atual.url)} tipoEntrada={tipoEntrada} />
      ) : (
        <CenaProdutos key={passo} programa={atual.programa} itens={atual.itens} grade={atual.grade} largura={largura} altura={altura} margemPct={margemPct} nivel={nivel} fuso={fuso} comFundo={!!fundoNaCena} logo={logo && !falhas.has(logo) ? logo : undefined} aoFalharLogo={() => logo && falhou(logo)} tipoEntrada={tipoEntrada} />
      )}
    </div>
  );
}
