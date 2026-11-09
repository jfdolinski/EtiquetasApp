ALTER TABLE "configuracoes_pedidos" ADD COLUMN "proximo_numero" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "pedidos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "codigo_cifrado" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'NOVO',
    "cliente_nome" TEXT NOT NULL,
    "cliente_telefone" TEXT NOT NULL,
    "endereco" JSONB,
    "modalidade" TEXT NOT NULL,
    "agendamento" JSONB,
    "pagamento" TEXT NOT NULL,
    "troco_para_centavos" INTEGER,
    "observacao" TEXT NOT NULL DEFAULT '',
    "itens" JSONB NOT NULL,
    "subtotal_centavos" INTEGER NOT NULL,
    "taxa_centavos" INTEGER NOT NULL,
    "total_centavos" INTEGER NOT NULL,
    "origem_hash" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pedidos_codigo_hash_key" ON "pedidos"("codigo_hash");
CREATE UNIQUE INDEX "pedidos_empresa_id_numero_key" ON "pedidos"("empresa_id", "numero");
CREATE INDEX "pedidos_empresa_id_criado_em_idx" ON "pedidos"("empresa_id", "criado_em");
CREATE INDEX "pedidos_empresa_id_origem_hash_criado_em_idx" ON "pedidos"("empresa_id", "origem_hash", "criado_em");
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
