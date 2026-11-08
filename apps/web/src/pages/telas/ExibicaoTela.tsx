import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cenasDosItens, corDoTextoSobre, familiaDoFormato, gradeDaCena, gradeParaItens, horaDosDados, type GradeDaCena, type ItemConteudoTela, type NivelEfetivo, type ProgramaTela } from '@etiquetas/shared';

/**
 * Desenha as cenas em pixels, a partir da largura e altura recebidas: a pré-visualização e a TV usam
 * este mesmo código, então o que se aprova é o que aparece. Só CSS, que as TVs mais fracas aguentam.
 */
const ANIMACOES = `
@keyframes tvSobe { from { opacity: 0; transform: translateY(6%); } to { opacity: 1; transform: none; } }
@keyframes tvZoom { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
@keyframes tvSurge { from { opacity: 0; } to { opacity: 1; } }
@keyframes tvPulso { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
`;

function entrada(nivel: NivelEfetivo, indice: number): CSSProperties {
  if (nivel !== 'COMPLETO') return {};
  return { animation: `tvSobe .55s ease-out ${indice * 90}ms both` };
}

const linhas = (n: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: n, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' });

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

function Preco({ item, tamanho, maxLargura, cor, nivel, indice }: { item: ItemConteudoTela; tamanho: number; maxLargura: number; cor: string; nivel: NivelEfetivo; indice: number }) {
  return (
    <TextoQueCabe tamanho={tamanho} maxLargura={maxLargura} testId="preco-tela" style={{ background: cor, color: corDoTextoSobre(cor), fontWeight: 800, lineHeight: 1.15, padding: '.08em .28em', borderRadius: '.16em', ...(nivel === 'COMPLETO' ? { animation: `tvPulso 2.4s ease-in-out ${0.7 + indice * 0.09}s infinite` } : {}) }}>
      {item.preco}
    </TextoQueCabe>
  );
}

function PrecoDe({ item, tamanho, maxLargura }: { item: ItemConteudoTela; tamanho: number; maxLargura: number }) {
  if (!item.precoDe) return null;
  return (
    <TextoQueCabe tamanho={tamanho} maxLargura={maxLargura} style={{ opacity: 0.75, textDecoration: 'line-through' }}>
      de {item.precoDe}
    </TextoQueCabe>
  );
}

interface Celula {
  item: ItemConteudoTela;
  indice: number;
  largura: number;
  altura: number;
  corDestaque: string;
  nivel: NivelEfetivo;
}

function CartaoGrade({ item, indice, largura, altura, corDestaque, nivel }: Celula) {
  const nome = Math.min(altura * 0.115, largura * 0.075);
  const preco = Math.min(altura * 0.2, largura * 0.125);
  const util = (largura - 2 * Math.min(largura, altura) * 0.07) * 0.95;
  // O nome usa as linhas que sobram: em cartão alto (TV na vertical) cabe bem mais que em um largo.
  const blocoPreco = preco * 1.31 + nome * 1.4;
  const blocoDetalhe = item.detalhe ? nome * 1.1 : 0;
  const sobra = altura - 2 * Math.min(largura, altura) * 0.07 - blocoPreco - blocoDetalhe;
  const linhasDoNome = Math.max(1, Math.min(6, Math.floor(sobra / (nome * 1.15))));
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, boxSizing: 'border-box', padding: Math.min(largura, altura) * 0.07, borderRadius: Math.min(largura, altura) * 0.05, background: 'rgba(127,127,127,.16)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center', overflow: 'hidden', ...entrada(nivel, indice) }}>
      <div data-testid="texto-celula" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ ...linhas(linhasDoNome), fontSize: nome, fontWeight: 600, lineHeight: 1.15 }}>{item.nome}</div>
        {item.detalhe && <div style={{ ...linhas(1), fontSize: nome * 0.72, opacity: 0.75, marginTop: nome * 0.25 }}>{item.detalhe}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: nome * 0.2, marginTop: nome * 0.2 }}>
        <PrecoDe item={item} tamanho={nome * 0.8} maxLargura={util} />
        <Preco item={item} tamanho={preco} maxLargura={util} cor={corDestaque} nivel={nivel} indice={indice} />
      </div>
    </div>
  );
}

function CartaoDestaque({ item, indice, largura, altura, corDestaque, nivel, faixa }: Celula & { faixa: boolean }) {
  const animacao: CSSProperties = nivel === 'COMPLETO' ? { animation: 'tvZoom .6s ease-out both' } : {};
  // Lado a lado não cabe: nome em uma linha e o preço embaixo, que é o que importa de longe.
  if (faixa && largura < 400) {
    const nome = Math.min(altura * 0.28, largura * 0.11);
    const preco = Math.min(altura * 0.42, largura * 0.11);
    return (
      <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: altura * 0.06, overflow: 'hidden', ...animacao }}>
        <div style={{ maxWidth: largura, fontSize: nome, fontWeight: 600, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.nome}</div>
        <Preco item={item} tamanho={preco} maxLargura={largura} cor={corDestaque} nivel="LEVE" indice={indice} />
      </div>
    );
  }
  if (faixa) {
    const nome = Math.min(altura * 0.32, largura * 0.05);
    const preco = Math.min(altura * 0.6, largura * 0.09);
    return (
      <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: largura * 0.02, overflow: 'hidden', ...animacao }}>
        <div style={{ ...linhas(2), fontSize: nome, fontWeight: 700, lineHeight: 1.1, textAlign: 'left', minWidth: 0 }}>{item.nome}</div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: nome * 0.1 }}>
          <PrecoDe item={item} tamanho={nome * 0.6} maxLargura={largura * 0.5} />
          <Preco item={item} tamanho={preco} maxLargura={largura * 0.5} cor={corDestaque} nivel={nivel} indice={indice} />
        </div>
      </div>
    );
  }
  const nome = Math.min(altura * 0.11, largura * 0.07);
  const preco = Math.min(altura * 0.27, largura * 0.125);
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: altura * 0.05, textAlign: 'center', overflow: 'hidden', ...animacao }}>
      <div style={{ ...linhas(3), fontSize: nome, fontWeight: 700, lineHeight: 1.12, maxWidth: largura * 0.92 }}>{item.nome}</div>
      {item.detalhe && <div style={{ ...linhas(1), fontSize: nome * 0.55, opacity: 0.75 }}>{item.detalhe}</div>}
      <PrecoDe item={item} tamanho={nome * 0.7} maxLargura={largura * 0.92} />
      <Preco item={item} tamanho={preco} maxLargura={largura * 0.92} cor={corDestaque} nivel={nivel} indice={indice} />
    </div>
  );
}

function LinhaLista({ item, indice, largura, altura, corDestaque, nivel }: Celula) {
  const fonte = Math.min(altura * 0.46, largura * 0.055);
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: largura * 0.02, borderBottom: '1px solid rgba(127,127,127,.35)', overflow: 'hidden', ...entrada(nivel, indice) }}>
      <div style={{ minWidth: 0, flex: 1, textAlign: 'left', fontSize: fonte, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.nome}
        {item.detalhe && <span style={{ opacity: 0.7, fontSize: fonte * 0.72 }}> · {item.detalhe}</span>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: fonte * 0.5 }}>
        {/* Em linha estreita o preço anterior espreme o nome, que é o que identifica o produto. */}
        {largura >= 1200 && <PrecoDe item={item} tamanho={fonte * 0.68} maxLargura={largura * 0.2} />}
        <Preco item={item} tamanho={fonte * 0.92} maxLargura={largura * 0.42} cor={corDestaque} nivel="LEVE" indice={indice} />
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
}

function CenaProdutos({ programa, itens, grade: gradeCheia, largura, altura, margemPct, nivel, fuso }: PropsCena) {
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
  const temRodape = !pequena && !faixa;
  const altTitulo = temTitulo ? uteisA * 0.13 : 0;
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
        background: config.corFundo,
        color: texto,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        overflow: 'hidden',
        ...(nivel === 'ESTATICO' ? {} : { animation: 'tvSurge .35s ease-out both' }),
      }}
    >
      {temTitulo && (
        <div data-testid="titulo-tela" style={{ height: altTitulo, lineHeight: `${altTitulo}px`, textAlign: 'center', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', ...(nivel === 'COMPLETO' ? { animation: 'tvSobe .5s ease-out both' } : {}) }}>
          <TextoQueCabe tamanho={altTitulo * 0.68} maxLargura={uteisL}>{config.titulo}</TextoQueCabe>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grade.colunas}, ${celL}px)`, gridAutoRows: `${celA}px`, gap: espaco, justifyContent: 'center' }}>
        {itens.map((item, i) => {
          const comum = { item, indice: i, largura: celL, altura: celA, corDestaque: config.corDestaque, nivel };
          // Painel bem pequeno mostra um produto por vez, seja qual for o modelo.
          if (modelo === 'DESTAQUE' || (pequena && grade.colunas === 1)) return <CartaoDestaque key={i} {...comum} faixa={faixa || pequena} />;
          if (modelo === 'LISTA_PRECOS') return <LinhaLista key={i} {...comum} />;
          return <CartaoGrade key={i} {...comum} />;
        })}
      </div>
      {temRodape && (
        <div style={{ position: 'absolute', left: margemX + respiro, right: margemX + respiro, bottom: margemY + respiro, height: altRodape, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: respiro, fontSize: altRodape * 0.5, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden' }}>
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

function CenaImagem({ programa, url, largura, altura, margemPct, nivel, aoFalhar }: { programa: ProgramaTela; url: string; largura: number; altura: number; margemPct: number; nivel: NivelEfetivo; aoFalhar: () => void }) {
  const cobrir = programa.config.ajuste === 'COBRIR';
  // Cobrindo, a imagem vai até a borda de propósito: quem escolheu aceitou cortar.
  const margemX = cobrir ? 0 : (largura * margemPct) / 100;
  const margemY = cobrir ? 0 : (altura * margemPct) / 100;
  const animacao: CSSProperties = nivel === 'ESTATICO' ? {} : { animation: nivel === 'COMPLETO' ? 'tvZoom .6s ease-out both' : 'tvSurge .35s ease-out both' };
  return (
    <div data-testid="cena-imagem" style={{ position: 'absolute', inset: 0, background: programa.config.corFundo, overflow: 'hidden' }}>
      <img src={url} alt="" onError={aoFalhar} style={{ position: 'absolute', left: margemX, top: margemY, width: largura - 2 * margemX, height: altura - 2 * margemY, objectFit: cobrir ? 'cover' : 'contain', ...animacao }} />
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
  }, [proxima]);

  useEffect(() => {
    const relogio = setTimeout(() => setPasso((p) => p + 1), segundos * 1000);
    return () => clearTimeout(relogio);
  }, [passo, segundos]);

  if (!atual) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: atual.programa.config.corFundo }}>
      <style>{ANIMACOES}</style>
      {atual.tipo === 'imagem' ? (
        <CenaImagem key={passo} programa={atual.programa} url={atual.url} largura={largura} altura={altura} margemPct={margemPct} nivel={nivel} aoFalhar={() => setFalhas((f) => new Set(f).add(atual.url))} />
      ) : (
        <CenaProdutos key={passo} programa={atual.programa} itens={atual.itens} grade={atual.grade} largura={largura} altura={altura} margemPct={margemPct} nivel={nivel} fuso={fuso} />
      )}
    </div>
  );
}
