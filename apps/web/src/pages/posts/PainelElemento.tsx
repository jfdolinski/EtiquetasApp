import type { ReactNode } from 'react';
import { rotuloElemento, type AjusteElemento, type ElementoPost, type EstiloElemento, type ImagemPost, type ProdutoCatalogo } from '@etiquetas/shared';
import { SeletorFonte } from '../../components/SeletorFonte';
import { Botao } from '../../components/ui';
import { CLASSE_PAINEL } from './apoio';
import { EscolherImagem } from './EscolherImagem';

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{rotulo}</span>
      {children}
    </label>
  );
}

function Numero({ rotulo, valor, aoMudar, min, max, passo = 1 }: { rotulo: string; valor: number; aoMudar: (n: number) => void; min?: number; max?: number; passo?: number }) {
  return (
    <Linha rotulo={rotulo}>
      <input
        type="number"
        className={CLASSE_PAINEL}
        value={Number.isFinite(valor) ? valor : 0}
        min={min}
        max={max}
        step={passo}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) aoMudar(min !== undefined || max !== undefined ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)) : n);
        }}
      />
    </Linha>
  );
}

function Deslizante({ rotulo, valor, aoMudar, min, max, passo = 1, unidade = '' }: { rotulo: string; valor: number; aoMudar: (n: number) => void; min: number; max: number; passo?: number; unidade?: string }) {
  return (
    <label className="block">
      <span className="mb-0.5 flex justify-between text-xs font-medium text-slate-600">
        {rotulo} <span className="tabular-nums text-slate-500">{Math.round(valor * 100) / 100}{unidade}</span>
      </span>
      <input type="range" aria-label={rotulo} className="w-full" min={min} max={max} step={passo} value={valor} onChange={(e) => aoMudar(e.target.valueAsNumber)} />
    </label>
  );
}

export function Cor({ rotulo, valor, aoMudar, aoTirar }: { rotulo: string; valor: string; aoMudar: (c: string) => void; aoTirar?: () => void }) {
  return (
    <div>
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{rotulo}</span>
      <div className="flex items-center gap-1">
        <input type="color" aria-label={rotulo} value={valor} onChange={(e) => aoMudar(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5" />
        <input
          aria-label={`${rotulo} em hexadecimal`}
          className={CLASSE_PAINEL}
          defaultValue={valor}
          key={valor}
          maxLength={7}
          onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && aoMudar(e.target.value.toLowerCase())}
        />
        {aoTirar && <button type="button" onClick={aoTirar} title={`Tirar ${rotulo.toLowerCase()}`} aria-label={`Tirar ${rotulo.toLowerCase()}`} className="px-1 text-slate-500 hover:text-red-700">✕</button>}
      </div>
    </div>
  );
}

function Liga({ titulo, ativo, aoMudar, children }: { titulo: string; ativo: boolean; aoMudar: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} aria-pressed={ativo} onClick={() => aoMudar(!ativo)} className={`h-8 min-w-8 rounded border px-2 text-sm ${ativo ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}

function Grupo<T extends string>({ rotulo, valor, opcoes, aoMudar }: { rotulo: string; valor: T; opcoes: { v: T; texto: string; titulo: string }[]; aoMudar: (v: T) => void }) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex overflow-hidden rounded border border-slate-300">
      {opcoes.map((o) => (
        <button key={o.v} type="button" title={o.titulo} aria-label={o.titulo} aria-pressed={valor === o.v} onClick={() => aoMudar(o.v)} className={`h-8 min-w-8 px-2 text-sm ${valor === o.v ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-slate-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      {children}
    </section>
  );
}

export type ModoAlinhar = 'esquerda' | 'centroX' | 'direita' | 'topo' | 'centroY' | 'base';

interface Props {
  el: ElementoPost;
  varios: boolean;
  /** Texto a editar: vem dos dados do post ou do próprio elemento. Nulo: não dá para escrever (ex.: contatos). */
  texto: string | null;
  aoMudarTexto: (t: string) => void;
  /** Aviso de IA e contatos são montados pelo sistema. */
  avisoTexto?: string;
  aoEstilo: (m: EstiloElemento) => void;
  aoAjuste: (m: AjusteElemento) => void;
  aoAlinhar: (m: ModoAlinhar) => void;
  aoCamada: (m: 'frente' | 'tras' | 'subir' | 'descer') => void;
  aoDuplicar: () => void;
  aoExcluir: () => void;
  aoRestaurar: () => void;
  catalogo: ProdutoCatalogo | null;
  aoTrocarImagem: ((i: ImagemPost | null) => void) | null;
}

/** Tudo o que dá para mudar no elemento selecionado. */
export function PainelElemento({ el, varios, texto, aoMudarTexto, avisoTexto, aoEstilo, aoAjuste, aoAlinhar, aoCamada, aoDuplicar, aoExcluir, aoRestaurar, catalogo, aoTrocarImagem }: Props) {
  const ehExtra = el.id.startsWith('extra-');
  const ehForma = el.tipo === 'retangulo' || el.tipo === 'elipse' || el.tipo === 'estrela';
  const temContornoOuFundo = el.tipo === 'texto';
  return (
    <div className="space-y-3" aria-label={`Propriedades: ${rotuloElemento(el, varios)}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-semibold">{rotuloElemento(el, varios)}</h2>
        <div className="flex gap-1">
          <Liga titulo="Travar a posição" ativo={!!el.travado} aoMudar={(travado) => aoAjuste({ travado })}>🔒</Liga>
          <Liga titulo="Ocultar" ativo={!!el.oculto} aoMudar={(oculto) => aoAjuste({ oculto })}>🚫</Liga>
        </div>
      </div>

      {(el.tipo === 'texto' || el.tipo === 'qr') && texto !== null && (
        <Linha rotulo={el.tipo === 'qr' ? 'Link ou texto do QR code' : 'Texto'}>
          <textarea rows={el.tipo === 'qr' ? 2 : 3} className={CLASSE_PAINEL} value={texto} onChange={(e) => aoMudarTexto(e.target.value)} maxLength={1000} />
        </Linha>
      )}
      {avisoTexto && <p className="text-xs text-slate-500">{avisoTexto}</p>}

      {el.tipo === 'texto' && (
        <Secao titulo="Letra">
          <div>
            <span className="mb-0.5 block text-xs font-medium text-slate-600">Fonte</span>
            <SeletorFonte valor={el.fonte} aoMudar={(fonte) => aoEstilo({ fonte })} rotulo="Fonte do elemento" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Numero rotulo="Tamanho máximo" valor={el.tamanho ?? 40} min={8} max={500} aoMudar={(tamanho) => aoEstilo({ tamanho })} />
            <Cor rotulo="Cor do texto" valor={el.cor ?? '#000000'} aoMudar={(cor) => aoEstilo({ cor })} />
          </div>
          <div className="flex flex-wrap gap-1">
            <Liga titulo="Negrito" ativo={!!el.negrito} aoMudar={(negrito) => aoEstilo({ negrito })}><b>N</b></Liga>
            <Liga titulo="Itálico" ativo={!!el.italico} aoMudar={(italico) => aoEstilo({ italico })}><i>I</i></Liga>
            <Liga titulo="Sublinhado" ativo={!!el.sublinhado} aoMudar={(sublinhado) => aoEstilo({ sublinhado })}><u>S</u></Liga>
            <Liga titulo="Tachado" ativo={!!el.tachado} aoMudar={(tachado) => aoEstilo({ tachado })}><s>T</s></Liga>
            {el.preco && <Liga titulo="R$ e centavos menores" ativo={el.centavosPequenos !== false} aoMudar={(centavosPequenos) => aoEstilo({ centavosPequenos })}>,99</Liga>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Grupo rotulo="Alinhamento" valor={el.alinhamento ?? 'center'} aoMudar={(alinhamento) => aoEstilo({ alinhamento })} opcoes={[{ v: 'left', texto: '⇤', titulo: 'Alinhar à esquerda' }, { v: 'center', texto: '↔', titulo: 'Centralizar texto' }, { v: 'right', texto: '⇥', titulo: 'Alinhar à direita' }]} />
            <Grupo rotulo="Alinhamento vertical" valor={el.alinhamentoVertical ?? 'middle'} aoMudar={(alinhamentoVertical) => aoEstilo({ alinhamentoVertical })} opcoes={[{ v: 'top', texto: '⤒', titulo: 'Texto no topo' }, { v: 'middle', texto: '↕', titulo: 'Texto no meio' }, { v: 'bottom', texto: '⤓', titulo: 'Texto na base' }]} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Numero rotulo="Entre letras" valor={el.espacamentoLetras ?? 0} min={-20} max={100} aoMudar={(espacamentoLetras) => aoEstilo({ espacamentoLetras })} />
            <Numero rotulo="Altura linha" valor={el.alturaLinha ?? 1.15} passo={0.05} min={0.5} max={4} aoMudar={(alturaLinha) => aoEstilo({ alturaLinha })} />
            <Linha rotulo="Letras">
              <select className={CLASSE_PAINEL} value={el.caixa ?? 'normal'} onChange={(e) => aoEstilo({ caixa: e.target.value as EstiloElemento['caixa'] })}>
                <option value="normal">Aa</option>
                <option value="maiusculas">AA</option>
                <option value="minusculas">aa</option>
              </select>
            </Linha>
          </div>
        </Secao>
      )}

      {temContornoOuFundo && (
        <Secao titulo="Destaque do texto">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!el.contornoCor} onChange={(e) => aoEstilo({ contornoCor: e.target.checked ? '#000000' : undefined })} />
            Contorno nas letras
          </label>
          {el.contornoCor && (
            <div className="grid grid-cols-2 gap-2">
              <Cor rotulo="Cor do contorno" valor={el.contornoCor} aoMudar={(contornoCor) => aoEstilo({ contornoCor })} />
              <Numero rotulo="Espessura" valor={el.contornoEspessura ?? 2} min={1} max={40} aoMudar={(contornoEspessura) => aoEstilo({ contornoEspessura })} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!el.fundoTexto} onChange={(e) => aoEstilo({ fundoTexto: e.target.checked ? '#ffd600' : undefined })} />
            Fundo atrás do texto
          </label>
          {el.fundoTexto && (
            <div className="grid grid-cols-2 gap-2">
              <Cor rotulo="Cor do fundo" valor={el.fundoTexto} aoMudar={(fundoTexto) => aoEstilo({ fundoTexto })} />
              <Numero rotulo="Cantos" valor={el.raio ?? 0} min={0} max={500} aoMudar={(raio) => aoEstilo({ raio })} />
            </div>
          )}
        </Secao>
      )}

      {(ehForma || el.tipo === 'linha') && (
        <Secao titulo="Forma">
          <Cor rotulo={el.tipo === 'linha' ? 'Cor da linha' : 'Preenchimento'} valor={el.cor ?? '#ffffff'} aoMudar={(cor) => aoEstilo({ cor })} />
          {ehForma && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!el.cor2} onChange={(e) => aoEstilo({ cor2: e.target.checked ? '#ffffff' : undefined })} />
                Degradê
              </label>
              {el.cor2 && (
                <div className="grid grid-cols-2 gap-2">
                  <Cor rotulo="Segunda cor" valor={el.cor2} aoMudar={(cor2) => aoEstilo({ cor2 })} />
                  <Numero rotulo="Ângulo" valor={el.angulo ?? 135} min={0} max={360} aoMudar={(angulo) => aoEstilo({ angulo })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Cor rotulo="Cor da borda" valor={el.bordaCor ?? '#000000'} aoMudar={(bordaCor) => aoEstilo({ bordaCor })} />
                <Numero rotulo="Borda" valor={el.bordaEspessura ?? 0} min={0} max={60} aoMudar={(bordaEspessura) => aoEstilo({ bordaEspessura, bordaCor: el.bordaCor ?? '#000000' })} />
              </div>
            </>
          )}
          {el.tipo === 'retangulo' && <Numero rotulo="Cantos arredondados" valor={el.raio ?? 0} min={0} max={500} aoMudar={(raio) => aoEstilo({ raio })} />}
          {el.tipo === 'estrela' && (
            <div className="grid grid-cols-2 gap-2">
              <Numero rotulo="Pontas" valor={el.pontas ?? 5} min={3} max={40} aoMudar={(pontas) => aoEstilo({ pontas })} />
              <Numero rotulo="Miolo" valor={el.raioInterno ?? 0.5} passo={0.05} min={0.1} max={0.95} aoMudar={(raioInterno) => aoEstilo({ raioInterno })} />
            </div>
          )}
          {el.tipo === 'linha' && <Numero rotulo="Espessura" valor={el.bordaEspessura ?? 8} min={1} max={100} aoMudar={(bordaEspessura) => aoEstilo({ bordaEspessura })} />}
        </Secao>
      )}

      {el.tipo === 'imagem' && (
        <Secao titulo="Imagem">
          {aoTrocarImagem && <EscolherImagem titulo={rotuloElemento(el, varios)} catalogo={catalogo} marcada={el.imagem} somenteLeitura={false} aoEscolher={aoTrocarImagem} />}
          <Grupo rotulo="Encaixe" valor={el.ajusteImagem ?? 'conter'} aoMudar={(ajusteImagem) => aoEstilo({ ajusteImagem })} opcoes={[{ v: 'conter', texto: 'Inteira', titulo: 'Imagem inteira no quadro' }, { v: 'cobrir', texto: 'Preencher', titulo: 'Preencher o quadro, cortando as sobras' }]} />
          <div className="grid grid-cols-2 items-end gap-2">
            <Numero rotulo="Cantos" valor={el.raio ?? 0} min={0} max={500} aoMudar={(raio) => aoEstilo({ raio })} />
            <label className="flex items-center gap-2 pb-1 text-sm">
              <input type="checkbox" checked={!!el.espelhar} onChange={(e) => aoEstilo({ espelhar: e.target.checked })} />
              Espelhar
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Cor rotulo="Cor da borda" valor={el.bordaCor ?? '#ffffff'} aoMudar={(bordaCor) => aoEstilo({ bordaCor })} />
            <Numero rotulo="Borda" valor={el.bordaEspessura ?? 0} min={0} max={60} aoMudar={(bordaEspessura) => aoEstilo({ bordaEspessura, bordaCor: el.bordaCor ?? '#ffffff' })} />
          </div>
          <Deslizante rotulo="Brilho" valor={el.brilho ?? 100} min={30} max={200} unidade="%" aoMudar={(brilho) => aoEstilo({ brilho })} />
          <Deslizante rotulo="Contraste" valor={el.contraste ?? 100} min={30} max={200} unidade="%" aoMudar={(contraste) => aoEstilo({ contraste })} />
          <Deslizante rotulo="Saturação" valor={el.saturacao ?? 100} min={0} max={250} unidade="%" aoMudar={(saturacao) => aoEstilo({ saturacao })} />
        </Secao>
      )}

      <Secao titulo="Efeitos">
        <Deslizante rotulo="Opacidade" valor={Math.round((el.opacidade ?? 1) * 100)} min={5} max={100} unidade="%" aoMudar={(n) => aoEstilo({ opacidade: n / 100 })} />
        {el.tipo !== 'imagem' && el.tipo !== 'qr' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!el.sombraCor} onChange={(e) => aoEstilo({ sombraCor: e.target.checked ? '#000000' : undefined })} />
              Sombra
            </label>
            {el.sombraCor && (
              <div className="grid grid-cols-2 gap-2">
                <Cor rotulo="Cor da sombra" valor={el.sombraCor} aoMudar={(sombraCor) => aoEstilo({ sombraCor })} />
                <Numero rotulo="Desfoque" valor={el.sombraBlur ?? 10} min={0} max={100} aoMudar={(sombraBlur) => aoEstilo({ sombraBlur })} />
                <Numero rotulo="Deslocar X" valor={el.sombraX ?? 0} min={-100} max={100} aoMudar={(sombraX) => aoEstilo({ sombraX })} />
                <Numero rotulo="Deslocar Y" valor={el.sombraY ?? 4} min={-100} max={100} aoMudar={(sombraY) => aoEstilo({ sombraY })} />
              </div>
            )}
          </>
        )}
      </Secao>

      <Secao titulo="Posição e tamanho neste formato">
        <div className="grid grid-cols-2 gap-2">
          <Numero rotulo="X" valor={Math.round(el.x)} aoMudar={(x) => aoAjuste({ x })} />
          <Numero rotulo="Y" valor={Math.round(el.y)} aoMudar={(y) => aoAjuste({ y })} />
          <Numero rotulo="Largura" valor={Math.round(el.largura)} min={10} max={3000} aoMudar={(largura) => aoAjuste({ largura })} />
          <Numero rotulo="Altura" valor={Math.round(el.altura)} min={10} max={3000} aoMudar={(altura) => aoAjuste({ altura })} />
        </div>
        <Deslizante rotulo="Rotação" valor={el.rotacao ?? 0} min={-180} max={180} unidade="°" aoMudar={(rotacao) => aoAjuste({ rotacao })} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Alinhar na arte">
          {(
            [
              ['esquerda', '⇤', 'Encostar à esquerda'],
              ['centroX', '↔', 'Centralizar na largura'],
              ['direita', '⇥', 'Encostar à direita'],
              ['topo', '⤒', 'Encostar no topo'],
              ['centroY', '↕', 'Centralizar na altura'],
              ['base', '⤓', 'Encostar na base'],
            ] as [ModoAlinhar, string, string][]
          ).map(([m, t, titulo]) => (
            <button key={m} type="button" title={titulo} aria-label={titulo} onClick={() => aoAlinhar(m)} className="h-8 min-w-8 rounded border border-slate-300 bg-white px-2 text-sm hover:bg-slate-50">{t}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Ordem das camadas">
          <Botao variante="secundario" onClick={() => aoCamada('frente')}>Trazer à frente</Botao>
          <Botao variante="secundario" onClick={() => aoCamada('tras')}>Enviar para trás</Botao>
        </div>
      </Secao>

      <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-3">
        <Botao variante="secundario" onClick={aoDuplicar}>Duplicar</Botao>
        {!ehExtra && <Botao variante="secundario" onClick={aoRestaurar}>Voltar ao modelo</Botao>}
        <Botao variante="secundario" onClick={aoExcluir}>{ehExtra ? 'Excluir' : 'Tirar da arte'}</Botao>
      </div>
    </div>
  );
}

/** Lista de camadas, da frente para o fundo. */
export function Camadas({ elementos, selecionado, varios, aoSelecionar, aoAjustar, aoMover }: { elementos: ElementoPost[]; selecionado: string | null; varios: boolean; aoSelecionar: (id: string) => void; aoAjustar: (id: string, m: AjusteElemento) => void; aoMover: (id: string, m: 'subir' | 'descer') => void }) {
  const lista = [...elementos].filter((e) => !e.fixo).reverse();
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">Camadas</h2>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 bg-white text-sm">
        {lista.map((e, i) => {
          const nome = rotuloElemento(e, varios);
          return (
            <li key={e.id} className={`flex items-center gap-1 px-1 ${e.id === selecionado ? 'bg-blue-50' : ''} ${e.oculto ? 'opacity-50' : ''}`}>
              <button type="button" aria-label={`Selecionar ${nome}`} onClick={() => aoSelecionar(e.id)} className="min-w-0 flex-1 truncate py-1 pl-1 text-left">{nome}</button>
              <button type="button" aria-label={`${e.oculto ? 'Mostrar' : 'Ocultar'} ${nome}`} title={e.oculto ? 'Mostrar' : 'Ocultar'} onClick={() => aoAjustar(e.id, { oculto: !e.oculto })} className="px-1 text-xs">{e.oculto ? '🚫' : '👁'}</button>
              <button type="button" aria-label={`Subir ${nome}`} title="Subir" disabled={i === 0} onClick={() => aoMover(e.id, 'subir')} className="px-1 text-xs disabled:opacity-30">▲</button>
              <button type="button" aria-label={`Descer ${nome}`} title="Descer" disabled={i === lista.length - 1} onClick={() => aoMover(e.id, 'descer')} className="px-1 text-xs disabled:opacity-30">▼</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
