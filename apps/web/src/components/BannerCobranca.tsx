import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AvisoCobrancaResumo } from '@etiquetas/shared';
import { api } from '../api';
import { useAuth } from '../auth';

const CHAVE_FECHADOS = 'etiquetas.avisosFechados';

function fechados(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE_FECHADOS) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * Aviso de cobrança vigente. Fechar esconde só este aviso nesta sessão: o próximo,
 * emitido na frequência configurada, aparece de novo.
 */
export function BannerCobranca() {
  const { usuario, empresaId, aviso: avisoLogin } = useAuth();
  const [ocultos, setOcultos] = useState(fechados);
  const operaEmpresa = !usuario?.superAdmin || Boolean(empresaId);
  const { data } = useQuery({
    queryKey: ['aviso-cobranca', empresaId],
    queryFn: () => api<{ aviso: AvisoCobrancaResumo | null }>('/assinatura/aviso'),
    enabled: operaEmpresa,
    refetchInterval: 10 * 60_000,
  });
  // Antes da primeira resposta, mostra o aviso que veio no login.
  const aviso = data ? data.aviso : avisoLogin && !usuario?.superAdmin ? { id: 'login', tipo: 'CARENCIA' as const, mensagem: avisoLogin, criadoEm: '' } : null;
  if (!aviso || ocultos.includes(aviso.id)) return null;

  const forte = aviso.tipo === 'PRE_BLOQUEIO' || aviso.tipo === 'CARENCIA';
  return (
    <div
      role="status"
      className={`mb-4 flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
        forte ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'
      }`}
    >
      <span>{aviso.mensagem}</span>
      <button
        type="button"
        aria-label="Fechar aviso"
        className="shrink-0 rounded px-1 opacity-70 hover:opacity-100"
        onClick={() => {
          const novos = [...ocultos, aviso.id].slice(-20);
          setOcultos(novos);
          try {
            sessionStorage.setItem(CHAVE_FECHADOS, JSON.stringify(novos));
          } catch {
            // Sem armazenamento: o aviso volta ao recarregar.
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}
