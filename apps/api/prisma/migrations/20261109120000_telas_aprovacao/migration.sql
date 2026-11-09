-- AlterTable
ALTER TABLE "conteudos_tela" ADD COLUMN     "aprovacao" JSONB,
ADD COLUMN     "aprovacao_pedida_em" TIMESTAMP(3),
ADD COLUMN     "aprovacao_situacao" TEXT;
