import { useQuery } from '@tanstack/react-query';
import { textoDuracao, type SaudeSistema } from '@etiquetas/shared';
import { api } from '../api';
import { Alerta, Cabecalho, Tabela, formatarData } from '../components/ui';

const tamanho = (bytes: number) => (bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1_048_576))} MB`);

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string | number; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}

/** Situação do servidor para o super-admin. Quando a API cai, quem avisa é o monitor do GitHub (docs/DEPLOY.md). */
export function Saude() {
  const { data: s, error, isLoading } = useQuery({ queryKey: ['saude'], queryFn: () => api<SaudeSistema>('/sistema/saude'), refetchInterval: 30_000 });

  return (
    <>
      <Cabecalho titulo="Saúde do sistema" descricao="Situação do servidor, do banco e dos erros inesperados." />
      {error && <Alerta>{error.message}</Alerta>}
      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}
      {s && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cartao rotulo="API no ar há" valor={textoDuracao(s.noArHaSegundos * 1000)} detalhe={`${s.memoriaMb} MB de memória`} />
            <Cartao rotulo="Erros nas últimas 24 h" valor={s.erros24h} />
            <Cartao rotulo="Fila de impressão" valor={s.filaImpressao} detalhe="trabalhos aguardando" />
            <Cartao rotulo="Agentes online" valor={`${s.agentes.online} de ${s.agentes.ativados}`} />
            <Cartao rotulo="Tamanho do banco" valor={tamanho(s.bancoBytes)} />
            <Cartao rotulo="E-mail" valor={s.emailConfigurado ? 'Configurado' : 'Não configurado'} detalhe="SMTP_HOST" />
            <Cartao rotulo="Avisos no celular" valor={s.pushConfigurado ? 'Configurado' : 'Não configurado'} detalhe="FCM_CONTA_SERVICO" />
            <Cartao
              rotulo="Última faxina"
              valor={s.ultimaFaxina ? formatarData(s.ultimaFaxina.em) : 'Ainda não rodou'}
              detalhe={s.ultimaFaxina ? (s.ultimaFaxina.erro ?? `${s.ultimaFaxina.conteudos} conteúdo(s), ${s.ultimaFaxina.auditoria} de auditoria, ${s.ultimaFaxina.listas} lista(s)`) : `Conteúdo fica ${s.retencao.conteudoDias} dias, auditoria ${s.retencao.auditoriaDias}`}
            />
          </div>

          <h2 className="font-medium">Erros recentes</h2>
          <Tabela colunas={['Quando', 'Rota', 'Mensagem']} vazio={s.erros.length === 0}>
            {s.erros.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatarData(e.criadoEm)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.metodo} {e.rota}</td>
                <td className="px-4 py-2.5">{e.mensagem}</td>
              </tr>
            ))}
          </Tabela>

          <h2 className="font-medium">Maiores tabelas</h2>
          <Tabela colunas={['Tabela', 'Tamanho']} vazio={s.tabelas.length === 0}>
            {s.tabelas.map((t) => (
              <tr key={t.nome}>
                <td className="px-4 py-2.5 font-mono text-xs">{t.nome}</td>
                <td className="px-4 py-2.5">{tamanho(t.bytes)}</td>
              </tr>
            ))}
          </Tabela>
        </div>
      )}
    </>
  );
}
