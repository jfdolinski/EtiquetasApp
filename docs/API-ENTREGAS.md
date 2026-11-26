# API do Flow Entregas

Com esta API, o sistema da sua empresa (loja virtual, ERP, aplicativo próprio) faz quatro coisas no Flow Entregas:

- abre chamadas de entrega;
- consulta o valor antes de abrir;
- acompanha a situação de cada chamada;
- cancela uma chamada.

O Flow também avisa o seu sistema a cada mudança de situação, por um endereço que você informa (webhook).

## Chave

Crie a chave no Flow em **Entregas › Integração**. É preciso ter a permissão de configurar as entregas.

- A chave começa com `flw_`. Ela aparece uma vez só, quando é criada: guarde no seu sistema.
- Revogar a chave corta o acesso na hora.
- Cada empresa pode ter até 10 chaves ativas.

Mande a chave em toda requisição:

```
Authorization: Bearer flw_...
```

O endereço da API é o do seu Flow seguido de `/api/integracao/entregas/v1`, por exemplo `https://flow.suaempresa.com.br/api/integracao/entregas/v1`.

O limite é de 120 requisições por minuto. Os erros voltam com o código HTTP e `{"message": "..."}` em português.

## Abrir uma chamada

`POST /chamadas`

```json
{
  "referencia": "PED-1001",
  "tipo": "ENTREGA",
  "destino": {
    "endereco": "Rua das Flores, 120, Centro, Belo Horizonte",
    "lat": -19.9191,
    "lon": -43.9386,
    "contato": "Ana Souza",
    "telefone": "31988887777",
    "instrucoes": "Interfone 12"
  },
  "paradas": [],
  "observacao": "2 sacolas",
  "valorDeclaradoCentavos": 15000,
  "agendadaPara": null,
  "distribuir": true
}
```

| Campo | Obrigatório | Como funciona |
|---|---|---|
| `referencia` | não | O número do pedido no seu sistema. A mesma referência nunca abre duas chamadas: se ela já existe, a resposta traz a chamada existente com `"criada": false`. Pode repetir o pedido sem medo de duplicar. Até 60 letras. |
| `tipo` | não | `ENTREGA` (padrão), `COLETA` ou `DEVOLUCAO_MAQUINA`. |
| `origem` | não | Sem ela, a chamada sai do ponto de partida da empresa (Entregas › Configuração). |
| `destino` | sim | `endereco` com ao menos 5 letras. Sem `lat` e `lon`, o Flow procura o endereço no mapa. Se não achar, responde 400 e é preciso mandar as coordenadas. |
| `paradas` | não | Mais entregas depois do destino, na ordem em que vão ser feitas. Até 9, só no tipo `ENTREGA`. |
| `valorDeclaradoCentavos` | não | Quanto vale o que vai no pacote. Limita o desconto em caso de avaria. |
| `agendadaPara` | não | Data e hora da coleta (ISO 8601), de 15 minutos a 30 dias à frente. |
| `distribuir` | não | `true` oferece a chamada aos entregadores pelas regras do Direcionamento; `false` deixa a chamada esperando a empresa escolher. Sem o campo, vale a regra da empresa. |

O valor sai da tabela de preços da empresa, como nas chamadas abertas pelo site.

Resposta:

```json
{ "criada": true, "chamada": { ... } }
```

## Ver o valor antes

`POST /previa`, com o mesmo corpo de abrir a chamada. A resposta traz `valorCentavos`, `metros`, `segundos` e os adicionais. Nada é gravado.

## Consultar

- `GET /chamadas/{id}`
- `GET /chamadas?referencia=PED-1001`

A chamada:

```json
{
  "id": "…",
  "numero": 42,
  "referencia": "PED-1001",
  "tipo": "ENTREGA",
  "situacao": "COLETADA",
  "situacaoTexto": "A caminho",
  "valorCentavos": 1250,
  "paradaAtual": 0,
  "paradas": 1,
  "entregador": { "nome": "Carlos", "veiculo": "Moto", "placa": "ABC1D23" },
  "codigoConfirmacao": "4821",
  "rastreio": "https://flow.suaempresa.com.br/rastreio/…",
  "criadaEm": "2026-11-26T14:00:00.000Z",
  "coletadaEm": "2026-11-26T14:20:00.000Z",
  "concluidaEm": null
}
```

Os campos que pedem explicação:

- **`situacao`:** pode ser `ABERTA`, `ACEITA`, `NA_COLETA`, `COLETADA`, `NO_DESTINO`, `CONCLUIDA`, `OCORRENCIA` ou `CANCELADA`.
- **`situacaoTexto`:** a frase que o cliente vê no acompanhamento.
- **`entregador`:** aparece depois do aceite. Traz só o primeiro nome.
- **`codigoConfirmacao`:** o código que o cliente informa ao receber. Repasse ao cliente. Vem `null` quando a chamada termina, nas paradas seguintes, e quando a empresa usa só a assinatura.
- **`rastreio`:** a página de acompanhamento, para mandar ao cliente.

## Cancelar

`POST /chamadas/{id}/cancelar`

```json
{ "motivo": "Cliente desistiu" }
```

Vale a mesma regra do site: depois que um entregador aceitou, cobra a taxa de cancelamento da tabela.

## Avisos (webhook)

Informe o endereço que recebe os avisos ao criar a chave, ou depois, em **Entregas › Integração**. O endereço precisa:

- começar com `https://`;
- ser público na internet (rede interna é recusada);
- responder em até 10 segundos com um código 2xx.

A cada mudança de situação, ou de parada, de **qualquer** chamada da empresa, o Flow faz um `POST` com este corpo:

```json
{
  "evento": "chamada.situacao",
  "id": "id-único-do-aviso",
  "enviadoEm": "2026-11-26T14:20:03.000Z",
  "chamada": { ... }
}
```

A `chamada` tem o mesmo formato da consulta. Isso inclui as chamadas abertas pelo site: use a `referencia` para reconhecer as suas.

### Cabeçalhos

- `X-Flow-Evento`: `chamada.situacao` ou `teste`.
- `X-Flow-Id`: o mesmo `id` do corpo. Use para ignorar o mesmo aviso repetido.
- `X-Flow-Momento`: segundos desde 1970.
- `X-Flow-Assinatura`: `sha256=` seguido do HMAC-SHA256, em hexadecimal, de `{X-Flow-Momento}.{corpo}`. A chave do HMAC é o segredo `whsec_...`, que aparece ao criar a chave.

### Conferir a assinatura

Exemplo em Node:

```js
const { createHmac, timingSafeEqual } = require('node:crypto');

function avisoValido(corpoCru, cabecalhos, segredo) {
  const momento = cabecalhos['x-flow-momento'];
  if (Math.abs(Date.now() / 1000 - Number(momento)) > 300) return false; // aviso velho
  const esperado = 'sha256=' + createHmac('sha256', segredo).update(`${momento}.${corpoCru}`).digest('hex');
  const recebido = cabecalhos['x-flow-assinatura'] ?? '';
  return esperado.length === recebido.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}
```

Confira sobre o corpo exatamente como chegou, antes de converter o JSON.

### Tentativas

Quando o endereço não responde 2xx, o Flow tenta de novo depois de 1 minuto, 5 minutos, 30 minutos, 2 horas e 6 horas. São seis tentativas no total; depois disso, desiste daquele aviso.

Os avisos podem chegar fora de ordem. Na dúvida, consulte a chamada.

**Testar aviso**, em **Entregas › Integração**, manda um aviso de teste na hora. **Avisos enviados** mostra os últimos 50 de cada chave, com o resultado de cada um.
