-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "emergencia" JSONB,
ADD COLUMN     "rastreio_cifrado" TEXT,
ADD COLUMN     "rastreio_hash" TEXT;

-- AlterTable
ALTER TABLE "configuracoes_entregas" ADD COLUMN     "chamar_ao_aceitar_pedido" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "chamadas_entrega_rastreio_hash_key" ON "chamadas_entrega"("rastreio_hash");

