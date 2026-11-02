// Usa o APK no emulador como uma pessoa usaria: toca, digita e tira print de cada passo.
// Nada para no primeiro problema: o objetivo é mostrar tudo o que acontece. Falhas ficam no resumo.
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const PACOTE = 'br.com.etiquetas.app';
const API = 'http://127.0.0.1:3000/api';
const fluxo = JSON.parse(readFileSync('saida-fluxo/fluxo.json', 'utf8'));
const falhas = [];
let passo = 0;

// O importante é publicar os prints: erro inesperado vira falha no resumo, não para o job.
const encerrar = (e) => {
  falhas.push(`erro no teste: ${e?.message ?? e}`.slice(0, 400));
  appendFileSync('saida-fluxo/fluxo.log', `ERRO: ${e?.stack ?? e}${String.fromCharCode(10)}`);
  writeFileSync('saida-fluxo/resumo.txt', falhas.join(String.fromCharCode(10)));
  console.log(`::warning title=Fluxo real::${falhas.join(' ; ').slice(0, 800)}`);
  process.exit(0);
};
process.on('uncaughtException', encerrar);
process.on('unhandledRejection', encerrar);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args) => execSync(`adb ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const log = (t) => {
  console.log(t);
  appendFileSync('saida-fluxo/fluxo.log', `${t}\n`);
};

function print(nome) {
  passo++;
  const arquivo = `saida-fluxo/${String(passo).padStart(2, '0')}-${nome}.png`;
  writeFileSync(arquivo, execSync('adb exec-out screencap -p', { maxBuffer: 50 * 1024 * 1024 }));
  log(`print: ${arquivo}`);
}

function lerTela() {
  try {
    adb('shell uiautomator dump /sdcard/tela.xml');
    return adb('exec-out cat /sdcard/tela.xml');
  } catch {
    return '';
  }
}

const textosDaTela = (xml) => [...xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map((m) => m[1]);

function centro(xml, texto) {
  const alvo = texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<node[^>]*(?:text|content-desc)="[^"]*${alvo}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
  return m ? [Math.round((+m[1] + +m[3]) / 2), Math.round((+m[2] + +m[4]) / 2)] : null;
}

async function aguardar(texto, tempoMs = 30_000) {
  const fim = Date.now() + tempoMs;
  while (Date.now() < fim) {
    if (centro(lerTela(), texto)) return true;
    await espera(1000);
  }
  return false;
}

/** Espera o texto e toca nele. */
async function tocar(texto, tempoMs = 30_000) {
  const fim = Date.now() + tempoMs;
  while (Date.now() < fim) {
    const c = centro(lerTela(), texto);
    if (c) {
      adb(`shell input tap ${c[0]} ${c[1]}`);
      log(`tocou: ${texto}`);
      await espera(1200);
      return true;
    }
    await espera(1000);
  }
  falha(`não achou para tocar: ${texto}`);
  return false;
}

function falha(motivo) {
  falhas.push(motivo);
  log(`FALHA: ${motivo}`);
  log(`  na tela: ${textosDaTela(lerTela()).slice(0, 40).join(' | ')}`);
}

async function confere(texto, tempoMs = 30_000) {
  if (await aguardar(texto, tempoMs)) return log(`ok: ${texto}`);
  falha(`não apareceu: ${texto}`);
}

async function digitar(rotulo, valor) {
  if (!(await tocar(rotulo))) return;
  adb(`shell input text ${JSON.stringify(valor)}`);
  await espera(800);
  log(`digitou em ${rotulo}: ${valor}`);
}

async function api(caminho) {
  const r = await fetch(API + caminho, { headers: { authorization: `Bearer ${fluxo.token}`, 'x-forwarded-for': '10.2.0.1' } });
  return r.json();
}

// ---- Instalação: logo depois de ligar, o emulador pode recusar por ainda estar subindo ----
const APK = 'android/app/build/outputs/apk/release/app-release.apk';
if (!existsSync(APK)) throw new Error(`APK não encontrado: ${execSync('ls android/app/build/outputs/apk/* || true', { encoding: 'utf8', shell: '/bin/bash' })}`);
for (let tentativa = 1; ; tentativa++) {
  try {
    log(execSync(`adb wait-for-device install -r ${APK} 2>&1`, { encoding: 'utf8', timeout: 180_000 }).trim());
    break;
  } catch (e) {
    log(`instalação, tentativa ${tentativa}: ${e.stdout ?? e.message}`);
    if (tentativa >= 5) throw new Error(`o APK não instalou: ${e.stdout ?? e.message}`);
    await espera(15_000);
  }
}

// ---- Vínculo, pelo mesmo link que o QR abre ----
try {
  adb('logcat -c');
} catch {
  // Alguns emuladores recusam limpar o log; só fica mais comprido.
}
const link = `etiquetas://vincular?servidor=${encodeURIComponent('http://10.0.2.2:3000')}&codigo=${fluxo.codigo}`;
adb(`shell am start -a android.intent.action.VIEW -d "'${link}'" ${PACOTE}`);
await espera(3000);
await confere('Vincular', 90_000);
print('confirmar-vinculo');
await tocar('Vincular');
// O Android pergunta sobre notificações na primeira vez.
if (await aguardar('Allow', 10_000)) await tocar('Allow');
await confere('Mercado Fluxo', 30_000);
print('inicio');

// ---- Lista do dia ----
await tocar('Lista do dia');
await confere('pendente');
await espera(1500);
print('lista');
await confere('Café torrado');

// ---- Etiqueta avulsa ----
await tocar('Etiqueta avulsa');
await espera(3000);
print('avulsa-aberta');
log(`tela da avulsa: ${textosDaTela(lerTela()).join(' | ')}`);
await confere('Código de barras, código ou nome', 15_000);
await digitar('Código de barras, código ou nome', '7891000100103');
print('avulsa-digitado');
adb('shell input keyevent 4'); // Fecha o teclado, como uma pessoa faria para ver a tela.
await espera(800);
await tocar('Buscar');
await espera(4000);
print('avulsa-buscou');
await confere('Café torrado', 20_000);
print('avulsa-na-lista');
await tocar('Imprimir');
await espera(1500);
print('avulsa-confirmar');
{
  // Botão de confirmar do diálogo do Android, pelo id: o texto muda de caixa conforme a versão.
  const m = /resource-id="android:id\/button1"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(lerTela());
  if (m) adb(`shell input tap ${Math.round((+m[1] + +m[3]) / 2)} ${Math.round((+m[2] + +m[4]) / 2)}`);
  else falha('o diálogo de confirmar impressão não apareceu');
}
await espera(5000);
print('avulsa-enviada');
await confere('enviada', 15_000);

// Consulta sem parâmetro, saindo em PDF: o caso do cliente real.
await tocar('Tabela sem parametro');
await tocar('Cartazes');
await digitar('Código de barras, código ou nome', '7891000100110');
adb('shell input keyevent 4');
await espera(800);
await tocar('Buscar');
await confere('Arroz branco', 20_000);
print('avulsa-sem-parametro');
await tocar('Gerar PDF');
await espera(1500);
{
  const m = /resource-id="android:id\/button1"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(lerTela());
  if (m) adb(`shell input tap ${Math.round((+m[1] + +m[3]) / 2)} ${Math.round((+m[2] + +m[4]) / 2)}`);
  else falha('o diálogo de gerar PDF não apareceu');
}
await espera(6000);
print('pdf-compartilhar');
log(`tela depois do PDF: ${textosDaTela(lerTela()).slice(0, 30).join(' | ')}`);
// A tela do Android para abrir o PDF fica por cima: volta para o app.
if (!centro(lerTela(), 'Etiqueta avulsa')) adb('shell input keyevent 4');
await espera(1500);
await confere('gerado', 10_000);
print('pdf-gerado');

// Câmera: abre e volta (o emulador não tem código de barras para ler).
if (await tocar('Ler código com a câmera', 8000)) {
  if (await aguardar('While using', 5000)) await tocar('While using');
  await espera(3000);
  print('camera');
  await confere('Aponte para o código de barras', 10_000);
  await tocar('Cancelar', 8000);
}

// ---- O que o servidor viu ----
await espera(6000);
const trabalhos = await api('/trabalhos');
log(`trabalhos no servidor: ${JSON.stringify(Array.isArray(trabalhos) ? trabalhos.map((t) => [t.origem, t.status, t.quantidadeEtiquetas, t.erro]) : trabalhos)}`);
if (!Array.isArray(trabalhos) || !trabalhos.some((t) => t.origem === 'AVULSA')) falha('nenhum trabalho AVULSA chegou ao servidor');
if (Array.isArray(trabalhos) && !trabalhos.some((t) => t.origem === 'AVULSA' && t.status === 'CONCLUIDO')) falha('o trabalho AVULSA não foi concluído');
let bytes = '0';
try {
  bytes = readFileSync('saida-fluxo/impressora.txt', 'utf8');
} catch {
  // Nada chegou.
}
log(`bytes na impressora simulada: ${bytes}`);
if (bytes === '0') falha('nada chegou à impressora simulada');

try {
  writeFileSync('saida-fluxo/logcat.txt', execSync('adb logcat -d -s ReactNativeJS:V AndroidRuntime:E', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }));
} catch {
  // Sem log, seguem os prints.
}
const vivo = (() => {
  try {
    adb(`shell pidof ${PACOTE}`);
    return true;
  } catch {
    return false;
  }
})();
if (!vivo) falha('o processo do app morreu');

writeFileSync('saida-fluxo/resumo.txt', falhas.length ? falhas.join('\n') : 'tudo certo');
console.log(falhas.length ? `::warning title=Fluxo real::${falhas.length} falha(s): ${falhas.join(' ; ').slice(0, 800)}` : '::notice title=Fluxo real::Vínculo, lista, avulsa e impressão funcionaram no emulador.');
process.exit(0);
