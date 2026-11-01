ALTER TABLE "empresas" ADD COLUMN "aprovacao_pendente" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "situacao_receita" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "cadastro_pendente" BOOLEAN NOT NULL DEFAULT false;
