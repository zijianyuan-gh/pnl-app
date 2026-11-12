// Writes a SYNTHETIC Daybook backup (format 2, SHA-256) for screenshots and native tests:
//   node scripts/make-demo-backup.mjs <outDir>
// → <outDir>/demo-backup.json and <outDir>/expected.json (balance etc. for assertions),
//   <outDir>/files/: a tampered copy (must be refused) and a small CSV (import test) for the iOS tests.
// Dates are relative to today so the calendar always has data in the current month.
// Never contains real financial data.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'build/demo';
mkdirSync(out, { recursive: true });

// Same canonical form as src/lib/digest.ts (the app rejects the file if this ever drifts)
function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJSON(x))).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let seed = 20261112;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const now = Date.UTC(2026, 10, 1);
const today = new Date();
const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);

const accounts = [
  { id: 'demo-stocks', name: 'Stocks', startingBalanceCents: 25_000_00, color: '#4F8CFF' },
  { id: 'demo-futures', name: 'Futures', startingBalanceCents: 10_000_00, color: '#F5B544' },
  { id: 'demo-options', name: 'Options', startingBalanceCents: 2_000_00, color: '#A78BFA' },
].map((a, i) => ({ ...a, startDate: iso(start), archived: false, sortOrder: i, createdAt: now, updatedAt: now }));

const symbols = { 'demo-stocks': ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY'], 'demo-futures': ['ES', 'NQ', 'CL'], 'demo-options': ['SPY', 'QQQ', 'IWM'] };
// no broker names: App Store screenshots must not suggest any affiliation (Guideline 5.2.1)
const platforms = {};
const tags = ['breakout', 'pullback', 'news', 'scalp', 'swing'];
const trades = [];
let n = 0;
for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
  if (d.getDay() === 0 || d.getDay() === 6 || rnd() < 0.22) continue;
  const k = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < k; i++) {
    const acc = pick(accounts).id;
    const scale = acc === 'demo-options' ? 9_000 : acc === 'demo-futures' ? 60_000 : 45_000;
    const pnl = Math.round((rnd() - 0.42) * scale);
    trades.push({
      id: `demo-t${++n}`, accountId: acc, date: iso(d), pnlCents: pnl,
      feesCents: rnd() < 0.5 ? (acc === 'demo-futures' ? 4_20 : 1_00) : null,
      symbol: pick(symbols[acc]), platform: platforms[acc] ?? '', tags: rnd() < 0.7 ? [pick(tags)] : [], notes: '',
      side: rnd() < 0.6 ? 'long' : 'short', quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null,
      createdAt: now + n, updatedAt: now + n,
    });
  }
}
const cashflows = [
  { id: 'demo-c1', accountId: 'demo-stocks', date: iso(new Date(start.getFullYear(), start.getMonth() + 1, 3)), type: 'deposit', amountCents: 5_000_00, notes: 'Monthly top-up', createdAt: now, updatedAt: now },
];

const netPnlCents = trades.reduce((s, t) => s + t.pnlCents, 0);
const body = {
  app: 'daybook-pnl-journal', format: 2, schemaVersion: 1, exportedAt: new Date().toISOString(),
  summary: { accounts: accounts.length, trades: trades.length, cashflows: cashflows.length, netPnlCents },
  data: { accounts, trades, cashflows, tombstones: [] },
  settings: { lang: null },
};
const file = { ...body, integrity: { algorithm: 'SHA-256', scheme: 'daybook-canonical-json-v1', digest: createHash('sha256').update(canonicalJSON(body), 'utf8').digest('hex') } };
writeFileSync(join(out, 'demo-backup.json'), JSON.stringify(file, null, 2));

// Native tests: a copy edited after export (the SHA-256 no longer matches → the app must refuse it)
// and a two-row CSV for the import test
mkdirSync(join(out, 'files'), { recursive: true });
const tampered = structuredClone(file);
tampered.data.trades[0].notes = 'edited after export';
writeFileSync(join(out, 'files', 'Daybook tampered backup.json'), JSON.stringify(tampered, null, 2));
writeFileSync(
  join(out, 'files', 'Daybook import.csv'),
  ['date,account,pnl,symbol,notes', `${iso(today)},Stocks,77.77,CSVTEST,csv import test`, `${iso(today)},Stocks,-11.11,CSVTEST,csv import test`, ''].join('\n'),
);

const balanceCents = accounts.reduce((s, a) => s + a.startingBalanceCents, 0) + 5_000_00 + netPnlCents;
const fmt = (c) => `${c < 0 ? '−' : ''}$${Math.floor(Math.abs(c) / 100).toLocaleString('en-US')}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
writeFileSync(join(out, 'expected.json'), JSON.stringify({ trades: trades.length, balance: fmt(balanceCents), net: fmt(netPnlCents) }, null, 2));
console.log(`demo backup: ${trades.length} trades, balance ${fmt(balanceCents)} → ${out}`);
