-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "distribuicao_ativa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proxima_tentativa_em" TIMESTAMP(3),
ADD COLUMN     "rodada" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sem_entregador_em" TIMESTAMP(3),
ADD COLUMN     "tentativas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "configuracoes_entregas" ADD COLUMN     "direcionamento" JSONB;

-- AlterTable
ALTER TABLE "ofertas_chamada" ADD COLUMN     "motivo" JSONB;

-- CreateTable
CREATE TABLE "entregadores_empresa" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "preferido" BOOLEAN NOT NULL DEFAULT false,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entregadores_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entregadores_empresa_empresa_id_entregador_id_key" ON "entregadores_empresa"("empresa_id", "entregador_id");

-- CreateIndex
CREATE INDEX "chamadas_entrega_distribuicao_ativa_proxima_tentativa_em_idx" ON "chamadas_entrega"("distribuicao_ativa", "proxima_tentativa_em");

-- AddForeignKey
ALTER TABLE "entregadores_empresa" ADD CONSTRAINT "entregadores_empresa_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregadores_empresa" ADD CONSTRAINT "entregadores_empresa_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

