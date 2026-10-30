import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { config } from './config';
import { criarValidationPipe } from './validacao';

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

  // Atrás do Traefik (Easypanel) e do nginx do web: o rate limit precisa do IP real do cliente.
  app.set('trust proxy', cfg.proxiesConfiaveis);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(criarValidationPipe());
  // Layouts grandes e lotes de até 500 etiquetas passam do limite padrão de 100 KB.
  app.useBodyParser('json', { limit: '20mb' });
  if (cfg.corsOrigem) app.enableCors({ origin: cfg.corsOrigem.split(',').map((o) => o.trim()) });
  app.enableShutdownHooks();

  await app.listen(cfg.porta, '0.0.0.0');
  new Logger('Iniciar').log(`API ouvindo na porta ${cfg.porta}`);
}

void iniciar();
