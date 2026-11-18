import { useState } from 'react';
import { problemaNosAdicionais, type AdicionalHorario, type AdicionalRegiao, type Adicionais, type ConfigMapa } from '@etiquetas/shared';
import { Alerta, Botao, Campo } from '../../components/ui';
import { MapaEntregadores } from './MapaEntregadores';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const centavos = (t: string) => Math.round(Number(t.trim().replace(/\./g, '').replace(',', '.') || '0') * 100);

/** Adicionais por horário (noturno, fim de semana, pico) e por região (morro, área rural), somados ao valor da tabela. */
export function AdicionaisEditor({ valor, mudar, mapa }: { valor: Adicionais; mudar: (a: Adicionais) => void; mapa: ConfigMapa }) {
  const [marcando, setMarcando] = useState<number | null>(null);
  const problema = problemaNosAdicionais(valor);
  const h = (i: number, x: Partial<AdicionalHorario>) => mudar({ ...valor, horarios: valor.horarios.map((v, j) => (j === i ? { ...v, ...x } : v)) });
  const r = (i: number, x: Partial<AdicionalRegiao>) => mudar({ ...valor, regioes: valor.regioes.map((v, j) => (j === i ? { ...v, ...x } : v)) });

  return (
    <div className="space-y-3" data-testid="adicionais">
      <div className="text-sm font-medium">Adicionais</div>
      <p className="text-xs text-slate-500">Somam ao valor da tabela (percentual sobre ele e/ou valor fixo). O entregador vê o total na oferta; a empresa vê o detalhe na chamada.</p>

      {valor.horarios.map((x, i) => (
        <fieldset key={`h${i}`} className="space-y-2 rounded border border-slate-200 p-2">
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Nome do adicional de horário" value={x.nome} onChange={(e) => h(i, { nome: e.target.value })} placeholder="Noturno" />
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Das" type="time" value={x.inicio} onChange={(e) => h(i, { inicio: e.target.value })} />
              <Campo rotulo="Até" type="time" value={x.fim} onChange={(e) => h(i, { fim: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {DIAS.map((d, n) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" checked={x.dias.includes(n)} onChange={(e) => h(i, { dias: e.target.checked ? [...x.dias, n].sort() : x.dias.filter((v) => v !== n) })} aria-label={`${x.nome || 'Adicional'}: ${d}`} />
                {d}
              </label>
            ))}
          </div>
          <Valores x={x} mudar={(v) => h(i, v)} remover={() => mudar({ ...valor, horarios: valor.horarios.filter((_, j) => j !== i) })} />
        </fieldset>
      ))}

      {valor.regioes.map((x, i) => (
        <fieldset key={`r${i}`} className={`space-y-2 rounded border p-2 ${marcando === i ? 'border-orange-400' : 'border-slate-200'}`}>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Nome do adicional de região" value={x.nome} onChange={(e) => r(i, { nome: e.target.value })} placeholder="Zona rural" />
            <Campo rotulo="Raio (km)" inputMode="decimal" value={String(x.raioKm).replace('.', ',')} onChange={(e) => r(i, { raioKm: Number(e.target.value.replace(',', '.')) })} />
          </div>
          <button type="button" className="text-xs text-blue-700 underline" onClick={() => setMarcando(marcando === i ? null : i)}>
            {marcando === i ? 'Clique no mapa abaixo para marcar o centro' : `Marcar o centro no mapa (${x.centro.lat.toFixed(4)}, ${x.centro.lon.toFixed(4)})`}
          </button>
          <Valores x={x} mudar={(v) => r(i, v)} remover={() => mudar({ ...valor, regioes: valor.regioes.filter((_, j) => j !== i) })} />
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-2">
        <Botao variante="secundario" onClick={() => mudar({ ...valor, horarios: [...valor.horarios, { nome: '', dias: [0, 1, 2, 3, 4, 5, 6], inicio: '22:00', fim: '06:00', percentual: 20, fixoCentavos: 0 }] })}>
          + Adicional de horário
        </Botao>
        <Botao
          variante="secundario"
          onClick={() => {
            mudar({ ...valor, regioes: [...valor.regioes, { nome: '', centro: { lat: 0, lon: 0 }, raioKm: 1, percentual: 0, fixoCentavos: 300 }] });
            setMarcando(valor.regioes.length);
          }}
        >
          + Adicional de região
        </Botao>
      </div>
      {valor.regioes.length > 0 && (
        <MapaEntregadores
          config={mapa}
          base={null}
          raioKm={1}
          altura={260}
          areas={valor.regioes.filter((x) => x.centro.lat || x.centro.lon).map((x) => ({ lat: x.centro.lat, lon: x.centro.lon, raioMetros: x.raioKm * 1000, cor: '#7c3aed', opacidade: 0.15, rotulo: x.nome || 'Região' }))}
          aoClicar={marcando === null ? undefined : (p) => { r(marcando, { centro: p }); setMarcando(null); }}
        />
      )}
      {problema && (valor.horarios.length > 0 || valor.regioes.length > 0) && <Alerta tipo="aviso">{problema}</Alerta>}
    </div>
  );
}

function Valores({ x, mudar, remover }: { x: { nome: string; percentual: number; fixoCentavos: number }; mudar: (v: { percentual?: number; fixoCentavos?: number }) => void; remover: () => void }) {
  const [fixo, setFixo] = useState(reais(x.fixoCentavos));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-28">
        <Campo rotulo="Percentual (%)" type="number" min={0} max={200} value={String(x.percentual)} onChange={(e) => mudar({ percentual: Number(e.target.value) })} />
      </div>
      <div className="w-28">
        <Campo rotulo="Valor fixo (R$)" inputMode="decimal" value={fixo} onChange={(e) => { setFixo(e.target.value); mudar({ fixoCentavos: centavos(e.target.value) }); }} />
      </div>
      <button type="button" className="mb-2 text-xs text-red-700 underline" onClick={remover}>
        Remover
      </button>
    </div>
  );
}
