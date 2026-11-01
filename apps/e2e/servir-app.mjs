// Serve o build web do aplicativo (apps/mobile/dist) para os testes de tela do celular.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RAIZ = new URL('../mobile/dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };

createServer(async (req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  for (const arquivo of [caminho === '' || caminho === '.' ? 'index.html' : caminho, 'index.html']) {
    try {
      const dados = await readFile(join(RAIZ, arquivo));
      res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
      return res.end(dados);
    } catch {
      // Tenta o próximo: rota do app cai no index.html.
    }
  }
  res.writeHead(404).end();
}).listen(8099);
