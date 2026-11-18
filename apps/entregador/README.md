# Flow Entregas (app do entregador)

React Native com Expo, Android. Fica fora do workspace do pnpm (usa `npm`), como o `apps/mobile`. Desenho do módulo: [docs/ENTREGAS.md](../../docs/ENTREGAS.md).

O entregador não é usuário de empresa: tem cadastro próprio (CPF, documentos), entra com e-mail ou CPF e senha e recebe um token `ent_...` que só serve nas rotas `/entregador/*`.

## Comandos

```bash
npm ci
npm test              # regras em src/regras.ts
npm run typecheck
npm run web           # telas no navegador; localização só com a aba aberta, sem câmera
npx expo export -p web   # build usado pelos testes de tela em apps/e2e (E2E_ENTREGADOR_URL)
```

## Como o APK nasce

O workflow **Aplicativo do entregador** (`.github/workflows/entregador.yml`) compila, instala num emulador, confere que abre e chega ao cadastro e publica uma Release `entregador-<versão>-<número>`.

Colocar no ar: grave a versão da Release (ex.: `1.0.0-3`) em `release-publicada.txt`, faça commit e o deploy do serviço web. O nginx passa a servir `/downloads/flow-entregas.apk` e `/downloads/entregador-versao.txt`; o app avisa quando há versão nova.

## Segredos do GitHub

| Segredo | O que é | Sem ele |
|---|---|---|
| `ENTREGADOR_SERVIDOR` | Endereço do site (https://…), gravado no APK | A tela de entrada pede o endereço ao entregador |
| `APP_KEYSTORE_BASE64`, `APP_KEYSTORE_SENHA` | A mesma chave do outro aplicativo | APK de teste, assinado com a chave de depuração |

Ainda sem Firebase: as chamadas (etapa 2) vão precisar dele para tocar com o celular bloqueado, e o `google-services.json` terá que incluir o pacote `br.com.etiquetas.entregador`.

## Localização

Online = `expo-location` com serviço em primeiro plano (notificação fixa "Você está online"), uma posição a cada 20 s, inclusive parado (`distanceInterval: 0`). A tarefa é registrada em `src/localizacao.ts`, importado primeiro no `index.ts`, porque o Android a acorda com o app fechado. O servidor recusa posição de GPS falso (`mocked`), desconta a diária do dia e desliga quem fica 10 min sem aviso. Offline, nada é enviado.

## Estrutura

- `src/regras.ts`: cópias de regras do shared; `packages/shared/src/entregas-app.test.ts` confere que continuam iguais.
- `src/api.ts`: sessão no cofre do aparelho e chamadas à API.
- `src/localizacao.ts`: permissões, tarefa em segundo plano e envio da posição.
- `src/TelaEntrar.tsx` (entrar e cadastro), `TelaDocumentos.tsx` (análise), `TelaInicio.tsx` (online), `TelaCreditos.tsx` (diárias e Pix), `TelaPerfil.tsx`, `App.tsx`.
