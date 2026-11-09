-- Fotos do catálogo guardadas por produto, para as telas.
CREATE TABLE "fotos_produto_tela" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "mime" TEXT,
    "conteudo" BYTEA,
    "url_origem" TEXT,
    "medicamento" BOOLEAN NOT NULL DEFAULT false,
    "verificado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fotos_produto_tela_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fotos_produto_tela_empresa_id_codigo_key" ON "fotos_produto_tela"("empresa_id", "codigo");
CREATE INDEX "fotos_produto_tela_verificado_em_idx" ON "fotos_produto_tela"("verificado_em");

ALTER TABLE "fotos_produto_tela" ADD CONSTRAINT "fotos_produto_tela_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
