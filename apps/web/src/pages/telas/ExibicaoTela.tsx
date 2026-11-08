import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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

function Preco({ item, tamanho, cor, nivel, indice }: { item: ItemConteudoTela; tamanho: number; cor: string; nivel: NivelEfetivo; indice: number }) {
  return (
    <span data-testid="preco-tela" style={{ display: 'inline-block', background: cor, color: corDoTextoSobre(cor), fontSize: tamanho, fontWeight: 800, lineHeight: 1.15, padding: `${tamanho * 0.08}px ${tamanho * 0.28}px`, borderRadius: tamanho * 0.16, whiteSpace: 'nowrap', ...(nivel === 'COMPLETO' ? { animation: `tvPulso 2.4s ease-in-out ${0.7 + indice * 0.09}s infinite` } : {}) }}>
      {item.preco}
    </span>
  );
}

function PrecoDe({ item, tamanho }: { item: ItemConteudoTela; tamanho: number }) {
  if (!item.precoDe) return null;
  return <span style={{ fontSize: tamanho, opacity: 0.75, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>de {item.precoDe}</span>;
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
  return (
    <div data-testid="celula-tela" style={{ width: largura, height: altura, boxSizing: 'border-box', padding: Math.min(largura, altura) * 0.07, borderRadius: Math.min(largura, altura) * 0.05, background: 'rgba(127,127,127,.16)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center', overflow: 'hidden', ...entrada(nivel, indice) }}>
      <div data-testid="texto-celula" style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ ...linhas(item.detalhe ? 2 : 3), fontSize: nome, fontWeight: 600, lineHeight: 1.15 }}>{item.nome}</div>
        {item.detalhe && <div style={{ ...linhas(1), fontSize: nome * 0.72, opacity: 0.75, marginTop: nome * 0.25 }}>{item.detalhe}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: nome * 0.2, marginTop: nome * 0.2 }}>
        <PrecoDe item={item} tamanho={nome * 0.8} />
        <Preco item={item} tamanho={preco} cor={corDestaque} nivel={nivel} indice={indice} />
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
        <Preco item={item} tamanho={preco} cor={corDestaque} nivel="LEVE" indice={indice} />
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
          <PrecoDe item={item} tamanho={nome * 0.6} />
          <Preco item={item} tamanho={preco} cor={corDestaque} nivel={nivel} indice={indice} />
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
      <PrecoDe item={item} tamanho={nome * 0.7} />
      <Preco item={item} tamanho={preco} cor={corDestaque} nivel={nivel} indice={indice} />
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
        {largura >= 1200 && <PrecoDe item={item} tamanho={fonte * 0.68} />}
        <Preco item={item} tamanho={fonte * 0.92} cor={corDestaque} nivel="LEVE" indice={indice} />
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

function Cena({ programa, itens, grade: gradeCheia, largura, altura, margemPct, nivel, fuso }: PropsCena) {
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
  // Em negrito, cada letra ocupa cerca de 0,62 da altura: título longo em tela estreita diminui em vez de ser cortado.
  const fonteTitulo = Math.min(altTitulo * 0.68, uteisL / (Math.max(1, config.titulo.trim().length) * 0.62));

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
        <div data-testid="titulo-tela" style={{ height: altTitulo, lineHeight: `${altTitulo}px`, textAlign: 'center', fontSize: fonteTitulo, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(nivel === 'COMPLETO' ? { animation: 'tvSobe .5s ease-out both' } : {}) }}>
          {config.titulo}
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

interface PropsExibicao {
  programas: ProgramaTela[];
  largura: number;
  altura: number;
  margemPct: number;
  nivel: NivelEfetivo;
  fuso?: string;
}

/** Passa pelos programas, cena a cena. Programação nova entra sem interromper: vale a partir da próxima cena. */
export function ExibicaoTela({ programas, largura, altura, margemPct, nivel, fuso }: PropsExibicao) {
  const cenas = useMemo(
    () =>
      programas.flatMap((programa) => {
        const grade = gradeDaCena(programa.modelo, largura, altura);
        return cenasDosItens(programa.itens, grade).map((itens) => ({ programa, itens, grade }));
      }),
    [programas, largura, altura],
  );
  const [passo, setPasso] = useState(0);
  const atual = cenas.length ? cenas[passo % cenas.length] : null;
  const segundos = atual?.programa.config.segundosPorCena ?? 8;

  useEffect(() => {
    const relogio = setTimeout(() => setPasso((p) => p + 1), segundos * 1000);
    return () => clearTimeout(relogio);
  }, [passo, segundos]);

  if (!atual) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: atual.programa.config.corFundo }}>
      <style>{ANIMACOES}</style>
      <Cena key={passo} {...atual} largura={largura} altura={altura} margemPct={margemPct} nivel={nivel} fuso={fuso} />
    </div>
  );
}
