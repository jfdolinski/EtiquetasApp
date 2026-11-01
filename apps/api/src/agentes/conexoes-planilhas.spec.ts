import { randomBytes } from 'node:crypto';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { cifrar, decifrar } from '../cripto';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentesGateway } from './agentes.gateway';
import { ConexoesService } from './conexoes.service';
import type { GoogleDriveService } from './google-drive.service';
import { ErroDoAgente } from './sessao-agente';

const EMPRESA = 'e1';
const CHAVE = randomBytes(32);
const CHAVE_DRIVE = JSON.stringify({ type: 'service_account', client_email: 'c@p.iam.gserviceaccount.com', private_key: 'k' });

beforeAll(() => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://teste';
  process.env.CHAVE_CRIPTOGRAFIA = CHAVE.toString('base64');
});

function montar(conexao: Record<string, unknown> = {}) {
  const atual = { id: 'c1', agenteId: 'a1', nome: 'Pasta', tipo: 'PASTA', host: '', porta: 0, banco: 'C:\\Planilhas', usuario: '', senhaCifrada: null, opcoes: {}, ativo: true, criadoEm: new Date(), ...conexao };
  const prisma = {
    conexaoBanco: {
      findFirst: jest.fn(async ({ where }: { where: { empresaId: string } }) => (where.empresaId === EMPRESA ? atual : null)),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...atual, ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...atual, ...data })),
    },
    agente: { findFirst: jest.fn(async () => ({ id: 'a1' })) },
  };
  const requisitar = jest.fn(async (..._: unknown[]) => ({}) as unknown);
  const gateway = { enviarConfiguracao: jest.fn(async () => undefined), sessao: jest.fn(() => ({ requisitar })) };
  const drive = { listar: jest.fn(async () => [{ id: 'd1', nome: 'Preços', tamanho: null, modificadoEm: null }]), ler: jest.fn() };
  const servico = new ConexoesService(
    prisma as unknown as PrismaService,
    { registrar: jest.fn(async () => undefined) } as unknown as AuditoriaService,
    gateway as unknown as AgentesGateway,
    drive as unknown as GoogleDriveService,
  );
  return { servico, prisma, requisitar, gateway, drive };
}

describe('Conexão de pasta (agente)', () => {
  const dto = { nome: 'Pasta', tipo: 'PASTA' as const, agenteId: 'a1', banco: ' C:\\Planilhas ' };

  it('guarda o caminho e não pede servidor, porta nem usuário', async () => {
    const { servico, prisma, gateway } = montar();
    await servico.criar(EMPRESA, dto, 'u1');
    expect(prisma.conexaoBanco.create.mock.calls[0][0].data).toMatchObject({ tipo: 'PASTA', banco: 'C:\\Planilhas', host: '', porta: 0, usuario: '', senhaCifrada: null, agenteId: 'a1' });
    expect(gateway.enviarConfiguracao).toHaveBeenCalledWith('a1');
  });

  it('recusa caminho relativo', async () => {
    await expect(montar().servico.criar(EMPRESA, { ...dto, banco: 'Planilhas' }, 'u1')).rejects.toThrow(/caminho completo/);
    await expect(montar().servico.criar(EMPRESA, { ...dto, banco: '..\\Windows' }, 'u1')).rejects.toThrow(/caminho completo/);
  });

  it('lê pelo agente e limpa os títulos; a busca vai como termo', async () => {
    const { servico, requisitar } = montar();
    requisitar.mockResolvedValue({ abas: ['A', 'B'], aba: 'A', linhas: [['Código de Barras', 'Preço'], ['0789', 4.99]], truncado: false, duracaoMs: 1 });
    const r = await servico.lerPlanilha(EMPRESA, 'c1', { arquivo: 'p.xlsx', aba: null, termo: '789', limiteLinhas: 10 });
    expect(requisitar).toHaveBeenCalledWith('ler_arquivo', { conexaoId: 'c1', caminho: 'p.xlsx', aba: '', termo: '789', limiteLinhas: 10 }, expect.any(Number));
    expect(r.abas).toEqual(['A', 'B']);
    expect(r.resultado.colunas).toEqual([{ nome: 'codigo_de_barras', tipo: 'TEXT' }, { nome: 'preco', tipo: 'NUMERIC' }]);
    expect(r.resultado.linhas).toEqual([['0789', 4.99]]);
  });

  it('agente antigo: pede para atualizar', async () => {
    const { servico, requisitar } = montar();
    requisitar.mockRejectedValue(new ErroDoAgente('x', 'tipo de mensagem não suportado por esta versão do agente: listar_arquivos'));
    await expect(servico.listarArquivos(EMPRESA, 'c1')).rejects.toThrow(/desatualizado/);
  });

  it('não aceita SQL nem troca para banco; outra empresa não enxerga', async () => {
    const { servico, requisitar } = montar();
    await expect(servico.executar(EMPRESA, 'c1', 'SELECT 1', [], 10)).rejects.toThrow(/não aceita SQL/);
    await expect(servico.consultar(EMPRESA, 'c1', { sql: 'SELECT 1' }, 'u1')).rejects.toThrow(/não aceita SQL/);
    await expect(servico.atualizar(EMPRESA, 'c1', { tipo: 'POSTGRES' }, 'u1')).rejects.toThrow(/crie outra conexão/);
    await expect(servico.listarArquivos('e2', 'c1')).rejects.toThrow(/não encontrada/);
    expect(requisitar).not.toHaveBeenCalled();
  });
});

describe('Conexão Google Drive', () => {
  const dto = { nome: 'Drive', tipo: 'GOOGLE_DRIVE' as const, banco: 'https://drive.google.com/drive/folders/1AbCdEfGhIj', senha: CHAVE_DRIVE };

  it('sem agente: guarda o id da pasta, o e-mail da conta e a chave cifrada', async () => {
    const { servico, prisma, gateway } = montar();
    const r = await servico.criar(EMPRESA, dto, 'u1');
    const data = prisma.conexaoBanco.create.mock.calls[0][0].data as Record<string, string>;
    expect(data).toMatchObject({ agenteId: null, banco: '1AbCdEfGhIj', usuario: 'c@p.iam.gserviceaccount.com' });
    expect(data.senhaCifrada).not.toContain('service_account');
    expect(decifrar(data.senhaCifrada, CHAVE)).toBe(CHAVE_DRIVE);
    expect(JSON.stringify(r)).not.toContain('private_key');
    expect(gateway.enviarConfiguracao).not.toHaveBeenCalled();
  });

  it('recusa sem chave, chave errada e link que não é de pasta', async () => {
    await expect(montar().servico.criar(EMPRESA, { ...dto, senha: undefined }, 'u1')).rejects.toThrow(/chave JSON/);
    await expect(montar().servico.criar(EMPRESA, { ...dto, senha: '{"type":"outra"}' }, 'u1')).rejects.toThrow(/conta de serviço/);
    await expect(montar().servico.criar(EMPRESA, { ...dto, banco: 'https://mal.com/folders/x' }, 'u1')).rejects.toThrow(/link/);
  });

  it('testar e listar vão direto ao Drive, sem agente', async () => {
    const senhaCifrada = cifrar(CHAVE_DRIVE, CHAVE);
    const { servico, drive, gateway } = montar({ tipo: 'GOOGLE_DRIVE', agenteId: null, banco: 'p1', senhaCifrada });
    expect((await servico.testar(EMPRESA, 'c1')).versaoServidor).toContain('1 planilha');
    await servico.listarArquivos(EMPRESA, 'c1');
    expect(drive.listar).toHaveBeenCalledWith(CHAVE_DRIVE, 'p1');
    expect(gateway.sessao).not.toHaveBeenCalled();
  });

  it('filtra e limita a leitura como uma consulta', async () => {
    const { servico, drive } = montar({ tipo: 'GOOGLE_DRIVE', agenteId: null, banco: 'p1', senhaCifrada: cifrar(CHAVE_DRIVE, CHAVE) });
    drive.ler.mockResolvedValue(new Map([['Aba', { colunas: ['ean', 'nome'], linhas: [['0789', 'Arroz'], ['555', 'Feijão']] }]]));
    const achou = await servico.lerPlanilha(EMPRESA, 'c1', { arquivo: 'd1', aba: null, termo: '789', limiteLinhas: 10 });
    expect(achou.resultado.linhas).toEqual([['0789', 'Arroz']]);
    const limitada = await servico.lerPlanilha(EMPRESA, 'c1', { arquivo: 'd1', aba: 'Aba', termo: null, limiteLinhas: 1 });
    expect(limitada.resultado.truncado).toBe(true);
    await expect(servico.lerPlanilha(EMPRESA, 'c1', { arquivo: 'd1', aba: 'Nada', termo: null, limiteLinhas: 1 })).rejects.toThrow(/não existe/);
  });
});
