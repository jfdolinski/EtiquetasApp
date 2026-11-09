-- Quem ainda não tem foto volta a ser procurado logo nas primeiras vezes.
ALTER TABLE "fotos_produto_tela" ADD COLUMN "tentativas_sem_foto" INTEGER NOT NULL DEFAULT 0;
