-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "cancelamento_pago" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coletada_em" TIMESTAMP(3),
ADD COLUMN     "foto_coleta" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foto_entrega" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "configuracoes_entregas" ADD COLUMN     "foto_coleta" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foto_entrega" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rastros_chamada" (
    "id" UUID NOT NULL,
    "chamada_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rastros_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redefinicoes_senha_entregador" (
    "id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redefinicoes_senha_entregador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rastros_chamada_chamada_id_em_idx" ON "rastros_chamada"("chamada_id", "em");

-- CreateIndex
CREATE INDEX "rastros_chamada_em_idx" ON "rastros_chamada"("em");

-- CreateIndex
CREATE UNIQUE INDEX "redefinicoes_senha_entregador_token_hash_key" ON "redefinicoes_senha_entregador"("token_hash");

-- CreateIndex
CREATE INDEX "redefinicoes_senha_entregador_entregador_id_criado_em_idx" ON "redefinicoes_senha_entregador"("entregador_id", "criado_em");

-- AddForeignKey
ALTER TABLE "rastros_chamada" ADD CONSTRAINT "rastros_chamada_chamada_id_fkey" FOREIGN KEY ("chamada_id") REFERENCES "chamadas_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redefinicoes_senha_entregador" ADD CONSTRAINT "redefinicoes_senha_entregador_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

