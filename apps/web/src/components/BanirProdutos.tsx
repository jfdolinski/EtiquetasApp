import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { codigosValidosDoRegistro, descricaoDoRegistro, type BanirResposta, type Registro } from '@etiquetas/shared';
import { api } from '../api';
import { Alerta, Botao, Campo, Modal } from './ui';

/**
 * Confirma o banimento dos produtos selecionados numa lista. Quem chama decide o que sai da tela
 * em `aoBanir`, com os códigos banidos (já normalizados).
 */
export function BanirProdutos({
  registros,
  aoFechar,
  aoBanir,
}: {
  /** Registros selecionados; null = fechado. */
  registros: Registro[] | null;
  aoFechar: () => void;
  aoBanir: (codigos: string[], resposta: BanirResposta) => void;
}) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const produtos = (registros ?? []).map((r) => ({ descricao: descricaoDoRegistro(r), codigos: codigosValidosDoRegistro(r) }));
  const comCodigo = produtos.filter((p) => p.codigos.length > 0);
  const codigos = [...new Set(comCodigo.flatMap((p) => p.codigos))];
  const semCodigo = produtos.length - comCodigo.length;

  const banir = useMutation({
    mutationFn: () => api<BanirResposta>('/banidos', { metodo: 'POST', corpo: { codigos, motivo: motivo.trim() || undefined } }),
    onSuccess: (r) => {
      setMotivo('');
      void cliente.invalidateQueries({ queryKey: ['banidos'] });
      aoBanir(codigos, r);
    },
  });

  return (
    <Modal titulo={`Banir ${comCodigo.length} produto(s)`} aberto={registros !== null} aoFechar={aoFechar}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          As etiquetas destes produtos deixam de ser impressas em toda a empresa, até alguém liberar o código em Produtos banidos.
        </p>
        {comCodigo.length > 0 && (
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 text-sm">
            {comCodigo.map((p, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{p.descricao}</span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{p.codigos.join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
        {semCodigo > 0 && <Alerta tipo="aviso">{semCodigo} produto(s) sem código de barras válido ficam de fora.</Alerta>}
        {banir.error && <Alerta>{banir.error.message}</Alerta>}
        {comCodigo.length > 0 && <Campo rotulo="Motivo (opcional)" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />}
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao>
          <Botao variante="perigo" disabled={banir.isPending || codigos.length === 0} onClick={() => banir.mutate()}>
            {banir.isPending ? 'Banindo…' : `Banir ${comCodigo.length} produto(s)`}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
