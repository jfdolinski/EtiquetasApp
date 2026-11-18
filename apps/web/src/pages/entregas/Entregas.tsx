import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RAIO_ATENDIMENTO_MAXIMO_KM,
  ROTULO_SITUACAO_MAPA,
  ROTULO_VEICULO,
  type ConfigEntregasEmpresa,
  type ConfigMapa,
  type MapaEntregas,
  type Ponto,
  type ResultadoEndereco,
} from '@etiquetas/shared';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Alerta, Botao, Cabecalho, Campo, Selo, Tabela } from '../../components/ui';
import { MapaEntregadores } from './MapaEntregadores';

type Aba = 'mapa' | 'configuracao';
type RespostaConfig = { config: ConfigEntregasEmpresa; mapa: ConfigMapa };

const ATUALIZAR_MS = 20_000;

/** Entregadores online perto da empresa. Chamadas e direcionamento vêm nas próximas etapas (docs/ENTREGAS.md). */
export function Entregas() {
  const { pode } = useAuth();
  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'mapa', rotulo: 'Mapa' },
    ...(pode('entrega.configurar') ? [{ id: 'configuracao' as const, rotulo: 'Configuração' }] : []),
  ];
  const [aba, setAba] = useState<Aba>('mapa');
  const config = useQuery({ queryKey: ['entregas-config'], queryFn: () => api<RespostaConfig>('/entregas/config') });

  return (
    <div>
      <Cabecalho titulo="Entregas" descricao="Entregadores online perto da empresa. A posição de quem está livre aparece aproximada." />
      {abas.length > 1 && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
          {abas.map(({ id, rotulo }) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {rotulo}
            </button>
          ))}
        </div>
      )}
      {config.error && <Alerta>{config.error.message}</Alerta>}
      {config.data && aba === 'mapa' && <PainelMapa mapa={config.data.mapa} configurar={pode('entrega.configurar') ? () => setAba('configuracao') : null} />}
      {config.data && aba === 'configuracao' && <Configuracao inicial={config.data.config} mapa={config.data.mapa} aoSalvar={() => setAba('mapa')} />}
    </div>
  );
}

function PainelMapa({ mapa, configurar }: { mapa: ConfigMapa; configurar: (() => void) | null }) {
  const { data, error, dataUpdatedAt } = useQuery({ queryKey: ['entregas-mapa'], queryFn: () => api<MapaEntregas>('/entregas/mapa'), refetchInterval: ATUALIZAR_MS });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!data) return <div className="text-sm text-slate-500">Carregando…</div>;
  if (!data.config.base) {
    return (
      <Alerta tipo="info">
        Marque o ponto de partida da empresa (loja ou depósito) para ver os entregadores por perto.{' '}
        {configurar ? (
          <button type="button" className="font-medium underline" onClick={configurar}>
            Configurar agora
          </button>
        ) : (
          'Peça a quem configura as entregas.'
        )}
      </Alerta>
    );
  }
  const livres = data.entregadores.filter((e) => e.situacao === 'LIVRE').length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600">
        <span>
          <strong className="text-slate-900">{livres}</strong> livre{livres === 1 ? '' : 's'} em até {data.config.raioAtendimentoKm} km
        </span>
        {data.entregadores.length > livres && <span>{data.entregadores.length - livres} sem sinal</span>}
        <span className="text-xs text-slate-400">Atualiza a cada 20 s · {new Date(dataUpdatedAt).toLocaleTimeString('pt-BR')}</span>
      </div>
      <MapaEntregadores config={mapa} base={data.config.base} raioKm={data.config.raioAtendimentoKm} entregadores={data.entregadores} />
      <Tabela colunas={['Entregador', 'Veículo', 'Distância', 'Situação']} vazio={data.entregadores.length === 0}>
        {data.entregadores.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2.5">{e.nome}</td>
            <td className="px-4 py-2.5">{ROTULO_VEICULO[e.veiculo]}</td>
            <td className="px-4 py-2.5">{e.distanciaKm.toLocaleString('pt-BR')} km</td>
            <td className="px-4 py-2.5">
              <Selo cor={e.situacao === 'LIVRE' ? 'verde' : 'cinza'}>{ROTULO_SITUACAO_MAPA[e.situacao]}</Selo>
            </td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}

function Configuracao({ inicial, mapa, aoSalvar }: { inicial: ConfigEntregasEmpresa; mapa: ConfigMapa; aoSalvar: () => void }) {
  const cliente = useQueryClient();
  const [base, setBase] = useState<(Ponto & { endereco: string }) | null>(inicial.base);
  const [raio, setRaio] = useState(String(inicial.raioAtendimentoKm));
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ResultadoEndereco[] | null>(null);
  useEffect(() => setBase(inicial.base), [inicial.base]);

  const buscar = useMutation({
    mutationFn: (q: string) => api<ResultadoEndereco[]>(`/entregas/enderecos?${new URLSearchParams({ q })}`),
    onSuccess: setResultados,
  });
  const salvar = useMutation({
    mutationFn: () => api<ConfigEntregasEmpresa>('/entregas/config', { metodo: 'PUT', corpo: { base, raioAtendimentoKm: Number(raio) } }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['entregas-config'] });
      void cliente.invalidateQueries({ queryKey: ['entregas-mapa'] });
      aoSalvar();
    },
  });
  const raioNumero = Number(raio);
  const raioValido = Number.isInteger(raioNumero) && raioNumero >= 1 && raioNumero <= RAIO_ATENDIMENTO_MAXIMO_KM;

  const aoBuscar = (e: FormEvent) => {
    e.preventDefault();
    if (busca.trim().length >= 4) buscar.mutate(busca.trim());
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-4">
        <form onSubmit={aoBuscar} className="space-y-2">
          <Campo rotulo="Endereço da loja ou do depósito" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Rua, número, cidade" ajuda="Busque o endereço ou clique no mapa para marcar o ponto." />
          <Botao type="submit" variante="secundario" disabled={buscar.isPending || busca.trim().length < 4}>
            {buscar.isPending ? 'Buscando…' : 'Buscar endereço'}
          </Botao>
        </form>
        {buscar.error && <Alerta>{buscar.error.message}</Alerta>}
        {resultados && (
          <div className="space-y-1">
            {resultados.length === 0 && <p className="text-sm text-slate-500">Nenhum endereço encontrado. Tente com a cidade, ou clique no mapa.</p>}
            {resultados.map((r) => (
              <button key={`${r.lat},${r.lon}`} type="button" onClick={() => { setBase(r); setResultados(null); }} className="block w-full rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                {r.endereco}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="font-medium text-slate-700">Ponto de partida</div>
          {base ? (
            <>
              <div className="text-slate-600">{base.endereco || 'Marcado no mapa'}</div>
              <div className="text-xs text-slate-400">
                {base.lat.toFixed(5)}, {base.lon.toFixed(5)}
              </div>
            </>
          ) : (
            <div className="text-slate-500">Ainda não marcado.</div>
          )}
        </div>
        <Campo rotulo="Raio de atendimento (km)" type="number" min={1} max={RAIO_ATENDIMENTO_MAXIMO_KM} value={raio} onChange={(e) => setRaio(e.target.value)} ajuda="Entregadores fora desse raio não aparecem para a empresa." />
        {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
        <Botao onClick={() => salvar.mutate()} disabled={!base || !raioValido || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </div>
      <MapaEntregadores config={mapa} base={base} raioKm={raioValido ? raioNumero : 1} aoClicar={(p) => setBase({ ...p, endereco: '' })} />
    </div>
  );
}
