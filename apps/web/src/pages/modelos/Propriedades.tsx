import { useState, type ReactNode } from 'react';
import {
  FONTES,
  FORMATOS_DATA,
  PALETA,
  PAPEIS_CARTAZ,
  ROTULO_CATEGORIA,
  ROTULO_SIMBOLOGIA,
  SIMBOLOGIAS,
  type CampoDinamico,
  type Cor,
  type ElementoEtiqueta,
  type ElementoImagem,
  type ElementoPreco,
  type ElementoTexto,
  type FormatoCampo,
  type FormatoData,
  type LayoutEtiqueta,
  type OrigemValor,
  type Rotacao,
  type Simbologia,
} from '@etiquetas/shared';
import { cssFonte } from './fontes';
import { lerImagem } from './imagens';

const CLASSE = 'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-100';

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{rotulo}</span>
      {children}
    </label>
  );
}

function Numero({ valor, aoMudar, min, max, passo = 0.5 }: { valor: number; aoMudar: (n: number) => void; min?: number; max?: number; passo?: number }) {
  return (
    <input
      type="number"
      className={CLASSE}
      value={Number.isFinite(valor) ? valor : ''}
      min={min}
      max={max}
      step={passo}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) aoMudar(n);
      }}
    />
  );
}

/** Seção recolhível do painel. */
function Secao({ titulo, children, aberta = true }: { titulo: string; children: ReactNode; aberta?: boolean }) {
  return (
    <details open={aberta} className="group rounded border border-slate-200">
      <summary className="cursor-pointer select-none bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">{titulo}</summary>
      <div className="space-y-2 p-2">{children}</div>
    </details>
  );
}

/** Botões de alternância (negrito, alinhamento…). */
function Alternar<T extends string | boolean>({ opcoes, valor, aoMudar }: { opcoes: { v: T; rotulo: ReactNode; titulo: string }[]; valor: T; aoMudar: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-300">
      {opcoes.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          title={o.titulo}
          aria-pressed={valor === o.v}
          onClick={() => aoMudar(o.v)}
          className={`min-w-8 border-r border-slate-300 px-2 py-1 text-sm last:border-r-0 ${valor === o.v ? 'bg-blue-600 text-white' : 'bg-white hover:bg-slate-50'}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

function Liga({ ativo, aoMudar, children, titulo }: { ativo: boolean; aoMudar: (v: boolean) => void; children: ReactNode; titulo: string }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-pressed={ativo}
      onClick={() => aoMudar(!ativo)}
      className={`min-w-8 rounded border px-2 py-1 text-sm ${ativo ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}

/** Seletor de cor: paleta rápida + cor livre. */
export function CampoCor({ valor, aoMudar, rotulo }: { valor: Cor; aoMudar: (c: Cor) => void; rotulo: string }) {
  return (
    <div>
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{rotulo}</span>
      <div className="flex flex-wrap items-center gap-1">
        <input type="color" value={valor} onChange={(e) => aoMudar(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5" title="Outra cor" />
        {PALETA.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => aoMudar(c)}
            className={`h-5 w-5 rounded-sm border ${valor.toLowerCase() === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-300'}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

function Opacidade({ valor, aoMudar }: { valor: number; aoMudar: (v: number) => void }) {
  return (
    <Linha rotulo={`Opacidade: ${Math.round(valor * 100)}%`}>
      <input type="range" min={0} max={100} value={Math.round(valor * 100)} onChange={(e) => aoMudar(Number(e.target.value) / 100)} className="w-full" />
    </Linha>
  );
}

const ROTULO_ORIGEM = { fixo: 'Texto fixo', campo: 'Campo da consulta', data: 'Data', contador: 'Contador' } as const;

function EditorOrigem({
  origem,
  campos,
  aoMudar,
  permitirFormato,
  multilinha = false,
}: {
  origem: OrigemValor;
  campos: CampoDinamico[];
  aoMudar: (o: OrigemValor) => void;
  permitirFormato: boolean;
  multilinha?: boolean;
}) {
  function trocarTipo(tipo: OrigemValor['tipo']) {
    if (tipo === 'fixo') aoMudar({ tipo, texto: '' });
    if (tipo === 'campo') aoMudar({ tipo, campo: campos[0]?.nome ?? '' });
    if (tipo === 'data') aoMudar({ tipo, dias: 0, formato: 'dd/MM/yyyy' });
    if (tipo === 'contador') aoMudar({ tipo, inicio: 1, passo: 1, digitos: 0 });
  }

  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
      <Linha rotulo="Conteúdo">
        <select className={CLASSE} value={origem.tipo} onChange={(e) => trocarTipo(e.target.value as OrigemValor['tipo'])}>
          {Object.entries(ROTULO_ORIGEM).map(([v, r]) => (
            <option key={v} value={v}>{r}</option>
          ))}
        </select>
      </Linha>
      {origem.tipo === 'fixo' && (
        <Linha rotulo={multilinha ? 'Texto (Enter quebra a linha)' : 'Texto'}>
          {multilinha ? (
            <textarea className={CLASSE} rows={3} value={origem.texto} maxLength={500} onChange={(e) => aoMudar({ ...origem, texto: e.target.value })} />
          ) : (
            <input className={CLASSE} value={origem.texto} maxLength={500} onChange={(e) => aoMudar({ ...origem, texto: e.target.value })} />
          )}
        </Linha>
      )}
      {origem.tipo === 'campo' && (
        <>
          <Linha rotulo="Campo">
            <select className={CLASSE} value={origem.campo} onChange={(e) => aoMudar({ ...origem, campo: e.target.value })}>
              {!campos.some((c) => c.nome === origem.campo) && <option value={origem.campo}>{origem.campo || 'Selecione…'} (fora da consulta)</option>}
              {campos.map((c) => (
                <option key={c.nome} value={c.nome}>
                  {c.nome} · {ROTULO_CATEGORIA[c.categoria]}
                </option>
              ))}
            </select>
          </Linha>
          {permitirFormato && <EditorFormato formato={origem.formato} aoMudar={(formato) => aoMudar({ ...origem, formato })} />}
        </>
      )}
      {origem.tipo === 'data' && (
        <div className="grid grid-cols-2 gap-2">
          <Linha rotulo="Hoje + dias">
            <Numero valor={origem.dias} passo={1} min={-3650} max={3650} aoMudar={(dias) => aoMudar({ ...origem, dias: Math.round(dias) })} />
          </Linha>
          <Linha rotulo="Formato">
            <select className={CLASSE} value={origem.formato} onChange={(e) => aoMudar({ ...origem, formato: e.target.value as FormatoData })}>
              {FORMATOS_DATA.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Linha>
        </div>
      )}
      {origem.tipo === 'contador' && (
        <div className="grid grid-cols-3 gap-2">
          <Linha rotulo="Início">
            <Numero valor={origem.inicio} passo={1} aoMudar={(inicio) => aoMudar({ ...origem, inicio: Math.round(inicio) })} />
          </Linha>
          <Linha rotulo="Passo">
            <Numero valor={origem.passo} passo={1} aoMudar={(passo) => aoMudar({ ...origem, passo: Math.round(passo) })} />
          </Linha>
          <Linha rotulo="Dígitos">
            <Numero valor={origem.digitos} passo={1} min={0} max={12} aoMudar={(digitos) => aoMudar({ ...origem, digitos: Math.round(digitos) })} />
          </Linha>
        </div>
      )}
    </div>
  );
}

function EditorFormato({ formato, aoMudar }: { formato: FormatoCampo | undefined; aoMudar: (f: FormatoCampo | undefined) => void }) {
  const tipo = formato?.tipo ?? 'texto';
  return (
    <div className="grid grid-cols-2 gap-2">
      <Linha rotulo="Formato">
        <select
          className={CLASSE}
          value={tipo}
          onChange={(e) => {
            const t = e.target.value;
            if (t === 'texto') aoMudar(undefined);
            if (t === 'numero' || t === 'moeda') aoMudar({ tipo: t, casas: 2 });
            if (t === 'data') aoMudar({ tipo: 'data', formato: 'dd/MM/yyyy' });
          }}
        >
          <option value="texto">Como vier</option>
          <option value="numero">Número</option>
          <option value="moeda">Moeda (R$)</option>
          <option value="data">Data</option>
        </select>
      </Linha>
      {(formato?.tipo === 'numero' || formato?.tipo === 'moeda') && (
        <Linha rotulo="Casas decimais">
          <Numero valor={formato.casas} passo={1} min={0} max={6} aoMudar={(casas) => aoMudar({ ...formato, casas: Math.round(casas) })} />
        </Linha>
      )}
      {formato?.tipo === 'data' && (
        <Linha rotulo="Exibir">
          <select className={CLASSE} value={formato.formato} onChange={(e) => aoMudar({ tipo: 'data', formato: e.target.value as FormatoData })}>
            {FORMATOS_DATA.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Linha>
      )}
    </div>
  );
}

const TITULO = {
  texto: 'Texto',
  preco: 'Preço',
  codigo_barras: 'Código de barras',
  qrcode: 'QR code',
  retangulo: 'Retângulo',
  elipse: 'Elipse / círculo',
  estrela: 'Estrela / explosão',
  linha: 'Linha',
  imagem: 'Imagem',
} as const;

const CATEGORIAS = [...new Set(FONTES.map((f) => f.categoria))];

/** Fonte, tamanho, cor, estilo, alinhamento e efeitos: comum a texto e preço. */
type MudancaFonte = Partial<Omit<ElementoTexto, 'tipo'> & Omit<ElementoPreco, 'tipo'>>;

function PropriedadesFonte({ el, aoMudar }: { el: ElementoTexto | ElementoPreco; aoMudar: (m: MudancaFonte) => void }) {
  const texto = el.tipo === 'texto' ? el : null;
  return (
    <>
      <Secao titulo="Fonte">
        <Linha rotulo="Família">
          <select className={CLASSE} value={el.fonte ?? 'helvetica'} onChange={(e) => aoMudar({ fonte: e.target.value })} style={{ font: cssFonte(el.fonte, false, false, 15) }}>
            {CATEGORIAS.map((c) => (
              <optgroup key={c} label={c}>
                {FONTES.filter((f) => f.categoria === c).map((f) => (
                  <option key={f.id} value={f.id} style={{ font: cssFonte(f.id, false, false, 15) }}>
                    {f.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Linha>
        <div className="grid grid-cols-2 gap-2">
          <Linha rotulo={el.ajustar ? 'Tamanho máximo (pt)' : 'Tamanho (pt)'}>
            <Numero valor={el.tamanhoPt} passo={1} min={4} max={2000} aoMudar={(tamanhoPt) => aoMudar({ tamanhoPt: Math.max(4, Math.min(2000, tamanhoPt)) })} />
          </Linha>
          <div className="flex items-end gap-1">
            <Liga titulo="Negrito" ativo={el.negrito} aoMudar={(negrito) => aoMudar({ negrito })}>
              <b>N</b>
            </Liga>
            <Liga titulo="Itálico" ativo={el.italico ?? false} aoMudar={(italico) => aoMudar({ italico })}>
              <i>I</i>
            </Liga>
            {texto && (
              <>
                <Liga titulo="Sublinhado" ativo={texto.sublinhado ?? false} aoMudar={(sublinhado) => aoMudar({ sublinhado })}>
                  <u>S</u>
                </Liga>
                <Liga titulo="Tachado" ativo={texto.tachado ?? false} aoMudar={(tachado) => aoMudar({ tachado })}>
                  <s>T</s>
                </Liga>
              </>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.ajustar ?? false} onChange={(e) => aoMudar({ ajustar: e.target.checked })} />
          Ajustar ao quadro (diminui a fonte até caber)
        </label>
        <CampoCor rotulo="Cor do texto" valor={el.cor ?? '#000000'} aoMudar={(cor) => aoMudar({ cor })} />
      </Secao>

      <Secao titulo="Parágrafo">
        <div className="flex flex-wrap gap-2">
          <Alternar
            valor={el.alinhamento}
            aoMudar={(alinhamento) => aoMudar({ alinhamento })}
            opcoes={[
              { v: 'esquerda', rotulo: '⇤', titulo: 'Alinhar à esquerda' },
              { v: 'centro', rotulo: '↔', titulo: 'Centralizar' },
              { v: 'direita', rotulo: '⇥', titulo: 'Alinhar à direita' },
            ]}
          />
          <Alternar
            valor={el.alinhamentoVertical ?? (el.tipo === 'preco' ? 'meio' : 'topo')}
            aoMudar={(alinhamentoVertical) => aoMudar({ alinhamentoVertical })}
            opcoes={[
              { v: 'topo', rotulo: '⤒', titulo: 'Topo' },
              { v: 'meio', rotulo: '↕', titulo: 'Meio' },
              { v: 'base', rotulo: '⤓', titulo: 'Base' },
            ]}
          />
        </div>
        {texto && (
          <div className="grid grid-cols-3 gap-2">
            <Linha rotulo="Entre letras">
              <Numero valor={texto.espacamentoLetras ?? 0} passo={0.5} min={-10} max={100} aoMudar={(espacamentoLetras) => aoMudar({ espacamentoLetras })} />
            </Linha>
            <Linha rotulo="Altura linha">
              <Numero valor={texto.alturaLinha ?? 1.15} passo={0.05} min={0.5} max={4} aoMudar={(alturaLinha) => aoMudar({ alturaLinha: Math.max(0.5, Math.min(4, alturaLinha)) })} />
            </Linha>
            <Linha rotulo="Letras">
              <select className={CLASSE} value={texto.caixa ?? 'normal'} onChange={(e) => aoMudar({ caixa: e.target.value as ElementoTexto['caixa'] })}>
                <option value="normal">Aa</option>
                <option value="maiusculas">AA</option>
                <option value="minusculas">aa</option>
              </select>
            </Linha>
          </div>
        )}
      </Secao>

      <Secao titulo="Efeitos" aberta={Boolean(el.contorno || el.corFundo)}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(el.contorno)} onChange={(e) => aoMudar({ contorno: e.target.checked ? { cor: '#ffffff', espessuraPt: 1.5 } : null })} />
          Contorno nas letras
        </label>
        {el.contorno && (
          <>
            <CampoCor rotulo="Cor do contorno" valor={el.contorno.cor} aoMudar={(cor) => aoMudar({ contorno: { ...el.contorno!, cor } })} />
            <Linha rotulo="Espessura do contorno (pt)">
              <Numero valor={el.contorno.espessuraPt} passo={0.5} min={0.1} max={20} aoMudar={(espessuraPt) => aoMudar({ contorno: { ...el.contorno!, espessuraPt: Math.max(0.1, Math.min(20, espessuraPt)) } })} />
            </Linha>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(el.corFundo)} onChange={(e) => aoMudar({ corFundo: e.target.checked ? '#ffd600' : null })} />
          Fundo colorido
        </label>
        {el.corFundo && <CampoCor rotulo="Cor do fundo" valor={el.corFundo} aoMudar={(corFundo) => aoMudar({ corFundo })} />}
      </Secao>
    </>
  );
}

/** Trocar arquivo, ajuste de preto e branco e proporção original. */
function PropriedadesImagem({ el, layout, aoMudar }: { el: ElementoImagem; layout: LayoutEtiqueta; aoMudar: (m: Partial<ElementoImagem>) => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const deitado = el.rotacao === 90 || el.rotacao === 270;

  async function trocar(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    setLendo(true);
    try {
      const dados = await lerImagem(arquivo);
      // Mantém a largura atual e ajusta a altura à proporção da nova imagem.
      const altura = Math.min(layout.alturaMm - el.y, Math.max(1, (el.largura * (deitado ? dados.larguraPx : dados.alturaPx)) / (deitado ? dados.alturaPx : dados.larguraPx)));
      aoMudar({ ...dados, altura: Math.round(altura * 2) / 2 });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  function proporcaoOriginal() {
    const [w, h] = deitado ? [el.alturaPx, el.larguraPx] : [el.larguraPx, el.alturaPx];
    let largura = el.largura;
    let altura = (largura * h) / w;
    if (el.y + altura > layout.alturaMm) {
      altura = layout.alturaMm - el.y;
      largura = (altura * w) / h;
    }
    aoMudar({ largura: Math.max(0.5, Math.round(largura * 2) / 2), altura: Math.max(0.5, Math.round(altura * 2) / 2) });
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-600">
        <div className="truncate" title={el.nome}>{el.nome || 'imagem'}</div>
        <div className="text-slate-500">{el.original ? 'Colorida no PDF' : 'Só em tons de cinza (reenvie para ter cor)'}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="cursor-pointer rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
          {lendo ? 'Lendo…' : 'Trocar imagem'}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => (void trocar(e.target.files?.[0]), (e.target.value = ''))} />
        </label>
        <button type="button" onClick={proporcaoOriginal} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
          Proporção original
        </button>
      </div>
      {erro && <p className="text-xs text-red-700">{erro}</p>}
      <Secao titulo="Impressoras térmicas" aberta={false}>
        <Linha rotulo={`Limiar do preto: ${el.limiar}`}>
          <input type="range" min={1} max={254} value={el.limiar} onChange={(e) => aoMudar({ limiar: Number(e.target.value) })} className="w-full" />
        </Linha>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.pontilhado} onChange={(e) => aoMudar({ pontilhado: e.target.checked })} />
          Pontilhado (fotos e degradês)
        </label>
        <p className="text-xs text-slate-500">Térmicas imprimem só preto: estes ajustes valem para ZPL, PPLB e ESC/POS. PPLA ainda não imprime imagens.</p>
      </Secao>
    </div>
  );
}

export function PropriedadesElemento({
  el,
  layout,
  campos,
  aoMudar,
  aoExcluir,
  aoDuplicar,
}: {
  el: ElementoEtiqueta;
  layout: LayoutEtiqueta;
  campos: CampoDinamico[];
  aoMudar: (m: Partial<ElementoEtiqueta>) => void;
  aoExcluir: () => void;
  aoDuplicar: () => void;
}) {
  const limitar = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const forma = el.tipo === 'retangulo' || el.tipo === 'elipse' || el.tipo === 'estrela' ? el : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{TITULO[el.tipo]}</h3>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={aoDuplicar} className="text-blue-700 hover:underline">Duplicar</button>
          <button type="button" onClick={aoExcluir} className="text-red-700 hover:underline">Excluir</button>
        </div>
      </div>

      {el.tipo === 'texto' && <EditorOrigem origem={el.valor} campos={campos} permitirFormato multilinha aoMudar={(valor) => aoMudar({ valor })} />}
      {el.tipo === 'preco' && (
        <>
          <EditorOrigem origem={el.valor} campos={campos} permitirFormato={false} aoMudar={(valor) => aoMudar({ valor })} />
          <div className="grid grid-cols-2 gap-2">
            <Linha rotulo="Símbolo">
              <input className={CLASSE} value={el.simbolo} maxLength={10} onChange={(e) => aoMudar({ simbolo: e.target.value })} />
            </Linha>
            <label className="flex items-end gap-2 pb-1 text-sm">
              <input type="checkbox" checked={el.centavosSobrescritos} onChange={(e) => aoMudar({ centavosSobrescritos: e.target.checked })} />
              Centavos no alto
            </label>
          </div>
        </>
      )}
      {(el.tipo === 'texto' || el.tipo === 'preco') && <PropriedadesFonte el={el} aoMudar={aoMudar} />}
      {el.tipo === 'texto' && (
        <div className="grid grid-cols-2 gap-2">
          <Linha rotulo="Prefixo">
            <input className={CLASSE} value={el.prefixo} maxLength={50} onChange={(e) => aoMudar({ prefixo: e.target.value })} />
          </Linha>
          <Linha rotulo="Sufixo">
            <input className={CLASSE} value={el.sufixo} maxLength={50} onChange={(e) => aoMudar({ sufixo: e.target.value })} />
          </Linha>
        </div>
      )}

      {el.tipo === 'codigo_barras' && (
        <>
          <EditorOrigem origem={el.valor} campos={campos} permitirFormato={false} aoMudar={(valor) => aoMudar({ valor })} />
          <Linha rotulo="Tipo de código">
            <select className={CLASSE} value={el.simbologia} onChange={(e) => aoMudar({ simbologia: e.target.value as Simbologia })}>
              {SIMBOLOGIAS.map((s) => (
                <option key={s} value={s}>{ROTULO_SIMBOLOGIA[s]}</option>
              ))}
            </select>
          </Linha>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={el.mostrarTexto} onChange={(e) => aoMudar({ mostrarTexto: e.target.checked })} />
            Mostrar os dígitos
          </label>
        </>
      )}

      {el.tipo === 'qrcode' && <EditorOrigem origem={el.valor} campos={campos} permitirFormato={false} aoMudar={(valor) => aoMudar({ valor })} />}

      {forma && (
        <Secao titulo="Preenchimento e borda">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={forma.preenchido} onChange={(e) => aoMudar({ preenchido: e.target.checked, ...(!e.target.checked && forma.espessuraMm < 0.1 ? { espessuraMm: 0.3 } : {}) })} />
            Preenchido
          </label>
          {forma.preenchido && <CampoCor rotulo="Cor de preenchimento" valor={forma.corPreenchimento ?? '#000000'} aoMudar={(corPreenchimento) => aoMudar({ corPreenchimento })} />}
          <div className="grid grid-cols-2 gap-2">
            <Linha rotulo="Borda (mm, 0 = sem)">
              <Numero valor={forma.espessuraMm} passo={0.1} min={0} max={50} aoMudar={(espessuraMm) => aoMudar({ espessuraMm: Math.max(forma.preenchido ? 0 : 0.1, Math.min(50, espessuraMm)) })} />
            </Linha>
            <label className="flex items-end gap-2 pb-1 text-sm">
              <input type="checkbox" checked={forma.tracejado ?? false} onChange={(e) => aoMudar({ tracejado: e.target.checked })} />
              Tracejada
            </label>
          </div>
          {forma.espessuraMm > 0 && <CampoCor rotulo="Cor da borda" valor={forma.corBorda ?? '#000000'} aoMudar={(corBorda) => aoMudar({ corBorda })} />}
          {forma.tipo === 'retangulo' && (
            <Linha rotulo="Cantos arredondados (mm)">
              <Numero valor={forma.raioMm ?? 0} passo={0.5} min={0} max={600} aoMudar={(raioMm) => aoMudar({ raioMm: Math.max(0, raioMm) })} />
            </Linha>
          )}
          {forma.tipo === 'estrela' && (
            <div className="grid grid-cols-2 gap-2">
              <Linha rotulo="Pontas">
                <Numero valor={forma.pontas} passo={1} min={3} max={40} aoMudar={(pontas) => aoMudar({ pontas: Math.max(3, Math.min(40, Math.round(pontas))) })} />
              </Linha>
              <Linha rotulo={`Recorte: ${Math.round((1 - forma.raioInterno) * 100)}%`}>
                <input type="range" min={5} max={90} value={Math.round((1 - forma.raioInterno) * 100)} onChange={(e) => aoMudar({ raioInterno: 1 - Number(e.target.value) / 100 })} className="w-full" />
              </Linha>
            </div>
          )}
        </Secao>
      )}

      {el.tipo === 'linha' && (
        <Secao titulo="Linha">
          <div className="grid grid-cols-2 gap-2">
            <Linha rotulo="Espessura (mm)">
              <Numero valor={el.espessuraMm} passo={0.1} min={0.1} max={50} aoMudar={(espessuraMm) => aoMudar({ espessuraMm: Math.max(0.1, Math.min(50, espessuraMm)) })} />
            </Linha>
            <label className="flex items-end gap-2 pb-1 text-sm">
              <input type="checkbox" checked={el.tracejado ?? false} onChange={(e) => aoMudar({ tracejado: e.target.checked })} />
              Tracejada
            </label>
          </div>
          <CampoCor rotulo="Cor" valor={el.cor ?? '#000000'} aoMudar={(cor) => aoMudar({ cor })} />
        </Secao>
      )}

      {el.tipo === 'imagem' && <PropriedadesImagem el={el} layout={layout} aoMudar={aoMudar} />}

      <Secao titulo="Posição e tamanho" aberta={false}>
        <div className="grid grid-cols-2 gap-2">
          <Linha rotulo="X (mm)">
            <Numero valor={el.x} aoMudar={(x) => aoMudar({ x: limitar(x, layout.larguraMm - el.largura) })} />
          </Linha>
          <Linha rotulo="Y (mm)">
            <Numero valor={el.y} aoMudar={(y) => aoMudar({ y: limitar(y, layout.alturaMm - el.altura) })} />
          </Linha>
          <Linha rotulo="Largura (mm)">
            <Numero valor={el.largura} min={0.5} aoMudar={(largura) => aoMudar({ largura: Math.max(0.5, Math.min(layout.larguraMm - el.x, largura)) })} />
          </Linha>
          <Linha rotulo="Altura (mm)">
            <Numero valor={el.altura} min={0.5} aoMudar={(altura) => aoMudar({ altura: Math.max(0.5, Math.min(layout.alturaMm - el.y, altura)) })} />
          </Linha>
        </div>
        {el.tipo !== 'retangulo' && el.tipo !== 'linha' && el.tipo !== 'elipse' && el.tipo !== 'estrela' && (
          <Linha rotulo="Rotação">
            <select className={CLASSE} value={el.rotacao} onChange={(e) => aoMudar({ rotacao: Number(e.target.value) as Rotacao })}>
              <option value={0}>0°</option>
              <option value={90}>90° (horário)</option>
              <option value={180}>180°</option>
              <option value={270}>270°</option>
            </select>
          </Linha>
        )}
        <Opacidade valor={el.opacidade ?? 1} aoMudar={(opacidade) => aoMudar({ opacidade })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.travado ?? false} onChange={(e) => aoMudar({ travado: e.target.checked })} />
          Travar (não arrasta nem redimensiona)
        </label>
      </Secao>
    </div>
  );
}

type Papel = keyof typeof PAPEIS_CARTAZ;

/** Monta um cartaz: folha inteira como uma etiqueta só, sem margens. */
function ModeloCartaz({ aoMudar }: { aoMudar: (l: Partial<LayoutEtiqueta>) => void }) {
  const [papel, setPapel] = useState<Papel>('A4');
  const [paisagem, setPaisagem] = useState(false);
  function aplicar() {
    const [a, b] = PAPEIS_CARTAZ[papel];
    const [larguraMm, alturaMm] = paisagem ? [b, a] : [a, b];
    aoMudar({
      larguraMm,
      alturaMm,
      colunas: 1,
      espacamentoHorizontalMm: 0,
      espacamentoVerticalMm: 0,
      margens: { superior: 0, inferior: 0, esquerda: 0, direita: 0 },
      papel: { tipo: 'folha', larguraMm, alturaMm },
    });
  }
  return (
    <div className="space-y-2 rounded border border-blue-200 bg-blue-50 p-2">
      <span className="block text-xs font-semibold text-blue-900">Cartaz (folha inteira)</span>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
          {Object.entries(PAPEIS_CARTAZ).map(([nome, [w, h]]) => (
            <option key={nome} value={nome}>
              {nome} ({w} × {h} mm)
            </option>
          ))}
        </select>
        <Alternar
          valor={paisagem}
          aoMudar={setPaisagem}
          opcoes={[
            { v: false, rotulo: 'Retrato', titulo: 'Em pé' },
            { v: true, rotulo: 'Paisagem', titulo: 'Deitado' },
          ]}
        />
        <button type="button" onClick={aplicar} className="rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700">
          Aplicar
        </button>
      </div>
      <p className="text-xs text-blue-900/70">Muitas jato de tinta não imprimem até a borda: deixe uns 5 mm livres nas bordas do desenho.</p>
    </div>
  );
}

const FOLHAS = { A4: [210, 297], Carta: [215.9, 279.4] } as const;

export function PropriedadesLayout({ layout, aoMudar }: { layout: LayoutEtiqueta; aoMudar: (l: Partial<LayoutEtiqueta>) => void }) {
  const m = layout.margens;
  const margem = (lado: keyof typeof m) => (v: number) => aoMudar({ margens: { ...m, [lado]: Math.max(0, v) } });
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Etiqueta / cartaz</h3>
      <ModeloCartaz aoMudar={aoMudar} />
      <div className="grid grid-cols-2 gap-2">
        <Linha rotulo="Largura (mm)">
          <Numero valor={layout.larguraMm} min={5} max={1200} aoMudar={(larguraMm) => aoMudar({ larguraMm })} />
        </Linha>
        <Linha rotulo="Altura (mm)">
          <Numero valor={layout.alturaMm} min={5} max={1200} aoMudar={(alturaMm) => aoMudar({ alturaMm })} />
        </Linha>
        <Linha rotulo="Colunas">
          <Numero valor={layout.colunas} passo={1} min={1} max={20} aoMudar={(c) => aoMudar({ colunas: Math.max(1, Math.min(20, Math.round(c))) })} />
        </Linha>
        <Linha rotulo="Papel">
          <select
            className={CLASSE}
            value={layout.papel.tipo === 'rolo' ? 'rolo' : Object.entries(FOLHAS).find(([, [w, h]]) => layout.papel.tipo === 'folha' && layout.papel.larguraMm === w && layout.papel.alturaMm === h)?.[0] ?? 'outra'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'rolo') aoMudar({ papel: { tipo: 'rolo' } });
              else if (v in FOLHAS) {
                const [larguraMm, alturaMm] = FOLHAS[v as keyof typeof FOLHAS];
                aoMudar({ papel: { tipo: 'folha', larguraMm, alturaMm } });
              } else aoMudar({ papel: { tipo: 'folha', larguraMm: 210, alturaMm: 297 } });
            }}
          >
            <option value="rolo">Rolo</option>
            <option value="A4">Folha A4</option>
            <option value="Carta">Folha Carta</option>
            <option value="outra">Folha (outro tamanho)</option>
          </select>
        </Linha>
        {layout.papel.tipo === 'folha' && (
          <>
            <Linha rotulo="Largura da folha">
              <Numero valor={layout.papel.larguraMm} aoMudar={(larguraMm) => layout.papel.tipo === 'folha' && aoMudar({ papel: { ...layout.papel, larguraMm } })} />
            </Linha>
            <Linha rotulo="Altura da folha">
              <Numero valor={layout.papel.alturaMm} aoMudar={(alturaMm) => layout.papel.tipo === 'folha' && aoMudar({ papel: { ...layout.papel, alturaMm } })} />
            </Linha>
          </>
        )}
        <Linha rotulo="Espaço entre colunas">
          <Numero valor={layout.espacamentoHorizontalMm} min={0} aoMudar={(v) => aoMudar({ espacamentoHorizontalMm: Math.max(0, v) })} />
        </Linha>
        <Linha rotulo={layout.papel.tipo === 'rolo' ? 'Espaço entre etiquetas (gap)' : 'Espaço entre linhas'}>
          <Numero valor={layout.espacamentoVerticalMm} min={0} aoMudar={(v) => aoMudar({ espacamentoVerticalMm: Math.max(0, v) })} />
        </Linha>
      </div>
      <div>
        <span className="mb-0.5 block text-xs font-medium text-slate-600">Margens (mm): superior, inferior, esquerda, direita</span>
        <div className="grid grid-cols-4 gap-1">
          <Numero valor={m.superior} min={0} aoMudar={margem('superior')} />
          <Numero valor={m.inferior} min={0} aoMudar={margem('inferior')} />
          <Numero valor={m.esquerda} min={0} aoMudar={margem('esquerda')} />
          <Numero valor={m.direita} min={0} aoMudar={margem('direita')} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(layout.corFundo)} onChange={(e) => aoMudar({ corFundo: e.target.checked ? '#fff3e0' : null })} />
        Cor de fundo
      </label>
      {layout.corFundo && <CampoCor rotulo="Fundo" valor={layout.corFundo} aoMudar={(corFundo) => aoMudar({ corFundo })} />}
      <p className="text-xs text-slate-500">
        Clique num elemento para editar. Setas movem 0,5 mm (Shift: 5 mm); Delete exclui; Ctrl+Z desfaz, Ctrl+Y refaz, Ctrl+D duplica.
      </p>
    </div>
  );
}
