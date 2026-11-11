-- Nome e categoria do catálogo, lidos na mesma busca da foto
ALTER TABLE "fotos_produto_tela" ADD COLUMN "nome" TEXT,
ADD COLUMN "categoria" TEXT,
ADD COLUMN "dados_em" TIMESTAMP(3),
ADD COLUMN "tentativas_sem_dados" INTEGER NOT NULL DEFAULT 0;
