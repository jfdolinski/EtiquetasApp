-- CreateEnum
CREATE TYPE "FinalidadeConsulta" AS ENUM ('LISTA_DIARIA', 'BUSCA_PRODUTO', 'OUTRA');

-- CreateTable
CREATE TABLE "consultas_sql" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "conexao_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "finalidade" "FinalidadeConsulta" NOT NULL DEFAULT 'OUTRA',
    "sql" TEXT NOT NULL,
    "campos" JSONB NOT NULL DEFAULT '[]',
    "campos_hash" TEXT,
    "campos_atualizados_em" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultas_sql_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultas_sql_conexao_id_idx" ON "consultas_sql"("conexao_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultas_sql_empresa_id_nome_key" ON "consultas_sql"("empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "consultas_sql" ADD CONSTRAINT "consultas_sql_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultas_sql" ADD CONSTRAINT "consultas_sql_conexao_id_fkey" FOREIGN KEY ("conexao_id") REFERENCES "conexoes_banco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
