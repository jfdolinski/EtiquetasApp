import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Keyboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BannerVigente } from '../../../packages/shared/src/tipos';
import type { Api } from './api';
import { contaExibicao, linkDeBannerValido } from './regras';
import { cores } from './ui';

const TROCA_MS = 30_000;
const ATUALIZAR_MS = 10 * 60_000;

/** Espaço pago: não tem botão de fechar. Com mais de um anunciante, revezam, como no site. */
export function BannerPublicidade({ api }: { api: Api }) {
  const [banners, setBanners] = useState<BannerVigente[]>([]);
  const [indice, setIndice] = useState(0);
  // Aberto, o teclado já deixa pouco espaço para a lista e o botão de imprimir.
  const [tecladoAberto, setTecladoAberto] = useState(false);
  const contados = useRef(new Map<string, number>());

  useEffect(() => {
    const buscar = () => {
      if (AppState.currentState === 'active') void api<BannerVigente[]>('/banners/vigentes').then(setBanners).catch(() => undefined);
    };
    buscar();
    const t = setInterval(buscar, ATUALIZAR_MS);
    return () => clearInterval(t);
  }, [api]);

  useEffect(() => {
    const abriu = Keyboard.addListener('keyboardDidShow', () => setTecladoAberto(true));
    const fechou = Keyboard.addListener('keyboardDidHide', () => setTecladoAberto(false));
    return () => {
      abriu.remove();
      fechou.remove();
    };
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => setIndice((i) => i + 1), TROCA_MS);
    return () => clearInterval(t);
  }, [banners.length]);

  const banner = banners.length ? banners[indice % banners.length] : null;
  const visivel = banner !== null && !tecladoAberto;

  useEffect(() => {
    if (!banner || !visivel || AppState.currentState !== 'active') return;
    const agora = Date.now();
    if (!contaExibicao(contados.current.get(banner.id), agora)) return;
    contados.current.set(banner.id, agora);
    void api(`/banners/${banner.id}/exibicao`, { metodo: 'POST' }).catch(() => undefined);
  }, [banner, visivel, api]);

  if (!visivel) return null;

  const conteudo = banner.imagem ? (
    <Image source={{ uri: banner.imagem }} resizeMode="contain" style={estilos.imagem} accessibilityLabel={banner.texto || banner.anunciante} />
  ) : (
    <Text style={estilos.texto} numberOfLines={2} ellipsizeMode="tail">{banner.texto}</Text>
  );

  function abrir(link: string) {
    void api(`/banners/${banner!.id}/clique`, { metodo: 'POST' }).catch(() => undefined);
    void Linking.openURL(link).catch(() => undefined);
  }

  return (
    <View accessibilityLabel="Publicidade" style={estilos.espaco}>
      {linkDeBannerValido(banner.link) ? (
        <Pressable accessibilityRole="link" accessibilityLabel={banner.texto || banner.anunciante} onPress={() => abrir(banner.link!)}>
          {conteudo}
        </Pressable>
      ) : (
        conteudo
      )}
      <Text style={estilos.rotulo} numberOfLines={1}>Publicidade · {banner.anunciante}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  espaco: { backgroundColor: cores.branco, borderTopWidth: 1, borderTopColor: cores.borda, paddingTop: 4, paddingHorizontal: 8 },
  imagem: { width: '100%', height: 56 },
  texto: { textAlign: 'center', fontSize: 14, fontWeight: '500', color: cores.texto, paddingVertical: 6 },
  rotulo: { textAlign: 'right', fontSize: 10, color: cores.suave, paddingBottom: 2 },
});
