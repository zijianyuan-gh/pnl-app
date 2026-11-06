import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Wallet } from 'lucide-react';
import { useApp, useFiltered } from '../state/app';
import { fmt } from '../i18n';
import { AccountFilterPill } from '../components/AccountFilter';
import { FlowRow, TradeRow } from '../components/rows';
import { Button, EmptyState, IconButton, InfoTip, Money, cx } from '../components/ui';
import { addMonths, formatDate, formatMonth, monthGrid, monthKeyOf, parseISODate, type ISODate } from '../lib/dates';
import { formatCompact, formatMoney } from '../lib/money';
import { primeKeyboard } from '../lib/keyboard';
import { isIOS, isStandalone } from '../lib/platform';
import { aggregateByDay, combinedBalance, summarizeDays, type DayAgg } from '../lib/stats';

export function CalendarScreen({ onCreateAccount }: { onCreateAccount: () => void }) {
  const { T, locale, today, openAdd, accounts: allAccounts } = useApp();
  const { accounts, trades, cashflows } = useFiltered();
  const [month, setMonth] = useState(monthKeyOf(today));
  const [selected, setSelected] = useState<ISODate>(today);

  const byDay = useMemo(() => aggregateByDay(trades), [trades]);
  const balance = useMemo(() => combinedBalance(accounts, trades, cashflows), [accounts, trades, cashflows]);
  const accById = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);

  const monthDays = useMemo(() => {
    const out: DayAgg[] = [];
    for (const [d, agg] of byDay) if (monthKeyOf(d) === month) out.push(agg);
    return out;
  }, [byDay, month]);
  const monthNet = monthDays.reduce((s, d) => s + d.pnlCents, 0);
  const monthTrades = monthDays.reduce((s, d) => s + d.trades, 0);
  const monthDaySummary = summarizeDays(monthDays);
  const maxAbs = Math.max(1, ...monthDays.map((d) => Math.abs(d.pnlCents)));

  const goMonth = (k: string) => {
    setMonth(k);
    // keep the selection inside the visible month
    if (monthKeyOf(selected) !== k) setSelected(k === monthKeyOf(today) ? today : `${k}-01`);
  };

  // Swipe left/right to change month
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) goMonth(addMonths(month, dx < 0 ? 1 : -1));
  };

  const selectedTrades = useMemo(
    () => trades.filter((t) => t.date === selected).sort((a, b) => a.createdAt - b.createdAt),
    [trades, selected],
  );
  const selectedFlows = useMemo(() => cashflows.filter((c) => c.date === selected), [cashflows, selected]);
  const selectedAgg = byDay.get(selected);
  const isCurrentMonth = month === monthKeyOf(today);
  const grid = monthGrid(month);

  return (
    <div className="mx-auto w-full max-w-[720px] pb-6">
      {/* Header */}
      <header className="pt-safe px-safe sticky top-0 z-20 bg-bg/95 pb-3 backdrop-blur">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-[20px] font-bold tracking-tight">
            <span className="grid h-7 w-7 grid-cols-2 gap-[3px] rounded-lg bg-surface-2 p-[5px]" aria-hidden>
              <span className="rounded-[2px] bg-pos" />
              <span className="rounded-[2px] bg-neg" />
              <span className="rounded-[2px] bg-ink-3/50" />
              <span className="rounded-[2px] bg-pos" />
            </span>
            {T.appName}
          </h1>
          <AccountFilterPill />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="min-w-0 rounded-2xl bg-surface px-3.5 py-3">
            <div className="flex items-center gap-1 text-[12px] font-medium text-ink-3 min-[360px]:text-[12.5px]">
              <span className="truncate">{T.money.estBalance}</span>
              <InfoTip text={T.money.estBalanceHelp} label={T.money.estBalance} />
            </div>
            <div className={cx('num mt-0.5 truncate font-semibold leading-tight', fitSize(formatMoney(balance.estimatedCents)))} data-testid="header-balance">
              {formatMoney(balance.estimatedCents)}
            </div>
          </div>
          <div className="min-w-0 rounded-2xl bg-surface px-3.5 py-3">
            <div className="truncate text-[12.5px] font-medium text-ink-3">
              {formatDate(`${month}-01`, locale, { month: 'short' })} · {T.money.netPnl}
            </div>
            <Money
              cents={monthNet}
              className={cx('mt-0.5 block truncate font-semibold leading-tight', fitSize(formatMoney(monthNet, { sign: 'always' })))}
              testId="header-month-pnl"
            />
          </div>
        </div>
      </header>

      <div className="px-safe">
        {allAccounts.length === 0 && (
          <div className="mb-4 rounded-2xl bg-surface">
            <EmptyState
              icon={<Wallet size={26} />}
              title={T.calendar.welcomeTitle}
              body={T.calendar.welcomeBody}
              action={
                <Button variant="primary" onClick={onCreateAccount} data-testid="welcome-create">
                  <Plus size={18} /> {T.calendar.welcomeCta}
                </Button>
              }
            />
            {isIOS() && !isStandalone() && (
              <p className="mx-4 mb-4 -mt-4 rounded-xl bg-warn/10 px-3 py-2.5 text-[13px] leading-snug text-warn" data-testid="welcome-safari-warning">
                {T.data.safariTabWarning}
              </p>
            )}
          </div>
        )}

        {/* Month navigation */}
        <div className="flex items-center gap-1 py-1">
          <IconButton label={T.calendar.prevMonth} onClick={() => goMonth(addMonths(month, -1))} data-testid="prev-month">
            <ChevronLeft size={22} />
          </IconButton>
          <h2 className="min-w-0 flex-1 text-center text-[17px] font-semibold" data-testid="month-title" aria-live="polite">
            {formatMonth(month, locale)}
          </h2>
          <IconButton label={T.calendar.nextMonth} onClick={() => goMonth(addMonths(month, 1))} data-testid="next-month">
            <ChevronRight size={22} />
          </IconButton>
        </div>
        <div className="mb-2 flex min-h-8 items-center justify-between gap-2 px-1">
          <p className="num truncate text-[12.5px] text-ink-3" data-testid="month-summary">
            {fmt(T.calendar.monthSummary, { trades: monthTrades, green: monthDaySummary.greenDays, red: monthDaySummary.redDays })}
          </p>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => {
                setMonth(monthKeyOf(today));
                setSelected(today);
              }}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-semibold"
              data-testid="go-today"
            >
              <CalendarDays size={14} /> {T.common.today}
            </button>
          )}
        </div>

        {/* Calendar grid */}
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="select-none" data-testid="calendar">
          <div className="mb-1 grid grid-cols-7 gap-1 sm:gap-1.5" aria-hidden>
            {T.calendar.weekdays.map((w, i) => (
              <div key={i} className="py-1 text-center text-[11.5px] font-semibold text-ink-3">
                {w}
              </div>
            ))}
          </div>
          <div role="group" aria-label={formatMonth(month, locale)} className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {grid.flat().map((d, i) =>
              d ? (
                <DayCell
                  key={d}
                  date={d}
                  agg={byDay.get(d)}
                  maxAbs={maxAbs}
                  isToday={d === today}
                  isSelected={d === selected}
                  onSelect={() => setSelected(d)}
                  onOpenAdd={() => openAdd({ date: d })}
                  tradeLabel={(n) => (n === 1 ? T.calendar.trade : fmt(T.calendar.trades, { n }))}
                  locale={locale}
                />
              ) : (
                <div key={`e${i}`} aria-hidden className="aspect-square sm:aspect-[1.1]" />
              ),
            )}
          </div>
        </div>

        {/* Selected day */}
        <section className="mt-5" aria-label={formatDate(selected, locale)} data-testid="day-panel">
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <div className="min-w-0">
              <h3 className="truncate text-[17px] font-semibold">
                {formatDate(selected, locale, { weekday: 'long', month: 'long', day: 'numeric' })}
                {selected === today && <span className="ml-2 text-[13px] font-medium text-ink-3">{T.common.today}</span>}
              </h3>
              {selectedAgg && (
                <p className="num mt-0.5 text-[13px] text-ink-3">
                  {T.calendar.dayNet}{' '}
                  <Money cents={selectedAgg.pnlCents} className="font-semibold" testId="day-net" /> ·{' '}
                  {selectedAgg.trades === 1 ? T.calendar.trade : fmt(T.calendar.trades, { n: selectedAgg.trades })}
                </p>
              )}
            </div>
            <Button size="sm" className="shrink-0 whitespace-nowrap" aria-label={T.calendar.addForDay} onClick={() => {
              primeKeyboard();
              openAdd({ date: selected });
            }} data-testid="add-for-day" disabled={!allAccounts.length}>
              <Plus size={16} /> {T.tabs.add}
            </Button>
          </div>
          {selectedTrades.length === 0 && selectedFlows.length === 0 ? (
            <div className="rounded-2xl bg-surface px-4 py-5 text-center text-[14px] text-ink-3">{T.calendar.noTradesDay}</div>
          ) : (
            <>
              {selectedTrades.length > 0 && (
                <div className="overflow-hidden rounded-2xl bg-surface">
                  {selectedTrades.map((t) => (
                    <TradeRow key={t.id} trade={t} account={accById.get(t.accountId)} showAccount={allAccounts.length > 1} />
                  ))}
                </div>
              )}
              {selectedFlows.length > 0 && (
                <>
                  <h4 className="mb-2 mt-4 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{T.calendar.cashflowsDay}</h4>
                  <div className="overflow-hidden rounded-2xl bg-surface">
                    {selectedFlows.map((c) => (
                      <FlowRow key={c.id} flow={c} account={accById.get(c.accountId)} showAccount={allAccounts.length > 1} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Shrink big numbers with the screen so they fit the half-width header cards (down to 320px). */
function fitSize(text: string): string {
  if (text.length <= 9) return 'text-[clamp(17px,6vw,24px)]';
  if (text.length <= 10) return 'text-[clamp(16px,5.4vw,24px)]';
  if (text.length <= 12) return 'text-[clamp(14px,4.6vw,22px)]';
  if (text.length <= 14) return 'text-[clamp(13px,3.9vw,22px)]';
  return 'text-[clamp(12px,3.3vw,22px)]';
}

function DayCell({
  date,
  agg,
  maxAbs,
  isToday,
  isSelected,
  onSelect,
  onOpenAdd,
  tradeLabel,
  locale,
}: {
  date: ISODate;
  agg?: DayAgg;
  maxAbs: number;
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onOpenAdd: () => void;
  tradeLabel: (n: number) => string;
  locale: string;
}) {
  const day = parseISODate(date).d;
  const pnl = agg?.pnlCents ?? 0;
  const has = !!agg;
  const tone = !has ? 'none' : pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
  // Intensity scales with the size of the day relative to the month's biggest day
  // (capped at 0.34 so the cell text keeps ≥ 6:1 contrast)
  const intensity = has && pnl !== 0 ? 0.14 + 0.2 * Math.sqrt(Math.abs(pnl) / maxAbs) : 0;
  const bg =
    tone === 'pos'
      ? `rgb(61 220 151 / ${intensity})`
      : tone === 'neg'
        ? `rgb(240 93 94 / ${intensity})`
        : tone === 'zero'
          ? 'rgb(255 255 255 / 0.07)'
          : 'rgb(255 255 255 / 0.025)';
  const label = `${formatDate(date, locale, { month: 'long', day: 'numeric' })}${
    has ? `, ${formatMoney(pnl, { sign: 'always' })}, ${tradeLabel(agg!.trades)}` : ''
  }`;
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      data-testid={`day-${date}`}
      data-pnl={has ? pnl : undefined}
      onClick={onSelect}
      onDoubleClick={onOpenAdd}
      style={{ background: bg }}
      className={cx(
        'relative flex aspect-square min-w-0 flex-col overflow-hidden rounded-[10px] p-[3px] text-left transition active:scale-[0.97] sm:aspect-[1.1] sm:rounded-xl sm:p-2',
        isSelected && 'ring-2 ring-ink/85 ring-inset',
      )}
    >
      {/* Spoken name: full date and exact signed amount; the compact visible text is hidden from AT */}
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className={cx(
          'num flex h-[18px] min-w-[18px] items-center justify-center self-start rounded-full px-1 text-[11px] font-semibold leading-none sm:h-5 sm:min-w-5 sm:text-[12px]',
          isToday ? 'bg-ink text-black' : has ? 'text-ink' : 'text-ink-3',
        )}
      >
        {day}
      </span>
      {has && (
        <span className="mt-auto block w-full min-w-0 text-center" aria-hidden>
          <span
            className={cx(
              'num block whitespace-nowrap text-[10.5px] font-bold leading-tight tracking-[-0.04em] min-[400px]:text-[11.5px] sm:text-[14px]',
              tone === 'pos' ? 'text-pos-hi' : tone === 'neg' ? 'text-neg-hi' : 'text-ink-2',
            )}
          >
            <span className="sm:hidden">{formatCompact(pnl)}</span>
            <span className="hidden sm:inline">
              {Math.abs(pnl) < 100_000_00 ? formatMoney(pnl, { sign: 'always', cents: Math.abs(pnl) < 1_000_00 }) : formatCompact(pnl)}
            </span>
          </span>
          <span className="num block truncate text-[9.5px] leading-tight text-[#d4d4d8] min-[400px]:text-[10px] sm:text-[11.5px]" aria-hidden>
            <span className="min-[360px]:hidden">{agg!.trades}×</span>
            <span className="hidden min-[360px]:inline">{tradeLabel(agg!.trades)}</span>
          </span>
        </span>
      )}
    </button>
  );
}
