-- Produtos banidos: código de barras que não sai em etiqueta, por empresa.
CREATE TABLE "produtos_banidos" (
    "empresa_id" UUID NOT NULL,
    "codigo_barras" TEXT NOT NULL,
    "motivo" TEXT,
    "criado_por" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produtos_banidos_pkey" PRIMARY KEY ("empresa_id","codigo_barras")
);

ALTER TABLE "produtos_banidos" ADD CONSTRAINT "produtos_banidos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
