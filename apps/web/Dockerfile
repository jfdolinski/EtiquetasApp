# Build a partir da raiz do repositório:
#   docker build -f apps/web/Dockerfile -t etiquetas-web .
#
# Argumentos opcionais (Easypanel: "Build Args"):
#   SERVIDOR_PUBLICO  endereço gravado no agente, ex.: https://app.seudominio.com.br
#                     (o técnico não precisa digitá-lo na ativação)
#   VERSAO            versão exibida pelo agente (ex.: o hash do commit)
#   AGENTE_RELEASE    versão assinada publicada no GitHub (ex.: 2026.11.02.1000): o agente é
#                     copiado de lá em vez de compilado aqui. Ver docs/DEPLOY.md.

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
ARG AGENTE_RELEASE=""
ARG AGENTE_REPOSITORIO="jfdolinski/EtiquetasApp"
WORKDIR /src
COPY apps/agent/go.mod apps/agent/go.sum ./
RUN go mod download
COPY apps/agent/ ./
RUN set -e; \
    mkdir -p /downloads; \
    if [ -n "$AGENTE_RELEASE" ]; then \
      base="https://github.com/$AGENTE_REPOSITORIO/releases/download/agente-$AGENTE_RELEASE"; \
      for a in etiquetas-agente.exe etiquetas-agente.exe.sig etiquetas-agente-linux-amd64 SHA256SUMS.txt versao.txt; do wget -q -O "/downloads/$a" "$base/$a"; done; \
      cd /downloads && sha256sum -c SHA256SUMS.txt; \
      exit 0; \
    fi; \
    v="${VERSAO:-$(TZ='<-03>3' date +%Y.%m.%d.%H%M)}"; \
    flags="-s -w -X main.versao=${v} -X main.servidorPadrao=${SERVIDOR_PUBLICO}"; \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$flags -H windowsgui" -o /downloads/etiquetas-agente.exe ./cmd/etiquetas-agente; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$flags" -o /downloads/etiquetas-agente-linux-amd64 ./cmd/etiquetas-agente; \
    cd /downloads && sha256sum etiquetas-agente.exe etiquetas-agente-linux-amd64 > SHA256SUMS.txt && echo "$v" > versao.txt

# Aplicativo de celular: o instalador é gerado pelo workflow "Aplicativo" e publicado como Release do
# GitHub; apps/mobile/release-publicada.txt diz qual versão servir. Vazio, ou Release fora do ar: o site sobe sem ele.
FROM alpine:3.20 AS app
ARG AGENTE_REPOSITORIO="jfdolinski/EtiquetasApp"
COPY apps/mobile/release-publicada.txt /tmp/release.txt
RUN set -e; \
    mkdir -p /downloads; \
    v="$(tr -d ' \r\n' < /tmp/release.txt)"; \
    if [ -n "$v" ]; then \
      base="https://github.com/$AGENTE_REPOSITORIO/releases/download/app-$v"; \
      wget -q -O /tmp/etiquetas-app.apk "$base/etiquetas-app.apk" && wget -q -O /tmp/app-versao.txt "$base/app-versao.txt" && mv /tmp/etiquetas-app.apk /tmp/app-versao.txt /downloads/ \
        || echo "AVISO: não foi possível baixar o aplicativo $v"; \
    fi

FROM nginx:1.27-alpine
# O nginx substitui ${API_UPSTREAM} ao iniciar (apenas variáveis definidas no ambiente).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web /repo/apps/web/dist /usr/share/nginx/html
COPY --from=agente /downloads /usr/share/nginx/html/downloads
COPY --from=app /downloads /usr/share/nginx/html/downloads
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
