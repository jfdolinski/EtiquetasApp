# Build a partir da raiz do repositório:
#   docker build -f apps/web/Dockerfile -t etiquetas-web .
#
# Argumentos opcionais (Easypanel: "Build Args"):
#   SERVIDOR_PUBLICO  endereço gravado no agente, ex.: https://app.seudominio.com.br
#                     (o técnico não precisa digitá-lo na ativação)
#   VERSAO            versão exibida pelo agente (ex.: o hash do commit)

FROM node:22-alpine AS web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@etiquetas/web..."
RUN pnpm --filter @etiquetas/web build

# Agente local (Go) para Windows e Linux, servido em /downloads/.
FROM golang:1.27-alpine AS agente
ARG SERVIDOR_PUBLICO=""
ARG VERSAO=""
WORKDIR /src
COPY apps/agent/go.mod apps/agent/go.sum ./
RUN go mod download
COPY apps/agent/ ./
RUN set -e; \
    v="${VERSAO:-$(date -u +%Y.%m.%d)}"; \
    flags="-s -w -X main.versao=${v} -X main.servidorPadrao=${SERVIDOR_PUBLICO}"; \
    mkdir -p /downloads; \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$flags" -o /downloads/etiquetas-agente.exe ./cmd/etiquetas-agente; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$flags" -o /downloads/etiquetas-agente-linux-amd64 ./cmd/etiquetas-agente; \
    cd /downloads && sha256sum etiquetas-agente.exe etiquetas-agente-linux-amd64 > SHA256SUMS.txt && echo "$v" > versao.txt

FROM nginx:1.27-alpine
# O nginx substitui ${API_UPSTREAM} ao iniciar (apenas variáveis definidas no ambiente).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web /repo/apps/web/dist /usr/share/nginx/html
COPY --from=agente /downloads /usr/share/nginx/html/downloads
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
