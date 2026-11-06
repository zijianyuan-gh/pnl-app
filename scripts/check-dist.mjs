// Release gate: the production build must contain only app code — no test/demo trades,
// no backups/CSV exports, no secrets, and it must carry the Content-Security-Policy.
// Usage: npm run build && npm run check:dist
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const ALLOWED_EXT = new Set(['.html', '.js', '.css', '.png', '.svg', '.webmanifest', '']);
const problems = [];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(DIST);

// Identifiers and values that only exist in test data
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/backup-v1.0.json', import.meta.url), 'utf8'));
const testOnly = [
  ...[...fixture.data.accounts, ...fixture.data.trades, ...fixture.data.cashflows].map((r) => r.id),
  'Kalshi 预测', 'SECRETSYM', 'SecretBroker', 'VERYLONGSYMBOL', 'daybook-backup-2', 'window.__pwned', 'attacker.example',
];
const secretPatterns = [
  [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/, 'Cloudflare credential name'],
  [/[A-Za-z0-9._%+-]+@(?:gmail|berkeley|outlook|icloud|yahoo|hotmail)\.[a-z.]+/i, 'personal e-mail address'],
];

for (const f of files) {
  const rel = relative(DIST, f);
  const ext = extname(f);
  if (!ALLOWED_EXT.has(ext)) problems.push(`${rel}: unexpected file type (only app assets may ship)`);
  if (ext === '.png') continue;
  const text = readFileSync(f, 'utf8');
  for (const s of testOnly) if (text.includes(s)) problems.push(`${rel}: contains test-only data "${s}"`);
  for (const [re, what] of secretPatterns) if (re.test(text)) problems.push(`${rel}: looks like it contains a ${what}`);
}

const index = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!/http-equiv="Content-Security-Policy"[^>]*connect-src 'self'/.test(index)) problems.push('index.html: Content-Security-Policy missing');
if (!files.some((f) => f.endsWith('sw.js'))) problems.push('sw.js missing');

if (problems.length) {
  console.error(`dist check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`dist check passed: ${files.length} files, no test data, no secrets, CSP present`);
