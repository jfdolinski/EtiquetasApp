import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A pré-visualização do build (usada nos testes e2e) serve com a mesma CSP do nginx de produção.
const nginx = readFileSync(new URL('./nginx.conf.template', import.meta.url), 'utf8');
const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(nginx)?.[1] ?? '';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Usa o código-fonte do pacote compartilhado direto, sem precisar compilá-lo antes.
    alias: {
      '@etiquetas/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // ws: o agente local também pode apontar para o Vite em desenvolvimento.
    proxy: { '/api': { target: 'http://localhost:3000', ws: true } },
  },
  preview: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000' } },
    headers: { 'Content-Security-Policy': csp },
  },
});
