import type { Account, CashFlow, CashFlowType, Trade } from '../db/types';
import { cashFlowFingerprint, normalizeTags, tradeFingerprint } from '../db/validate';
import { parseFlexibleDate, isValidTime, type DateOrder, type ISODate } from './dates';
import { centsToDecimal, parseMoney, type Cents } from './money';

// ---------------- Generic CSV ----------------

export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => {
    let n = 0;
    let inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) n++;
    }
    return [d, n] as const;
  });
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM, auto delimiter. */
export function parseCSV(text: string, delimiter = detectDelimiter(text)): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // drop fully empty lines
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function csvCell(v: string | number | null | undefined, text = false): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet formula injection in free-text cells
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: (string | number | null | undefined)[][], textCols: Set<number> = new Set()): string {
  return rows.map((r) => r.map((c, i) => csvCell(c, textCols.has(i))).join(',')).join('\r\n') + '\r\n';
}

// ---------------- Export ----------------

export const EXPORT_HEADERS = [
  'date',
  'account',
  'type',
  'pnl',
  'fees',
  'symbol',
  'platform',
  'tags',
  'side',
  'quantity',
  'entry_price',
  'exit_price',
  'entry_time',
  'exit_time',
  'notes',
  'id',
] as const;

/**
 * Trades and cash flows in one CSV. `pnl` is net realized P&L (fees already included);
 * for deposit/withdrawal rows `pnl` holds the (positive) amount.
 */
export function exportCSV(accounts: Account[], trades: Trade[], cashflows: CashFlow[]): string {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  type Row = { date: string; created: number; cells: (string | number | null)[] };
  const rows: Row[] = [];
  for (const t of trades) {
    rows.push({
      date: t.date,
      created: t.createdAt,
      cells: [
        t.date,
        names.get(t.accountId) ?? '',
        'trade',
        centsToDecimal(t.pnlCents),
        t.feesCents === null ? '' : centsToDecimal(t.feesCents),
        t.symbol,
        t.platform,
        t.tags.join('; '),
        t.side ?? '',
        t.quantity ?? '',
        t.entryPrice ?? '',
        t.exitPrice ?? '',
        t.entryTime ?? '',
        t.exitTime ?? '',
        t.notes,
        t.id,
      ],
    });
  }
  for (const c of cashflows) {
    rows.push({
      date: c.date,
      created: c.createdAt,
      cells: [c.date, names.get(c.accountId) ?? '', c.type, centsToDecimal(c.amountCents), '', '', '', '', '', '', '', '', '', '', c.notes, c.id],
    });
  }
  rows.sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1));
  const textCols = new Set([1, 5, 6, 7, 9, 10, 11, 14]);
  return toCSV([[...EXPORT_HEADERS], ...rows.map((r) => r.cells)], textCols);
}

// ---------------- Import ----------------

export type ImportField =
  | 'date'
  | 'pnl'
  | 'account'
  | 'type'
  | 'fees'
  | 'symbol'
  | 'platform'
  | 'tags'
  | 'side'
  | 'quantity'
  | 'entry_price'
  | 'exit_price'
  | 'entry_time'
  | 'exit_time'
  | 'notes'
  | 'id';

export const IMPORT_FIELDS: ImportField[] = [
  'date',
  'pnl',
  'account',
  'type',
  'symbol',
  'platform',
  'tags',
  'fees',
  'notes',
  'side',
  'quantity',
  'entry_price',
  'exit_price',
  'entry_time',
  'exit_time',
  'id',
];

const ALIASES: Record<ImportField, string[]> = {
  date: ['date', 'trade date', 'tradedate', 'close date', 'closed', 'closed date', 'exit date', 'date closed', 'day', 'settlement date', 'time', 'datetime', '日期', '交易日期'],
  pnl: [
    'pnl', 'p&l', 'p/l', 'pl', 'net pnl', 'net p&l', 'net p/l', 'netpnl', 'realized pnl', 'realized p&l', 'realized p/l',
    'realized', 'profit', 'profit/loss', 'profit loss', 'gain/loss', 'gain loss', 'gain', 'net', 'net profit', 'amount',
    'result', 'return', '盈亏', '净盈亏', '金额', '收益',
  ],
  account: ['account', 'account name', 'acct', 'portfolio', '账户'],
  type: ['type', 'kind', 'record type', 'transaction type', '类型'],
  fees: ['fees', 'fee', 'commission', 'commissions', 'comm', 'fees & commissions', '费用', '手续费'],
  symbol: ['symbol', 'ticker', 'instrument', 'contract', 'market', 'security', 'underlying', 'event', '标的', '代码'],
  platform: ['platform', 'broker', 'exchange', 'venue', '平台', '券商'],
  tags: ['tags', 'tag', 'strategy', 'setup', 'labels', '策略', '标签'],
  side: ['side', 'direction', 'long/short', 'position', '方向'],
  quantity: ['quantity', 'qty', 'size', 'shares', 'contracts', '数量'],
  entry_price: ['entry price', 'entry', 'open price', 'buy price', 'avg entry', 'entry_price', '入场价'],
  exit_price: ['exit price', 'exit', 'close price', 'sell price', 'avg exit', 'exit_price', '出场价'],
  entry_time: ['entry time', 'open time', 'entry_time', '入场时间'],
  exit_time: ['exit time', 'close time', 'exit_time', '出场时间'],
  notes: ['notes', 'note', 'comment', 'comments', 'description', 'memo', '备注'],
  id: ['id', 'trade id', 'uuid'],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').replace(/[()$]/g, '').trim();

export type Mapping = Record<ImportField, number | null>;

export function guessMapping(headers: string[]): Mapping {
  const normalized = headers.map(norm);
  const used = new Set<number>();
  const mapping = {} as Mapping;
  for (const f of IMPORT_FIELDS) {
    mapping[f] = null;
    const aliases = ALIASES[f].map(norm);
    // exact alias match first, in alias priority order
    for (const a of aliases) {
      const idx = normalized.findIndex((h, i) => !used.has(i) && h === a);
      if (idx >= 0) {
        mapping[f] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export interface ImportOptions {
  dateOrder: DateOrder;
  /** Used when there is no account column, or for unknown names if unknownAccounts = 'default'. */
  defaultAccountId: string | null;
  unknownAccounts: 'create' | 'default';
  /** If true, the P&L column is gross and fees are subtracted. Default false (P&L is already net). */
  pnlIsGross: boolean;
  /** Import rows flagged as duplicates anyway. */
  includeDuplicates: boolean;
}

export type RowStatus = 'ok' | 'duplicate' | 'error';

export interface PreviewRow {
  line: number; // 1-based line in file (header = 1)
  status: RowStatus;
  messages: string[];
  kind: 'trade' | CashFlowType;
  date: ISODate | null;
  amountCents: Cents | null; // trade: signed net P&L; cash flow: positive amount
  accountName: string;
  /** existing account id, or `new:<name>` for accounts that will be created */
  accountRef: string | null;
  symbol: string;
  trade?: Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>;
  flow?: Omit<CashFlow, 'id' | 'createdAt' | 'updatedAt'>;
  sourceId: string | null;
}

export interface ImportPreview {
  rows: PreviewRow[];
  counts: { ok: number; duplicate: number; error: number; trades: number; cashflows: number };
  newAccounts: { ref: string; name: string; startDate: ISODate }[];
  netPnlCents: Cents; // of rows that will be imported (trades only)
}

function parseType(v: string): 'trade' | CashFlowType | null {
  const s = v.trim().toLowerCase();
  if (!s || ['trade', 'trades', 'pnl', 'p&l', '交易'].includes(s)) return 'trade';
  if (['deposit', 'deposits', 'dep', 'transfer in', 'in', '入金', '存入'].includes(s)) return 'deposit';
  if (['withdrawal', 'withdraw', 'withdrawals', 'wd', 'transfer out', 'out', '出金', '取出'].includes(s)) return 'withdrawal';
  return null;
}

function parseSide(v: string): 'long' | 'short' | null {
  const s = v.trim().toLowerCase();
  if (['long', 'buy', 'b', 'l', 'yes', '多', '做多'].includes(s)) return 'long';
  if (['short', 'sell', 's', 'sell short', 'no', '空', '做空'].includes(s)) return 'short';
  return null;
}

function parseTime(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const t = `${String(h).padStart(2, '0')}:${m[2]}`;
  return isValidTime(t) ? t : null;
}

export function buildImportPreview(
  table: string[][],
  mapping: Mapping,
  opts: ImportOptions,
  existing: { accounts: Account[]; trades: Trade[]; cashflows: CashFlow[] },
): ImportPreview {
  const body = table.slice(1);
  const byName = new Map(existing.accounts.map((a) => [a.name.trim().toLowerCase(), a]));
  const existingTradeIds = new Set(existing.trades.map((t) => t.id));
  const existingFlowIds = new Set(existing.cashflows.map((c) => c.id));
  const tradeFp = new Map<string, number>();
  for (const t of existing.trades) tradeFp.set(tradeFingerprint(t), (tradeFp.get(tradeFingerprint(t)) ?? 0) + 1);
  const flowFp = new Map<string, number>();
  for (const c of existing.cashflows) flowFp.set(cashFlowFingerprint(c), (flowFp.get(cashFlowFingerprint(c)) ?? 0) + 1);

  const newAccounts = new Map<string, { ref: string; name: string; startDate: ISODate }>();
  const get = (r: string[], f: ImportField) => (mapping[f] === null ? '' : (r[mapping[f]!] ?? '').trim());
  const rows: PreviewRow[] = [];

  body.forEach((r, i) => {
    const messages: string[] = [];
    const line = i + 2;
    const kind = parseType(get(r, 'type'));
    if (!kind) messages.push('err_type');
    const date = parseFlexibleDate(get(r, 'date'), opts.dateOrder);
    if (!date) messages.push('err_date');

    const money = parseMoney(get(r, 'pnl'));
    let amount: Cents | null = money.ok ? money.cents : null;
    if (!money.ok) messages.push('err_amount');
    else if (money.rounded) messages.push('warn_rounded');

    let fees: Cents | null = null;
    const feesRaw = get(r, 'fees');
    if (feesRaw) {
      const f = parseMoney(feesRaw);
      if (!f.ok) messages.push('err_fees');
      else fees = Math.abs(f.cents);
    }
    if (amount !== null && kind === 'trade' && opts.pnlIsGross && fees) amount -= fees;

    // account
    let accountRef: string | null = null;
    const accName = get(r, 'account');
    if (mapping.account !== null && accName) {
      const acc = byName.get(accName.toLowerCase());
      if (acc) accountRef = acc.id;
      else if (opts.unknownAccounts === 'create') {
        const key = accName.toLowerCase();
        const ref = `new:${key}`;
        const cur = newAccounts.get(key);
        if (!cur) newAccounts.set(key, { ref, name: accName.slice(0, 60), startDate: date ?? '9999-12-31' });
        else if (date && date < cur.startDate) cur.startDate = date;
        accountRef = ref;
      } else accountRef = opts.defaultAccountId;
    } else accountRef = opts.defaultAccountId;
    if (!accountRef) messages.push('err_account');

    const symbol = get(r, 'symbol').slice(0, 60);
    const sourceId = get(r, 'id') || null;
    let status: RowStatus = messages.some((m) => m.startsWith('err_')) ? 'error' : 'ok';

    const row: PreviewRow = {
      line,
      status,
      messages,
      kind: kind ?? 'trade',
      date,
      amountCents: amount,
      accountName: accName,
      accountRef,
      symbol,
      sourceId,
    };

    if (status === 'ok' && kind === 'trade') {
      const entryTime = parseTime(get(r, 'entry_time'));
      const exitTime = parseTime(get(r, 'exit_time'));
      row.trade = {
        accountId: accountRef!,
        date: date!,
        pnlCents: amount!,
        feesCents: fees,
        symbol,
        platform: get(r, 'platform').slice(0, 60),
        tags: normalizeTags(get(r, 'tags')),
        notes: get(r, 'notes').replace(/^'(?=[=+\-@])/, '').slice(0, 2000),
        side: parseSide(get(r, 'side')),
        quantity: get(r, 'quantity') || null,
        entryPrice: get(r, 'entry_price') || null,
        exitPrice: get(r, 'exit_price') || null,
        entryTime,
        exitTime,
      };
      const fp = tradeFingerprint(row.trade);
      if ((sourceId && existingTradeIds.has(sourceId)) || (tradeFp.get(fp) ?? 0) > 0) {
        status = 'duplicate';
        if (!(sourceId && existingTradeIds.has(sourceId))) tradeFp.set(fp, tradeFp.get(fp)! - 1);
      }
    } else if (status === 'ok' && kind !== null && kind !== 'trade') {
      const amt = Math.abs(amount!);
      if (amt === 0) {
        status = 'error';
        messages.push('err_amount');
      } else {
        row.amountCents = amt;
        row.flow = { accountId: accountRef!, date: date!, type: kind, amountCents: amt, notes: get(r, 'notes').slice(0, 2000) };
        const fp = cashFlowFingerprint(row.flow);
        if ((sourceId && existingFlowIds.has(sourceId)) || (flowFp.get(fp) ?? 0) > 0) {
          status = 'duplicate';
          if (!(sourceId && existingFlowIds.has(sourceId))) flowFp.set(fp, flowFp.get(fp)! - 1);
        }
      }
    }
    row.status = status;
    rows.push(row);
  });

  const willImport = (r: PreviewRow) => r.status === 'ok' || (r.status === 'duplicate' && opts.includeDuplicates);
  const counts = { ok: 0, duplicate: 0, error: 0, trades: 0, cashflows: 0 };
  let net = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (willImport(r)) {
      if (r.trade) {
        counts.trades++;
        net += r.trade.pnlCents;
      } else if (r.flow) counts.cashflows++;
    }
  }
  // Only create accounts that some imported row actually uses
  const usedRefs = new Set(rows.filter(willImport).map((r) => r.accountRef));
  return {
    rows,
    counts,
    newAccounts: [...newAccounts.values()].filter((a) => usedRefs.has(a.ref)),
    netPnlCents: net,
  };
}
