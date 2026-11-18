import * as ImagePicker from 'expo-image-picker';

/** Foto (câmera ou galeria) como data URL, reduzida para caber nos 5 MB da API. */
export async function escolherImagem(origem: 'camera' | 'galeria'): Promise<string | null> {
  const opcoes: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, base64: true, exif: false };
  if (origem === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('Permita o uso da câmera nas configurações do celular.');
  }
  const r = origem === 'camera' ? await ImagePicker.launchCameraAsync(opcoes) : await ImagePicker.launchImageLibraryAsync(opcoes);
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  if (a.base64) return `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}`;
  // No navegador o endereço já é a imagem.
  return a.uri.startsWith('data:') ? a.uri : null;
}
