-- CreateEnum
CREATE TYPE "StatusItemLista" AS ENUM ('PENDENTE', 'NA_FILA', 'IMPRESSO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "StatusTrabalho" AS ENUM ('PENDENTE', 'ENVIANDO', 'CONCLUIDO', 'ERRO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "OrigemTrabalho" AS ENUM ('LISTA', 'AVULSA');

-- AlterTable
ALTER TABLE "modelos_etiqueta" ADD COLUMN     "impressora_id" UUID,
ADD COLUMN     "na_lista_diaria" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "listas_diarias" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "erros" JSONB NOT NULL DEFAULT '[]',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listas_diarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_lista" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "lista_id" UUID NOT NULL,
    "modelo_id" UUID NOT NULL,
    "impressora_id" UUID,
    "chave" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "registro" JSONB NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "status" "StatusItemLista" NOT NULL DEFAULT 'PENDENTE',
    "trabalho_id" UUID,
    "impresso_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_lista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trabalhos_impressao" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "impressora_id" UUID,
    "impressora_nome" TEXT NOT NULL,
    "modelo_nome" TEXT NOT NULL,
    "linguagem" "LinguagemImpressora" NOT NULL,
    "origem" "OrigemTrabalho" NOT NULL,
    "quantidade_etiquetas" INTEGER NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "status" "StatusTrabalho" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trabalhos_impressao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listas_diarias_empresa_id_data_key" ON "listas_diarias"("empresa_id", "data");

-- CreateIndex
CREATE INDEX "itens_lista_lista_id_status_idx" ON "itens_lista"("lista_id", "status");

-- CreateIndex
CREATE INDEX "itens_lista_trabalho_id_idx" ON "itens_lista"("trabalho_id");

-- CreateIndex
CREATE INDEX "trabalhos_impressao_empresa_id_criado_em_idx" ON "trabalhos_impressao"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "trabalhos_impressao_status_idx" ON "trabalhos_impressao"("status");

-- AddForeignKey
ALTER TABLE "modelos_etiqueta" ADD CONSTRAINT "modelos_etiqueta_impressora_id_fkey" FOREIGN KEY ("impressora_id") REFERENCES "impressoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_diarias" ADD CONSTRAINT "listas_diarias_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_lista" ADD CONSTRAINT "itens_lista_lista_id_fkey" FOREIGN KEY ("lista_id") REFERENCES "listas_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_lista" ADD CONSTRAINT "itens_lista_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "modelos_etiqueta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_lista" ADD CONSTRAINT "itens_lista_impressora_id_fkey" FOREIGN KEY ("impressora_id") REFERENCES "impressoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_lista" ADD CONSTRAINT "itens_lista_trabalho_id_fkey" FOREIGN KEY ("trabalho_id") REFERENCES "trabalhos_impressao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trabalhos_impressao" ADD CONSTRAINT "trabalhos_impressao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trabalhos_impressao" ADD CONSTRAINT "trabalhos_impressao_impressora_id_fkey" FOREIGN KEY ("impressora_id") REFERENCES "impressoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trabalhos_impressao" ADD CONSTRAINT "trabalhos_impressao_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
