CREATE TABLE "imagens_post" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "imagens_post_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "imagens_post_empresa_id_criado_em_idx" ON "imagens_post"("empresa_id", "criado_em");
ALTER TABLE "imagens_post" ADD CONSTRAINT "imagens_post_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "marcas_post" (
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cor_principal" TEXT NOT NULL,
    "cor_destaque" TEXT NOT NULL,
    "logo_id" UUID,
    "chave_catalogo_cifrada" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marcas_post_pkey" PRIMARY KEY ("empresa_id")
);
ALTER TABLE "marcas_post" ADD CONSTRAINT "marcas_post_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marcas_post" ADD CONSTRAINT "marcas_post_logo_id_fkey" FOREIGN KEY ("logo_id") REFERENCES "imagens_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "posts_sociais" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "conteudo" JSONB NOT NULL,
    "legenda" TEXT NOT NULL DEFAULT '',
    "ajustes" JSONB NOT NULL DEFAULT '{}',
    "autor" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "posts_sociais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "posts_sociais_empresa_id_atualizado_em_idx" ON "posts_sociais"("empresa_id", "atualizado_em");
ALTER TABLE "posts_sociais" ADD CONSTRAINT "posts_sociais_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
