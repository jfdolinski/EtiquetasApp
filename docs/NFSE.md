# NFS-e (nota fiscal de serviço eletrônica)

O Flow emite NFS-e pelo **padrão nacional**: API da Sefin Nacional, com certificado digital A1 na conexão (mTLS) e a DPS assinada. Não há provedor intermediário.

## Escopo (combinado em 26/11/2026)

| Pergunta | Decisão |
|---|---|
| Quem emite | **As duas coisas.** A plataforma emite a nota da mensalidade de cada empresa, com o emissor sem `empresa_id`. Cada empresa emite as próprias: pedido concluído e nota avulsa. |
| Por onde | **Emissor Nacional direto** (Sefin Nacional). Produção Restrita para testes; nos testes automáticos, um simulador. |
| Quando | **Automática, que pode ser ligada ou desligada, mais botão.** A mensalidade sai ao registrar o pagamento em Cobrança. O pedido sai ao ser concluído. Se der erro, aparece "Emitir de novo". |
| Cancelamento | Por botão, com motivo (1 erro na emissão, 2 serviço não prestado, 9 outros) e texto de 15 a 255 letras. Estornar o pagamento só avisa que a nota continua valendo. |
| PDF | O DANFSe é **gerado pelo Flow**. A API do DANFSe do ADN foi desligada em produção em 03/08/2026, e a NT 008 passou a geração do PDF aos sistemas emissores. |
| Tomador do pedido | O cliente do pedido. O CPF ou CNPJ é opcional e só é pedido na loja quando a empresa tem a emissão automática ligada. Sem documento, o tomador fica "não identificado". |
| Certificado | O `.pfx` e a senha são enviados na tela e cifrados com `cifrar`. Nunca voltam ao navegador; a tela mostra só o titular, o CNPJ e a validade. |
| Regime | MEI, Simples Nacional (ME/EPP) e fora do Simples, configuráveis. O IBS/CBS fica de fora: o grupo é opcional no XSD e a ausência não gera rejeição até 31/12/2026. |

## Como funciona

- **Regras puras** em `packages/shared/src/nfse.ts`:
  - validação do emissor, do serviço e do tomador;
  - `idDps` e `montarDps`, que gera o XML já na forma canônica e na ordem do XSD;
  - `montarPedidoCancelamento` (evento e101101, sem `nPedRegEvento`);
  - textos e motivos.
- **Leiautes.** Os dois usam `versao="1.01"`:
  - `PRODUCAO_2026` vale em produção;
  - `NT_009` vale na Produção Restrita desde 20/10/2026. Nele, `finNFSe` e `indDest` sobem para `infDPS`.
  - Quando a NT 009 chegar à produção, ponha `NFSE_LEIAUTE_PRODUCAO=NT_009` no Easypanel.
- **Alíquota e tributos aproximados.**
  - `pAliq` só vai na DPS do Simples com ISS retido (mínimo de 1,8%). Nos outros casos a Sefin recusa e usa a alíquota cadastrada pelo município.
  - O total aproximado dos tributos depende do regime: `indTotTrib` no MEI, `pTotTribSN` no Simples e `pTotTrib` fora dele.
- **API** em `apps/api/src/nfse`:
  - `certificado.ts`: abre o `.pfx` com node-forge e assina com RSA-SHA256 + exc-c14n + enveloped, com o X509 no `KeyInfo`.
  - `sefin.ts`: cliente HTTPS com o `pfx` na conexão; manda gzip+base64 e entende os erros em `erros` ou `erro`.
  - `nfse.service.ts`: a fila e as regras.
  - `danfse.ts`: o PDF, com QR Code da consulta pública e a marca d'água "SEM VALIDADE JURÍDICA" na Produção Restrita.
  - `simulador-sefin.ts`: o simulador.
- **Fila** em `notas_fiscais`:
  - A nota nasce PENDENTE, com o número da DPS reservado no `UPDATE ... RETURNING` da linha do emissor.
  - O relógio de 10 s reivindica (PENDENTE → PROCESSANDO por `updateMany`) e envia.
  - Fora do ar (rede, 5xx, 429): a **mesma DPS** é reenviada depois de 30 s, 2 min, 10 min, 30 min, 2 h e 6 h; esgotadas as tentativas, vira ERRO.
  - DPS repetida (E0014) é recuperada por `GET /dps/{id}` e `GET /nfse/{chave}`.
  - Nota presa em PROCESSANDO por 5 min volta à fila.
  - Recusa de regra vira ERRO com a mensagem da Sefin. "Emitir de novo" usa os dados fiscais de agora, com o mesmo número (nenhuma nota nasceu com ele).
- **Automático.** Ligar marca `automatico_desde`, e o relógio só pega pagamento ou pedido concluído depois dessa hora. Assim nenhum lugar que conclui pedido ou registra pagamento precisa avisar.
- **Numeração.** `proximo_numero` não pode voltar para um número já usado na série e no ambiente. Ao trocar de ambiente, confira o número.
- **Telas:**
  - Notas fiscais da empresa (`/notas-fiscais`): Emitidas, Recebidas do Flow e Configuração.
  - Notas fiscais da plataforma (`/plataforma/notas-fiscais`, super-admin).
  - Coluna "Nota fiscal" nos pagamentos de Cobrança.
  - Bloco "Nota fiscal de serviço" no pedido concluído.
- **Permissões:** `nfse.ver`, `nfse.emitir` e `nfse.configurar`.

## Ambiente

| Variável | Uso |
|---|---|
| `NFSE_LEIAUTE_PRODUCAO` | `NT_009` quando a NT 009 entrar em produção. Sem ela, vale o leiaute atual. |
| `NFSE_SEFIN_URL` | **Só nos testes**: troca o endereço da Sefin dos dois ambientes (simulador). |
| `NFSE_TESTE_SEM_VERIFICAR_SERVIDOR` | **Só nos testes**: aceita o certificado do simulador. |

Endereços oficiais:
- Produção Restrita: `https://sefin.producaorestrita.nfse.gov.br/SefinNacional`
- Produção: `https://sefin.nfse.gov.br/SefinNacional`

## Testado

- **Assinatura:** conferida pelo `xml-crypto`, uma biblioteca independente. A DPS e o cancelamento são validados, e o conteúdo adulterado é recusado.
- **Cliente HTTPS:** testado contra o simulador com mTLS. Casos cobertos:
  - emitir;
  - DPS repetida e recuperação;
  - fora do ar;
  - certificado de outro CNPJ;
  - ambiente errado;
  - cancelar e cancelar de novo.
- **e2e** (`apps/e2e/testes/nfse.spec.ts`):
  - mensalidade ao registrar o pagamento;
  - nota recebida pela empresa;
  - PDF e XML;
  - isolamento entre empresas;
  - cancelamento;
  - fila fora do ar;
  - resposta perdida;
  - recusa e "Emitir de novo";
  - nota do pedido com CPF;
  - permissões;
  - a tela inteira: configurar, enviar o certificado, emitir avulsa, baixar o PDF e cancelar.

## Não testado / pendente

- **Nada foi enviado à Produção Restrita de verdade.** Para isso é preciso um certificado A1 real de um CNPJ com município conveniado. O usuário compra o certificado e envia pela tela.
- **Pontos que só o teste real confirma:**
  - o leiaute NT 009 completo (só `finNFSe` e `indDest` foram acrescentados);
  - o código exato de cancelamento repetido;
  - se a resposta do E0014 traz a chave;
  - a faixa de série 1–49999 para aplicativo próprio.
- **O DANFSe segue os blocos do leiaute nacional v2.0, mas não reproduz a arte oficial.** O endereço do QR Code (`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=`) não foi confirmado em documento oficial.
- **Fora do escopo:**
  - IBS/CBS;
  - substituição de nota (`<subst>`);
  - cancelamento fora do prazo (evento 101103);
  - tomador estrangeiro e endereço do tomador;
  - venda pelo app com CPF;
  - aviso nas Notificações de nota com erro ou de certificado vencendo (hoje só aparece na tela).
