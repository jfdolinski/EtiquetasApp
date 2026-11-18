-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "adicionais" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "parada_atual" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "configuracoes_entregas" ADD COLUMN     "adicionais" JSONB;

-- CreateTable
CREATE TABLE "paradas_chamada" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "parada" JSONB NOT NULL,
    "codigo_confirmacao" TEXT NOT NULL,
    "entregue_em" TIMESTAMP(3),
    "rastreio_hash" TEXT,
    "rastreio_cifrado" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paradas_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paradas_chamada_rastreio_hash_key" ON "paradas_chamada"("rastreio_hash");

-- CreateIndex
CREATE UNIQUE INDEX "paradas_chamada_chamada_id_ordem_key" ON "paradas_chamada"("chamada_id", "ordem");

-- AddForeignKey
ALTER TABLE "paradas_chamada" ADD CONSTRAINT "paradas_chamada_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

