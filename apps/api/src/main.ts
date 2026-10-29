import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { config } from './config';

async function iniciar() {
  try {
    process.loadEnvFile();
  } catch {
    // Sem .env: as variáveis vêm do ambiente (ex.: Easypanel).
  }
  const cfg = config();

  // Importado depois de carregar o .env para que nenhum módulo leia variáveis antes da hora.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Atrás do proxy do Easypanel/nginx: necessário para o rate limit enxergar o IP real.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (cfg.corsOrigem) app.enableCors({ origin: cfg.corsOrigem.split(',').map((o) => o.trim()) });
  app.enableShutdownHooks();

  await app.listen(cfg.porta, '0.0.0.0');
  new Logger('Iniciar').log(`API ouvindo na porta ${cfg.porta}`);
}

void iniciar();
