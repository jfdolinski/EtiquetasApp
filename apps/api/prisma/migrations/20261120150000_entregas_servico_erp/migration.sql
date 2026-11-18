-- AlterTable
ALTER TABLE "chamadas_entrega" ADD COLUMN     "checklists" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "chegou_no_ponto_em" TIMESTAMP(3),
ADD COLUMN     "codigo_devolucao" TEXT,
ADD COLUMN     "devolucao" JSONB,
ADD COLUMN     "espera_centavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "espera_minutos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "espera_por_bloco_centavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "espera_tolerancia_minutos" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "pedido_erp" TEXT;

-- AlterTable
ALTER TABLE "parametros_entregas" ADD COLUMN     "tabela_padrao" JSONB,
ADD COLUMN     "valor_minimo_centavos" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "configuracoes_pedidos_erp" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "consulta_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "intervalo_minutos" INTEGER NOT NULL DEFAULT 2,
    "chamar_automatico" BOOLEAN NOT NULL DEFAULT true,
    "importar_existentes" BOOLEAN NOT NULL DEFAULT false,
    "responsavel_id" UUID,
    "proxima_leitura_em" TIMESTAMP(3),
    "lido_em" TIMESTAMP(3),
    "erro" TEXT,
    "primeira_leitura" BOOLEAN NOT NULL DEFAULT true,
    "colunas" JSONB,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_pedidos_erp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_erp_entrega" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "situacao" TEXT NOT NULL,
    "mensagem" TEXT,
    "chamada_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_erp_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_pedidos_erp_empresa_id_key" ON "configuracoes_pedidos_erp"("empresa_id");

-- CreateIndex
CREATE INDEX "configuracoes_pedidos_erp_ativo_proxima_leitura_em_idx" ON "configuracoes_pedidos_erp"("ativo", "proxima_leitura_em");

-- CreateIndex
CREATE INDEX "pedidos_erp_entrega_empresa_id_criado_em_idx" ON "pedidos_erp_entrega"("empresa_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_erp_entrega_empresa_id_codigo_key" ON "pedidos_erp_entrega"("empresa_id", "codigo");

-- AddForeignKey
ALTER TABLE "configuracoes_pedidos_erp" ADD CONSTRAINT "configuracoes_pedidos_erp_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_pedidos_erp" ADD CONSTRAINT "configuracoes_pedidos_erp_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_sql"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_pedidos_erp" ADD CONSTRAINT "configuracoes_pedidos_erp_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_erp_entrega" ADD CONSTRAINT "pedidos_erp_entrega_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

