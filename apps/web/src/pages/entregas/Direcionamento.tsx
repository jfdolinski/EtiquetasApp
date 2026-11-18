import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CRITERIOS,
  formatarKm,
  LIMITES_DIRECIONAMENTO,
  MODOS_OFERTA,
  problemaNasRegras,
  REGRAS_DIRECIONAMENTO_PADRAO,
  ROTULO_CRITERIO,
  ROTULO_MODO_OFERTA,
  ROTULO_TIPO_CHAMADA,
  ROTULO_VEICULO,
  somaDosPesos,
  TIPOS_CHAMADA,
  TIPOS_VEICULO,
  type ConfigEntregasEmpresa,
  type ConfigMapa,
  type ModoOferta,
  type Ponto,
  type RegrasDirecionamento,
  type Simulacao,
  type TipoChamada,
} from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Campo, Selecao, Tabela } from '../../components/ui';
import { MapaEntregadores } from './MapaEntregadores';

const COR_PONTO = '#ea580c';

/** Regras da distribuição automática e o simulador (quem receberia agora, com o que está na tela). */
export function Direcionamento({ inicial, mapa }: { inicial: ConfigEntregasEmpresa; mapa: ConfigMapa }) {
  const cliente = useQueryClient();
  const [r, setR] = useState<RegrasDirecionamento>(inicial.direcionamento);
  const [ponto, setPonto] = useState<Ponto | null>(inicial.base);
  const [tipo, setTipo] = useState<TipoChamada>('ENTREGA');
  const mudar = (x: Partial<RegrasDirecionamento>) => setR({ ...r, ...x });
  const problema = problemaNasRegras(r);
  const soma = somaDosPesos(r.pesos);

  const salvar = useMutation({
    mutationFn: () => api<ConfigEntregasEmpresa>('/entregas/direcionamento', { metodo: 'PUT', corpo: { regras: r } }),
    onSuccess: (c) => {
      setR(c.direcionamento);
      void cliente.invalidateQueries({ queryKey: ['entregas-config'] });
    },
  });
  const simular = useMutation({ mutationFn: () => api<Simulacao>('/entregas/direcionamento/simular', { metodo: 'POST', corpo: { regras: r, ponto: ponto && { lat: ponto.lat, lon: ponto.lon }, tipo } }) });
  const numero = (k: keyof typeof LIMITES_DIRECIONAMENTO | 'raioLimiteKm', rotulo: string, ajuda?: string) => (
    <Campo rotulo={rotulo} type="number" value={String(r[k])} onChange={(e) => mudar({ [k]: Number(e.target.value) })} ajuda={ajuda} />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[26rem_1fr]">
      <div className="space-y-5 text-sm">
        <Secao titulo="Quando usar">
          <Marca checked={r.automatico} onChange={(v) => mudar({ automatico: v })}>
            Toda chamada nova vai direto para a distribuição automática
          </Marca>
          <p className="text-xs text-slate-500">Desligado, a chamada fica esperando você escolher alguém ou clicar em "Distribuir automaticamente". O entregador sempre precisa aceitar.</p>
        </Secao>

        <Secao titulo="1. Quem pode receber">
          <p className="text-xs text-slate-500">Sempre: aprovado, online com diária do dia, posição dos últimos 2 min, livre e sem recusa desta chamada.</p>
          <div className="grid grid-cols-2 gap-2">
            {numero('raioKm', 'Raio inicial até a coleta (km)')}
            {numero('raioLimiteKm', 'Raio limite (km)')}
          </div>
          <Marca checked={r.somentePreferidos} onChange={(v) => mudar({ somentePreferidos: v })}>
            Só os meus preferidos
          </Marca>
          <div>
            <div className="mb-1 font-medium">Veículos aceitos</div>
            <table className="text-xs">
              <thead>
                <tr>
                  <th />
                  {TIPOS_VEICULO.map((v) => (
                    <th key={v} className="px-2 font-normal text-slate-500">
                      {ROTULO_VEICULO[v]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIPOS_CHAMADA.map((t) => (
                  <tr key={t}>
                    <td className="pr-2">{ROTULO_TIPO_CHAMADA[t]}</td>
                    {TIPOS_VEICULO.map((v) => (
                      <td key={v} className="px-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${ROTULO_TIPO_CHAMADA[t]} de ${ROTULO_VEICULO[v]}`}
                          checked={r.veiculos[t].includes(v)}
                          onChange={(e) => mudar({ veiculos: { ...r.veiculos, [t]: e.target.checked ? TIPOS_VEICULO.filter((x) => x === v || r.veiculos[t].includes(x)) : r.veiculos[t].filter((x) => x !== v) } })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>

        <Secao titulo="2. Ordem de preferência">
          <p className="text-xs text-slate-500">Cada critério dá uma nota de 0 a 1, multiplicada pelo peso. Os pesos somam 100. Empate: quem está livre há mais tempo.</p>
          <div className="grid grid-cols-2 gap-2">
            {CRITERIOS.map((c) => (
              <Campo key={c} rotulo={`Peso: ${ROTULO_CRITERIO[c]}`} type="number" min={0} max={100} value={String(r.pesos[c])} onChange={(e) => mudar({ pesos: { ...r.pesos, [c]: Number(e.target.value) } })} />
            ))}
          </div>
          <div className={soma === 100 ? 'text-slate-500' : 'font-medium text-red-700'}>Soma: {soma}</div>
          <p className="text-xs text-slate-500">Sem histórico de aceite e sem avaliação, a nota é 0,8. Recusar ou deixar expirar só baixa a taxa de aceite; ninguém é bloqueado automaticamente.</p>
          <Marca checked={r.preferidosPrimeiro} onChange={(v) => mudar({ preferidosPrimeiro: v })}>
            Preferidos sempre primeiro
          </Marca>
        </Secao>

        <Secao titulo="3. Como oferecer">
          <Selecao rotulo="Modo" value={r.modo} onChange={(e) => mudar({ modo: e.target.value as ModoOferta })}>
            {MODOS_OFERTA.map((m) => (
              <option key={m} value={m}>
                {ROTULO_MODO_OFERTA[m]}
              </option>
            ))}
          </Selecao>
          <div className="grid grid-cols-2 gap-2">
            {r.modo === 'GRUPO' && numero('tamanhoGrupo', 'Entregadores por grupo')}
            {numero('maxTentativas', r.modo === 'GRUPO' ? 'Grupos por rodada' : 'Ofertas por rodada')}
            {numero('minutosNovaTentativa', 'Nova rodada a cada (min)')}
            {numero('ampliarRaioKm', 'Aumentar o raio a cada rodada (km)')}
          </div>
          <p className="text-xs text-slate-500">
            Cada oferta tem {inicial.segundosParaAceitar} s para ser aceita (muda na Configuração). Sem aceite na rodada, a chamada espera, o aviso "Chamada sem entregador" das Notificações pode tocar e o sistema tenta de novo com o raio maior.
          </p>
        </Secao>

        {problema && <Alerta tipo="aviso">{problema}</Alerta>}
        {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
        {salvar.isSuccess && !salvar.isPending && <Alerta tipo="info">Regras salvas.</Alerta>}
        <div className="flex gap-2">
          <Botao onClick={() => salvar.mutate()} disabled={!!problema || salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar regras'}
          </Botao>
          <Botao variante="secundario" onClick={() => setR(REGRAS_DIRECIONAMENTO_PADRAO)}>
            Voltar ao padrão
          </Botao>
        </div>
      </div>

      <div className="space-y-3">
        <div className="font-medium">Simulador</div>
        <p className="text-sm text-slate-600">Clique no mapa para escolher onde seria a coleta. O simulador usa as regras da tela, mesmo antes de salvar, e os entregadores online agora.</p>
        <MapaEntregadores config={mapa} base={null} raioKm={1} marcas={ponto ? [{ ...ponto, cor: COR_PONTO, rotulo: 'Coleta simulada' }] : []} aoClicar={setPonto} altura={340} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Selecao rotulo="Serviço" value={tipo} onChange={(e) => setTipo(e.target.value as TipoChamada)}>
              {TIPOS_CHAMADA.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_CHAMADA[t]}
                </option>
              ))}
            </Selecao>
          </div>
          <Botao variante="secundario" onClick={() => simular.mutate()} disabled={!ponto || !!problema || simular.isPending}>
            {simular.isPending ? 'Simulando…' : 'Simular'}
          </Botao>
        </div>
        {simular.error && <Alerta>{simular.error.message}</Alerta>}
        {simular.data && <ResultadoSimulacao s={simular.data} />}
      </div>
    </div>
  );
}

function ResultadoSimulacao({ s }: { s: Simulacao }) {
  const recebem = s.regras.modo === 'GRUPO' ? s.regras.tamanhoGrupo : 1;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {s.classificados.length === 0 ? (
          <>Ninguém receberia agora em até {s.raioKm} km.</>
        ) : (
          <>
            Em até {s.raioKm} km, {s.classificados.length === 1 ? 'um entregador poderia receber' : `${s.classificados.length} entregadores poderiam receber`}. A primeira oferta iria para <strong>{s.classificados.slice(0, recebem).map((c) => c.nome).join(', ')}</strong>.
          </>
        )}
      </p>
      {s.classificados.length > 0 && (
        <Tabela colunas={['', 'Entregador', 'Distância', 'Livre', ...CRITERIOS.map((c) => ROTULO_CRITERIO[c]), 'Pontos']}>
          {s.classificados.map((c) => (
            <tr key={c.id} className={c.posicao <= recebem ? 'bg-green-50' : undefined}>
              <td className="px-3 py-2">{c.posicao}º</td>
              <td className="px-3 py-2">
                {c.nome}
                {c.preferido ? ' ★' : ''}
                <div className="text-xs text-slate-500">{ROTULO_VEICULO[c.veiculo]}</div>
              </td>
              <td className="px-3 py-2">{formatarKm(c.metrosAteColeta)}</td>
              <td className="px-3 py-2">{Math.round(c.minutosLivre)} min</td>
              {CRITERIOS.map((k) => (
                <td key={k} className="px-3 py-2 text-xs">
                  {c.notas[k].toLocaleString('pt-BR', { maximumFractionDigits: 2 })} × {s.regras.pesos[k]}
                </td>
              ))}
              <td className="px-3 py-2 font-semibold">{c.pontos.toLocaleString('pt-BR')}</td>
            </tr>
          ))}
        </Tabela>
      )}
      {s.descartados.length > 0 && (
        <div className="text-sm">
          <div className="font-medium">Fora desta oferta</div>
          <ul className="list-disc pl-5 text-slate-600">
            {s.descartados.map((d) => (
              <li key={d.id}>
                {d.nome}: {d.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
      <legend className="px-1 font-semibold">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Marca({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
