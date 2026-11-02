export interface Config {
  porta: number;
  jwtSegredo: string;
  jwtExpiracao: string;
  corsOrigem: string | null;
  /**
   * Proxies reversos à frente da API (Express `trust proxy`). No Easypanel são 2: Traefik
   * e o nginx do web. Errar para menos faz o rate limit enxergar o IP do proxy (todos os
   * usuários dividem o mesmo limite); errar para mais deixa o cliente forjar o IP.
   */
  proxiesConfiaveis: number;
  /** 32 bytes para AES-256-GCM das senhas dos bancos dos clientes. */
  chaveCriptografia: Buffer;
  /** Fuso usado em {data_hoje} e {data_hora_agora}. */
  fusoHorario: string;
  superAdmin: { email: string; senha: string; nome: string } | null;
  /** Sem SMTP_HOST o sistema não envia e-mail e esconde o "Esqueci minha senha". */
  smtp: { host: string; porta: number; usuario: string; senha: string; remetente: string } | null;
  /** Endereço público do site, para links em e-mails. */
  urlPublica: string | null;
  /** Sistema de catálogo, fonte das imagens dos posts. Sem ele, só imagem própria. */
  catalogoUrl: string | null;
  /** Conta de serviço do Firebase, para avisos com o app fechado. */
  fcm: { projeto: string; email: string; chavePrivada: string } | null;
  /** Dias até apagar os bytes dos trabalhos de impressão terminados. */
  retencaoConteudoDias: number;
  retencaoAuditoriaDias: number;
}

let cache: Config | null = null;

/** Lê e valida as variáveis de ambiente. Chamado de forma preguiçosa, depois de carregar o .env. */
export function config(): Config {
  if (cache) return cache;

  const jwtSegredo = process.env.JWT_SECRET ?? '';
  if (jwtSegredo.length < 32) {
    throw new Error('JWT_SECRET ausente ou curto demais (mínimo 32 caracteres).');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não definida.');
  }

  const chaveCriptografia = Buffer.from(process.env.CHAVE_CRIPTOGRAFIA ?? '', 'base64');
  if (chaveCriptografia.length !== 32) {
    throw new Error('CHAVE_CRIPTOGRAFIA ausente ou inválida (32 bytes em base64).');
  }

  const fusoHorario = process.env.FUSO_HORARIO || 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fusoHorario });
  } catch {
    throw new Error(`FUSO_HORARIO inválido: ${fusoHorario}`);
  }

  const { SUPERADMIN_EMAIL, SUPERADMIN_SENHA, SMTP_HOST, FCM_CONTA_SERVICO } = process.env;

  let fcm: Config['fcm'] = null;
  if (FCM_CONTA_SERVICO) {
    try {
      const conta = JSON.parse(Buffer.from(FCM_CONTA_SERVICO, 'base64').toString('utf8')) as { project_id: string; client_email: string; private_key: string };
      fcm = { projeto: conta.project_id, email: conta.client_email, chavePrivada: conta.private_key };
    } catch {
      throw new Error('FCM_CONTA_SERVICO inválida (JSON da conta de serviço em base64).');
    }
    if (!fcm.projeto || !fcm.email || !fcm.chavePrivada) throw new Error('FCM_CONTA_SERVICO incompleta: faltam project_id, client_email ou private_key.');
  }
  const diasDe = (valor: string | undefined, padrao: number) => {
    const n = Number(valor);
    return Number.isInteger(n) && n >= 1 ? n : padrao;
  };

  cache = {
    porta: Number(process.env.PORTA ?? 3000),
    jwtSegredo,
    jwtExpiracao: process.env.JWT_EXPIRACAO || '12h',
    corsOrigem: process.env.CORS_ORIGEM || null,
    proxiesConfiaveis: Math.max(0, Number(process.env.PROXIES_CONFIAVEIS ?? 2) || 0),
    chaveCriptografia,
    fusoHorario,
    superAdmin:
      SUPERADMIN_EMAIL && SUPERADMIN_SENHA
        ? {
            email: SUPERADMIN_EMAIL.trim().toLowerCase(),
            senha: SUPERADMIN_SENHA,
            nome: process.env.SUPERADMIN_NOME || 'Administrador da Plataforma',
          }
        : null,
    smtp: SMTP_HOST
      ? {
          host: SMTP_HOST,
          porta: Number(process.env.SMTP_PORTA ?? 587),
          usuario: process.env.SMTP_USUARIO ?? '',
          senha: process.env.SMTP_SENHA ?? '',
          remetente: process.env.SMTP_REMETENTE || process.env.SMTP_USUARIO || '',
        }
      : null,
    urlPublica: process.env.URL_PUBLICA?.replace(/\/+$/, '') || null,
    catalogoUrl: process.env.CATALOGO_URL?.replace(/\/+$/, '') || null,
    fcm,
    retencaoConteudoDias: diasDe(process.env.RETENCAO_CONTEUDO_DIAS, 90),
    retencaoAuditoriaDias: diasDe(process.env.RETENCAO_AUDITORIA_DIAS, 730),
  };
  return cache;
}
