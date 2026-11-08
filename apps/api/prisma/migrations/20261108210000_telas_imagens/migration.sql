CREATE TABLE "imagens_tela" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "largura" INTEGER,
    "altura" INTEGER,
    "bytes" INTEGER NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "imagens_tela_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "imagens_tela_empresa_id_criado_em_idx" ON "imagens_tela"("empresa_id", "criado_em");
ALTER TABLE "imagens_tela" ADD CONSTRAINT "imagens_tela_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
