import { useState, type ReactNode } from 'react';
import {
  FORMATOS_DATA,
  ROTULO_CATEGORIA,
  ROTULO_SIMBOLOGIA,
  SIMBOLOGIAS,
  type CampoDinamico,
  type ElementoEtiqueta,
  type ElementoImagem,
  type FormatoCampo,
  type FormatoData,
  type LayoutEtiqueta,
  type OrigemValor,
  type Rotacao,
  type Simbologia,
} from '@etiquetas/shared';
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

const ROTULO_ORIGEM = { fixo: 'Texto fixo', campo: 'Campo da consulta', data: 'Data', contador: 'Contador' } as const;

function EditorOrigem({ origem, campos, aoMudar, permitirFormato }: { origem: OrigemValor; campos: CampoDinamico[]; aoMudar: (o: OrigemValor) => void; permitirFormato: boolean }) {
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
        <Linha rotulo="Texto">
          <input className={CLASSE} value={origem.texto} maxLength={500} onChange={(e) => aoMudar({ ...origem, texto: e.target.value })} />
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

const TITULO = { texto: 'Texto', codigo_barras: 'Código de barras', qrcode: 'QR code', retangulo: 'Retângulo', linha: 'Linha', imagem: 'Imagem' } as const;

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
        <div className="text-slate-500">{el.larguraPx} × {el.alturaPx} px guardados</div>
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
      <Linha rotulo={`Limiar do preto: ${el.limiar}`}>
        <input type="range" min={1} max={254} value={el.limiar} onChange={(e) => aoMudar({ limiar: Number(e.target.value) })} className="w-full" />
      </Linha>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={el.pontilhado} onChange={(e) => aoMudar({ pontilhado: e.target.checked })} />
        Pontilhado (fotos e degradês)
      </label>
      <p className="text-xs text-slate-500">
        A tela mostra como sai numa térmica de 203 dpi. No PDF a imagem sai em tons de cinza. PPLA ainda não imprime imagens.
      </p>
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
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{TITULO[el.tipo]}</h3>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={aoDuplicar} className="text-blue-700 hover:underline">Duplicar</button>
          <button type="button" onClick={aoExcluir} className="text-red-700 hover:underline">Excluir</button>
        </div>
      </div>
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
      {el.tipo !== 'retangulo' && el.tipo !== 'linha' && (
        <Linha rotulo="Rotação">
          <select className={CLASSE} value={el.rotacao} onChange={(e) => aoMudar({ rotacao: Number(e.target.value) as Rotacao })}>
            <option value={0}>0°</option>
            <option value={90}>90° (horário)</option>
            <option value={180}>180°</option>
            <option value={270}>270°</option>
          </select>
        </Linha>
      )}

      {el.tipo === 'texto' && (
        <>
          <EditorOrigem origem={el.valor} campos={campos} permitirFormato aoMudar={(valor) => aoMudar({ valor })} />
          <div className="grid grid-cols-2 gap-2">
            <Linha rotulo="Prefixo">
              <input className={CLASSE} value={el.prefixo} maxLength={50} onChange={(e) => aoMudar({ prefixo: e.target.value })} />
            </Linha>
            <Linha rotulo="Sufixo">
              <input className={CLASSE} value={el.sufixo} maxLength={50} onChange={(e) => aoMudar({ sufixo: e.target.value })} />
            </Linha>
            <Linha rotulo="Tamanho (pt)">
              <Numero valor={el.tamanhoPt} passo={1} min={4} max={200} aoMudar={(tamanhoPt) => aoMudar({ tamanhoPt: Math.max(4, Math.min(200, tamanhoPt)) })} />
            </Linha>
            <Linha rotulo="Alinhamento">
              <select className={CLASSE} value={el.alinhamento} onChange={(e) => aoMudar({ alinhamento: e.target.value as typeof el.alinhamento })}>
                <option value="esquerda">Esquerda</option>
                <option value="centro">Centro</option>
                <option value="direita">Direita</option>
              </select>
            </Linha>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={el.negrito} onChange={(e) => aoMudar({ negrito: e.target.checked })} />
            Negrito
          </label>
        </>
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

      {(el.tipo === 'retangulo' || el.tipo === 'linha') && (
        <Linha rotulo="Espessura (mm)">
          <Numero valor={el.espessuraMm} passo={0.1} min={0.1} max={20} aoMudar={(espessuraMm) => aoMudar({ espessuraMm: Math.max(0.1, Math.min(20, espessuraMm)) })} />
        </Linha>
      )}
      {el.tipo === 'retangulo' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.preenchido} onChange={(e) => aoMudar({ preenchido: e.target.checked })} />
          Preenchido
        </label>
      )}
      {el.tipo === 'imagem' && <PropriedadesImagem el={el} layout={layout} aoMudar={aoMudar} />}
    </div>
  );
}

const FOLHAS = { A4: [210, 297], Carta: [215.9, 279.4] } as const;

export function PropriedadesLayout({ layout, aoMudar }: { layout: LayoutEtiqueta; aoMudar: (l: Partial<LayoutEtiqueta>) => void }) {
  const m = layout.margens;
  const margem = (lado: keyof typeof m) => (v: number) => aoMudar({ margens: { ...m, [lado]: Math.max(0, v) } });
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Etiqueta</h3>
      <div className="grid grid-cols-2 gap-2">
        <Linha rotulo="Largura (mm)">
          <Numero valor={layout.larguraMm} min={5} max={400} aoMudar={(larguraMm) => aoMudar({ larguraMm })} />
        </Linha>
        <Linha rotulo="Altura (mm)">
          <Numero valor={layout.alturaMm} min={5} max={400} aoMudar={(alturaMm) => aoMudar({ alturaMm })} />
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
      <p className="text-xs text-slate-500">Clique num elemento para editar. Setas movem 0,5 mm; Delete exclui.</p>
    </div>
  );
}
