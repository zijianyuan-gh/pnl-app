import { useDeferredValue, useMemo, useState } from 'react';
import { ListX, Search, X, ReceiptText } from 'lucide-react';
import { useApp, useFiltered } from '../state/app';
import { fmt } from '../i18n';
import { AccountFilterPill } from '../components/AccountFilter';
import { FlowRow, TradeRow } from '../components/rows';
import { Chip, EmptyState, Money, Segmented } from '../components/ui';
import { addDays, formatDate, monthKeyOf, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import type { CashFlow, Trade } from '../db/types';

type RangeKey = 'all' | 'month' | '30d' | 'ytd' | 'custom';
type Outcome = 'all' | 'wins' | 'losses';

const PAGE = 60; // date groups per page

export function TradesScreen() {
  const { T, locale, today, accounts } = useApp();
  const { trades, cashflows } = useFiltered();
  const [type, setType] = useState<'trades' | 'flows'>('trades');
  const [range, setRange] = useState<RangeKey>('all');
  const [from, setFrom] = useState<ISODate>(addDays(today, -30));
  const [to, setTo] = useState<ISODate>(today);
  const [outcome, setOutcome] = useState<Outcome>('all');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  const [pages, setPages] = useState(1);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const bounds = useMemo((): { from?: ISODate; to?: ISODate } => {
    switch (range) {
      case 'month':
        return { from: `${monthKeyOf(today)}-01`, to: `${monthKeyOf(today)}-31` };
      case '30d':
        return { from: addDays(today, -29), to: today };
      case 'ytd':
        return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
      case 'custom':
        return from <= to ? { from, to } : { from: to, to: from };
      default:
        return {};
    }
  }, [range, today, from, to]);

  const inBounds = (d: ISODate) => (!bounds.from || d >= bounds.from) && (!bounds.to || d <= bounds.to);

  const filteredTrades = useMemo(() => {
    return trades
      .filter((t) => inBounds(t.date))
      .filter((t) => (outcome === 'wins' ? t.pnlCents > 0 : outcome === 'losses' ? t.pnlCents < 0 : true))
      .filter((t) => {
        if (!q) return true;
        const acc = accById.get(t.accountId)?.name ?? '';
        const hay = `${t.symbol} ${t.platform} ${t.tags.join(' ')} ${t.notes} ${acc}`.toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      })
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, bounds, outcome, q, accById]);

  const filteredFlows = useMemo(() => {
    return cashflows
      .filter((c) => inBounds(c.date))
      .filter((c) => (outcome === 'wins' ? c.type === 'deposit' : outcome === 'losses' ? c.type === 'withdrawal' : true))
      .filter((c) => {
        if (!q) return true;
        const acc = accById.get(c.accountId)?.name ?? '';
        return `${c.notes} ${acc} ${c.type}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashflows, bounds, outcome, q, accById]);

  const rows: (Trade | CashFlow)[] = type === 'trades' ? filteredTrades : filteredFlows;
  const groups = useMemo(() => {
    const g: { date: ISODate; items: (Trade | CashFlow)[]; net: number }[] = [];
    for (const r of rows) {
      const last = g[g.length - 1];
      const v = 'pnlCents' in r ? r.pnlCents : r.type === 'deposit' ? r.amountCents : -r.amountCents;
      if (last && last.date === r.date) {
        last.items.push(r);
        last.net += v;
      } else g.push({ date: r.date, items: [r], net: v });
    }
    return g;
  }, [rows]);

  const net = groups.reduce((s, g) => s + g.net, 0);
  const totalAll = type === 'trades' ? trades.length : cashflows.length;
  const filtersActive = range !== 'all' || outcome !== 'all' || !!q;
  const shown = groups.slice(0, pages * PAGE);

  return (
    <div className="mx-auto w-full max-w-[720px] pb-6">
      <header className="pt-safe px-safe sticky top-0 z-20 bg-bg/95 pb-2 backdrop-blur">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h1 className="text-[28px] font-bold tracking-tight">{T.trades.title}</h1>
          <AccountFilterPill />
        </div>
        <div className="relative mt-2">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPages(1);
            }}
            placeholder={T.trades.searchPh}
            aria-label={T.common.search}
            data-testid="trades-search"
            className="field min-h-10 pl-9 pr-9"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              aria-label={T.common.clear}
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-ink-3"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
          {(['all', 'month', '30d', 'ytd', 'custom'] as RangeKey[]).map((r) => (
            <Chip key={r} active={range === r} onClick={() => setRange(r)} testId={`range-${r}`}>
              {T.trades.range[r]}
            </Chip>
          ))}
        </div>
        {range === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="sr-only">{T.common.from}</span>
              <input type="date" className="field num min-h-10 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={T.common.from} data-testid="range-from" />
            </label>
            <label className="block">
              <span className="sr-only">{T.common.to}</span>
              <input type="date" className="field num min-h-10 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} aria-label={T.common.to} data-testid="range-to" />
            </label>
          </div>
        )}
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <Segmented
            size="sm"
            value={outcome}
            onChange={setOutcome}
            label="Outcome"
            options={[
              { value: 'all', label: T.trades.all },
              { value: 'wins', label: type === 'trades' ? T.trades.wins : T.add.kindDeposit, tone: type === 'trades' ? 'pos' : undefined },
              { value: 'losses', label: type === 'trades' ? T.trades.losses : T.add.kindWithdrawal, tone: type === 'trades' ? 'neg' : undefined },
            ]}
          />
          <Segmented
            size="sm"
            value={type}
            onChange={(v) => {
              setType(v);
              setPages(1);
            }}
            label="Type"
            options={[
              { value: 'trades', label: T.trades.typeTrades },
              { value: 'flows', label: T.trades.typeFlows },
            ]}
          />
        </div>
        {rows.length > 0 && (
          <p className="num mt-2 px-1 text-[13px] text-ink-3" data-testid="trades-summary">
            {fmt(type === 'trades' ? T.trades.summary : T.trades.summaryFlows, {
              n: rows.length,
              net: formatMoney(net, { sign: 'always' }),
            })}
          </p>
        )}
      </header>

      <div className="px-safe pt-1">
        {rows.length === 0 ? (
          <div className="rounded-2xl bg-surface">
            {totalAll === 0 || !filtersActive ? (
              <EmptyState icon={<ReceiptText size={26} />} title={T.trades.empty} body={T.trades.emptyBody} />
            ) : (
              <EmptyState icon={<ListX size={26} />} title={T.trades.emptyFiltered} body={T.trades.emptyFilteredBody} />
            )}
          </div>
        ) : (
          <>
            {shown.map((g) => (
              <section key={g.date} className="mb-4" data-testid="trade-group">
                <div className="mb-1.5 flex items-baseline justify-between px-1">
                  <h2 className="text-[13px] font-semibold text-ink-2">
                    {formatDate(g.date, locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </h2>
                  {type === 'trades' ? (
                    <Money cents={g.net} className="text-[13px] font-semibold" />
                  ) : (
                    <span className="num text-[13px] font-semibold text-ink-2">{formatMoney(g.net, { sign: 'always' })}</span>
                  )}
                </div>
                <div className="overflow-hidden rounded-2xl bg-surface">
                  {g.items.map((r) =>
                    'pnlCents' in r ? (
                      <TradeRow key={r.id} trade={r} account={accById.get(r.accountId)} showAccount={accounts.length > 1} />
                    ) : (
                      <FlowRow key={r.id} flow={r} account={accById.get(r.accountId)} showAccount={accounts.length > 1} />
                    ),
                  )}
                </div>
              </section>
            ))}
            {groups.length > shown.length && (
              <button
                type="button"
                className="mb-4 min-h-11 w-full rounded-2xl bg-surface text-[15px] font-semibold text-link"
                onClick={() => setPages((p) => p + 1)}
              >
                {T.trades.showMore}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
