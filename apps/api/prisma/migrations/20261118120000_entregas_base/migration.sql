-- CreateTable
CREATE TABLE "entregadores" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "veiculo" TEXT NOT NULL,
    "placa" TEXT,
    "chave_pix" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "motivo" TEXT,
    "decidido_em" TIMESTAMP(3),
    "termos_versao" INTEGER NOT NULL,
    "termos_aceitos_em" TIMESTAMP(3) NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "online_desde" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "precisao_metros" DOUBLE PRECISION,
    "posicao_em" TIMESTAMP(3),
    "aviso_em" TIMESTAMP(3),
    "versao_app" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entregadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes_entregador" (
    "id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "dispositivo" TEXT NOT NULL DEFAULT '',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerrada_em" TIMESTAMP(3),

    CONSTRAINT "sessoes_entregador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_entregador" (
    "id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_entregador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacotes_credito" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "diarias" INTEGER NOT NULL,
    "preco_centavos" INTEGER NOT NULL,
    "validade_dias" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacotes_credito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_credito" (
    "id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "pacote_nome" TEXT NOT NULL,
    "diarias" INTEGER NOT NULL,
    "preco_centavos" INTEGER NOT NULL,
    "validade_dias" INTEGER NOT NULL,
    "txid" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "pagamento_informado_em" TIMESTAMP(3),
    "comprovante" BYTEA,
    "comprovante_mime" TEXT,
    "motivo" TEXT,
    "decidido_em" TIMESTAMP(3),
    "decidido_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_credito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes_credito" (
    "id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "origem" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "restante" INTEGER NOT NULL,
    "vence_em" TIMESTAMP(3) NOT NULL,
    "pedido_id" UUID,
    "motivo" TEXT,
    "criado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_credito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diarias_entregador" (
    "id" UUID NOT NULL,
    "entregador_id" UUID NOT NULL,
    "dia" DATE NOT NULL,
    "lote_id" UUID NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diarias_entregador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_entregas" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pix_chave" TEXT NOT NULL DEFAULT '',
    "pix_nome" TEXT NOT NULL DEFAULT '',
    "pix_cidade" TEXT NOT NULL DEFAULT '',
    "diarias_bonus_cadastro" INTEGER NOT NULL DEFAULT 0,
    "validade_bonus_dias" INTEGER NOT NULL DEFAULT 30,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_entregas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "base_lat" DOUBLE PRECISION,
    "base_lon" DOUBLE PRECISION,
    "base_endereco" TEXT NOT NULL DEFAULT '',
    "raio_atendimento_km" INTEGER NOT NULL DEFAULT 15,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_geocodificacao" (
    "chave" TEXT NOT NULL,
    "resultados" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_geocodificacao_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "entregadores_cpf_key" ON "entregadores"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "entregadores_email_key" ON "entregadores"("email");

-- CreateIndex
CREATE INDEX "entregadores_online_posicao_em_idx" ON "entregadores"("online", "posicao_em");

-- CreateIndex
CREATE INDEX "entregadores_situacao_criado_em_idx" ON "entregadores"("situacao", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_entregador_token_hash_key" ON "sessoes_entregador"("token_hash");

-- CreateIndex
CREATE INDEX "sessoes_entregador_entregador_id_encerrada_em_idx" ON "sessoes_entregador"("entregador_id", "encerrada_em");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_entregador_entregador_id_tipo_key" ON "documentos_entregador"("entregador_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_credito_txid_key" ON "pedidos_credito"("txid");

-- CreateIndex
CREATE INDEX "pedidos_credito_situacao_criado_em_idx" ON "pedidos_credito"("situacao", "criado_em");

-- CreateIndex
CREATE INDEX "pedidos_credito_entregador_id_criado_em_idx" ON "pedidos_credito"("entregador_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_credito_pedido_id_key" ON "lotes_credito"("pedido_id");

-- CreateIndex
CREATE INDEX "lotes_credito_entregador_id_vence_em_idx" ON "lotes_credito"("entregador_id", "vence_em");

-- CreateIndex
CREATE UNIQUE INDEX "diarias_entregador_entregador_id_dia_key" ON "diarias_entregador"("entregador_id", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_entregas_empresa_id_key" ON "configuracoes_entregas"("empresa_id");

-- AddForeignKey
ALTER TABLE "sessoes_entregador" ADD CONSTRAINT "sessoes_entregador_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_entregador" ADD CONSTRAINT "documentos_entregador_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_credito" ADD CONSTRAINT "pedidos_credito_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_credito" ADD CONSTRAINT "lotes_credito_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_credito" ADD CONSTRAINT "lotes_credito_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos_credito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diarias_entregador" ADD CONSTRAINT "diarias_entregador_entregador_id_fkey" FOREIGN KEY ("entregador_id") REFERENCES "entregadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diarias_entregador" ADD CONSTRAINT "diarias_entregador_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_credito"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_entregas" ADD CONSTRAINT "configuracoes_entregas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

