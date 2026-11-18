import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ROTULO_SITUACAO_MAPA, ROTULO_VEICULO, type ConfigMapa, type EntregadorNoMapa, type Ponto } from '@etiquetas/shared';

const CENTRO_BRASIL: Ponto = { lat: -15.78, lon: -47.93 };

/**
 * Mapa do Leaflet com o OpenStreetMap. Só círculos e marcadores desenhados (sem imagens de ícone),
 * para não depender de arquivos do pacote nem da CSP.
 */
export function MapaEntregadores({
  config,
  base,
  raioKm,
  entregadores = [],
  aoClicar,
  altura = 480,
}: {
  config: ConfigMapa;
  base: Ponto | null;
  raioKm: number;
  entregadores?: EntregadorNoMapa[];
  aoClicar?: (p: Ponto) => void;
  altura?: number;
}) {
  const elemento = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const clique = useRef(aoClicar);
  clique.current = aoClicar;
  const enquadrado = useRef<string | null>(null);

  useEffect(() => {
    if (!elemento.current) return;
    const m = L.map(elemento.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(config.blocos, { maxZoom: config.zoomMaximo, attribution: config.atribuicao }).addTo(m);
    m.setView([CENTRO_BRASIL.lat, CENTRO_BRASIL.lon], 4);
    m.on('click', (e: L.LeafletMouseEvent) => clique.current?.({ lat: Number(e.latlng.lat.toFixed(6)), lon: Number(e.latlng.lng.toFixed(6)) }));
    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
    };
  }, [config.blocos, config.atribuicao, config.zoomMaximo]);

  useEffect(() => {
    const m = mapa.current;
    const g = camada.current;
    if (!m || !g) return;
    g.clearLayers();
    if (base) {
      const area = L.circle([base.lat, base.lon], { radius: raioKm * 1000, color: '#2563eb', weight: 1, fillOpacity: 0.05 }).addTo(g);
      L.circleMarker([base.lat, base.lon], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#ea580c', fillOpacity: 1 }).bindTooltip('Ponto de partida da empresa').addTo(g);
      // Enquadra só quando o ponto ou o raio mudam: a atualização dos entregadores não tira o zoom de quem está olhando.
      const chave = `${base.lat},${base.lon},${raioKm}`;
      if (enquadrado.current !== chave) {
        m.fitBounds(area.getBounds(), { padding: [16, 16] });
        enquadrado.current = chave;
      }
    }
    for (const e of entregadores) {
      const livre = e.situacao === 'LIVRE';
      L.circleMarker([e.lat, e.lon], { radius: 7, color: '#ffffff', weight: 2, fillColor: livre ? '#059669' : '#94a3b8', fillOpacity: 1 })
        .bindTooltip(`${e.nome} · ${ROTULO_VEICULO[e.veiculo]} · ${ROTULO_SITUACAO_MAPA[e.situacao]} · ${e.distanciaKm.toLocaleString('pt-BR')} km`)
        .addTo(g);
    }
  }, [base?.lat, base?.lon, raioKm, entregadores]);

  return <div ref={elemento} style={{ height: altura }} className={`z-0 w-full rounded-lg border border-slate-200 ${aoClicar ? 'cursor-crosshair' : ''}`} data-testid="mapa-entregas" />;
}
