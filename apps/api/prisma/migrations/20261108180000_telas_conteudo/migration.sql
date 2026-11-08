CREATE TABLE "conteudos_tela" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "consulta_id" UUID,
    "nome" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "intervalo_minutos" INTEGER NOT NULL,
    "validade_minutos" INTEGER NOT NULL,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "horario_inicio" TEXT,
    "horario_fim" TEXT,
    "data_inicio" TEXT,
    "data_fim" TEXT,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "quantidade_itens" INTEGER NOT NULL DEFAULT 0,
    "dados_em" TIMESTAMP(3),
    "erro" TEXT,
    "proxima_atualizacao_em" TIMESTAMP(3),
    "responsavel_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conteudos_tela_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conteudos_tela_empresa_id_nome_key" ON "conteudos_tela"("empresa_id", "nome");
CREATE INDEX "conteudos_tela_publicado_proxima_atualizacao_em_idx" ON "conteudos_tela"("publicado", "proxima_atualizacao_em");
ALTER TABLE "conteudos_tela" ADD CONSTRAINT "conteudos_tela_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conteudos_tela" ADD CONSTRAINT "conteudos_tela_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_sql"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conteudos_tela" ADD CONSTRAINT "conteudos_tela_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "telas_conteudo" (
    "tela_id" UUID NOT NULL,
    "conteudo_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    CONSTRAINT "telas_conteudo_pkey" PRIMARY KEY ("tela_id", "conteudo_id")
);
CREATE INDEX "telas_conteudo_conteudo_id_idx" ON "telas_conteudo"("conteudo_id");
ALTER TABLE "telas_conteudo" ADD CONSTRAINT "telas_conteudo_tela_id_fkey" FOREIGN KEY ("tela_id") REFERENCES "telas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telas_conteudo" ADD CONSTRAINT "telas_conteudo_conteudo_id_fkey" FOREIGN KEY ("conteudo_id") REFERENCES "conteudos_tela"("id") ON DELETE CASCADE ON UPDATE CASCADE;
