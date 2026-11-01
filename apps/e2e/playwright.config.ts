import { defineConfig } from '@playwright/test';

/**
 * Testes de ponta a ponta: API, site e Postgres de verdade, no navegador.
 *   E2E_DATABASE_URL=postgresql://... corepack pnpm --filter @etiquetas/e2e e2e
 * O banco precisa existir; a API aplica nele as migrações antes de subir. Use um banco só para isso.
 */
const banco = process.env.E2E_DATABASE_URL ?? 'postgresql://etiquetas:etiquetas@localhost:5432/etiquetas_e2e';
const ambienteApi = {
  ...(process.env as Record<string, string>),
  DATABASE_URL: banco,
  JWT_SECRET: 'segredo-so-para-testes-e2e-com-mais-de-32-caracteres',
  CHAVE_CRIPTOGRAFIA: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  SUPERADMIN_EMAIL: 'super@e2e.local',
  SUPERADMIN_SENHA: 'SenhaSuperE2E123',
  // Um proxy: cada teste informa um IP próprio e o limite de logins por minuto não interfere.
  PROXIES_CONFIAVEIS: '1',
  PORTA: '3000',
};

export default defineConfig({
  testDir: './testes',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'corepack pnpm --filter @etiquetas/shared build && corepack pnpm --filter @etiquetas/api exec prisma migrate deploy && corepack pnpm --filter @etiquetas/api build && node ../api/dist/main.js',
      url: 'http://localhost:3000/api/health',
      env: ambienteApi,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // O build de produção, com a CSP do nginx: um script barrado aparece como erro nos testes de tela.
      command: 'corepack pnpm --filter @etiquetas/web build && corepack pnpm --filter @etiquetas/web exec vite preview',
      url: 'http://localhost:5173',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
