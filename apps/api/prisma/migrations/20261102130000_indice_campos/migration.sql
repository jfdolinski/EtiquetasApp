CREATE TABLE "referencias_campo" (
    "id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "exemplo" TEXT NOT NULL DEFAULT '',
    "alternativos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "obrigatoria_em" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referencias_campo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referencias_campo_alias_key" ON "referencias_campo"("alias");
