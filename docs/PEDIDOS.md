# Módulo de Pedidos

O cliente final de uma empresa abre um link público, monta um carrinho com os produtos do ERP (via consulta SQL) e envia o pedido. A loja acompanha num painel, pode propor alterações (que o cliente confirma) e imprime uma folha de lançamento com códigos de barras para passar no ERP.

Tudo é por empresa (`empresa_id`): configuração, catálogo, pedidos, numeração e links.

## Link do catálogo

- Um link fixo por empresa, com código aleatório (`/loja/<codigo>`), nunca o CNPJ nem o id. Igual para todos os clientes.
- A empresa liga/desliga o catálogo e pode gerar um link novo (o antigo deixa de valer).
- Público, sem login. A página nunca fala com o banco do cliente: mostra uma **cópia** dos produtos, atualizada de tempos em tempos pela consulta (como os conteúdos das telas). Cópia vencida tira o catálogo do ar, para não mostrar preço velho.

## Produtos

- Consulta SQL da empresa (sem `{param.*}`), com colunas escolhidas: código, nome, preço (obrigatórias); preço anterior, unidade, categoria, estoque, código de barras para foto (opcionais).
- Fora: banidos, sem preço ou preço zerado/inválido. Com coluna de estoque: só estoque > 0, e a quantidade fica limitada ao estoque.
- Quantidade só inteira (≥ 1).
- Fotos do catálogo pelo código de barras (como nas telas), opcional.
- Celular primeiro: busca por nome ou código, categorias em abas (se houver coluna), cartões com foto, preço, preço anterior, unidade; botão Adicionar → – 1 +; barra fixa do carrinho; carrinho guardado no navegador.

## Finalização

- Dados: nome, telefone/WhatsApp (celular brasileiro), endereço obrigatório (CEP com busca no ViaCEP, depois BrasilAPI, pela API; número, complemento opcional, "sem número"), observação opcional. Em "Retirar no local" o endereço não é pedido.
- Aviso curto de uso dos dados (LGPD). A faxina apaga telefone e endereço de pedidos concluídos/cancelados depois de um prazo (sugestão: 180 dias).
- Limite de pedidos por endereço de acesso.
- O servidor confere tudo de novo: preço, estoque, mínimo, horário, modalidade. Se preço ou estoque mudaram, não grava: mostra o que mudou e o cliente confirma de novo. O cliente nunca define preço.

## Pedido mínimo

Opcional por empresa. Abaixo dele, o botão de enviar fica bloqueado com "Faltam R$ X".

## Modalidades de entrega

Cada uma ligada ou não pela empresa, com preço próprio:

- **Entrega**
- **Entrega agendada**: o cliente escolhe dia e faixa de horário, dentro do horário de funcionamento.
- **Entrega expressa**: só com a loja aberta.
- **Retirar no local**: sem endereço do cliente; mostra o endereço da loja.

## Horário de funcionamento

Na configuração da empresa (a própria empresa altera, com `pedido.configurar`): por dia da semana, até dois períodos, no fuso do sistema. Fora do horário o catálogo fica só para olhar ("Fechado agora, abrimos às 8h"), mas entrega agendada continua aceita. O servidor confere ao gravar.

## Pagamento

Só informativo: Pix, cartão na entrega, dinheiro. Em dinheiro, "troco para quanto?" (≥ total) e o sistema calcula o troco. Alteração que muda o total recalcula o troco e avisa se o valor não cobre mais.

## Acompanhamento e alterações

- Depois de enviar: número do pedido e link de acompanhamento (código aleatório próprio do pedido).
- Situações: Novo → Em separação → Pronto/Saiu para entrega → Concluído; Cancelado.
- O atendente pode mudar modalidade, taxa, quantidades, tirar item, dar desconto. Isso vira **proposta**: o pedido fica "Aguardando confirmação do cliente"; o cliente vê antes → depois e aceita ou recusa no link. Recusa volta ao que era. Proposta reenviada invalida a resposta antiga (versão).
- Painel: botão "Conversar no WhatsApp" (`wa.me` com mensagem pronta, inclusive "seu pedido mudou, confirme aqui").
- Evento "pedido novo" nas Notificações (sino, celular, e-mail).

## Folha de lançamento (impressão)

Depois do pedido aceito, impressa numa impressora térmica de cupom (ESC/POS, 80 mm) pelo agente, na fila de impressão de sempre. A empresa escolhe a impressora. Prévia na tela.

Ordem, com títulos separando as partes:

1. **Código do atendente** (Code 128): o "Código no ERP" do usuário que aceitou (campo novo em Usuários; sem ele, a impressão avisa e não sai).
2. **Telefone do cliente** (Code 128, só dígitos com DDD).
3. **Agora passe os produtos**: um código de barras **por unidade** (3 unidades = 3 códigos), EAN-13/EAN-8 quando o código é EAN válido, senão Code 128. Abaixo de cada código, **uma linha**: `[ ] Nome…   R$ preço unitário   1/3` (nome cortado com reticências; preço é o do pedido, já com desconto aceito).

Cabeçalho só em texto (número, data, cliente, modalidade, pagamento e troco); rodapé com total de unidades, produtos, entrega e total. Códigos pelo comando nativo de código de barras da impressora (não imagem). ESC/POS ainda não testado em impressora física: conferir a primeira impressão real, inclusive a leitura no papel térmico.

## Venda pelo vendedor (aplicativo)

O vendedor logado no aplicativo lança o pedido do cliente: "Nova venda" na guia Pedidos. Usa a **mesma configuração** do link (produtos, preços, estoque com reservas, entregas e taxas, folha); só o que é do vendedor fica na seção "Vendas no app" da Configuração:

- ligar ou desligar;
- vender com a loja fechada (todas as formas de entrega ligadas);
- exigir ou não o pedido mínimo;
- desconto máximo do vendedor, em % dos produtos (0 = nenhum, até 50%).

Fluxo no celular: busca por nome ou código, ou leitura do código de barras pela câmera; carrinho com quantidade e observação por produto; dados do cliente (nome, celular, entrega com CEP pela API, faixa da agendada, pagamento e troco, desconto, observação); lançar. O servidor confere tudo de novo, como no link (preço ou estoque mudou: volta com os itens para confirmar). O pedido **nasce aceito pelo vendedor** (Em separação): a folha de lançamento sai com o código dele no ERP. Depois de lançar, o vendedor manda o link do acompanhamento pelo WhatsApp (o cliente acompanha, aceita alterações e confirma o recebimento como no link) e, com `pedido.gerenciar`, imprime a folha. O carrinho em andamento fica guardado no aparelho. Limite de 60 vendas por hora por vendedor. Sem internet não vende.

Painel e aplicativo marcam "Venda de Fulano", e a busca do painel acha pelo nome do vendedor. Quem tem só `pedido.vender` vê no aplicativo apenas as próprias vendas.

## Permissões

`pedido.ver`, `pedido.gerenciar` (situação, propostas, cancelar, imprimir), `pedido.vender` (lançar vendas pelo aplicativo), `pedido.configurar` (link, consulta, colunas, mínimo, modalidades, horários, impressora).

## Etapas

1. **Base**: regras puras no shared; tabelas; cópia do catálogo pela consulta; tela Configurar pedidos (link, liga/desliga, consulta e colunas, mínimo, modalidades e preços, horários, mensagem de boas-vindas).
2. **Página do cliente**: catálogo público, carrinho, finalização com CEP e limite, acompanhamento com aceitar/recusar.
3. **Painel de pedidos**: lista, detalhe, situações, propostas, WhatsApp, folha de lançamento, "Código no ERP" em Usuários, notificação de pedido novo, faxina dos dados pessoais.
4. **Aplicativo** (depois): painel no celular, push.
