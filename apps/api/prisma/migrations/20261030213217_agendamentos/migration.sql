-- AlterEnum
ALTER TYPE "OrigemTrabalho" ADD VALUE 'AGENDAMENTO';

-- CreateTable
CREATE TABLE "agendamentos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "modelo_id" UUID NOT NULL,
    "impressora_id" UUID,
    "responsavel_id" UUID,
    "intervalo_segundos" INTEGER NOT NULL,
    "inicio_em" TIMESTAMP(3) NOT NULL,
    "imprimir_automatico" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "proxima_execucao_em" TIMESTAMP(3),
    "ultima_execucao_em" TIMESTAMP(3),
    "historico" JSONB NOT NULL DEFAULT '[]',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agendamentos_empresa_id_idx" ON "agendamentos"("empresa_id");

-- CreateIndex
CREATE INDEX "agendamentos_ativo_proxima_execucao_em_idx" ON "agendamentos"("ativo", "proxima_execucao_em");

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "modelos_etiqueta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_impressora_id_fkey" FOREIGN KEY ("impressora_id") REFERENCES "impressoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
