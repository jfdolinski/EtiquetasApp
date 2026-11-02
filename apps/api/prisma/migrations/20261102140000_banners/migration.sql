CREATE TABLE "banners_publicitarios" (
    "id" UUID NOT NULL,
    "anunciante" TEXT NOT NULL,
    "contato" TEXT NOT NULL DEFAULT '',
    "texto" TEXT NOT NULL DEFAULT '',
    "imagem" TEXT,
    "link" TEXT,
    "valor_mensal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "exibicoes" INTEGER NOT NULL DEFAULT 0,
    "cliques" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "banners_publicitarios_pkey" PRIMARY KEY ("id")
);
