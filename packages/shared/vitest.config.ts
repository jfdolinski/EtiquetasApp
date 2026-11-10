import { defineConfig } from 'vitest/config';

// Sem procurar tsconfig.json: o teste das cópias do aplicativo lê apps/mobile/src/regras.ts, e o
// tsconfig de lá herda do Expo, que só existe com as dependências do app instaladas (não no CI).
export default defineConfig({ esbuild: { tsconfigRaw: '{"compilerOptions":{"target":"es2022"}}' } });
