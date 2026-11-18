import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConfigMapa, DemandaEntregas } from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Selecao } from '../../components/ui';
import { MapaEntregadores } from './MapaEntregadores';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const COR = '#ea580c';

/** Onde e quando a empresa mais chama entregador: células de ~550 m e contagem por hora e por dia. */
export function Demanda({ mapa }: { mapa: ConfigMapa }) {
  const [dias, setDias] = useState('30');
  const { data, error } = useQuery({ queryKey: ['entregas-demanda', dias], queryFn: () => api<DemandaEntregas>(`/entregas/demanda?dias=${dias}`) });
  const areas = useMemo(() => {
    const maior = Math.max(1, ...(data?.celulas.map((c) => c.quantidade) ?? [1]));
    return (data?.celulas ?? []).map((c) => ({ lat: c.lat, lon: c.lon, raioMetros: 280, cor: COR, opacidade: 0.15 + 0.6 * (c.quantidade / maior), rotulo: `${c.quantidade} entrega${c.quantidade === 1 ? '' : 's'}` }));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">Pontos de entrega (e de coleta no cliente) das chamadas, juntados em áreas de cerca de 500 m: quanto mais forte, mais chamadas. Serve para decidir o raio, os adicionais por região e quando pedir mais entregadores.</p>
        <div className="w-44">
          <Selecao rotulo="Período" value={dias} onChange={(e) => setDias(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </Selecao>
        </div>
      </div>
      {error && <Alerta>{error.message}</Alerta>}
      {data && (
        <>
          <p className="text-sm" data-testid="demanda-total">
            <strong>{data.total}</strong> chamada{data.total === 1 ? '' : 's'} no período, em {data.celulas.length} área{data.celulas.length === 1 ? '' : 's'}.
          </p>
          <MapaEntregadores config={mapa} base={null} raioKm={1} areas={areas} altura={420} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Barras titulo="Por hora do dia" rotulos={data.porHora.map((_, h) => String(h).padStart(2, '0'))} valores={data.porHora} />
            <Barras titulo="Por dia da semana" rotulos={DIAS_SEMANA} valores={data.porDia} />
          </div>
        </>
      )}
    </div>
  );
}

function Barras({ titulo, rotulos, valores }: { titulo: string; rotulos: string[]; valores: number[] }) {
  const maior = Math.max(1, ...valores);
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{titulo}</figcaption>
      <div className="flex h-32 items-end gap-0.5" role="img" aria-label={`${titulo}: ${rotulos.map((r, i) => `${r} ${valores[i]}`).join(', ')}`}>
        {valores.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${rotulos[i]}: ${v}`}>
            <div className="w-full rounded-t-sm bg-orange-500" style={{ height: `${(v / maior) * 100}%`, minHeight: v ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-slate-500">
        {rotulos.map((r, i) => (
          <span key={i} className="flex-1 text-center">
            {rotulos.length > 12 ? (i % 3 === 0 ? r : '') : r}
          </span>
        ))}
      </div>
    </figure>
  );
}
