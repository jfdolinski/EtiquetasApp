import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatarDataBr,
  formatarMoeda,
  ROTULO_ETAPA,
  VARIAVEIS_MENSAGEM,
  type EtapaCobranca,
  type ExecucaoAvaliacaoResumo,
  type ParametrosCobrancaGlobais,
  type SituacaoCobrancaEmpresa,
} from '@etiquetas/shared';
import { api } from '../../api';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selo, Tabela, formatarData } from '../../components/ui';
import { FormAssinatura } from './FormAssinatura';

const COR_ETAPA: Record<EtapaCobranca, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  EM_DIA: 'verde',
  AVISO_PREVIO: 'cinza',
  CARENCIA: 'amarelo',
  PRE_BLOQUEIO: 'amarelo',
  BLOQUEADA: 'vermelho',
};

export function Cobranca() {
  const cliente = useQueryClient();
  const [edicao, setEdicao] = useState<SituacaoCobrancaEmpresa | null>(null);
  const { data: situacoes = [], error } = useQuery({ queryKey: ['cobranca-empresas'], queryFn: () => api<SituacaoCobrancaEmpresa[]>('/cobranca/empresas') });
  const { data: execucoes = [] } = useQuery({ queryKey: ['cobranca-execucoes'], queryFn: () => api<ExecucaoAvaliacaoResumo[]>('/cobranca/execucoes') });
  const avaliar = useMutation({
    mutationFn: () => api<ExecucaoAvaliacaoResumo>('/cobranca/avaliar', { metodo: 'POST' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cobranca-empresas'] });
      void cliente.invalidateQueries({ queryKey: ['cobranca-execucoes'] });
      void cliente.invalidateQueries({ queryKey: ['empresas'] });
    },
  });
  const ultima = execucoes[0];

  return (
    <>
      <Cabecalho
        titulo="Cobrança"
        descricao="Mensalidades, carência e bloqueio automático. A avaliação roda todo dia no horário configurado."
        acoes={
          <Botao variante="secundario" disabled={avaliar.isPending} onClick={() => avaliar.mutate()}>
            {avaliar.isPending ? 'Avaliando…' : 'Avaliar agora'}
          </Botao>
        }
      />
      <div className="space-y-6">
        {(error ?? avaliar.error) && <Alerta>{(error ?? avaliar.error)!.message}</Alerta>}
        {ultima && (
          <p className="text-sm text-slate-500">
            Última avaliação: {formatarData(ultima.iniciadoEm)} ({ultima.origem === 'AGENDADA' ? 'agendada' : 'manual'})
            {ultima.resultado &&
              ` · ${ultima.resultado.avaliadas} avaliada(s), ${ultima.resultado.bloqueadas} bloqueada(s), ${ultima.resultado.liberadas} liberada(s), ${ultima.resultado.avisos} aviso(s)`}
            {ultima.erro && <span className="text-red-700"> · erro: {ultima.erro}</span>}
          </p>
        )}

        <Tabela colunas={['Empresa', 'Mensalidade', 'Vencimento em aberto', 'Situação', 'Status', '']} vazio={situacoes.length === 0}>
          {situacoes.map((s) => (
            <tr key={s.empresa.id} className={s.empresa.ativa ? '' : 'text-slate-400'}>
              <td className="px-4 py-2.5 font-medium">{s.empresa.nome}</td>
              <td className="px-4 py-2.5">{s.assinatura ? formatarMoeda(s.assinatura.valorMensal) : <span className="text-slate-400">Sem assinatura</span>}</td>
              <td className="px-4 py-2.5">
                {s.assinatura ? formatarDataBr(s.assinatura.vencimentoAtual) : '—'}
                {s.avaliacao && s.avaliacao.diasAtraso > 0 && <div className="text-xs text-red-700">{s.avaliacao.diasAtraso} dia(s) de atraso</div>}
              </td>
              <td className="px-4 py-2.5">
                {s.avaliacao ? <Selo cor={COR_ETAPA[s.avaliacao.etapa]}>{ROTULO_ETAPA[s.avaliacao.etapa]}</Selo> : '—'}
                {s.assinatura?.controleManual && <div className="text-xs text-slate-500">controle manual</div>}
              </td>
              <td className="px-4 py-2.5 text-xs">{s.empresa.statusAssinatura}</td>
              <td className="px-4 py-2.5 text-right">
                <Botao variante="secundario" onClick={() => setEdicao(s)}>{s.assinatura ? 'Gerenciar' : 'Criar assinatura'}</Botao>
              </td>
            </tr>
          ))}
        </Tabela>

        <ParametrosGlobais />
      </div>
      <Modal titulo={`Assinatura · ${edicao?.empresa.nome ?? ''}`} aberto={edicao !== null} aoFechar={() => setEdicao(null)} largo>
        {edicao && <FormAssinatura situacao={edicao} aoMudar={() => void cliente.invalidateQueries({ queryKey: ['cobranca-empresas'] })} />}
      </Modal>
    </>
  );
}

function ParametrosGlobais() {
  const cliente = useQueryClient();
  const { data } = useQuery({ queryKey: ['cobranca-parametros'], queryFn: () => api<ParametrosCobrancaGlobais>('/cobranca/parametros') });
  if (!data) return null;
  return <FormParametros key={JSON.stringify(data)} inicial={data} aoSalvar={(p) => cliente.setQueryData(['cobranca-parametros'], p)} />;
}

function FormParametros({ inicial, aoSalvar }: { inicial: ParametrosCobrancaGlobais; aoSalvar: (p: ParametrosCobrancaGlobais) => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState(inicial);
  const salvar = useMutation({
    mutationFn: () => api<ParametrosCobrancaGlobais>('/cobranca/parametros', { metodo: 'PUT', corpo: f }),
    onSuccess: (p) => {
      aoSalvar(p);
      void cliente.invalidateQueries({ queryKey: ['cobranca-empresas'] });
    },
  });
  const num = (k: keyof ParametrosCobrancaGlobais) => ({
    type: 'number',
    value: String(f[k]),
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) }),
  });
  const texto = (k: keyof ParametrosCobrancaGlobais, rotulo: string) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{rotulo}</span>
      <textarea
        rows={2}
        value={String(f[k])}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold">Parâmetros de cobrança</h2>
        <p className="text-sm text-slate-500">
          Linha do tempo: aviso prévio antes do vencimento → carência (acesso normal, com aviso) → pré-bloqueio → bloqueio. Cada empresa pode sobrescrever os prazos.
        </p>
      </div>
      {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
      {salvar.isSuccess && <Alerta tipo="info">Parâmetros salvos. Valem na próxima avaliação (use “Avaliar agora” para aplicar já).</Alerta>}
      <div className="grid gap-3 sm:grid-cols-5">
        <Campo rotulo="Aviso prévio (dias antes)" min={0} max={365} required {...num('diasAvisoPrevio')} />
        <Campo rotulo="Carência (dias após vencer)" min={0} max={365} required {...num('diasCarencia')} />
        <Campo rotulo="Bloqueio (dias após vencer)" min={0} max={365} required {...num('diasAteBloqueio')} />
        <Campo rotulo="Repetir aviso a cada (dias)" min={1} max={365} required {...num('frequenciaAvisoDias')} />
        <Campo rotulo="Hora da avaliação diária" min={0} max={23} required {...num('horaAvaliacao')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {texto('mensagemAvisoPrevio', 'Mensagem de aviso prévio')}
        {texto('mensagemCarencia', 'Mensagem de carência')}
        {texto('mensagemPreBloqueio', 'Mensagem de pré-bloqueio')}
        {texto('mensagemBloqueio', 'Mensagem de bloqueio (tela de login)')}
      </div>
      <p className="text-xs text-slate-500">Variáveis: {VARIAVEIS_MENSAGEM.join(' ')}</p>
      <div className="flex justify-end">
        <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar parâmetros'}</Botao>
      </div>
    </form>
  );
}
