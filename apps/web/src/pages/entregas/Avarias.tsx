import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatarCentavos,
  MAX_FOTOS_AVARIA,
  problemaNaAvaria,
  RESPONSAVEIS_AVARIA,
  ROTULO_RESPONSAVEL_AVARIA,
  ROTULO_SITUACAO_AVARIA,
  ROTULO_TIPO_AVARIA,
  TIPOS_AVARIA,
  type AvariaResumo,
  type ChamadaResumo,
  type NovaAvaria,
  type ResponsavelAvaria,
  type SituacaoAvaria,
  type TipoAvaria,
} from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Campo, formatarData, Selecao, Selo, Tabela } from '../../components/ui';

const COR_SITUACAO: Record<SituacaoAvaria, 'cinza' | 'amarelo' | 'verde' | 'vermelho'> = {
  SEM_DESCONTO: 'cinza',
  AGUARDANDO: 'amarelo',
  ACEITA: 'verde',
  CONTESTADA: 'vermelho',
  RETIRADA: 'cinza',
};

/** "12,50" → 1250 (vazio = 0). */
export function centavosDoTexto(v: string): number {
  const n = Number((v ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/** Avarias e extravios de uma chamada, com o registro (fotos, prejuízo, responsável e desconto). */
export function AvariasDaChamada({ c, gerencia }: { c: ChamadaResumo; gerencia: boolean }) {
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: ['chamada-avarias', c.id], queryFn: () => api<AvariaResumo[]>(`/entregas/chamadas/${c.id}/avarias`), enabled: c.avarias > 0 });
  const [aberto, setAberto] = useState(false);
  const podeRegistrar = gerencia && !!c.entregador && (c.situacao === 'COLETADA' || c.situacao === 'NO_DESTINO' || c.situacao === 'OCORRENCIA' || c.situacao === 'CONCLUIDA' || c.situacao === 'CANCELADA');
  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: ['chamada-avarias', c.id] });
    void cliente.invalidateQueries({ queryKey: ['chamada', c.id] });
    void cliente.invalidateQueries({ queryKey: ['entregas-avarias'] });
  };
  if (!podeRegistrar && !c.avarias) return null;
  return (
    <div className="space-y-2 rounded-md border border-slate-200 px-3 py-2" data-testid="avarias">
      <div className="flex items-center justify-between gap-2">
        <strong>Avaria ou extravio</strong>
        {podeRegistrar && !aberto && (
          <button type="button" className="text-sm text-blue-700 underline" onClick={() => setAberto(true)}>
            Registrar avaria ou extravio
          </button>
        )}
      </div>
      {(lista.data ?? []).map((a) => (
        <LinhaAvaria key={a.id} a={a} gerencia={gerencia} aoMudar={atualizar} />
      ))}
      {aberto && (
        <NovaAvariaForm
          c={c}
          aoFechar={() => setAberto(false)}
          aoCriar={() => {
            setAberto(false);
            atualizar();
          }}
        />
      )}
    </div>
  );
}

function LinhaAvaria({ a, gerencia, aoMudar }: { a: AvariaResumo; gerencia: boolean; aoMudar: () => void }) {
  const [foto, setFoto] = useState<string | null>(null);
  const verFoto = useMutation({ mutationFn: (n: number) => api<{ dados: string }>(`/entregas/avarias/${a.id}/fotos/${n}`), onSuccess: (r) => setFoto(r.dados) });
  const retirar = useMutation({ mutationFn: () => api<AvariaResumo>(`/entregas/avarias/${a.id}/retirar`, { metodo: 'POST' }), onSuccess: aoMudar });
  return (
    <div className="space-y-1 border-t border-slate-100 pt-2 text-sm" data-testid="avaria">
      <div className="flex flex-wrap items-center gap-2">
        <Selo cor={COR_SITUACAO[a.situacao]}>{ROTULO_SITUACAO_AVARIA[a.situacao]}</Selo>
        <span>{ROTULO_TIPO_AVARIA[a.tipo]}</span>
        <span className="text-slate-500">{formatarData(a.criadoEm)}</span>
      </div>
      <div>{a.descricao}</div>
      <div className="text-slate-600">
        Prejuízo {formatarCentavos(a.prejuizoCentavos)} · responsável: {ROTULO_RESPONSAVEL_AVARIA[a.responsavel].toLowerCase()}
        {a.descontoCentavos > 0 && ` · desconto proposto ao entregador: ${formatarCentavos(a.descontoCentavos)}`}
      </div>
      {a.resposta && <div className="text-slate-600">Resposta do entregador: {a.resposta}</div>}
      {a.situacao === 'CONTESTADA' && <div className="text-xs text-slate-500">O entregador não concordou: nada é descontado. O acerto, se houver, é fora do Flow.</div>}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: a.fotos }, (_, n) => (
          <button key={n} type="button" className="text-blue-700 underline" onClick={() => verFoto.mutate(n)}>
            Ver foto {n + 1}
          </button>
        ))}
        {gerencia && a.situacao !== 'RETIRADA' && !a.pago && (
          <button type="button" className="text-red-700 underline" onClick={() => retirar.mutate()} disabled={retirar.isPending}>
            Retirar
          </button>
        )}
      </div>
      {retirar.error && <Alerta>{retirar.error.message}</Alerta>}
      {foto && <img src={foto} alt="Foto da avaria" className="max-h-64 rounded border" onClick={() => setFoto(null)} />}
    </div>
  );
}

function NovaAvariaForm({ c, aoFechar, aoCriar }: { c: ChamadaResumo; aoFechar: () => void; aoCriar: () => void }) {
  const [tipo, setTipo] = useState<TipoAvaria>('AVARIA');
  const [descricao, setDescricao] = useState('');
  const [prejuizo, setPrejuizo] = useState('');
  const [responsavel, setResponsavel] = useState<ResponsavelAvaria>('ENTREGADOR');
  const [desconto, setDesconto] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const corpo: NovaAvaria = { tipo, descricao, prejuizoCentavos: centavosDoTexto(prejuizo), responsavel, descontoCentavos: responsavel === 'ENTREGADOR' ? centavosDoTexto(desconto) : 0, fotos };
  const problema = problemaNaAvaria(corpo, c.valorDeclaradoCentavos);
  const criar = useMutation({ mutationFn: () => api<AvariaResumo>(`/entregas/chamadas/${c.id}/avarias`, { metodo: 'POST', corpo }), onSuccess: aoCriar });
  return (
    <div className="space-y-3 border-t border-slate-100 pt-2">
      <Selecao rotulo="O que aconteceu" value={tipo} onChange={(e) => setTipo(e.target.value as TipoAvaria)}>
        {TIPOS_AVARIA.map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_AVARIA[t]}
          </option>
        ))}
      </Selecao>
      <Campo rotulo="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Prejuízo (R$)" inputMode="decimal" value={prejuizo} onChange={(e) => setPrejuizo(e.target.value)} />
        <Selecao rotulo="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value as ResponsavelAvaria)}>
          {RESPONSAVEIS_AVARIA.map((r) => (
            <option key={r} value={r}>
              {ROTULO_RESPONSAVEL_AVARIA[r]}
            </option>
          ))}
        </Selecao>
      </div>
      {responsavel === 'ENTREGADOR' && (
        <Campo
          rotulo="Descontar do entregador (R$, opcional)"
          inputMode="decimal"
          value={desconto}
          onChange={(e) => setDesconto(e.target.value)}
          ajuda={`O entregador aceita ou contesta pelo app; só aceito entra no próximo pagamento.${c.valorDeclaradoCentavos !== null ? ` Até o valor declarado (${formatarCentavos(c.valorDeclaradoCentavos)}).` : ''}`}
        />
      )}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Fotos (1 a {MAX_FOTOS_AVARIA})</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={async (e) => {
            const arquivos = [...(e.target.files ?? [])].slice(0, MAX_FOTOS_AVARIA);
            setFotos(await Promise.all(arquivos.map(lerArquivo)));
          }}
        />
        {fotos.length > 0 && <span className="text-xs text-slate-500">{fotos.length === 1 ? '1 foto escolhida' : `${fotos.length} fotos escolhidas`}</span>}
      </label>
      {problema && descricao.length > 0 && <Alerta tipo="aviso">{problema}</Alerta>}
      {criar.error && <Alerta>{criar.error.message}</Alerta>}
      <div className="flex gap-2">
        <Botao onClick={() => criar.mutate()} disabled={!!problema || criar.isPending}>
          {criar.isPending ? 'Registrando…' : 'Registrar'}
        </Botao>
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

/** Lista de todas as avarias da empresa (aba Financeiro). */
export function AvariasDaEmpresa() {
  const { data, error } = useQuery({ queryKey: ['entregas-avarias'], queryFn: () => api<AvariaResumo[]>('/entregas/avarias') });
  if (error) return <Alerta>{error.message}</Alerta>;
  if (!data?.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Avarias e extravios</h2>
      <Tabela colunas={['Chamada', 'Entregador', 'O que foi', 'Prejuízo', 'Desconto', 'Situação']}>
          {data.map((a) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-4 py-2.5">nº {a.numero}</td>
              <td className="px-4 py-2.5">{a.entregadorNome}</td>
              <td className="px-4 py-2.5">{ROTULO_TIPO_AVARIA[a.tipo]}</td>
              <td className="px-4 py-2.5 text-right">{formatarCentavos(a.prejuizoCentavos)}</td>
              <td className="px-4 py-2.5 text-right">{a.descontoCentavos ? formatarCentavos(a.descontoCentavos) : '-'}</td>
              <td className="px-4 py-2.5">
                <Selo cor={COR_SITUACAO[a.situacao]}>{ROTULO_SITUACAO_AVARIA[a.situacao]}</Selo>
              </td>
            </tr>
          ))}
      </Tabela>
    </section>
  );
}
