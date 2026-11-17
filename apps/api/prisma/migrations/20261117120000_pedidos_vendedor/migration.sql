-- Venda lançada pelo vendedor no aplicativo.
ALTER TABLE "pedidos" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'LOJA',
ADD COLUMN "vendedor_id" UUID;

CREATE INDEX "pedidos_vendedor_id_criado_em_idx" ON "pedidos"("vendedor_id", "criado_em");

ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
