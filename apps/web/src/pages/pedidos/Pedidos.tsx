import { Cabecalho } from '../../components/ui';
import { ConfigurarPedidos } from './ConfigurarPedidos';

/** Pedidos feitos pelo link da empresa. O painel de pedidos entra aqui como mais uma aba. */
export function Pedidos() {
  return (
    <div>
      <Cabecalho titulo="Pedidos" descricao="Seus clientes montam o pedido pelo link da empresa, com os produtos e preços do seu sistema." />
      <ConfigurarPedidos />
    </div>
  );
}
