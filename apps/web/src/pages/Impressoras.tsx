import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DPIS, LINGUAGENS, ROTULO_LINGUAGEM, type AgenteResumo, type ImpressoraResumo, type LinguagemImpressora, type MetodoImpressora } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selecao, Selo, Tabela } from '../components/ui';

export function Impressoras() {
  return (
    <ExigeEmpresa>
      <ListaImpressoras />
    </ExigeEmpresa>
  );
}

function ListaImpressoras() {
  const { empresaId, pode } = useAuth();
  const podeEditar = pode('impressora.editar');
  const [edicao, setEdicao] = useState<{ impressora: ImpressoraResumo | null } | null>(null);
  const { data: impressoras = [], isLoading, error } = useQuery({
    queryKey: ['impressoras', empresaId],
    queryFn: () => api<ImpressoraResumo[]>('/impressoras'),
  });
  const { data: agentes = [] } = useQuery({
    queryKey: ['agentes', empresaId],
    queryFn: () => api<AgenteResumo[]>('/agentes'),
    enabled: pode('agente.ver'),
  });
  const nomeAgente = new Map(agentes.map((a) => [a.id, a.nome]));

  return (
    <>
      <Cabecalho
        titulo="Impressoras"
        descricao="Impressoras das lojas. A linguagem e o DPI definem como as etiquetas são geradas; o agente entrega os trabalhos."
        acoes={podeEditar && <Botao onClick={() => setEdicao({ impressora: null })}>Nova impressora</Botao>}
      />
      {error && <Alerta>{error.message}</Alerta>}
      {!isLoading && (
        <Tabela colunas={['Impressora', 'Linguagem', 'Conexão', 'Agente', '']} vazio={impressoras.length === 0}>
          {impressoras.map((i) => (
            <tr key={i.id} className={i.ativo ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5">
                <div className="font-medium">{i.nome} {!i.ativo && <Selo cor="cinza">Desativada</Selo>}</div>
                {i.modelo && <div className="text-xs text-slate-500">{i.modelo}</div>}
              </td>
              <td className="px-4 py-2.5">
                {ROTULO_LINGUAGEM[i.linguagem]}
                <div className="text-xs text-slate-500">{i.dpi} dpi{i.larguraMaximaMm ? ` · até ${i.larguraMaximaMm} mm` : ''}</div>
              </td>
              <td className="px-4 py-2.5">
                <div className="font-mono text-xs">{i.endereco}</div>
                <div className="text-xs text-slate-500">{i.metodo === 'REDE' ? 'Rede (RAW)' : 'Impressora do sistema'}</div>
              </td>
              <td className="px-4 py-2.5">{(i.agenteId && nomeAgente.get(i.agenteId)) ?? '—'}</td>
              <td className="px-4 py-2.5 text-right">
                {podeEditar && <Botao variante="secundario" onClick={() => setEdicao({ impressora: i })}>Editar</Botao>}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      <Modal titulo={edicao?.impressora ? 'Editar impressora' : 'Nova impressora'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && <FormImpressora impressora={edicao.impressora} agentes={agentes} aoConcluir={() => setEdicao(null)} />}
      </Modal>
    </>
  );
}

function FormImpressora({ impressora, agentes, aoConcluir }: { impressora: ImpressoraResumo | null; agentes: AgenteResumo[]; aoConcluir: () => void }) {
  const { empresaId } = useAuth();
  const cliente = useQueryClient();
  const [f, setF] = useState({
    nome: impressora?.nome ?? '',
    linguagem: impressora?.linguagem ?? ('ZPL' as LinguagemImpressora),
    dpi: impressora?.dpi ?? 203,
    metodo: impressora?.metodo ?? ('REDE' as MetodoImpressora),
    endereco: impressora?.endereco ?? '',
    agenteId: impressora?.agenteId ?? agentes.find((a) => a.ativo)?.id ?? '',
    modelo: impressora?.modelo ?? '',
    larguraMaximaMm: impressora?.larguraMaximaMm ? String(impressora.larguraMaximaMm) : '',
    ativo: impressora?.ativo ?? true,
  });
  const invalidar = () => void cliente.invalidateQueries({ queryKey: ['impressoras', empresaId] });

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        nome: f.nome,
        linguagem: f.linguagem,
        dpi: f.dpi,
        metodo: f.metodo,
        endereco: f.endereco,
        agenteId: f.agenteId || null,
        modelo: f.modelo,
        larguraMaximaMm: f.larguraMaximaMm ? Number(f.larguraMaximaMm) : null,
      };
      return impressora
        ? api(`/impressoras/${impressora.id}`, { metodo: 'PATCH', corpo: { ...corpo, ativo: f.ativo } })
        : api('/impressoras', { metodo: 'POST', corpo });
    },
    onSuccess: () => {
      invalidar();
      aoConcluir();
    },
  });
  const excluir = useMutation({
    mutationFn: () => api(`/impressoras/${impressora!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      invalidar();
      aoConcluir();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {(salvar.error ?? excluir.error) && <Alerta>{(salvar.error ?? excluir.error)!.message}</Alerta>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome" required placeholder="Ex.: Zebra Açougue" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        <Campo rotulo="Modelo" placeholder="Ex.: GC420t" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} />
        <Selecao rotulo="Linguagem" value={f.linguagem} onChange={(e) => setF({ ...f, linguagem: e.target.value as LinguagemImpressora })}>
          {LINGUAGENS.map((l) => (
            <option key={l} value={l}>{ROTULO_LINGUAGEM[l]}</option>
          ))}
        </Selecao>
        <Selecao rotulo="Resolução" value={f.dpi} onChange={(e) => setF({ ...f, dpi: Number(e.target.value) })}>
          {DPIS.map((d) => (
            <option key={d} value={d}>{d} dpi</option>
          ))}
        </Selecao>
        <Selecao rotulo="Conexão" value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value as MetodoImpressora })}>
          <option value="REDE">Rede (IP e porta, RAW)</option>
          <option value="SISTEMA">Impressora instalada no computador do agente</option>
        </Selecao>
        <Campo
          rotulo={f.metodo === 'REDE' ? 'IP e porta' : 'Nome no sistema'}
          required
          placeholder={f.metodo === 'REDE' ? '192.168.0.50:9100' : 'ZDesigner GC420t'}
          value={f.endereco}
          onChange={(e) => setF({ ...f, endereco: e.target.value })}
        />
        <Selecao rotulo="Agente" value={f.agenteId} onChange={(e) => setF({ ...f, agenteId: e.target.value })}>
          <option value="">Nenhum</option>
          {agentes.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.ativo}>{a.nome}</option>
          ))}
        </Selecao>
        <Campo
          rotulo="Largura máxima de impressão (mm)"
          type="number"
          min={10}
          max={1200}
          step="0.1"
          value={f.larguraMaximaMm}
          onChange={(e) => setF({ ...f, larguraMaximaMm: e.target.value })}
        />
      </div>
      {impressora && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          Impressora ativa
        </label>
      )}
      <div className="flex justify-between gap-2 pt-2">
        <div>
          {impressora && (
            <Botao variante="perigo" disabled={excluir.isPending} onClick={() => window.confirm(`Excluir a impressora "${impressora.nome}"?`) && excluir.mutate()}>
              Excluir
            </Botao>
          )}
        </div>
        <div className="flex gap-2">
          <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
          <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </div>
    </form>
  );
}
