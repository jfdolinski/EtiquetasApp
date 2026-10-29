# Deploy no Easypanel (VPS Hostinger)

O projeto sobe em quatro serviços dentro de um mesmo projeto do Easypanel. Os exemplos abaixo usam o nome de projeto `etiquetas`; o Easypanel expõe cada serviço na rede interna como `<projeto>_<serviço>` (ex.: `etiquetas_api`).

## 1. Pré-requisito

O código precisa estar em um repositório Git (GitHub, GitLab ou Gitea) que o Easypanel consiga acessar.

## 2. Banco e Redis

1. **+ Service → Postgres**, nome `postgres`. Anote a *Internal Connection URL*.
2. **+ Service → Redis**, nome `redis`. (Ainda não usado na Fase 1; fica pronto para as filas.)

## 3. API

**+ Service → App**, nome `api`.

- **Source:** o repositório, branch `main`.
- **Build:** Dockerfile, caminho `apps/api/Dockerfile`, contexto `/` (raiz do repositório).
- **Environment:**

  ```env
  DATABASE_URL=<Internal Connection URL do Postgres>
  JWT_SECRET=<48+ caracteres aleatórios>
  JWT_EXPIRACAO=12h
  PORTA=3000
  SUPERADMIN_EMAIL=voce@seudominio.com.br
  SUPERADMIN_SENHA=<senha forte>
  SUPERADMIN_NOME=Administrador da Plataforma
  CHAVE_CRIPTOGRAFIA=<32 bytes em base64>
  FUSO_HORARIO=America/Sao_Paulo
  ```

  Gere o segredo com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` e a chave com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

  A `CHAVE_CRIPTOGRAFIA` cifra as senhas dos bancos dos clientes. Guarde uma cópia fora do Easypanel: sem ela, todas as senhas de conexão precisam ser digitadas de novo.

- **Réplicas:** mantenha **1**. As conexões WebSocket dos agentes ficam na memória da instância que as recebeu.

- **Domains:** nenhum (a API é acessada pelo web, na rede interna). Porta do container: `3000`.

Ao iniciar, o container roda `prisma migrate deploy`, sincroniza o catálogo de permissões e cria o super-admin se o e-mail ainda não existir. Depois do primeiro login, troque a senha em **Minha conta**; mudar `SUPERADMIN_SENHA` depois não altera um usuário já criado.

## 4. Web

**+ Service → App**, nome `web`.

- **Build:** Dockerfile, caminho `apps/web/Dockerfile`, contexto `/`.
- **Environment:** `API_UPSTREAM=http://etiquetas_api:3000` (ajuste ao nome real do projeto).
- **Domains:** o domínio público (ex.: `app.seudominio.com.br`), porta `80`, HTTPS ligado.

O nginx do web serve o frontend e repassa `/api/*` para a API, incluindo o WebSocket dos agentes (`/api/agente/conectar`). Os agentes se conectam ao mesmo domínio público, por `wss://`.

## 5. Conferência

- `https://app.seudominio.com.br/api/health` deve responder `{"status":"ok","banco":"ok"}`.
- Entre com o super-admin, cadastre uma empresa e entre com o administrador dela em outra janela anônima.

## 6. Agente local

O agente não roda no Easypanel: ele é instalado na rede de cada cliente. Veja [apps/agent/README.md](../apps/agent/README.md) para compilar os binários (Windows e Linux) e instalar. Compile com `-X main.servidorPadrao=https://app.seudominio.com.br` para o técnico não precisar digitar o endereço.

## Atualizações

Cada deploy reconstrói a imagem; as migrações novas em `apps/api/prisma/migrations` são aplicadas na subida da API.
