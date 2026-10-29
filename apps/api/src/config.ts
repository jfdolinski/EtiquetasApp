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

  const { SUPERADMIN_EMAIL, SUPERADMIN_SENHA } = process.env;

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
  };
  return cache;
}
