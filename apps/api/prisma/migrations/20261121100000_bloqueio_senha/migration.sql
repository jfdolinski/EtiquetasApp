-- AlterTable
ALTER TABLE "entregadores" ADD COLUMN     "senha_bloqueada_ate" TIMESTAMP(3),
ADD COLUMN     "senha_falhas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "senha_bloqueada_ate" TIMESTAMP(3),
ADD COLUMN     "senha_falhas" INTEGER NOT NULL DEFAULT 0;

