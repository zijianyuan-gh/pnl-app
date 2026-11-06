import type { Account, CashFlow, Trade } from '../db/types';
import { addMonths, monthEnd, monthKeyOf, monthRange, type ISODate, type MonthKey } from './dates';
import { divRound, type Cents } from './money';

/**
 * Pure statistics. Definitions (also shown in the UI):
 *  - Trade P&L counts trades only. Deposits/withdrawals are never P&L.
 *  - Winning trade: pnl > 0. Losing trade: pnl < 0. Break-even: pnl = 0.
 *  - Trade win rate = winning trades / (winning + losing trades). Break-even excluded.
 *  - Trading day: a calendar date with ≥1 trade. Day P&L = sum of that day's trades.
 *  - Green-day rate = green days / (green + red days). Flat days excluded.
 *  - Streaks are counted over consecutive *trading days* (days without trades are skipped,
 *    a flat day ends a streak).
 *  - Estimated balance = starting balance + deposits − withdrawals + trade P&L,
 *    counting only records dated on/after the account's balance start date.
 */

export interface DateRange {
  from?: ISODate | null;
  to?: ISODate | null;
}

export function inRange(date: ISODate, r: DateRange): boolean {
  if (r.from && date < r.from) return false;
  if (r.to && date > r.to) return false;
  return true;
}

export function filterByAccount<T extends { accountId: string }>(rows: T[], accountId: string | null): T[] {
  return accountId ? rows.filter((r) => r.accountId === accountId) : rows;
}

export interface DayAgg {
  date: ISODate;
  pnlCents: Cents;
  trades: number;
  wins: number;
  losses: number;
}

export function aggregateByDay(trades: Trade[]): Map<ISODate, DayAgg> {
  const map = new Map<ISODate, DayAgg>();
  for (const t of trades) {
    let d = map.get(t.date);
    if (!d) {
      d = { date: t.date, pnlCents: 0, trades: 0, wins: 0, losses: 0 };
      map.set(t.date, d);
    }
    d.pnlCents += t.pnlCents;
    d.trades += 1;
    if (t.pnlCents > 0) d.wins += 1;
    else if (t.pnlCents < 0) d.losses += 1;
  }
  return map;
}

export interface TradeSummary {
  netCents: Cents;
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** null when there are no decided (non-break-even) trades */
  winRate: number | null;
  grossProfitCents: Cents;
  grossLossCents: Cents; // negative or 0
  avgWinCents: Cents | null;
  avgLossCents: Cents | null; // negative
  avgTradeCents: Cents | null;
  largestWinCents: Cents | null;
  largestLossCents: Cents | null;
  /** gross profit / |gross loss|; null if no losses */
  profitFactor: number | null;
  feesCents: Cents;
}

export function summarizeTrades(trades: Trade[]): TradeSummary {
  let net = 0;
  let wins = 0;
  let losses = 0;
  let be = 0;
  let gp = 0;
  let gl = 0;
  let maxWin: number | null = null;
  let maxLoss: number | null = null;
  let fees = 0;
  for (const t of trades) {
    net += t.pnlCents;
    fees += t.feesCents ?? 0;
    if (t.pnlCents > 0) {
      wins++;
      gp += t.pnlCents;
      if (maxWin === null || t.pnlCents > maxWin) maxWin = t.pnlCents;
    } else if (t.pnlCents < 0) {
      losses++;
      gl += t.pnlCents;
      if (maxLoss === null || t.pnlCents < maxLoss) maxLoss = t.pnlCents;
    } else be++;
  }
  const decided = wins + losses;
  return {
    netCents: net,
    count: trades.length,
    wins,
    losses,
    breakeven: be,
    winRate: decided ? wins / decided : null,
    grossProfitCents: gp,
    grossLossCents: gl,
    avgWinCents: wins ? divRound(gp, wins) : null,
    avgLossCents: losses ? divRound(gl, losses) : null,
    avgTradeCents: trades.length ? divRound(net, trades.length) : null,
    largestWinCents: maxWin,
    largestLossCents: maxLoss,
    profitFactor: gl !== 0 ? gp / Math.abs(gl) : null,
    feesCents: fees,
  };
}

export interface DaySummary {
  tradingDays: number;
  greenDays: number;
  redDays: number;
  flatDays: number;
  greenDayRate: number | null;
  bestDay: DayAgg | null;
  worstDay: DayAgg | null;
  avgDayCents: Cents | null;
  longestWinStreak: number;
  longestLossStreak: number;
  /** positive = current green streak length, negative = red streak length, 0 = none */
  currentStreak: number;
}

export function summarizeDays(days: DayAgg[]): DaySummary {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let green = 0;
  let red = 0;
  let flat = 0;
  let best: DayAgg | null = null;
  let worst: DayAgg | null = null;
  let total = 0;
  let winRun = 0;
  let lossRun = 0;
  let maxWin = 0;
  let maxLoss = 0;
  for (const d of sorted) {
    total += d.pnlCents;
    if (d.pnlCents > 0) {
      green++;
      winRun++;
      lossRun = 0;
    } else if (d.pnlCents < 0) {
      red++;
      lossRun++;
      winRun = 0;
    } else {
      flat++;
      winRun = 0;
      lossRun = 0;
    }
    maxWin = Math.max(maxWin, winRun);
    maxLoss = Math.max(maxLoss, lossRun);
    if (d.pnlCents > 0 && (!best || d.pnlCents > best.pnlCents)) best = d;
    if (d.pnlCents < 0 && (!worst || d.pnlCents < worst.pnlCents)) worst = d;
  }
  const decided = green + red;
  return {
    tradingDays: sorted.length,
    greenDays: green,
    redDays: red,
    flatDays: flat,
    greenDayRate: decided ? green / decided : null,
    bestDay: best,
    worstDay: worst,
    avgDayCents: sorted.length ? divRound(total, sorted.length) : null,
    longestWinStreak: maxWin,
    longestLossStreak: maxLoss,
    currentStreak: winRun > 0 ? winRun : lossRun > 0 ? -lossRun : 0,
  };
}

export interface MonthPoint {
  month: MonthKey;
  pnlCents: Cents;
  trades: number;
}

/** One point per month from the first to last month (inclusive), zero-filled. */
export function monthlySeries(trades: Trade[], fromMonth?: MonthKey, toMonth?: MonthKey): MonthPoint[] {
  const byMonth = new Map<MonthKey, MonthPoint>();
  let min: MonthKey | null = null;
  let max: MonthKey | null = null;
  for (const t of trades) {
    const k = monthKeyOf(t.date);
    let p = byMonth.get(k);
    if (!p) {
      p = { month: k, pnlCents: 0, trades: 0 };
      byMonth.set(k, p);
    }
    p.pnlCents += t.pnlCents;
    p.trades++;
    if (!min || k < min) min = k;
    if (!max || k > max) max = k;
  }
  const a = fromMonth ?? min;
  const b = toMonth ?? max;
  if (!a || !b) return [];
  return monthRange(a, b).map((k) => byMonth.get(k) ?? { month: k, pnlCents: 0, trades: 0 });
}

export interface CumPoint {
  date: ISODate;
  dayCents: Cents;
  cumCents: Cents;
}

/** Cumulative P&L by trading day (sorted ascending). */
export function cumulativeSeries(trades: Trade[]): CumPoint[] {
  const days = [...aggregateByDay(trades).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let cum = 0;
  return days.map((d) => {
    cum += d.pnlCents;
    return { date: d.date, dayCents: d.pnlCents, cumCents: cum };
  });
}

export interface BalanceBreakdown {
  startingCents: Cents;
  depositsCents: Cents;
  withdrawalsCents: Cents; // positive number
  tradingPnlCents: Cents; // only trades counted toward the balance (on/after start date)
  estimatedCents: Cents;
  /** trades dated before the balance start date (excluded from the balance) */
  excludedTrades: number;
}

export function accountBalance(account: Account, trades: Trade[], cashflows: CashFlow[]): BalanceBreakdown {
  let dep = 0;
  let wd = 0;
  let pnl = 0;
  let excluded = 0;
  for (const c of cashflows) {
    if (c.accountId !== account.id || c.date < account.startDate) continue;
    if (c.type === 'deposit') dep += c.amountCents;
    else wd += c.amountCents;
  }
  for (const t of trades) {
    if (t.accountId !== account.id) continue;
    if (t.date < account.startDate) {
      excluded++;
      continue;
    }
    pnl += t.pnlCents;
  }
  return {
    startingCents: account.startingBalanceCents,
    depositsCents: dep,
    withdrawalsCents: wd,
    tradingPnlCents: pnl,
    estimatedCents: account.startingBalanceCents + dep - wd + pnl,
    excludedTrades: excluded,
  };
}

export function combinedBalance(accounts: Account[], trades: Trade[], cashflows: CashFlow[]): BalanceBreakdown {
  const total: BalanceBreakdown = {
    startingCents: 0,
    depositsCents: 0,
    withdrawalsCents: 0,
    tradingPnlCents: 0,
    estimatedCents: 0,
    excludedTrades: 0,
  };
  for (const a of accounts) {
    const b = accountBalance(a, trades, cashflows);
    total.startingCents += b.startingCents;
    total.depositsCents += b.depositsCents;
    total.withdrawalsCents += b.withdrawalsCents;
    total.tradingPnlCents += b.tradingPnlCents;
    total.estimatedCents += b.estimatedCents;
    total.excludedTrades += b.excludedTrades;
  }
  return total;
}

export interface TagStat {
  tag: string;
  netCents: Cents;
  count: number;
  wins: number;
  losses: number;
}

export function tagBreakdown(trades: Trade[]): TagStat[] {
  const map = new Map<string, TagStat>();
  for (const t of trades) {
    for (const tag of new Set(t.tags)) {
      let s = map.get(tag);
      if (!s) {
        s = { tag, netCents: 0, count: 0, wins: 0, losses: 0 };
        map.set(tag, s);
      }
      s.netCents += t.pnlCents;
      s.count++;
      if (t.pnlCents > 0) s.wins++;
      else if (t.pnlCents < 0) s.losses++;
    }
  }
  return [...map.values()].sort((a, b) => b.netCents - a.netCents);
}

export type RangePreset = 'month' | '3m' | 'ytd' | '1y' | 'all';

/** Resolve an analytics range preset relative to `today`. */
export function presetRange(preset: RangePreset, today: ISODate): DateRange {
  const month = monthKeyOf(today);
  switch (preset) {
    case 'month':
      return { from: `${month}-01`, to: monthEnd(month) };
    case '3m':
      return { from: `${addMonths(month, -2)}-01`, to: monthEnd(month) };
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case '1y':
      return { from: `${addMonths(month, -11)}-01`, to: monthEnd(month) };
    case 'all':
    default:
      return {};
  }
}
