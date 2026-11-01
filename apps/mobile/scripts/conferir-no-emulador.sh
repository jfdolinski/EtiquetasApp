#!/usr/bin/env bash
# Instala o APK no emulador e confere que ele abre na tela de vínculo, sem travar.
# Falha vira anotação no GitHub, com o motivo.
set -u
apk="$1"
pacote=br.com.etiquetas.app
mkdir -p saida-emulador

falhar() {
  adb logcat -d -s AndroidRuntime:E ReactNativeJS:E > saida-emulador/erros.txt 2>/dev/null
  resumo=$(tr '\n' ' ' < saida-emulador/erros.txt | cut -c1-900)
  echo "::error title=Emulador::$1 $resumo"
  exit 1
}

adb install -r "$apk" || falhar "O APK não instalou."
adb logcat -c
adb shell monkey -p "$pacote" -c android.intent.category.LAUNCHER 1 >/dev/null || falhar "O app não abriu."

# Primeira abertura num emulador sem aceleração completa demora.
achou=""
for _ in $(seq 1 40); do
  sleep 3
  adb shell pidof "$pacote" >/dev/null || falhar "O processo do app morreu."
  # Permissão de notificação pode aparecer por cima; a tela de vínculo não pede antes de vincular.
  adb shell uiautomator dump /sdcard/tela.xml >/dev/null 2>&1
  adb pull /sdcard/tela.xml saida-emulador/tela.xml >/dev/null 2>&1
  if grep -q 'Digitar o código' saida-emulador/tela.xml 2>/dev/null; then
    achou=1
    break
  fi
done
[ -n "$achou" ] || falhar "A tela de vínculo não apareceu."

# Fluxo real: a tela de digitar abre e o campo aceita texto.
adb shell uiautomator dump /sdcard/tela.xml >/dev/null 2>&1
adb pull /sdcard/tela.xml saida-emulador/tela.xml >/dev/null 2>&1
limites=$(grep -o 'content-desc="Digitar o código"[^>]*bounds="[^"]*"' saida-emulador/tela.xml | grep -o 'bounds="[^"]*"' | head -1 | tr -dc '0-9,[]')
x=$(echo "$limites" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\1 \3/' | awk '{print int(($1+$2)/2)}')
y=$(echo "$limites" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\2 \4/' | awk '{print int(($1+$2)/2)}')
adb shell input tap "$x" "$y"
sleep 3
adb shell uiautomator dump /sdcard/tela.xml >/dev/null 2>&1
adb pull /sdcard/tela.xml saida-emulador/tela.xml >/dev/null 2>&1
grep -q 'Endereço do sistema' saida-emulador/tela.xml || falhar "A tela de digitar o código não abriu."

adb shell pidof "$pacote" >/dev/null || falhar "O app travou depois de navegar."
echo "::notice title=Emulador::O APK instalou, abriu na tela de vínculo e navegou sem travar."
