import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildImportPreview, exportCSV, guessMapping, parseCSV, type ImportOptions } from '../../src/lib/csv';
import { DaybookDB } from '../../src/db/db';
import { addTrade, createAccount } from '../../src/db/actions';
import { commitImport, undoImport } from '../../src/db/importCsv';
import { summarizeTrades } from '../../src/lib/stats';

const opts = (o: Partial<ImportOptions> = {}): ImportOptions => ({
  dateOrder: 'auto', defaultAccountId: null, unknownAccounts: 'create', pnlIsGross: false, includeDuplicates: false, ...o,
});

describe('parseCSV', () => {
  it('handles quotes, commas, newlines, BOM, CRLF and semicolons', () => {
    expect(parseCSV('﻿a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCSV('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a,b\n"multi\nline",2\n\n')).toEqual([['a', 'b'], ['multi\nline', '2']]);
  });
});

describe('guessMapping', () => {
  it('maps common column names', () => {
    const m = guessMapping(['Trade Date', 'Ticker', 'Net P&L', 'Commission', 'Strategy', 'Broker', 'Account']);
    expect(m.date).toBe(0);
    expect(m.symbol).toBe(1);
    expect(m.pnl).toBe(2);
    expect(m.fees).toBe(3);
    expect(m.tags).toBe(4);
    expect(m.platform).toBe(5);
    expect(m.account).toBe(6);
  });
});

describe('CSV import', () => {
  it('validates rows strictly, creates accounts, detects duplicates, and round-trips export', async () => {
    const d = new DaybookDB('csv-1');
    const A = await createAccount({ name: 'Stocks', startingBalanceCents: 0, startDate: '2026-01-01', color: '#4F8CFF' }, d);
    await addTrade({ accountId: A.id, date: '2026-03-02', pnlCents: 12500, feesCents: null, symbol: 'TSLA', platform: '', tags: [], notes: '', side: null, quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null }, d);
    const csv = [
      'Date,Account,Symbol,P&L,Fees,Tags,Type',
      '2026-03-02,stocks,tsla,125.00,,,',            // duplicate of existing (case-insensitive)
      '2026-03-02,Stocks,TSLA,125,,,',               // same again — only 1 existing, so this one is new
      '03/04/2026,Kalshi,FED-RATE,"(40.10)",1.20,"macro; event",trade',
      '2026-02-30,Stocks,X,10,,,',                    // invalid date
      '2026-03-05,Stocks,Y,abc,,,',                   // invalid amount
      '2026-03-06,Kalshi,,250,,,deposit',             // cash flow
      '2026-03-07,Stocks,Z,1.005,,,',                 // rounded with warning
    ].join('\n');
    const table = parseCSV(csv);
    const mapping = guessMapping(table[0]);
    const existing = { accounts: await d.accounts.toArray(), trades: await d.trades.toArray(), cashflows: await d.cashflows.toArray() };
    const p = buildImportPreview(table, mapping, opts(), existing);
    expect(p.rows.map((r) => r.status)).toEqual(['duplicate', 'ok', 'ok', 'error', 'error', 'ok', 'ok']);
    expect(p.rows[2].amountCents).toBe(-4010);
    expect(p.rows[2].trade?.feesCents).toBe(120);
    expect(p.rows[2].trade?.tags).toEqual(['macro', 'event']);
    expect(p.rows[6].messages).toContain('warn_rounded');
    expect(p.rows[6].amountCents).toBe(101);
    expect(p.newAccounts.map((a) => a.name)).toEqual(['Kalshi']);
    expect(p.newAccounts[0].startDate).toBe('2026-03-04');
    expect(p.counts).toMatchObject({ ok: 4, duplicate: 1, error: 2, trades: 3, cashflows: 1 });
    expect(p.netPnlCents).toBe(12500 - 4010 + 101);

    const res = await commitImport(p, false, d);
    expect(res).toMatchObject({ trades: 3, cashflows: 1, accountsCreated: 1 });
    const trades = await d.trades.toArray();
    expect(summarizeTrades(trades).netCents).toBe(12500 * 2 - 4010 + 101);

    // Re-importing the same file must not add anything new
    const existing2 = { accounts: await d.accounts.toArray(), trades, cashflows: await d.cashflows.toArray() };
    const p2 = buildImportPreview(table, guessMapping(table[0]), opts(), existing2);
    expect(p2.counts.ok).toBe(0);
    expect(p2.counts.duplicate).toBe(5);

    // Export → re-import into an empty DB reproduces totals; ids are recognized as duplicates
    const out = exportCSV(existing2.accounts, trades, existing2.cashflows);
    const t2 = parseCSV(out);
    const p3 = buildImportPreview(t2, guessMapping(t2[0]), opts(), existing2);
    expect(p3.counts.ok).toBe(0);
    const d2 = new DaybookDB('csv-2');
    const p4 = buildImportPreview(t2, guessMapping(t2[0]), opts(), { accounts: [], trades: [], cashflows: [] });
    expect(p4.counts.error).toBe(0);
    const r4 = await commitImport(p4, false, d2);
    expect(r4.trades).toBe(4);
    expect(r4.cashflows).toBe(1);
    expect(summarizeTrades(await d2.trades.toArray()).netCents).toBe(summarizeTrades(trades).netCents);

    await undoImport(res, d);
    expect((await d.trades.toArray()).length).toBe(1);
  });

  it('requires an account when no account column exists, and subtracts fees only when told P&L is gross', () => {
    const table = parseCSV('date,pnl,fees\n2026-01-05,100,2.5');
    const m = guessMapping(table[0]);
    const none = buildImportPreview(table, m, opts(), { accounts: [], trades: [], cashflows: [] });
    expect(none.rows[0].status).toBe('error');
    expect(none.rows[0].messages).toContain('err_account');
    const net = buildImportPreview(table, m, opts({ defaultAccountId: 'acc' }), { accounts: [], trades: [], cashflows: [] });
    expect(net.rows[0].trade?.pnlCents).toBe(10000);
    const gross = buildImportPreview(table, m, opts({ defaultAccountId: 'acc', pnlIsGross: true }), { accounts: [], trades: [], cashflows: [] });
    expect(gross.rows[0].trade?.pnlCents).toBe(9750);
  });

  it('neutralizes formula injection in exported text cells', () => {
    const out = exportCSV(
      [{ id: 'a', name: '=HYPERLINK("x")', startingBalanceCents: 0, startDate: '2026-01-01', color: '#000000', archived: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 't', accountId: 'a', date: '2026-01-02', pnlCents: -500, feesCents: null, symbol: 'X', platform: '', tags: [], notes: '@cmd', side: null, quantity: null, entryPrice: null, exitPrice: null, entryTime: null, exitTime: null, createdAt: 1, updatedAt: 1 }],
      [],
    );
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain(`'@cmd`);
    expect(out).toContain(',-5.00,'); // numbers are not escaped
  });
});
