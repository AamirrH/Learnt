import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/questions.js', ['questions.js', 'text/javascript; charset=utf-8']],
]);

export function createApp() {
  return createServer(async (request, response) => {
    const path = request.url.split('?', 1)[0];
    const asset = request.method === 'GET' && assets.get(path);
    if (!asset) {
      response.writeHead(404).end('Not found');
      return;
    }

    try {
      const [file, contentType] = asset;
      const body = await readFile(new URL(`./public/${file}`, import.meta.url));
      response.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      }).end(body);
    } catch {
      response.writeHead(500).end('Could not load the workspace.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Learnt is available at http://127.0.0.1:${port}`);
  });
}
