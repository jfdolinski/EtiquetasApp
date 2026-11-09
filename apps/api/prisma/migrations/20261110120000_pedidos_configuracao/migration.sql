ALTER TABLE "empresas" ADD COLUMN "horario_funcionamento" JSONB;

CREATE TABLE "configuracoes_pedidos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "codigo_link" TEXT NOT NULL,
    "consulta_id" UUID,
    "config" JSONB NOT NULL,
    "intervalo_minutos" INTEGER NOT NULL DEFAULT 15,
    "validade_minutos" INTEGER NOT NULL DEFAULT 120,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "quantidade_itens" INTEGER NOT NULL DEFAULT 0,
    "dados_em" TIMESTAMP(3),
    "erro" TEXT,
    "proxima_atualizacao_em" TIMESTAMP(3),
    "responsavel_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "configuracoes_pedidos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "configuracoes_pedidos_empresa_id_key" ON "configuracoes_pedidos"("empresa_id");
CREATE UNIQUE INDEX "configuracoes_pedidos_codigo_link_key" ON "configuracoes_pedidos"("codigo_link");
CREATE INDEX "configuracoes_pedidos_ativo_proxima_atualizacao_em_idx" ON "configuracoes_pedidos"("ativo", "proxima_atualizacao_em");
ALTER TABLE "configuracoes_pedidos" ADD CONSTRAINT "configuracoes_pedidos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "configuracoes_pedidos" ADD CONSTRAINT "configuracoes_pedidos_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_sql"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "configuracoes_pedidos" ADD CONSTRAINT "configuracoes_pedidos_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
