/**
 * Daybook for Mac — a self-contained launcher. Serves the embedded web app on
 * http://127.0.0.1:47823 (loopback only) and opens it in the default browser.
 * Trade data never touches this process: it lives in the browser's IndexedDB for that
 * address, exactly like the hosted version. The port is fixed on purpose — browser data
 * is tied to the exact address.
 */
import { assets } from './.generated/assets';

const HOST = '127.0.0.1';
const PORT = Number(process.env.DAYBOOK_PORT ?? 47823);
const URL_ = `http://${HOST}:${PORT}/`;
const HEALTH = '/__daybook';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webmanifest: 'application/manifest+json',
};

function openBrowser() {
  if (process.env.DAYBOOK_NO_BROWSER) return;
  Bun.spawn(['open', URL_]);
}

function alert(message: string) {
  if (process.platform !== 'darwin') return console.error(message);
  Bun.spawnSync(['osascript', '-e', `display alert "Daybook" message ${JSON.stringify(message)} as critical`]);
}

async function alreadyRunning(): Promise<boolean> {
  try {
    const r = await fetch(URL_ + HEALTH.slice(1), { signal: AbortSignal.timeout(800) });
    return (await r.text()) === 'daybook';
  } catch {
    return false;
  }
}

if (await alreadyRunning()) {
  // A second launch just brings the app back up.
  openBrowser();
  process.exit(0);
}

const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);

try {
  Bun.serve({
    hostname: HOST,
    port: PORT,
    fetch(req) {
      // Refuse requests whose Host header isn't ours (blocks DNS-rebinding pages)
      if (!allowedHosts.has(req.headers.get('host') ?? '')) return new Response('Forbidden', { status: 403 });
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      let path = new URL(req.url).pathname;
      if (path === HEALTH) return new Response('daybook');
      if (path.endsWith('/')) path += 'index.html';
      const file = assets[decodeURIComponent(path.slice(1))];
      if (!file) return new Response('Not found', { status: 404 });
      const ext = path.split('.').pop() ?? '';
      const revalidate = ext === 'html' || ext === 'webmanifest' || path === '/sw.js';
      return new Response(Bun.file(file), {
        headers: {
          'content-type': TYPES[ext] ?? 'application/octet-stream',
          'cache-control': revalidate ? 'no-cache' : 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY',
        },
      });
    },
  });
} catch (e) {
  alert(`Daybook could not start: port ${PORT} is used by another program.\n\n${(e as Error).message}`);
  process.exit(1);
}

console.log(`Daybook running at ${URL_}`);
openBrowser();
