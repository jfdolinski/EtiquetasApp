-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "agendada_para" TIMESTAMP(3),
ADD COLUMN     "codigo_coleta" TEXT,
ADD COLUMN     "etiqueta_impressa_em" TIMESTAMP(3),
ADD COLUMN     "etiqueta_lida_em" TIMESTAMP(3),
ADD COLUMN     "mensagens_lidas_empresa_em" TIMESTAMP(3),
ADD COLUMN     "mensagens_lidas_entregador_em" TIMESTAMP(3),
ADD COLUMN     "volumes" INTEGER,
ADD COLUMN     "volumes_entregues" INTEGER;

-- AlterTable
ALTER TABLE "entregadores" ADD COLUMN     "termo_custodia_em" TIMESTAMP(3),
ADD COLUMN     "termo_custodia_versao" INTEGER;

-- CreateTable
CREATE TABLE "mensagens_chamada" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "autor" TEXT NOT NULL,
    "usuario_id" UUID,
    "nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mensagens_chamada_chamada_id_criado_em_idx" ON "mensagens_chamada"("chamada_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "chamadas_entrega_codigo_coleta_key" ON "chamadas_entrega"("codigo_coleta");

-- AddForeignKey
ALTER TABLE "mensagens_chamada" ADD CONSTRAINT "mensagens_chamada_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

