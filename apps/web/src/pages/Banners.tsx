import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BannerPublicitario } from '@etiquetas/shared';
import { api } from '../api';
import { Alerta, Botao, Cabecalho, Campo, Modal, Selo, Tabela } from '../components/ui';

const MAX_ARQUIVO = 1_000_000;
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const hojeLocal = () => new Date().toLocaleDateString('sv');

type Edicao = { banner: BannerPublicitario | null } | null;

function situacao(b: BannerPublicitario, hoje: string): { texto: string; cor: 'verde' | 'amarelo' | 'cinza' } {
  if (!b.ativo) return { texto: 'Inativo', cor: 'cinza' };
  if (b.inicio > hoje) return { texto: 'Agendado', cor: 'amarelo' };
  if (b.fim && b.fim < hoje) return { texto: 'Encerrado', cor: 'cinza' };
  return { texto: 'No ar', cor: 'verde' };
}

export function Banners() {
  const cliente = useQueryClient();
  const [edicao, setEdicao] = useState<Edicao>(null);
  const { data: banners = [], isLoading, error } = useQuery({ queryKey: ['banners'], queryFn: () => api<BannerPublicitario[]>('/banners') });
  const excluir = useMutation({
    mutationFn: (id: string) => api(`/banners/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['banners'] });
      void cliente.invalidateQueries({ queryKey: ['banners-vigentes'] });
    },
  });

  const hoje = hojeLocal();
  const noAr = banners.filter((b) => situacao(b, hoje).texto === 'No ar');
  const receita = noAr.reduce((soma, b) => soma + b.valorMensal, 0);

  return (
    <>
      <Cabecalho
        titulo="Banners"
        descricao={`Propaganda nas telas de todas as empresas. No ar: ${noAr.length}, somando ${moeda(receita)} por mês.`}
        acoes={<Botao onClick={() => setEdicao({ banner: null })}>Novo banner</Botao>}
      />
      <div className="space-y-4">
        {(error ?? excluir.error) && <Alerta>{(error ?? excluir.error)!.message}</Alerta>}
        {!isLoading && (
          <Tabela colunas={['Anunciante', 'Período', 'Valor por mês', 'Exibições', 'Cliques', 'Situação', '']} vazio={banners.length === 0}>
            {banners.map((b) => {
              const s = situacao(b, hoje);
              return (
                <tr key={b.id}>
                  <td className="px-4 py-2.5 align-top">
                    <div className="font-medium">{b.anunciante}</div>
                    {b.contato && <div className="text-xs text-slate-500">{b.contato}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top text-slate-600">{dataBr(b.inicio)} a {b.fim ? dataBr(b.fim) : 'sem fim'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top">{moeda(b.valorMensal)}</td>
                  <td className="px-4 py-2.5 align-top">{b.exibicoes}</td>
                  <td className="px-4 py-2.5 align-top">{b.cliques}</td>
                  <td className="px-4 py-2.5 align-top"><Selo cor={s.cor}>{s.texto}</Selo></td>
                  <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right align-top">
                    <Botao variante="secundario" aria-label={`Editar ${b.anunciante}`} onClick={() => setEdicao({ banner: b })}>Editar</Botao>
                    <Botao variante="secundario" aria-label={`Excluir ${b.anunciante}`} disabled={excluir.isPending} onClick={() => window.confirm(`Excluir o banner de ${b.anunciante}? Os números de exibições e cliques também se perdem.`) && excluir.mutate(b.id)}>
                      Excluir
                    </Botao>
                  </td>
                </tr>
              );
            })}
          </Tabela>
        )}
      </div>

      <Modal titulo={edicao?.banner ? `Editar ${edicao.banner.anunciante}` : 'Novo banner'} aberto={edicao !== null} aoFechar={() => setEdicao(null)}>
        {edicao && <FormBanner banner={edicao.banner} aoConcluir={() => setEdicao(null)} />}
      </Modal>
    </>
  );
}

function FormBanner({ banner, aoConcluir }: { banner: BannerPublicitario | null; aoConcluir: () => void }) {
  const cliente = useQueryClient();
  const [erroArquivo, setErroArquivo] = useState('');
  const [f, setF] = useState({
    anunciante: banner?.anunciante ?? '',
    contato: banner?.contato ?? '',
    texto: banner?.texto ?? '',
    imagem: banner?.imagem ?? '',
    link: banner?.link ?? '',
    valorMensal: banner ? String(banner.valorMensal).replace('.', ',') : '',
    inicio: banner?.inicio ?? hojeLocal(),
    fim: banner?.fim ?? '',
    ativo: banner?.ativo ?? true,
  });
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, valorMensal: Number(f.valorMensal.replace(',', '.')) || 0, imagem: f.imagem || null, link: f.link || null, fim: f.fim || null };
      return banner ? api(`/banners/${banner.id}`, { metodo: 'PATCH', corpo }) : api('/banners', { metodo: 'POST', corpo });
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['banners'] });
      void cliente.invalidateQueries({ queryKey: ['banners-vigentes'] });
      aoConcluir();
    },
  });

  function escolherImagem(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    setErroArquivo('');
    if (!arquivo) return;
    if (arquivo.size > MAX_ARQUIVO) {
      setErroArquivo('A imagem passa de 1 MB.');
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setF((atual) => ({ ...atual, imagem: String(leitor.result) }));
    leitor.readAsDataURL(arquivo);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {salvar.error && <Alerta>{salvar.error.message}</Alerta>}
      {erroArquivo && <Alerta>{erroArquivo}</Alerta>}
      <Campo rotulo="Anunciante" required value={f.anunciante} onChange={(e) => setF({ ...f, anunciante: e.target.value })} />
      <Campo rotulo="Contato do anunciante" value={f.contato} onChange={(e) => setF({ ...f, contato: e.target.value })} ajuda="Só você vê. Telefone ou e-mail para a cobrança." />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Imagem</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={escolherImagem} className="block w-full text-sm" />
        <span className="mt-1 block text-xs text-slate-500">PNG, JPEG, WebP ou GIF de até 1 MB. Sugestão: 970 × 90 pixels; aparece com até 96 pixels de altura.</span>
      </label>
      {f.imagem && (
        <div className="space-y-1">
          <img src={f.imagem} alt="Prévia do banner" className="max-h-24 max-w-full rounded border border-slate-200 object-contain" />
          <Botao variante="secundario" onClick={() => setF({ ...f, imagem: '' })}>Tirar imagem</Botao>
        </div>
      )}
      <Campo rotulo="Texto" maxLength={200} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} ajuda="Aparece no lugar da imagem, se não houver uma. Com imagem, é a descrição para leitores de tela." />
      <Campo rotulo="Link" type="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} ajuda="Opcional. Abre em outra aba ao clicar: https://…" />
      <Campo rotulo="Valor por mês (R$)" inputMode="decimal" value={f.valorMensal} onChange={(e) => setF({ ...f, valorMensal: e.target.value })} ajuda="Só para o seu controle: nada é cobrado automaticamente." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Início" type="date" required value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        <Campo rotulo="Fim" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} ajuda="Vazio: sem data para sair." />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
        Ativo
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoConcluir}>Cancelar</Botao>
        <Botao type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</Botao>
      </div>
    </form>
  );
}
