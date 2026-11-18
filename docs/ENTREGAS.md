# Módulo de Entregas

Aplicativo para entregadores no estilo dos aplicativos de corrida: o entregador fica **online**, recebe chamadas, **aceita** sabendo antes o caminho e o valor, cumpre as etapas e comprova o serviço. A empresa acompanha num painel com o mapa dos entregadores online, escolhe o entregador ou deixa o sistema escolher por regras que ela mesma configura.

Serviços: **coleta**, **entrega** e **devolução de máquina de recebimento** (maquininha), além das entregas dos Pedidos do Flow.

## Decisões

| Assunto | Decisão |
|---|---|
| Quem é o entregador | Cadastro **da plataforma** (sem `empresa_id`, como os banners e o índice de campos). Um entregador atende **várias empresas** |
| Quem paga o serviço | **A empresa**, fora do sistema. O Flow calcula, mostra e controla o que é devido e o que foi pago, nunca movimenta dinheiro |
| Mapas | **OpenStreetMap**, atrás de uma interface própria (`ProvedorMapas`) para trocar pelo Google sem mexer nas regras |
| Créditos | Comprados pelo entregador, **confirmados à mão** pelo super-admin (Pix com comprovante). Gateway automático fica para depois |
| Aplicativo | **APK separado** ("Flow Entregas"), mesma API e mesmo monorepo (`apps/entregador`, fora do workspace como o `apps/mobile`). Android apenas |

## Quem usa o quê

- **Entregador (app):** cadastro, documentos, créditos, ficar online, receber e aceitar chamadas, rota, comprovação, histórico e extrato.
- **Empresa (site, tela Entregas):** abrir chamadas, mapa dos entregadores, escolha manual ou automática, acompanhamento, preços, regras, fechamento dos valores.
- **Super-admin (site):** aprovar entregadores, pacotes e preço dos créditos, confirmar pagamentos de créditos, regras e preços padrão da plataforma.

## Cadastro do entregador

- Público no app: nome, CPF, celular, e-mail, senha, tipo de veículo (moto, carro, bicicleta, a pé), placa quando houver, chave Pix para receber das empresas.
- Documentos: selfie, CNH (quando motorizado), CRLV; aceite dos termos (uso de localização, LGPD, custódia de maquininhas).
- Nasce **pendente** e só recebe chamadas depois de aprovado pelo super-admin (mesmo modelo do "cadastro pendente" de usuários). Recusar guarda o motivo; o entregador corrige e reenvia para análise. (Apagar os documentos de recusados na faxina ainda não foi feito.)
- Login próprio (não é `Usuario`): token `ent_...` só em hash, como os celulares e as telas. Rota do entregador precisa de marca própria (`@PermitidoAoEntregador()`), nenhuma rota de empresa aceita esse token.
- Super-admin pode suspender (com motivo); a empresa pode **bloquear para si** um entregador, sem afetar as outras.
- CPF do entregador nunca é mostrado às empresas; elas veem primeiro nome, foto, veículo, placa e avaliação.

## Créditos (diárias)

- O crédito é uma **diária**. Pacotes definidos pelo super-admin (ex.: 1, 7, 30 diárias), cada um com preço e validade em dias.
- **Consumo:** a diária é descontada na **primeira vez que o entregador fica online no dia** (dia do calendário no fuso do sistema). Ficar online e offline várias vezes no mesmo dia não gasta outra. Quem não liga o app não gasta.
- Sem diária disponível, o botão "Ficar online" mostra "Compre créditos para ficar online".
- **Saldo = lotes, nunca um número editado à mão:** cada compra confirmada ou bônus vira um lote (`lotes_credito`: quantidade, restante, validade) e cada dia online é uma linha em `diarias_entregador` ligada ao lote de onde saiu. O extrato junta os dois. Consome primeiro o lote que vence antes; lote vencido só deixa de contar (sem lançamento de vencimento).
- **Compra com confirmação manual:** o entregador escolhe o pacote, o app mostra o Pix da plataforma (copia e cola e QR, configurados pelo super-admin) e ele envia o comprovante (imagem, tipo conferido pelos bytes). O pedido fica **aguardando**; o super-admin confere e **confirma** (gera o lançamento) ou **recusa** com motivo. Confirmação é auditada e só vale uma vez (reivindicação por `updateMany`).
- Opcional: diárias grátis no primeiro cadastro aprovado e bônus manual (com motivo).
- Chamada em andamento à meia-noite não é interrompida: a nova diária só é cobrada ao ficar online de novo.

## Online e localização

- Online = serviço em primeiro plano no Android com notificação fixa ("Você está online"). Posição a cada 20 s ou 50 m, o que vier primeiro; parado, a cada 60 s.
- A API grava a última posição do entregador (`posicao_em`) e o rastro só durante chamadas. **Sem posição há mais de 2 min**, o entregador não recebe ofertas e aparece como "sem sinal".
- **Offline automático:** sem aviso por 10 min, o sistema o coloca offline.
- **Privacidade:**
  - nada é coletado offline;
  - no mapa da empresa, os entregadores livres aparecem com posição **aproximada** (arredondada em ~200 m) e só os que estão dentro do raio de atendimento dela;
  - ocupado com chamada de outra empresa aparece como "ocupado", sem detalhes;
  - durante uma chamada, a empresa dona dela vê a posição exata;
  - rastros apagados em 30 dias (fica só o resumo: distância e tempos).
- **Anti-fraude:** posição de GPS falso (*mock location* do Android) é recusada e o entregador é avisado; chegada só pode ser marcada perto do ponto (cerca de `raioChegadaMetros`, padrão 150 m).

## Chamadas

Uma chamada tem empresa, tipo, uma ou mais paradas e o valor.

- **Tipos:** `COLETA` (buscar no cliente e levar à empresa), `ENTREGA` (da empresa ao cliente), `DEVOLUCAO_MAQUINA` (buscar a máquina no cliente e levar ao depósito da empresa). Cada tipo pode exigir habilitação do entregador (ex.: maquininha exige o termo de custódia).
- **Paradas:** origem e destino com endereço, ponto (latitude/longitude), contato, telefone e instruções. Endereço vira ponto pelo provedor de mapas, e a empresa pode ajustar o pino no mapa antes de abrir.
- **Origem nos Pedidos:** pedido com entrega que fica "Pronto" pode gerar a chamada com um clique (ou automaticamente, opção da empresa), com o endereço e a localização que o cliente informou.
- **Situações:** `ABERTA` → `OFERTADA` → `ACEITA` → `NA_COLETA` → `COLETADA` → `NO_DESTINO` → `CONCLUIDA`; ou `CANCELADA` (empresa, com motivo) e `OCORRENCIA`. Toda mudança grava sobre a versão lida (`updateMany` em `atualizado_em`) e entra no histórico.
- **Antes de aceitar, o entregador vê:** tipo, empresa, bairro e ponto da coleta e do destino no mapa, distância da rota até a coleta e da coleta ao destino, tempo estimado e o **valor fechado**. Endereço completo e telefone do cliente só aparecem depois do aceite.
- **Ocorrências:** cliente ausente, endereço não encontrado, recusa no recebimento, máquina com defeito ou faltando item. Exigem foto e observação. A empresa decide: nova tentativa, devolução à origem (gera trecho extra pela tabela) ou cancelamento.
- **Cancelamento pela empresa depois do aceite:** paga a taxa de deslocamento da tabela, se o entregador já tinha saído.
- **Desistência do entregador depois do aceite:** a chamada volta para a distribuição; conta na taxa de desistência (não bloqueia).

## Comprovação

- **Código de confirmação** de 4 dígitos que o destinatário recebe (link de acompanhamento ou WhatsApp pela empresa) e informa ao entregador. Alternativa configurável: assinatura na tela, ou foto.
- **Maquininha:**
  - leitura do **número de série** pela câmera (mesmo leitor de código do app atual), conferido contra o esperado quando a chamada informa;
  - foto da máquina e checklist (carregador, bobina, chip, estado);
  - na devolução, o número tem que bater com o registrado; divergência vira ocorrência.
- **Custódia:** o sistema sabe que máquinas estão com cada entregador agora (coletada e ainda não entregue). O painel mostra, e o entregador não fica offline com máquina em custódia sem aviso à empresa.

## Valores (tabela da empresa)

Cada empresa tem sua tabela por tipo de serviço; o super-admin define a tabela padrão e, opcionalmente, um valor mínimo por chamada da plataforma.

```
valor = base do tipo
      + km da rota × valor por km   (a partir de km_incluso)
      + paradas extras × valor por parada
      + adicional de horário (noturno, domingo, feriado), em % ou valor fixo
espera: a cada 10 min além da tolerância no ponto, valor por bloco (somado depois, com registro do tempo)
```

- Tudo em **centavos**, regras puras no shared (`shared/entregas.ts`), testadas.
- O valor mostrado na oferta é o valor do serviço. Só a espera e a devolução por ocorrência podem somar depois, e cada uma aparece separada no extrato.
- A distância é a **da rota** (provedor de mapas); se a rota falhar, usa a linha reta × 1,4 e marca como estimada.

## Direcionamento (regras parametrizáveis)

Configuração por empresa, partindo do padrão da plataforma (como `parametros_telas`: empresa nula = padrão; JSON parcial). Três etapas, nesta ordem.

### 1. Quem pode receber (filtros)

Fica fora quem não cumprir **todos**:

- aprovado, online, com diária do dia;
- posição com menos de 2 min;
- dentro do **raio máximo** até a coleta (padrão 8 km, pela linha reta, para não gastar rota com todos);
- habilitado para o tipo do serviço e com veículo aceito pela empresa para aquele tipo;
- abaixo do limite de chamadas simultâneas (padrão 1);
- não bloqueado pela empresa e sem recusa desta chamada;
- se a empresa usa **"só meus preferidos"**, estar na lista de preferidos dela.

### 2. Ordem de preferência (pontuação)

Cada critério vira uma nota de 0 a 1, multiplicada pelo peso (os pesos somam 100):

| Critério | Nota | Peso padrão |
|---|---|---|
| Proximidade | 1 − distância / raio máximo | 50 |
| Tempo sem chamada | min(minutos livre / 60, 1) | 25 |
| Taxa de aceite (30 dias) | aceitas / ofertadas (sem histórico = 0,8) | 10 |
| Avaliação | (média − 1) / 4 (sem avaliação = 0,8) | 10 |
| Preferido da empresa | 1 se preferido, senão 0 | 5 |

Empate: quem está livre há mais tempo. A empresa pode marcar "preferidos sempre primeiro" (preferidos ordenados entre si pelos mesmos pesos, depois os demais).

### 3. Como oferecer

- **Em sequência** (padrão): o primeiro tem `segundosParaAceitar` (padrão 30) para aceitar; recusou ou não respondeu, vai ao próximo. Até `maxTentativas` (padrão 5).
- **Em grupo:** vai para os `tamanhoGrupo` melhores ao mesmo tempo; fica com quem aceitar primeiro (reivindicação por `updateMany`, os outros veem "já foi aceita").
- Esgotadas as tentativas ou sem ninguém elegível: a chamada fica `ABERTA` com aviso, a empresa recebe o evento `entrega_sem_entregador` das Notificações e o sistema tenta de novo a cada `minutosNovaTentativa` (padrão 2), com o raio aumentado em `ampliarRaioKm` até o `raioLimiteKm`.

### Escolha manual

No painel, a empresa escolhe um entregador no mapa ou na lista dos elegíveis e a oferta vai só para ele, com o mesmo prazo. **O entregador sempre precisa aceitar.** Recusou ou expirou: a empresa escolhe outro ou manda para a distribuição automática.

### Regras claras

- Cada oferta guarda **por que** aquele entregador foi escolhido: posição na lista, distância, notas e pesos ("João: 1,2 km, 40 min livre, nota 4,8 → 1º de 5"). A empresa vê na chamada; o entregador vê o resumo das suas ofertas.
- **Simulador** na configuração: com os pesos que a empresa está editando, mostra quem seria escolhido agora para um ponto do mapa, antes de salvar.
- Recusa e ofertas expiradas **só reduzem a taxa de aceite** (e com ela a prioridade); nada bloqueia o entregador automaticamente. Decisão para não caracterizar subordinação.

## Painel da empresa

- **Mapa** (Leaflet + OpenStreetMap): entregadores online no raio de atendimento, chamadas abertas e em andamento com a rota, depósito/endereços da empresa.
- Lista de chamadas por situação, com busca; abrir chamada (formulário ou a partir de um pedido).
- Detalhe: linha do tempo, rastro, fotos, código conferido, ocorrências, motivo da escolha.
- **Preferidos e bloqueados** da empresa.
- **Fechamento:** por entregador e período, total de serviços, esperas e extras; a empresa marca como **pago** (data, observação, comprovante opcional). O entregador vê e pode **contestar** uma linha com mensagem; a empresa responde.
- **Avaliação** do entregador ao concluir (1 a 5, comentário opcional, só a empresa vê o comentário).
- Eventos das Notificações: `entrega_sem_entregador`, `entrega_ocorrencia`, `entrega_atrasada` (passou do tempo estimado + tolerância).

## Aplicativo do entregador

- Início: botão grande **Ficar online / offline**, saldo de diárias, ganhos de hoje e da semana.
- **Oferta:** tela cheia com toque alto, mesmo com o celular bloqueado (push FCM de alta prioridade + notificação de tela cheia), contagem regressiva, mapa, valor, Aceitar/Recusar.
- Chamada em andamento: etapas com botões grandes, navegação abrindo o app de mapas do celular (Google Maps, Waze) pelo ponto, ligar/WhatsApp para o contato, leitor de série, fotos, código, ocorrência, botão de **emergência** (avisa a empresa com a posição).
- **Histórico e extrato:** por dia/semana/mês e por empresa, a receber, pago, contestado; comprovante em PDF.
- Créditos: pacotes, compra com comprovante, situação do pedido, extrato de diárias.
- Perfil: documentos, veículo, chave Pix, avaliação média, taxa de aceite.
- Guia de bateria: orienta a liberar o app da economia de energia (Xiaomi, Samsung, Motorola matam serviços em segundo plano).
- Sem internet: guarda os eventos da chamada (etapas, fotos, posições) e envia ao voltar; não recebe ofertas offline.

## Link de acompanhamento (destinatário)

Página pública com código aleatório (como `/loja/pedido/<codigo>`): situação, entregador (primeiro nome, foto, veículo, placa), posição durante o trecho até o destino, previsão e o código de confirmação. Some depois de concluída. Nos Pedidos, aparece dentro do acompanhamento do pedido.

## Mapas (`ProvedorMapas`)

Interface única na API com três funções: `geocodificar(endereco)`, `rota(pontos)` (distância e tempo, linha da rota) e a configuração do mapa do navegador (URL dos blocos e atribuição). Começa com OpenStreetMap; trocar pelo Google é uma implementação nova e uma variável de ambiente.

- **Endereço → ponto:** Nominatim. O servidor público tem limite de 1 requisição/s e proíbe uso pesado: usar com cache permanente por endereço normalizado e, crescendo, subir um Nominatim próprio. O cliente pode ajustar o pino.
- **Rotas:** OSRM **próprio** (o servidor de demonstração não pode ser usado em produção), com o recorte do mapa da região atendida para caber na VPS. Alternativa: OpenRouteService com chave.
- **Mapa na tela:** Leaflet com blocos do OpenStreetMap e atribuição visível; se o volume crescer, provedor de blocos (MapTiler, Stadia) ou servidor próprio. Liberar os domínios na CSP.
- Navegação turn-by-turn não é feita pelo Flow: o app abre o aplicativo de mapas do celular.

## Dados (rascunho)

Plataforma (sem `empresa_id`): `entregadores`, `documentos_entregador`, `sessoes_entregador`, `pacotes_credito`, `pedidos_credito`, `lotes_credito`, `diarias_entregador` (uma por entregador e dia, chave única), `parametros_entregas` (Pix da plataforma e diárias grátis), `cache_geocodificacao`.

Por empresa: `configuracoes_entregas` (tabela de preços, regras de direcionamento, raio de atendimento, endereços da empresa), `chamadas_entrega` (com `pedido_id` opcional), `paradas_chamada`, `ofertas_chamada` (entregador, ordem, notas, motivo, resultado, prazo), `eventos_chamada` (histórico, fotos, código, série), `rastros_chamada`, `entregadores_empresa` (preferido/bloqueado), `avaliacoes_entregador`, `fechamentos_entregas` e `contestacoes`.

Relógio em processo a cada 5 s (como os agendamentos): ofertas vencidas, próxima tentativa, offline automático, atraso. Uma réplica da API, como hoje.

## Permissões

`entrega.ver` (painel e mapa), `entrega.gerenciar` (abrir, escolher entregador, cancelar, ocorrências, avaliar), `entrega.configurar` (preços, regras, preferidos e bloqueados), `entrega.financeiro` (fechamento e pagamentos). Aprovação de entregadores e créditos: só super-admin.

## Riscos e cuidados

- **Push real (Firebase) é obrigatório** e nunca foi testado em produção: testar em celular físico antes de tudo, inclusive com tela bloqueada e economia de bateria.
- **Vínculo trabalhista:** nada de punição automática por recusa, escala obrigatória ou ordens fora da chamada; os termos dizem que o entregador é autônomo. Validar com advogado o modelo de créditos.
- **Custos e limites do OpenStreetMap:** servidores públicos não aguentam produção; OSRM próprio precisa de memória na VPS (recorte regional).
- **LGPD:** localização é dado pessoal; coletar só online, mostrar aproximada, apagar rastros, termo no cadastro.
- **Celulares baratos** matam o serviço em segundo plano: guia de configuração e aviso quando o sistema detectar o entregador sem sinal.
- **iPhone** fica fora, como no app atual.

## Etapas

1. **Base do entregador (feita):** cadastro, documentos, aprovação, login `ent_`, pacotes e compra de créditos com confirmação manual, consumo da diária, online/offline com localização, mapa no painel da empresa, `ProvedorMapas` com OpenStreetMap. Ficou para depois: senha esquecida no app, faxina dos documentos de recusados, Firebase no app do entregador. Nunca testado em celular físico nem com o Nominatim público de verdade (os testes trocam os blocos do mapa e não buscam endereço).
2. **Chamadas (feita em parte):** tabela de preços por tipo (base, por km, km inclusos) e prazo para aceitar (padrão 45 s), abertura de chamada (uma coleta e um destino, ponto pelo endereço ou clique no mapa), rota e valor (OSRM se `OSRM_URL` existir, senão linha reta × 1,4 marcada como estimada), oferta **manual** com aceite, etapas (chegada conferida pela cerca de 150 m, série da máquina, código de 4 dígitos com 5 tentativas, a empresa pode confirmar sem o código), ocorrência com foto (a empresa segue, libera ou cancela), ganhos no app. **Sem Firebase:** a resposta de cada posição (20 s, também com a tela apagada) traz a oferta e o app toca uma notificação local; com o app aberto, consulta a cada 5 s. Ficou para depois: link de acompanhamento do destinatário, tela de custódia das máquinas, foto obrigatória na coleta/entrega, várias paradas, cancelamento com taxa de deslocamento, desistência do entregador.
3. **Direcionamento automático (feita):** regras por empresa (aba Direcionamento: raio inicial, limite e quanto cresce por rodada, veículos aceitos por tipo, pesos, preferidos primeiro, só preferidos, sequência ou grupo, ofertas por rodada, intervalo), simulador com as regras da tela, distribuição ao abrir (regra ou caixa na chamada) ou pelo botão, rodadas com raio maior, motivo de cada oferta para a empresa e resumo para o entregador, preferidos e bloqueados (aba Entregadores), aviso `entrega_sem_entregador`. Diferenças do desenho: o padrão das regras é do código (sem padrão da plataforma editável pelo super-admin), o limite de chamadas simultâneas segue fixo em 1, a avaliação vale 0,8 para todos até a etapa 4 e quem recusou ou deixou expirar não recebe de novo a mesma chamada, nem em rodada nova.
4. **Fechamento e integração:** histórico e extrato do entregador, fechamento e contestação, avaliações, chamada a partir do Pedido, notificações.
5. **Depois:** gateway Pix para os créditos, várias paradas na mesma chamada, adicional por região e horário de pico, mapa de calor da demanda, troca para Google se compensar.
