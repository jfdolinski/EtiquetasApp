#!/usr/bin/env bash
# Instala o APK no emulador e confere que ele abre na tela de entrada e vai para o cadastro, sem travar.
# Falha vira anotação no GitHub, com o motivo.
set -u
apk="$1"
pacote=br.com.etiquetas.entregador
mkdir -p saida-emulador

falhar() {
  adb logcat -d -s AndroidRuntime:E ReactNativeJS:E > saida-emulador/erros.txt 2>/dev/null
  resumo=$(tr '\n' ' ' < saida-emulador/erros.txt | cut -c1-900)
  echo "::error title=Emulador::$1 $resumo"
  exit 1
}

tela() {
  adb shell uiautomator dump /sdcard/tela.xml >/dev/null 2>&1
  adb pull /sdcard/tela.xml saida-emulador/tela.xml >/dev/null 2>&1
}

# Centro do elemento com o texto (atributo text ou content-desc).
tocar() {
  limites=$(grep -o "\(text\|content-desc\)=\"$1\"[^>]*bounds=\"[^\"]*\"" saida-emulador/tela.xml | grep -o 'bounds="[^"]*"' | head -1 | tr -dc '0-9,[]')
  [ -n "$limites" ] || return 1
  x=$(echo "$limites" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\1 \3/' | awk '{print int(($1+$2)/2)}')
  y=$(echo "$limites" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\2 \4/' | awk '{print int(($1+$2)/2)}')
  adb shell input tap "$x" "$y"
}

adb install -r "$apk" || falhar "O APK não instalou."
adb logcat -c
adb shell monkey -p "$pacote" -c android.intent.category.LAUNCHER 1 >/dev/null || falhar "O app não abriu."

# Primeira abertura num emulador sem aceleração completa demora.
achou=""
for _ in $(seq 1 40); do
  sleep 3
  adb shell pidof "$pacote" >/dev/null || falhar "O processo do app morreu."
  tela
  if grep -q 'Quero me cadastrar' saida-emulador/tela.xml 2>/dev/null; then
    achou=1
    break
  fi
done
[ -n "$achou" ] || falhar "A tela de entrada não apareceu."

tocar 'Quero me cadastrar' || falhar "Não achei a guia de cadastro."
sleep 3
tela
grep -q 'Nome completo' saida-emulador/tela.xml || falhar "O formulário de cadastro não abriu."

adb shell pidof "$pacote" >/dev/null || falhar "O app travou depois de navegar."
echo "::notice title=Emulador::O APK instalou, abriu na tela de entrada e navegou até o cadastro sem travar."
