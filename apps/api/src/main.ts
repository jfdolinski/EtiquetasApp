import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { config } from './config';
import { criarValidationPipe } from './validacao';

const LIMITE_SEM_LOGIN_BYTES = 1024 * 1024;

async function iniciar() {
  try {
    process.loadEnvFile();
  } catch {
    // Sem .env: as variáveis vêm do ambiente (ex.: Easypanel).
  }
  const cfg = config();

  // Importado depois de carregar o .env para que nenhum módulo leia variáveis antes da hora.
  const { AppModule } = await import('./app.module');
  // Os leitores de corpo são registrados abaixo, depois do limite das requisições sem login.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Atrás do Traefik (Easypanel) e do nginx do web: o rate limit precisa do IP real do cliente.
  app.set('trust proxy', cfg.proxiesConfiaveis);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(criarValidationPipe());
  // Sem login (loja, cadastros, entregador entrando), o corpo é pequeno: até 1 MB. Com login, até
  // 20 MB (layouts grandes, lotes de etiquetas, imagens). Sem Content-Length, vale o limite do leitor.
  app.use((req: { headers: Record<string, string | string[] | undefined> }, res: { status: (n: number) => { json: (b: unknown) => void } }, proximo: () => void) => {
    if (!req.headers.authorization && Number(req.headers['content-length'] ?? 0) > LIMITE_SEM_LOGIN_BYTES) return res.status(413).json({ statusCode: 413, message: 'Requisição grande demais.' });
    proximo();
  });
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  if (cfg.corsOrigem) app.enableCors({ origin: cfg.corsOrigem.split(',').map((o) => o.trim()) });
  app.enableShutdownHooks();

  await app.listen(cfg.porta, '0.0.0.0');
  new Logger('Iniciar').log(`API ouvindo na porta ${cfg.porta}`);
}

void iniciar();
