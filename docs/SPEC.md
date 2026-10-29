# Sistema de Etiquetas SaaS – Especificação

## 1. Visão geral

Sistema web SaaS, multiempresa, que se conecta aos bancos de dados dos ERPs dos clientes (PostgreSQL, MySQL, SQL Server) por meio de um agente local, coleta dados de produtos e gera/imprime etiquetas. Cobrança mensal fixa por empresa.

## 2. Stack

- **Backend:** Node.js + TypeScript com NestJS (API REST + WebSocket)
- **ORM / banco próprio:** Prisma + PostgreSQL
- **Frontend:** React + Vite + TypeScript, Tailwind, editor de etiquetas com Konva.js (canvas)
- **Fila/cache:** Redis + BullMQ (jobs de impressão, verificação de inadimplência)
- **Agente local:** Go (binário único, instalador simples para Windows/Linux), conexão de saída via WebSocket seguro com o servidor
- **Deploy:** VPS Hostinger com Easypanel (containers: api, web, postgres, redis)
- **Monorepo:** pnpm workspaces – `apps/api`, `apps/web`, `apps/agent`, `packages/shared`

## 3. Módulos

### 3.1 Multiempresa e usuários

- Empresa (tenant) com CNPJ, plano, status de assinatura
- Usuários pertencem a uma empresa; super-admin da plataforma acima de tudo
- Permissões granulares por perfil (ex.: `etiqueta.modelo.editar`, `parametros.editar`, `sql.editar`, `imprimir`)

### 3.2 Assinatura e cobrança

- Mensalidade fixa por empresa
- Parâmetros totalmente configuráveis: dias de carência, frequência de avisos, dias até bloqueio, mensagens
- Job diário que avalia inadimplência e aplica aviso/bloqueio

### 3.3 Cadastro de sistemas (ERPs)

- Registro de ERPs (ex.: "ERP X – SQL Server")
- Cada ERP guarda um template: tipo de banco, consultas SQL padrão, mapeamento de campos
- Ao vincular empresa + ERP, o template é copiado para a empresa e pode ser ajustado

### 3.4 Editor SQL com placeholders

- Consultas armazenadas no servidor, por empresa
- Placeholders entre chaves, ex.: `{empresa.cnpj}`, `{empresa.codigo_erp}`, `{usuario.id}`, `{data_hoje}`
- Substituição feita no servidor com parâmetros seguros (nunca concatenação direta)
- Botão "testar consulta" que executa via agente e mostra as colunas retornadas

### 3.5 Campos dinâmicos

- As colunas retornadas pela consulta viram campos disponíveis no editor de etiquetas automaticamente
- Coluna adicionada/removida na consulta reflete na lista de campos
- Campos de texto fixo, data, contador, código de barras e QR code

### 3.6 Editor de etiquetas

- Arrastar e soltar campos no layout
- Fontes, tamanhos, negrito, alinhamento, rotação
- Códigos de barras (EAN-13, Code128 etc.) e QR code
- Tamanho da etiqueta, colunas por folha, margens, espaçamento
- Modelos pertencem à empresa; admin pode copiar/exportar modelos para outras empresas

### 3.7 Impressoras

- Cadastro com tipo e linguagem: Zebra (ZPL), Argox (PPLA/PPLB), térmica 80mm (ESC/POS), comum (PDF)
- Tamanho, modelo e método de impressão editáveis
- Impressão enviada ao agente local, que entrega à impressora da rede/USB

### 3.8 Agente local

- Apenas instalar: no primeiro uso pede o CNPJ, autentica e baixa todas as configurações
- Nenhuma configuração local de SQL; tudo vem do servidor
- Executa consultas no banco do ERP e envia os trabalhos de impressão
- Atualização automática e heartbeat (status online/offline no painel)

## 4. Fluxo do operador

1. Login; o servidor valida empresa e assinatura (aviso de carência ou bloqueio)
2. O servidor envia as consultas ao agente, com placeholders preenchidos
3. O agente retorna os dados; o sistema monta a lista do dia
4. Tela "Hoje você tem estas etiquetas para imprimir", organizada por modelo/impressora
5. Operador confere, desmarca itens ou ajusta quantidades
6. Impressão em lote com um clique; o sistema separa por modelo e impressora
7. Etiquetas avulsas: busca o produto, consulta ao vivo no banco do cliente, imprime
8. Itens marcados como impressos (histórico e auditoria)

## 5. Fluxo do administrador

1. Cadastra a empresa e vincula o ERP (template copiado)
2. Ajusta consultas SQL e testa via agente
3. Cria ou copia modelos de etiqueta
4. Cadastra impressoras
5. Cria usuários e define permissões
6. Define parâmetros de cobrança e bloqueio

## 6. Entidades principais

Empresa, Usuario, Perfil, Permissao, Assinatura, ParametroCobranca, SistemaERP, TemplateERP, ConexaoBanco, ConsultaSQL, ModeloEtiqueta, CampoEtiqueta, Impressora, Agente, ListaDiaria, ItemLista, TrabalhoImpressao, LogAuditoria.

## 7. Segurança

- Isolamento por tenant em todas as consultas (`empresa_id` obrigatório)
- Credenciais dos bancos dos clientes criptografadas
- Agente com token próprio, rotacionável
- Consultas do cliente somente leitura (usuário de banco read-only recomendado)

## 8. Roteiro de desenvolvimento

1. **Fase 1 – Base:** monorepo, autenticação, empresas, usuários, permissões, deploy no Easypanel
2. **Fase 2 – Agente:** registro por CNPJ, WebSocket, execução de consultas nos três bancos
3. **Fase 3 – SQL e campos:** editor SQL, placeholders, teste e campos dinâmicos
4. **Fase 4 – Editor de etiquetas:** layout, fontes, códigos de barras, geração ZPL/PPLA/ESC-POS/PDF
5. **Fase 5 – Lista do dia e impressão em lote**
6. **Fase 6 – Cadastro de ERPs e templates**
7. **Fase 7 – Assinatura, carência e bloqueio parametrizados**
8. **Fase 8 – Cópia de modelos entre empresas, auditoria e refinamentos**

## 9. Como trabalhar no Claude Code

- Comece pedindo: "Leia docs/SPEC.md e execute a Fase 1"
- Uma fase por vez, com testes e commit ao fim de cada uma
- Mantenha o `CLAUDE.md` com comandos do projeto, convenções e o estado atual das fases
