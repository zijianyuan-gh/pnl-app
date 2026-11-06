import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { useApp, useFiltered } from '../state/app';
import { fmt } from '../i18n';
import { AccountFilterPill } from '../components/AccountFilter';
import { EquityChart, MonthlyBars } from '../components/charts';
import { EmptyState, InfoTip, Money, Segmented, cx } from '../components/ui';
import { formatDate, formatMonth, monthKeyOf } from '../lib/dates';
import { formatMoney } from '../lib/money';
import {
  aggregateByDay, cumulativeSeries, inRange, monthlySeries, presetRange, summarizeDays, summarizeTrades, tagBreakdown,
  type RangePreset,
} from '../lib/stats';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(v === 1 || v === 0 ? 0 : 1)}%`);

export function AnalyticsScreen() {
  const { T, locale, today } = useApp();
  const { trades } = useFiltered();
  const [preset, setPreset] = useState<RangePreset>('all');
  const [tableView, setTableView] = useState(false);

  const range = useMemo(() => presetRange(preset, today), [preset, today]);
  const inPeriod = useMemo(() => trades.filter((t) => inRange(t.date, range)), [trades, range]);
  const s = useMemo(() => summarizeTrades(inPeriod), [inPeriod]);
  const days = useMemo(() => summarizeDays([...aggregateByDay(inPeriod).values()]), [inPeriod]);
  const allTime = useMemo(() => trades.reduce((sum, t) => sum + t.pnlCents, 0), [trades]);
  const thisMonth = useMemo(() => {
    const k = monthKeyOf(today);
    return trades.reduce((sum, t) => (monthKeyOf(t.date) === k ? sum + t.pnlCents : sum), 0);
  }, [trades, today]);
  const cum = useMemo(() => cumulativeSeries(inPeriod), [inPeriod]);
  const months = useMemo(() => {
    const from = range.from ? monthKeyOf(range.from) : undefined;
    const to = range.to ? monthKeyOf(range.to) : undefined;
    // For "all", span from first to last trade; never extend into empty future months
    const series = monthlySeries(inPeriod, from, to && to > monthKeyOf(today) ? monthKeyOf(today) : to);
    return series;
  }, [inPeriod, range, today]);
  const tags = useMemo(() => tagBreakdown(inPeriod), [inPeriod]);

  const streakText = (n: number) => (n === 1 ? T.analytics.streakDay : fmt(T.analytics.streakDays, { n }));

  return (
    <div className="mx-auto w-full max-w-[720px] pb-6">
      <header className="pt-safe px-safe sticky top-0 z-20 bg-bg/95 pb-2 backdrop-blur">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h1 className="text-[28px] font-bold tracking-tight">{T.analytics.title}</h1>
          <AccountFilterPill />
        </div>
        <Segmented
          className="mt-2"
          size="sm"
          value={preset}
          onChange={setPreset}
          label="Period"
          options={(['month', '3m', 'ytd', '1y', 'all'] as RangePreset[]).map((p) => ({ value: p, label: T.analytics.range[p] }))}
        />
      </header>

      <div className="px-safe pt-2">
        {/* Hero */}
        <section className="mb-5 rounded-2xl bg-surface px-4 pb-4 pt-3.5">
          <p className="text-[13px] font-medium text-ink-3">
            {fmt(T.analytics.periodNet, { period: T.analytics.periodNames[preset] })}
          </p>
          <Money cents={s.netCents} className="mt-0.5 block text-[34px] font-bold leading-tight tracking-tight" testId="an-net" />
          <p className="num mt-1 text-[13px] text-ink-3">
            {fmt(T.analytics.countLine, { t: s.count, d: days.tradingDays })}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
            <div>
              <p className="text-[12px] text-ink-3">{T.analytics.allTime}</p>
              <Money cents={allTime} className="text-[16px] font-semibold" testId="an-alltime" />
            </div>
            <div>
              <p className="text-[12px] text-ink-3">{T.analytics.thisMonth}</p>
              <Money cents={thisMonth} className="text-[16px] font-semibold" testId="an-month" />
            </div>
          </div>
        </section>

        {s.count === 0 ? (
          <div className="rounded-2xl bg-surface">
            <EmptyState icon={<BarChart3 size={26} />} title={T.analytics.emptyTitle} body={T.analytics.emptyBody} />
          </div>
        ) : (
          <>
            {/* Cumulative curve */}
            <Card title={T.analytics.equity}>
              {cum.length >= 2 ? (
                <EquityChart points={cum} locale={locale} label={T.analytics.equity} dayLabel={T.calendar.dayNet} />
              ) : (
                <p className="py-8 text-center text-[13px] text-ink-3">{T.analytics.needMore}</p>
              )}
            </Card>

            {/* Win rates */}
            <section className="mb-5 grid grid-cols-2 gap-3">
              <StatTile
                label={T.analytics.tradeWinRate}
                help={T.analytics.tradeWinRateHelp}
                value={pct(s.winRate)}
                sub={
                  <>
                    {fmt(T.analytics.winsLosses, { w: s.wins, l: s.losses })}
                    {s.breakeven > 0 && <> · {fmt(T.analytics.breakeven, { n: s.breakeven })}</>}
                  </>
                }
                testId="an-trade-winrate"
              />
              <StatTile
                label={T.analytics.dayWinRate}
                help={T.analytics.dayWinRateHelp}
                value={pct(days.greenDayRate)}
                sub={
                  <>
                    {fmt(T.analytics.greenRed, { g: days.greenDays, r: days.redDays })}
                    {days.flatDays > 0 && <> · {fmt(T.analytics.flat, { n: days.flatDays })}</>}
                  </>
                }
                testId="an-day-winrate"
              />
            </section>

            <ListCard>
              <StatRow label={T.analytics.avgWin} value={s.avgWinCents === null ? '—' : <Money cents={s.avgWinCents} />} testId="an-avg-win" />
              <StatRow label={T.analytics.avgLoss} value={s.avgLossCents === null ? '—' : <Money cents={s.avgLossCents} />} testId="an-avg-loss" />
              <StatRow label={T.analytics.avgTrade} value={s.avgTradeCents === null ? '—' : <Money cents={s.avgTradeCents} />} />
              <StatRow
                label={T.analytics.profitFactor}
                help={T.analytics.profitFactorHelp}
                value={<span className="num">{s.profitFactor === null ? (s.wins ? '∞' : '—') : s.profitFactor.toFixed(2)}</span>}
              />
              <StatRow label={T.analytics.largestWin} value={s.largestWinCents === null ? '—' : <Money cents={s.largestWinCents} />} />
              <StatRow label={T.analytics.largestLoss} value={s.largestLossCents === null ? '—' : <Money cents={s.largestLossCents} />} />
              {s.feesCents > 0 && <StatRow label={T.analytics.fees} value={<span className="num text-ink-2">{formatMoney(s.feesCents)}</span>} />}
            </ListCard>

            <ListCard>
              <StatRow
                label={T.analytics.bestDay}
                sub={days.bestDay ? formatDate(days.bestDay.date, locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : undefined}
                value={days.bestDay ? <Money cents={days.bestDay.pnlCents} /> : '—'}
                testId="an-best-day"
              />
              <StatRow
                label={T.analytics.worstDay}
                sub={days.worstDay ? formatDate(days.worstDay.date, locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : undefined}
                value={days.worstDay ? <Money cents={days.worstDay.pnlCents} /> : '—'}
                testId="an-worst-day"
              />
              <StatRow label={T.analytics.winStreak} help={T.analytics.streakHelp} value={<span className="num">{streakText(days.longestWinStreak)}</span>} testId="an-win-streak" />
              <StatRow label={T.analytics.lossStreak} value={<span className="num">{streakText(days.longestLossStreak)}</span>} testId="an-loss-streak" />
              <StatRow
                label={T.analytics.currentStreak}
                value={
                  <span className={cx('num', days.currentStreak > 0 && 'text-pos', days.currentStreak < 0 && 'text-neg')}>
                    {days.currentStreak > 0
                      ? fmt(T.analytics.streakGreen, { n: days.currentStreak })
                      : days.currentStreak < 0
                        ? fmt(T.analytics.streakRed, { n: -days.currentStreak })
                        : '—'}
                  </span>
                }
              />
            </ListCard>

            {/* Monthly bars */}
            <Card
              title={T.analytics.monthly}
              action={
                <button
                  type="button"
                  onClick={() => setTableView((v) => !v)}
                  className="-mr-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink-2 hover:text-ink"
                  aria-pressed={tableView}
                >
                  {tableView ? <BarChart3 size={15} /> : <Table2 size={15} />}
                  {tableView ? T.analytics.chartView : T.analytics.tableView}
                </button>
              }
            >
              {tableView ? (
                <table className="num w-full text-[14px]" data-testid="monthly-table">
                  <thead>
                    <tr className="text-left text-[12px] text-ink-3">
                      <th className="py-1.5 font-medium">{T.analytics.month}</th>
                      <th className="py-1.5 text-right font-medium">{T.analytics.trades}</th>
                      <th className="py-1.5 text-right font-medium">{T.analytics.pnl}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...months].reverse().map((m) => (
                      <tr key={m.month} className="border-t border-line">
                        <td className="py-2">{formatMonth(m.month, locale)}</td>
                        <td className="py-2 text-right text-ink-2">{m.trades}</td>
                        <td className="py-2 text-right font-semibold">
                          <Money cents={m.pnlCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <MonthlyBars
                  months={months}
                  locale={locale}
                  label={T.analytics.monthly}
                  tradesLabel={(n) => (n === 1 ? T.calendar.trade : fmt(T.calendar.trades, { n }))}
                />
              )}
            </Card>

            {tags.length > 0 && (
              <>
                <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{T.analytics.byTag}</h3>
                <ListCard>
                  {tags.slice(0, 12).map((g) => (
                    <StatRow
                      key={g.tag}
                      label={g.tag}
                      sub={fmt(T.analytics.tagLine, { n: g.count, wr: pct(g.wins + g.losses ? g.wins / (g.wins + g.losses) : null) })}
                      value={<Money cents={g.netCents} />}
                    />
                  ))}
                </ListCard>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl bg-surface px-4 pb-3 pt-3">
      <div className="mb-1 flex min-h-8 items-center justify-between">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ListCard({ children }: { children: ReactNode }) {
  return <section className="mb-5 overflow-hidden rounded-2xl bg-surface">{children}</section>;
}

function StatTile({ label, value, sub, help, testId }: { label: string; value: ReactNode; sub?: ReactNode; help?: string; testId?: string }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1 text-[12.5px] font-medium text-ink-3">
        {label}
        {help && <InfoTip text={help} label={label} />}
      </div>
      <div className="num mt-0.5 text-[26px] font-bold leading-tight" data-testid={testId && `${testId}-value`}>
        {value}
      </div>
      {sub && <div className="num mt-0.5 text-[12.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

function StatRow({ label, value, sub, help, testId }: { label: string; value: ReactNode; sub?: string; help?: string; testId?: string }) {
  return (
    <div className="flex min-h-[50px] flex-wrap items-center gap-x-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-line" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px]">
          <span className="truncate">{label}</span>
          {help && <InfoTip text={help} label={label} />}
        </div>
        {sub && <div className="text-[12.5px] text-ink-3">{sub}</div>}
      </div>
      <div className="shrink-0 text-[15px] font-semibold" data-testid={testId && `${testId}-value`}>
        {value}
      </div>
    </div>
  );
}
