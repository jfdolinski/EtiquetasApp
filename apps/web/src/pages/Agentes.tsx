import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatarCnpj, type AgenteResumo, type CodigoAtivacaoResposta } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ExigeEmpresa } from '../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selo, Tabela, formatarData } from '../components/ui';

export function Agentes() {
  return (
    <ExigeEmpresa>
      <ListaAgentes />
    </ExigeEmpresa>
  );
}

function situacao(a: AgenteResumo) {
  if (!a.ativo) return <Selo cor="cinza">Desativado</Selo>;
  if (!a.ativado) return <Selo cor="amarelo">{a.codigoAtivacaoExpiraEm ? 'Aguardando ativação' : 'Código expirado'}</Selo>;
  return a.online ? <Selo cor="verde">Online</Selo> : <Selo cor="vermelho">Offline</Selo>;
}

function ListaAgentes() {
  const { empresaId, pode } = useAuth();
  const cliente = useQueryClient();
  const podeEditar = pode('agente.editar');
  const [novo, setNovo] = useState(false);
  const [codigo, setCodigo] = useState<CodigoAtivacaoResposta | null>(null);
  const [renomear, setRenomear] = useState<AgenteResumo | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'info'; texto: string } | null>(null);

  const { data: agentes = [], isLoading, error } = useQuery({
    queryKey: ['agentes', empresaId],
    queryFn: () => api<AgenteResumo[]>('/agentes'),
    refetchInterval: 10_000, // status online/offline
  });
  const atualizarLista = () => void cliente.invalidateQueries({ queryKey: ['agentes', empresaId] });

  const acao = useMutation({
    mutationFn: async ({ agente, tipo }: { agente: AgenteResumo; tipo: 'codigo' | 'rotacionar' | 'ativo' }) => {
      if (tipo === 'codigo') setCodigo(await api<CodigoAtivacaoResposta>(`/agentes/${agente.id}/codigo-ativacao`, { metodo: 'POST' }));
      if (tipo === 'rotacionar') {
        await api(`/agentes/${agente.id}/rotacionar-token`, { metodo: 'POST' });
        setMensagem({ tipo: 'info', texto: `Token do agente "${agente.nome}" rotacionado. O agente já está usando o novo token.` });
      }
      if (tipo === 'ativo') await api(`/agentes/${agente.id}`, { metodo: 'PATCH', corpo: { ativo: !agente.ativo } });
    },
    onMutate: () => setMensagem(null),
    onError: (e) => setMensagem({ tipo: 'erro', texto: e.message }),
    onSettled: atualizarLista,
  });

  function confirmarNovoCodigo(agente: AgenteResumo) {
    if (
      !agente.ativado ||
      window.confirm(`Gerar novo código invalida o token atual: o agente "${agente.nome}" desconecta e precisa ser ativado de novo. Continuar?`)
    ) {
      acao.mutate({ agente, tipo: 'codigo' });
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Agentes"
        descricao="Programa instalado na rede da loja que acessa o banco do ERP e as impressoras. Conecta-se ao sistema pela internet, sem abrir portas."
        acoes={podeEditar && <Botao onClick={() => setNovo(true)}>Novo agente</Botao>}
      />
      <div className="space-y-4">
        {error && <Alerta>{error.message}</Alerta>}
        {mensagem && <Alerta tipo={mensagem.tipo}>{mensagem.texto}</Alerta>}
        {!isLoading && (
          <Tabela colunas={['Agente', 'Situação', 'Máquina', 'Versão', 'Bancos', 'Último contato', '']} vazio={agentes.length === 0}>
            {agentes.map((a) => (
              <tr key={a.id} className={a.ativo ? '' : 'text-slate-400'}>
                <td className="px-4 py-2.5 font-medium">{a.nome}</td>
                <td className="px-4 py-2.5">{situacao(a)}</td>
                <td className="px-4 py-2.5">
                  <div>{a.hostname ?? '—'}</div>
                  {a.sistemaOperacional && <div className="text-xs text-slate-500">{a.sistemaOperacional}</div>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{a.versao ?? '—'}</td>
                <td className="px-4 py-2.5">{a.totalConexoes}</td>
                <td className="px-4 py-2.5 text-slate-500">{formatarData(a.ultimoContatoEm)}</td>
                <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                  {podeEditar && (
                    <>
                      {a.ativo && (
                        <Botao variante="secundario" disabled={acao.isPending} onClick={() => confirmarNovoCodigo(a)}>
                          {a.ativado ? 'Reinstalar' : 'Novo código'}
                        </Botao>
                      )}
                      {a.ativo && a.online && (
                        <Botao variante="secundario" disabled={acao.isPending} onClick={() => acao.mutate({ agente: a, tipo: 'rotacionar' })}>
                          Rotacionar token
                        </Botao>
                      )}
                      <Botao variante="secundario" onClick={() => setRenomear(a)}>
                        Renomear
                      </Botao>
                      <Botao variante="secundario" disabled={acao.isPending} onClick={() => acao.mutate({ agente: a, tipo: 'ativo' })}>
                        {a.ativo ? 'Desativar' : 'Reativar'}
                      </Botao>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
        )}
      </div>

      <Modal titulo="Novo agente" aberto={novo} aoFechar={() => setNovo(false)}>
        {novo && (
          <FormNome
            rotuloBotao="Criar e gerar código"
            aoConcluir={(r) => {
              setNovo(false);
              if (r) setCodigo(r as CodigoAtivacaoResposta);
              atualizarLista();
            }}
            enviar={(nome) => api<CodigoAtivacaoResposta>('/agentes', { metodo: 'POST', corpo: { nome } })}
          />
        )}
      </Modal>
      <Modal titulo="Renomear agente" aberto={renomear !== null} aoFechar={() => setRenomear(null)}>
        {renomear && (
          <FormNome
            inicial={renomear.nome}
            rotuloBotao="Salvar"
            aoConcluir={() => {
              setRenomear(null);
              atualizarLista();
            }}
            enviar={(nome) => api(`/agentes/${renomear.id}`, { metodo: 'PATCH', corpo: { nome } })}
          />
        )}
      </Modal>
      <Modal titulo="Código de ativação" aberto={codigo !== null} aoFechar={() => setCodigo(null)}>
        {codigo && <InstrucoesAtivacao resposta={codigo} aoFechar={() => setCodigo(null)} />}
      </Modal>
    </>
  );
}

function FormNome({
  inicial = '',
  rotuloBotao,
  enviar,
  aoConcluir,
}: {
  inicial?: string;
  rotuloBotao: string;
  enviar: (nome: string) => Promise<unknown>;
  aoConcluir: (resultado?: unknown) => void;
}) {
  const [nome, setNome] = useState(inicial);
  const mutacao = useMutation({ mutationFn: () => enviar(nome), onSuccess: aoConcluir });

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    mutacao.mutate();
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-3">
      {mutacao.error && <Alerta>{mutacao.error.message}</Alerta>}
      <Campo
        rotulo="Nome"
        required
        minLength={2}
        autoFocus
        placeholder="Ex.: Loja Centro"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        ajuda="Identifica onde o agente está instalado."
      />
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={() => aoConcluir()}>Cancelar</Botao>
        <Botao type="submit" disabled={mutacao.isPending}>{mutacao.isPending ? 'Salvando…' : rotuloBotao}</Botao>
      </div>
    </form>
  );
}

function InstrucoesAtivacao({ resposta, aoFechar }: { resposta: CodigoAtivacaoResposta; aoFechar: () => void }) {
  const servidor = window.location.origin;

  return (
    <div className="space-y-4 text-sm">
      <p>
        Código para ativar o agente <strong>{resposta.agente.nome}</strong>. Ele é exibido só agora, vale uma única vez e
        expira em {formatarData(resposta.expiraEm)}.
      </p>
      <div className="rounded-md bg-slate-100 py-4 text-center font-mono text-3xl tracking-widest select-all">{resposta.codigo}</div>
      <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">
        <li>
          Na máquina da loja, baixe o agente para{' '}
          <a href="/downloads/etiquetas-agente.exe" download className="text-blue-700 underline">Windows</a> ou{' '}
          <a href="/downloads/etiquetas-agente-linux-amd64" download className="text-blue-700 underline">Linux</a> e abra um terminal como
          administrador na pasta do arquivo.
        </li>
        <li>
          Execute <code className="rounded bg-slate-100 px-1">etiquetas-agente instalar</code> e informe:
          <ul className="mt-1 list-disc pl-5">
            <li>
              Servidor: <code className="select-all">{servidor}</code>
            </li>
            <li>
              CNPJ: <code className="select-all">{formatarCnpj(resposta.cnpj)}</code>
            </li>
            <li>Código: o código acima</li>
          </ul>
        </li>
        <li>O agente fica instalado como serviço e aparece como Online nesta tela.</li>
      </ol>
      <div className="flex justify-end">
        <Botao onClick={aoFechar}>Concluir</Botao>
      </div>
    </div>
  );
}
