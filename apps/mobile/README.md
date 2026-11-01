# Aplicativo de celular

React Native com Expo. Android (APK instalado à mão) hoje; o código serve para iPhone quando houver conta Apple Developer. Fica fora do workspace do pnpm: usa `npm`.

## Comandos

```bash
npm ci
npm test              # regras em src/regras.ts
npm run typecheck
npm run web           # telas no navegador, para desenvolver; sem câmera nem cofre do aparelho
npx expo export -p web   # build usado pelos testes de tela em apps/e2e (E2E_APP_URL)
```

## Como o APK nasce

O workflow **Aplicativo** (`.github/workflows/aplicativo.yml`) compila, instala num emulador Android, confere que abre e publica uma Release no GitHub. Não é preciso Android SDK na máquina.

Colocar uma Release no ar: grave a versão dela (ex.: `1.0.0-12`) em `release-publicada.txt`, faça commit e o deploy do serviço web. O nginx passa a servir `/downloads/etiquetas-app.apk` e `/downloads/app-versao.txt`.

Versão nova: suba `version` em `package.json`. O app compara com `app-versao.txt` e mostra o aviso para baixar. O `versionCode` vem do número da execução do workflow e sempre cresce.

## Segredos do GitHub (o repositório é público: nada disso vai para o código)

| Segredo | O que é | Sem ele |
|---|---|---|
| `APP_KEYSTORE_BASE64`, `APP_KEYSTORE_SENHA` | Chave do APK de produção. Gere com `node scripts/gerar-chave.mjs <pasta-fora-do-repositorio>` | APK de teste, assinado com a chave pública de depuração. Trocar para a de produção obriga a desinstalar e instalar de novo |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` do projeto Firebase, em base64 | Compila, mas os avisos só chegam com o app aberto |

A API precisa de `FCM_CONTA_SERVICO` (JSON da conta de serviço do mesmo projeto Firebase, em base64).

## Estrutura

- `src/regras.ts`: leitura do QR, versões, agrupamento. Sem React Native; testado com Node.
- `src/api.ts`: sessão no cofre do aparelho (`expo-secure-store`) e chamadas à API.
- `src/TelaVincular.tsx`, `TelaInicio.tsx`, `TelaLista.tsx`, `TelaAvisos.tsx`, `App.tsx`: telas.
- Tipos vêm de `packages/shared` por `import type`, que some na compilação.
