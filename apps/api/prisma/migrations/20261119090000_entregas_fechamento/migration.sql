-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "avaliacao_comentario" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "avaliacao_nota" INTEGER,
ADD COLUMN     "avaliada_em" TIMESTAMP(3),
ADD COLUMN     "extra_centavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extra_motivo" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fechamento_id" UUID,
ADD COLUMN     "pedido_id" UUID;

-- CreateTable
CREATE TABLE "fechamentos_entregas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "pago_em" DATE NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "total_centavos" INTEGER NOT NULL,
    "observacao" TEXT NOT NULL DEFAULT '',
    "comprovante_mime" TEXT,
    "comprovante" BYTEA,
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fechamentos_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contestacoes_entrega" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "mensagem" TEXT NOT NULL,
    "resposta" TEXT,
    "respondida_em" TIMESTAMP(3),
    "respondida_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contestacoes_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fechamentos_entregas_empresa_id_criado_em_idx" ON "fechamentos_entregas"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "fechamentos_entregas_entregador_id_idx" ON "fechamentos_entregas"("entregador_id");

-- CreateIndex
CREATE INDEX "contestacoes_entrega_empresa_id_respondida_em_idx" ON "contestacoes_entrega"("empresa_id", "respondida_em");

-- CreateIndex
CREATE INDEX "contestacoes_entrega_chamada_id_idx" ON "contestacoes_entrega"("chamada_id");

-- CreateIndex
CREATE INDEX "chamadas_entrega_empresa_id_entregador_id_fechamento_id_idx" ON "chamadas_entrega"("empresa_id", "entregador_id", "fechamento_id");

-- CreateIndex
CREATE INDEX "chamadas_entrega_pedido_id_idx" ON "chamadas_entrega"("pedido_id");

-- AddForeignKey
ALTER TABLE "chamadas_entrega" ADD CONSTRAINT "chamadas_entrega_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamadas_entrega" ADD CONSTRAINT "chamadas_entrega_fechamento_id_fkey" FOREIGN KEY ("fechamento_id") REFERENCES "fechamentos_entregas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamentos_entregas" ADD CONSTRAINT "fechamentos_entregas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamentos_entregas" ADD CONSTRAINT "fechamentos_entregas_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamentos_entregas" ADD CONSTRAINT "fechamentos_entregas_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contestacoes_entrega" ADD CONSTRAINT "contestacoes_entrega_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contestacoes_entrega" ADD CONSTRAINT "contestacoes_entrega_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contestacoes_entrega" ADD CONSTRAINT "contestacoes_entrega_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

