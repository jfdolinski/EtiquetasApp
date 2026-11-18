import { useEffect, useState } from 'react';
import { ESPERA_BLOCO_MINUTOS, ESPERA_TOLERANCIA_PADRAO_MINUTOS, ROTULO_TIPO_CHAMADA, TIPOS_CHAMADA, type TabelaPrecos, type TipoChamada } from '@etiquetas/shared';
import { Campo } from '../../components/ui';

const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const centavos = (t: string) => Math.round(Number(t.trim().replace(/\./g, '').replace(',', '.')) * 100);

type Textos = { base: string; porKm: string; km: string; porParada: string; taxa: string; tolerancia: string; espera: string };

function textos(t: TabelaPrecos): Record<TipoChamada, Textos> {
  return Object.fromEntries(
    TIPOS_CHAMADA.map((tipo) => {
      const p = t[tipo];
      return [tipo, { base: reais(p.baseCentavos), porKm: reais(p.porKmCentavos), km: String(p.kmIncluso), porParada: reais(p.porParadaCentavos ?? 0), taxa: reais(p.taxaCancelamentoCentavos ?? 0), tolerancia: String(p.esperaToleranciaMinutos ?? ESPERA_TOLERANCIA_PADRAO_MINUTOS), espera: reais(p.esperaPorBlocoCentavos ?? 0) }];
    }),
  ) as Record<TipoChamada, Textos>;
}

function tabela(x: Record<TipoChamada, Textos>): TabelaPrecos {
  return Object.fromEntries(
    TIPOS_CHAMADA.map((t) => [
      t,
      {
        baseCentavos: centavos(x[t].base),
        porKmCentavos: centavos(x[t].porKm),
        kmIncluso: Number(x[t].km.replace(',', '.')),
        porParadaCentavos: centavos(x[t].porParada || '0'),
        taxaCancelamentoCentavos: centavos(x[t].taxa || '0'),
        esperaToleranciaMinutos: Number(x[t].tolerancia || '0'),
        esperaPorBlocoCentavos: centavos(x[t].espera || '0'),
      },
    ]),
  ) as TabelaPrecos;
}

/** Valor para o entregador por tipo de serviço (empresa em Configuração; super-admin no padrão da plataforma). */
export function TabelaPrecosEditor({ inicial, mudar }: { inicial: TabelaPrecos; mudar: (t: TabelaPrecos) => void }) {
  const [x, setX] = useState(() => textos(inicial));
  useEffect(() => setX(textos(inicial)), [inicial]);
  const trocar = (t: TipoChamada, campo: keyof Textos, v: string) => {
    const novo = { ...x, [t]: { ...x[t], [campo]: v } };
    setX(novo);
    mudar(tabela(novo));
  };
  return (
    <div className="space-y-3">
      {TIPOS_CHAMADA.map((t) => (
        <div key={t} className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid={`precos-${t}`}>
          <Campo rotulo={`${ROTULO_TIPO_CHAMADA[t]}: base (R$)`} inputMode="decimal" value={x[t].base} onChange={(e) => trocar(t, 'base', e.target.value)} />
          <Campo rotulo="Por km (R$)" inputMode="decimal" value={x[t].porKm} onChange={(e) => trocar(t, 'porKm', e.target.value)} />
          <Campo rotulo="Km inclusos" inputMode="decimal" value={x[t].km} onChange={(e) => trocar(t, 'km', e.target.value)} />
          <Campo rotulo="Taxa se cancelar após o aceite (R$)" inputMode="decimal" value={x[t].taxa} onChange={(e) => trocar(t, 'taxa', e.target.value)} />
          <Campo rotulo="Espera: tolerância (min)" inputMode="numeric" value={x[t].tolerancia} onChange={(e) => trocar(t, 'tolerancia', e.target.value)} />
          <Campo rotulo={`Espera: a cada ${ESPERA_BLOCO_MINUTOS} min (R$)`} inputMode="decimal" value={x[t].espera} onChange={(e) => trocar(t, 'espera', e.target.value)} />
          {t === 'ENTREGA' && <Campo rotulo="Por parada extra (R$)" inputMode="decimal" value={x[t].porParada} onChange={(e) => trocar(t, 'porParada', e.target.value)} />}
        </div>
      ))}
      <p className="text-xs text-slate-500">
        Espera: do "cheguei" até coletar ou entregar; passada a tolerância, cada {ESPERA_BLOCO_MINUTOS} min completos somam o valor do bloco (0 = espera não paga). Devolução à origem: metade da base mais o km da volta.
      </p>
    </div>
  );
}
