export interface Config {
  porta: number;
  jwtSegredo: string;
  jwtExpiracao: string;
  corsOrigem: string | null;
  /** 32 bytes para AES-256-GCM das senhas dos bancos dos clientes. */
  chaveCriptografia: Buffer;
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

  const { SUPERADMIN_EMAIL, SUPERADMIN_SENHA } = process.env;

  cache = {
    porta: Number(process.env.PORTA ?? 3000),
    jwtSegredo,
    jwtExpiracao: process.env.JWT_EXPIRACAO || '12h',
    corsOrigem: process.env.CORS_ORIGEM || null,
    chaveCriptografia,
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
