import { createServer, type Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { expect } from '@playwright/test';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Serve a private copy of dist/ so a test can publish a "new version" mid-session. */
export async function serveDistCopy(port: number): Promise<{ dir: string; server: Server; publishNewVersion: (marker: string) => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'daybook-dist-'));
  cpSync('dist', dir, { recursive: true });
  const server = createServer((req, res) => {
    let p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(port, () => r()));
  const publishNewVersion = (marker: string) => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8').replace('</head>', `<meta name="build-marker" content="${marker}"></head>`);
    writeFileSync(join(dir, 'index.html'), html);
    const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
    const sw2 = sw.replace(/(url:"index\.html",revision:")[^"]+"/, `$1${marker}"`);
    expect(sw2).not.toBe(sw);
    writeFileSync(join(dir, 'sw.js'), sw2);
  };
  return { dir, server, publishNewVersion };
}
