import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { codigoDoVinculoDaTela, codigoParaLer, MODELOS_RESOLUCAO, ROTULO_EQUIPAMENTO, TIPOS_EQUIPAMENTO, type PedidoTelaLido, type PerfilTelaResumo, type TelaResumo, type TipoEquipamento } from '@etiquetas/shared';
import { api } from '../../api';
import { ExigeEmpresa } from '../../components/ExigeEmpresa';
import { Alerta, Botao, Cabecalho, Campo, Selecao } from '../../components/ui';

const NOVO = 'novo';

export function VincularTela() {
  return (
    <ExigeEmpresa>
      <Formulario />
    </ExigeEmpresa>
  );
}

/** Aberto pelo QR da TV ou pelo botão da tela Telas: é aqui que se define qual equipamento é aquele. */
function Formulario() {
  const navegar = useNavigate();
  const [digitado, setDigitado] = useState(() => codigoDoVinculoDaTela(window.location.hash) ?? '');
  const codigo = codigoDoVinculoDaTela(digitado);
  const [substituir, setSubstituir] = useState('');
  const [nome, setNome] = useState('');
  const [local, setLocal] = useState('');
  const [perfilId, setPerfilId] = useState('');
  const [novo, setNovo] = useState<{ nome: string; tipo: TipoEquipamento; largura: string; altura: string }>({ nome: '', tipo: 'TV', largura: '', altura: '' });

  const { data: pedido, error: erroPedido, isFetching } = useQuery({
    queryKey: ['tela-pedido', codigo],
    queryFn: () => api<PedidoTelaLido>(`/telas/pedidos/${codigo}`),
    enabled: !!codigo,
    retry: false,
  });
  const { data: perfis = [] } = useQuery({ queryKey: ['telas-perfis'], queryFn: () => api<PerfilTelaResumo[]>('/telas/perfis') });
  const { data: telas = [] } = useQuery({ queryKey: ['telas'], queryFn: () => api<TelaResumo[]>('/telas') });

  // O que a TV detectou já vem preenchido; quem vincula só confere.
  useEffect(() => {
    if (!pedido) return;
    setPerfilId(pedido.perfilSugeridoId ?? NOVO);
    setNovo((n) => ({ ...n, largura: String(pedido.largura), altura: String(pedido.altura), nome: n.nome || `Tela ${pedido.largura}×${pedido.altura}` }));
  }, [pedido]);

  const vincular = useMutation({
    mutationFn: () =>
      api('/telas/vincular', {
        metodo: 'POST',
        corpo: substituir
          ? { codigo, telaId: substituir }
          : { codigo, nome, local, ...(perfilId === NOVO ? { novoPerfil: { nome: novo.nome, tipo: novo.tipo, largura: Number(novo.largura), altura: Number(novo.altura) } } : { perfilId }) },
      }),
    onSuccess: () => navegar('/telas'),
  });

  return (
    <>
      <Cabecalho titulo="Vincular tela" descricao="Abra o link /tv no equipamento e use o QR ou o código que aparece nele." />
      <form
        className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          vincular.mutate();
        }}
      >
        <Campo rotulo="Código que aparece na tela" value={digitado} onChange={(e) => setDigitado(e.target.value)} placeholder="K7M2-9QXT" autoComplete="off" />
        {!!digitado && !codigo && <Alerta tipo="aviso">O código tem 8 letras e números.</Alerta>}
        {erroPedido && <Alerta>{(erroPedido as Error).message}</Alerta>}
        {isFetching && <p className="text-sm text-slate-500">Conferindo o código…</p>}

        {pedido && codigo && (
          <>
            <Alerta tipo="info">
              Tela {codigoParaLer(codigo)}: informa {pedido.largura}×{pedido.altura}
              {pedido.escala && pedido.escala !== 1 ? `, escala ${pedido.escala}` : ''}. Confira se é o mesmo código que está nela.
            </Alerta>
            <Selecao rotulo="Este equipamento é" value={substituir} onChange={(e) => setSubstituir(e.target.value)}>
              <option value="">Uma tela nova</option>
              {telas.map((t) => (
                <option key={t.id} value={t.id}>
                  Substituir “{t.nome}”
                </option>
              ))}
            </Selecao>

            {substituir ? (
              <p className="text-sm text-slate-600">O equipamento novo herda a configuração, e o antigo perde o acesso e volta a mostrar o QR.</p>
            ) : (
              <>
                <Campo rotulo="Nome da tela" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="TV do açougue" required minLength={2} maxLength={80} />
                <Campo rotulo="Local" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Loja centro, entrada" maxLength={120} />
                <Selecao rotulo="Perfil de resolução" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
                  {perfis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} ({p.largura}×{p.altura})
                    </option>
                  ))}
                  <option value={NOVO}>Criar um perfil novo</option>
                </Selecao>
                {perfilId === NOVO && (
                  <div className="space-y-3 rounded-md border border-slate-200 p-3">
                    <Selecao
                      rotulo="Partir de um modelo"
                      value=""
                      onChange={(e) => {
                        const m = MODELOS_RESOLUCAO.find((x) => x.nome === e.target.value);
                        if (m) setNovo({ nome: m.nome, tipo: m.tipo, largura: String(m.largura), altura: String(m.altura) });
                      }}
                    >
                      <option value="">Usar o que a tela informou</option>
                      {MODELOS_RESOLUCAO.map((m) => (
                        <option key={m.nome} value={m.nome}>
                          {m.nome} ({m.largura}×{m.altura})
                        </option>
                      ))}
                    </Selecao>
                    <Campo rotulo="Nome do perfil" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required minLength={2} maxLength={80} />
                    <Selecao rotulo="Equipamento" value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoEquipamento })}>
                      {TIPOS_EQUIPAMENTO.map((t) => (
                        <option key={t} value={t}>
                          {ROTULO_EQUIPAMENTO[t]}
                        </option>
                      ))}
                    </Selecao>
                    <div className="grid grid-cols-2 gap-3">
                      <Campo rotulo="Largura (pixels)" type="number" min={32} value={novo.largura} onChange={(e) => setNovo({ ...novo, largura: e.target.value })} required />
                      <Campo rotulo="Altura (pixels)" type="number" min={32} value={novo.altura} onChange={(e) => setNovo({ ...novo, altura: e.target.value })} required />
                    </div>
                  </div>
                )}
              </>
            )}
            {vincular.error && <Alerta>{(vincular.error as Error).message}</Alerta>}
            <Botao type="submit" disabled={vincular.isPending}>
              {substituir ? 'Substituir equipamento' : 'Vincular tela'}
            </Botao>
          </>
        )}
      </form>
    </>
  );
}
