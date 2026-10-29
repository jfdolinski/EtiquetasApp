-- AlterTable
ALTER TABLE "consultas_sql" ADD COLUMN     "template_consulta_id" UUID,
ADD COLUMN     "template_sql_hash" TEXT;

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "sistema_erp_id" UUID;

-- CreateTable
CREATE TABLE "sistemas_erp" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "fabricante" TEXT,
    "tipo_banco" "TipoBanco" NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sistemas_erp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates_consulta" (
    "id" UUID NOT NULL,
    "sistema_erp_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "finalidade" "FinalidadeConsulta" NOT NULL DEFAULT 'OUTRA',
    "sql" TEXT NOT NULL,
    "campos_esperados" JSONB NOT NULL DEFAULT '[]',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_consulta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sistemas_erp_nome_key" ON "sistemas_erp"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "templates_consulta_sistema_erp_id_nome_key" ON "templates_consulta"("sistema_erp_id", "nome");

-- CreateIndex
CREATE INDEX "consultas_sql_template_consulta_id_idx" ON "consultas_sql"("template_consulta_id");

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_sistema_erp_id_fkey" FOREIGN KEY ("sistema_erp_id") REFERENCES "sistemas_erp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultas_sql" ADD CONSTRAINT "consultas_sql_template_consulta_id_fkey" FOREIGN KEY ("template_consulta_id") REFERENCES "templates_consulta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates_consulta" ADD CONSTRAINT "templates_consulta_sistema_erp_id_fkey" FOREIGN KEY ("sistema_erp_id") REFERENCES "sistemas_erp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
