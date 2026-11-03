ALTER TABLE "consultas_sql" ADD COLUMN "rotulos_colunas" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "consultas_sql" ADD COLUMN "rotulos_hash" TEXT;
