-- CreateEnum
CREATE TYPE "LinguagemImpressora" AS ENUM ('ZPL', 'PPLA', 'PPLB', 'ESCPOS', 'PDF');

-- CreateEnum
CREATE TYPE "MetodoImpressora" AS ENUM ('REDE', 'SISTEMA');

-- CreateTable
CREATE TABLE "modelos_etiqueta" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "consulta_id" UUID,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "layout" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modelos_etiqueta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impressoras" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "agente_id" UUID,
    "nome" TEXT NOT NULL,
    "linguagem" "LinguagemImpressora" NOT NULL,
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "metodo" "MetodoImpressora" NOT NULL DEFAULT 'REDE',
    "endereco" TEXT NOT NULL,
    "modelo" TEXT,
    "largura_maxima_mm" DOUBLE PRECISION,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "impressoras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modelos_etiqueta_consulta_id_idx" ON "modelos_etiqueta"("consulta_id");

-- CreateIndex
CREATE UNIQUE INDEX "modelos_etiqueta_empresa_id_nome_key" ON "modelos_etiqueta"("empresa_id", "nome");

-- CreateIndex
CREATE INDEX "impressoras_agente_id_idx" ON "impressoras"("agente_id");

-- CreateIndex
CREATE UNIQUE INDEX "impressoras_empresa_id_nome_key" ON "impressoras"("empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "modelos_etiqueta" ADD CONSTRAINT "modelos_etiqueta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos_etiqueta" ADD CONSTRAINT "modelos_etiqueta_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_sql"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressoras" ADD CONSTRAINT "impressoras_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressoras" ADD CONSTRAINT "impressoras_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
