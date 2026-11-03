import { useState } from 'react';
import { rotuloDaColuna, TAMANHO_MAXIMO_ROTULO, type RotulosColunas } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Botao } from './ui';

export type RenomearColunas = ReturnType<typeof useRenomearColunas>;

interface Alteracao {
  atuais: RotulosColunas;
  novos: RotulosColunas;
}

/** O super-admin liga a opção, os títulos viram campos, salva e pronto. Vários modelos na tela, uma consulta por modelo. */
export function useRenomearColunas(aoSalvar: () => void) {
  const { usuario } = useAuth();
  const [ativo, setAtivo] = useState(false);
  const [alteracoes, setAlteracoes] = useState<Record<string, Alteracao>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAtivo(false);
    setAlteracoes({});
    setErro(null);
  }

  return {
    pode: Boolean(usuario?.superAdmin),
    ativo,
    salvando,
    erro,
    ativar: () => setAtivo(true),
    fechar,
    valor: (consultaId: string, atuais: RotulosColunas, coluna: string) => alteracoes[consultaId]?.novos[coluna] ?? rotuloDaColuna(atuais, coluna),
    mudar: (consultaId: string, atuais: RotulosColunas, coluna: string, texto: string) =>
      setAlteracoes((a) => ({ ...a, [consultaId]: { atuais, novos: { ...a[consultaId]?.novos, [coluna]: texto } } })),
    async salvar() {
      setSalvando(true);
      setErro(null);
      try {
        for (const [id, { atuais, novos }] of Object.entries(alteracoes)) {
          await api(`/consultas/${id}/rotulos`, { metodo: 'PUT', corpo: { rotulos: { ...atuais, ...novos } } });
        }
        fechar();
        aoSalvar();
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setSalvando(false);
      }
    },
  };
}

export function BotaoRenomearColunas({ renomear, disponivel = true }: { renomear: RenomearColunas; disponivel?: boolean }) {
  if (!renomear.pode || !disponivel) return null;
  if (!renomear.ativo) {
    return (
      <Botao variante="secundario" onClick={renomear.ativar} title="Muda o nome das colunas nesta consulta, nas telas e no aplicativo. Se a consulta mudar, voltam os nomes originais.">
        Renomear colunas
      </Botao>
    );
  }
  return (
    <>
      <Botao disabled={renomear.salvando} onClick={() => void renomear.salvar()}>
        Salvar nomes
      </Botao>
      <Botao variante="secundario" disabled={renomear.salvando} onClick={renomear.fechar}>
        Cancelar
      </Botao>
      {renomear.erro && <span role="alert" className="text-sm text-red-700">{renomear.erro}</span>}
    </>
  );
}

/** Título da coluna: o nome de sempre ou, com a opção ligada, um campo. Vazio volta ao nome original. */
export function NomeDaColuna({ renomear, consultaId, rotulos, coluna }: { renomear: RenomearColunas; consultaId: string | null; rotulos: RotulosColunas; coluna: string }) {
  if (!renomear.ativo || !consultaId) return <>{rotuloDaColuna(rotulos, coluna)}</>;
  return (
    <input
      value={renomear.valor(consultaId, rotulos, coluna)}
      onChange={(e) => renomear.mudar(consultaId, rotulos, coluna, e.target.value)}
      maxLength={TAMANHO_MAXIMO_ROTULO}
      placeholder={coluna}
      title={`Coluna da consulta: ${coluna}`}
      aria-label={`Nome da coluna ${coluna}`}
      className="w-32 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs font-normal text-slate-900"
    />
  );
}
