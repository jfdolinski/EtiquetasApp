-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "assinatura" TEXT NOT NULL DEFAULT 'NAO';

-- AlterTable
ALTER TABLE "configuracoes_entregas" ADD COLUMN     "assinatura" TEXT NOT NULL DEFAULT 'NAO',
ADD COLUMN     "chamadas_simultaneas" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "paradas_chamada" ADD COLUMN     "pedido_erp" TEXT,
ADD COLUMN     "pedido_id" UUID;

-- CreateIndex
CREATE INDEX "paradas_chamada_pedido_id_idx" ON "paradas_chamada"("pedido_id");

