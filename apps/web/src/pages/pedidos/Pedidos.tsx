import { useState } from 'react';
import { useAuth } from '../../auth';
import { Cabecalho } from '../../components/ui';
import { ConfigurarPedidos } from './ConfigurarPedidos';
import { PainelPedidos } from './PainelPedidos';

type Aba = 'pedidos' | 'configuracao';

/** Pedidos feitos pelo link da empresa: o painel do dia a dia e a configuração do catálogo. */
export function Pedidos() {
  const { pode } = useAuth();
  const abas: { id: Aba; rotulo: string }[] = [
    ...(pode('pedido.ver') ? [{ id: 'pedidos' as const, rotulo: 'Pedidos' }] : []),
    ...(pode('pedido.configurar') ? [{ id: 'configuracao' as const, rotulo: 'Configuração' }] : []),
  ];
  const [aba, setAba] = useState<Aba>(abas[0]?.id ?? 'pedidos');
  return (
    <div>
      <Cabecalho titulo="Pedidos" descricao="Seus clientes montam o pedido pelo link da empresa, com os produtos e preços do seu sistema." />
      {abas.length > 1 && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
          {abas.map(({ id, rotulo }) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {rotulo}
            </button>
          ))}
        </div>
      )}
      {aba === 'pedidos' && <PainelPedidos />}
      {aba === 'configuracao' && <ConfigurarPedidos />}
    </div>
  );
}
