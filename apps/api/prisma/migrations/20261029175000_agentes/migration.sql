-- CreateEnum
CREATE TYPE "TipoBanco" AS ENUM ('POSTGRES', 'MYSQL', 'SQLSERVER');

-- CreateTable
CREATE TABLE "agentes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "token_hash" TEXT,
    "codigo_ativacao_hash" TEXT,
    "codigo_ativacao_expira_em" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" TEXT,
    "hostname" TEXT,
    "sistema_operacional" TEXT,
    "ultimo_contato_em" TIMESTAMP(3),
    "ativado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conexoes_banco" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "agente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoBanco" NOT NULL,
    "host" TEXT NOT NULL,
    "porta" INTEGER NOT NULL,
    "banco" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "senha_cifrada" TEXT,
    "opcoes" JSONB NOT NULL DEFAULT '{}',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexoes_banco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agentes_token_hash_key" ON "agentes"("token_hash");

-- CreateIndex
CREATE INDEX "agentes_empresa_id_codigo_ativacao_hash_idx" ON "agentes"("empresa_id", "codigo_ativacao_hash");

-- CreateIndex
CREATE UNIQUE INDEX "agentes_empresa_id_nome_key" ON "agentes"("empresa_id", "nome");

-- CreateIndex
CREATE INDEX "conexoes_banco_agente_id_idx" ON "conexoes_banco"("agente_id");

-- CreateIndex
CREATE UNIQUE INDEX "conexoes_banco_empresa_id_nome_key" ON "conexoes_banco"("empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "agentes" ADD CONSTRAINT "agentes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexoes_banco" ADD CONSTRAINT "conexoes_banco_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexoes_banco" ADD CONSTRAINT "conexoes_banco_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
