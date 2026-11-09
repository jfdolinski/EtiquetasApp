ALTER TYPE "OrigemTrabalho" ADD VALUE 'PEDIDO';

ALTER TABLE "usuarios" ADD COLUMN "codigo_erp" TEXT;

ALTER TABLE "pedidos" ADD COLUMN "desconto_centavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aceito_por_id" UUID,
ADD COLUMN "aceito_em" TIMESTAMP(3),
ADD COLUMN "proposta" JSONB,
ADD COLUMN "proposta_em" TIMESTAMP(3),
ADD COLUMN "resposta_proposta" JSONB,
ADD COLUMN "motivo_cancelamento" TEXT,
ADD COLUMN "historico" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "pedidos_empresa_id_situacao_idx" ON "pedidos"("empresa_id", "situacao");
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_aceito_por_id_fkey" FOREIGN KEY ("aceito_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
