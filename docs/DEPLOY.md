# Deploy no Easypanel (VPS Hostinger)

O sistema sobe como **três serviços** num projeto do Easypanel. Redis não é necessário.

| Serviço | O que é |
|---|---|
| `postgres` | banco da plataforma |
| `api` | NestJS, uma réplica |
| `web` | nginx com o frontend, o proxy de `/api` e os downloads do agente |

Os exemplos usam o projeto `etiquetas` e o domínio `app.seudominio.com.br`. O Easypanel expõe os serviços na rede interna como `<projeto>_<serviço>`, por exemplo `etiquetas_api`.

## 0. O que você precisa ter

- **VPS Hostinger com Easypanel instalado.** Pode ser o template "Easypanel" da Hostinger. 2 GB de RAM bastam para começar.
- **Domínio.** Crie um registro DNS **A** apontando `app.seudominio.com.br` para o IP da VPS.
- **Conta no GitHub** com um repositório **privado** vazio, por exemplo `etiquetas`. Não marque a opção de criar README, para o primeiro push entrar limpo.

## 1. Enviar o código para o GitHub

Na pasta do projeto:

```bash
git remote add origin https://github.com/SEU_USUARIO/etiquetas.git
git push -u origin main
```

O Git para Windows abre o navegador para você autorizar o acesso ao GitHub.

O workflow [CI](../.github/workflows/ci.yml) roda a cada push:

- testes da API, do web, do pacote compartilhado e do agente;
- build das duas imagens Docker;
- um teste que sobe Postgres, API e web juntos e faz login pelo nginx.

**Espere o CI ficar verde antes do primeiro deploy.** É a primeira vez que as imagens são construídas.

No Easypanel, conecte o GitHub em **Settings → GitHub** e dê acesso ao repositório.

## 2. Gerar os segredos

Gere os valores no seu computador e guarde-os num gerenciador de senhas:

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('CHAVE_CRIPTOGRAFIA=' + require('crypto').randomBytes(32).toString('base64'))"
```

- **`CHAVE_CRIPTOGRAFIA`** cifra as senhas dos bancos dos clientes. Se ela se perder, todas as conexões precisam ter a senha digitada de novo. Guarde uma cópia fora do Easypanel.
- **`JWT_SECRET`**: trocar o valor apenas desconecta todos os usuários.

## 3. Postgres

**+ Service → Postgres**, nome `postgres`. Anote a *Internal Connection URL*.

Em **Backups**, configure backup diário. O banco guarda tudo: empresas, consultas, modelos, histórico e auditoria.

## 4. API

**+ Service → App**, nome `api`.

- **Source:** GitHub, o repositório, branch `main`.
- **Build:** Dockerfile, caminho `apps/api/Dockerfile`.
- **Environment:**

  ```env
  DATABASE_URL=<Internal Connection URL do Postgres>
  JWT_SECRET=<gerado no passo 2>
  CHAVE_CRIPTOGRAFIA=<gerado no passo 2>
  JWT_EXPIRACAO=12h
  PORTA=3000
  FUSO_HORARIO=America/Sao_Paulo
  PROXIES_CONFIAVEIS=2
  SUPERADMIN_EMAIL=voce@seudominio.com.br
  SUPERADMIN_SENHA=<senha forte, troque depois do primeiro login>
  SUPERADMIN_NOME=Administrador da Plataforma
  ```

- **`PROXIES_CONFIAVEIS=2`:** a requisição passa pelo Traefik do Easypanel e pelo nginx do web. Com o valor errado, o limite de tentativas de login enxerga o IP do proxy em vez do IP de cada usuário.
- **Réplicas: 1.** As conexões dos agentes ficam na memória da API, e a avaliação diária de cobrança roda dentro dela.
- **Domains:** nenhum. A API só é acessada pelo web, na rede interna, na porta `3000`.

Ao subir, o container:

1. aplica as migrações (`prisma migrate deploy`);
2. sincroniza o catálogo de permissões e concede as permissões novas aos perfis "Administrador";
3. cria o super-admin, se o e-mail ainda não existir.

Mudar `SUPERADMIN_SENHA` depois não altera um usuário que já existe. Troque a senha em **Minha conta**.

## 5. Web

**+ Service → App**, nome `web`.

- **Build:** Dockerfile, caminho `apps/web/Dockerfile`.
- **Build Args:**
  - `SERVIDOR_PUBLICO=https://app.seudominio.com.br`: fica gravado no agente, para o técnico não precisar digitar o endereço.
  - `VERSAO=1.0.0`: opcional, aparece no painel em Agentes.
- **Environment:** `API_UPSTREAM=http://etiquetas_api:3000`. Ajuste ao nome real do projeto e do serviço.
- **Domains:** `app.seudominio.com.br`, porta `80`, **HTTPS ligado**. O Easypanel emite o certificado Let's Encrypt.

O nginx serve o frontend e repassa `/api/*` para a API, incluindo o WebSocket dos agentes em `wss://app.seudominio.com.br/api/agente/conectar`.

O build também compila o agente para Windows e Linux. Os arquivos ficam em:

- `https://app.seudominio.com.br/downloads/etiquetas-agente.exe`
- `https://app.seudominio.com.br/downloads/etiquetas-agente-linux-amd64`
- `SHA256SUMS.txt`, com o hash de cada um.

## 6. Conferência

1. `https://app.seudominio.com.br/api/health` deve responder `{"status":"ok","banco":"ok"}`.
2. Entre com o super-admin e troque a senha em **Minha conta**.
3. Em **Cobrança**, revise os parâmetros: prazos, mensagens e hora da avaliação diária.
4. Se for usar, cadastre o **Sistema ERP** e o template de consultas.
5. Cadastre a primeira **Empresa**, com o administrador dela. Numa janela anônima, entre com esse administrador.
6. Em **Agentes**, crie o agente e gere o código de ativação. Na máquina da loja:
   1. baixe o executável pelo link da tela e abra com dois cliques;
   2. na janela do agente, informe o CNPJ e o código e confirme a permissão de administrador;
   3. confira o ícone verde ao lado do relógio e se o agente aparece como **Online**.
7. Cadastre a conexão de banco, use **Testar** e siga com consultas, modelos e impressoras.

## 7. Atualizações

- Cada push na `main` com o CI verde pode ser publicado com **Deploy** em cada serviço. Faça primeiro a `api`, por causa das migrações, depois o `web`.
- Migrações novas em `apps/api/prisma/migrations` são aplicadas na subida da API. Faça backup do Postgres antes de atualizações grandes.
- Os agentes instalados **não se atualizam sozinhos**. No Windows, baixe o executável novo, abra com dois cliques: ele fecha o painel aberto e mostra **Atualizar o agente**, que troca a versão instalada e reinicia o serviço (pede permissão de administrador). **Reiniciar** não atualiza. No Linux, rode `etiquetas-agente instalar` com o arquivo novo. O token continua valendo.
- **Agentes da versão sem painel** (ativados pelo prompt ou abertos pela pasta Inicializar): o executável novo mostra **Falta instalar o agente**. Instale pela janela e, se ela avisar de uma cópia antiga na inicialização, clique em **Remover cópia antiga**.

## 8. Antes do primeiro cliente

- **Bancos e impressoras reais:** ainda não foram testados contra MySQL e SQL Server reais nem com impressoras físicas. Faça um piloto e confira a primeira etiqueta de cada linguagem: ZPL, PPLA, PPLB e ESC/POS.
- **Usuário de banco do cliente:** crie-o **somente leitura**. O agente também recusa escrita, mas a permissão do banco é a proteção principal.
- **Login:** a sessão expira em `JWT_EXPIRACAO`, por padrão 12 h, sem renovação automática.
