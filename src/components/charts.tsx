import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatDate, formatMonth } from '../lib/dates';
import { formatCompact, formatMoney } from '../lib/money';
import type { CumPoint, MonthPoint } from '../lib/stats';

const POS = '#3ddc97';
const NEG = '#f05d5e';
const GRID = 'rgb(255 255 255 / 0.07)';
const AXIS_TEXT = '#71717a';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Axis domain (always including 0, padded 8%) plus "nice" ticks inside it, in cents.
 * The domain hugs the data so a tiny dip below zero doesn't waste half the chart.
 */
export function axisScale(min: number, max: number, count = 3): { lo: number; hi: number; ticks: number[] } {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 100_00;
  const pad = (hi - lo) * 0.08;
  if (hi > 0) hi += pad;
  if (lo < 0) lo -= pad;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) ticks.push(Math.round(v));
  if (!ticks.includes(0)) ticks.push(0);
  return { lo, hi, ticks: ticks.sort((x, y) => x - y) };
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const tipW = 150;
  const left = Math.min(Math.max(0, x - tipW / 2), Math.max(0, width - tipW));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-xl border border-line-strong bg-surface-3/95 px-3 py-2 text-[12.5px] shadow-lg backdrop-blur"
      style={{ left, width: tipW }}
    >
      {children}
    </div>
  );
}

// ---------------- Cumulative P&L line ----------------

export function EquityChart({ points, locale, label, dayLabel }: { points: CumPoint[]; locale: string; label: string; dayLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const padT = 44; // room for the tooltip
  const padB = 22;
  const padR = 48;
  const padL = 4;

  const data = useMemo(() => {
    // Start from zero so the curve shows the path from flat
    if (!points.length) return [];
    return [{ date: points[0].date, dayCents: 0, cumCents: 0, synthetic: true }, ...points.map((p) => ({ ...p, synthetic: false }))];
  }, [points]);

  if (!data.length) return <div ref={ref} />;
  const vals = data.map((d) => d.cumCents);
  const { lo: yMin, hi: yMax, ticks } = axisScale(Math.min(...vals), Math.max(...vals), 3);
  const plotW = Math.max(10, width - padL - padR);
  const plotH = H - padT - padB;
  const x = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const zeroY = y(0);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.cumCents).toFixed(1)}`).join('');
  const area = `${line}L${x(data.length - 1).toFixed(1)},${zeroY.toFixed(1)}L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`;
  // Gradient stop at the zero line → green above, red below
  const zeroFrac = Math.min(1, Math.max(0, (zeroY - padT) / plotH));

  const pick = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = clientX - rect.left - padL;
    const i = Math.round((px / plotW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(1, i)));
  };
  const h = hover !== null ? data[hover] : null;
  const last = data[data.length - 1];

  return (
    <div
      ref={ref}
      className="relative select-none"
      style={{ touchAction: 'pan-y' }}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onPointerCancel={() => setHover(null)}
      role="img"
      aria-label={`${label}: ${formatMoney(last.cumCents, { sign: 'always' })}`}
      data-testid="equity-chart"
    >
      {width > 0 && (
        <svg width={width} height={H} className="block overflow-visible">
          <defs>
            <linearGradient id={`l${gid}`} x1="0" x2="0" y1={padT} y2={padT + plotH} gradientUnits="userSpaceOnUse">
              <stop offset={zeroFrac} stopColor={POS} />
              <stop offset={zeroFrac} stopColor={NEG} />
            </linearGradient>
            <linearGradient id={`a${gid}`} x1="0" x2="0" y1={padT} y2={padT + plotH} gradientUnits="userSpaceOnUse">
              <stop offset={0} stopColor={POS} stopOpacity={0.22} />
              <stop offset={zeroFrac} stopColor={POS} stopOpacity={0.02} />
              <stop offset={zeroFrac} stopColor={NEG} stopOpacity={0.02} />
              <stop offset={1} stopColor={NEG} stopOpacity={0.22} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgb(255 255 255 / 0.22)' : GRID} strokeDasharray={t === 0 ? '3 3' : undefined} />
              <text x={padL + plotW + 6} y={y(t)} dy="0.32em" fill={AXIS_TEXT} fontSize={10.5} className="num">
                {t === 0 ? '$0' : formatCompact(t)}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#a${gid})`} />
          <path d={line} fill="none" stroke={`url(#l${gid})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <text x={padL} y={H - 6} fill={AXIS_TEXT} fontSize={10.5}>
            {formatDate(data[1]?.date ?? data[0].date, locale, { month: 'short', day: 'numeric', year: '2-digit' })}
          </text>
          <text x={padL + plotW} y={H - 6} fill={AXIS_TEXT} fontSize={10.5} textAnchor="end">
            {formatDate(last.date, locale, { month: 'short', day: 'numeric', year: '2-digit' })}
          </text>
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT - 4} y2={padT + plotH} stroke="rgb(255 255 255 / 0.35)" />
              <circle cx={x(hover)} cy={y(h.cumCents)} r={4.5} fill={h.cumCents >= 0 ? POS : NEG} stroke="#141416" strokeWidth={2} />
            </g>
          )}
          {!h && <circle cx={x(data.length - 1)} cy={y(last.cumCents)} r={4} fill={last.cumCents >= 0 ? POS : NEG} stroke="#141416" strokeWidth={2} />}
        </svg>
      )}
      {h && hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          <div className="text-ink-3">{formatDate(h.date, locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div className="num font-semibold text-ink">{formatMoney(h.cumCents, { sign: 'always' })}</div>
          <div className="num text-ink-2">{dayLabel} {formatMoney(h.dayCents, { sign: 'always' })}</div>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------- Monthly bars ----------------

export function MonthlyBars({
  months,
  locale,
  label,
  tradesLabel,
}: {
  months: MonthPoint[];
  locale: string;
  label: string;
  tradesLabel: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const padT = 44;
  const padB = 22;
  const padR = 48;
  const minBar = 14;
  const plotWVisible = Math.max(10, width - padR);
  const slot = Math.max(minBar + 2, plotWVisible / Math.max(1, months.length));
  const plotW = slot * months.length;
  const scroll = plotW > plotWVisible + 1;
  const vals = months.map((m) => m.pnlCents);
  const { lo: yMin, hi: yMax, ticks } = axisScale(Math.min(0, ...vals), Math.max(0, ...vals), 3);
  const plotH = H - padT - padB;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const zeroY = y(0);
  const barW = Math.min(36, slot - 2); // 2px gap between adjacent bars
  const labelEvery = Math.ceil(28 / slot);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // show the most recent months first
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [months.length, width]);

  const h = hover !== null ? months[hover] : null;
  const scrollX = scrollRef.current?.scrollLeft ?? 0;

  return (
    <div ref={ref} className="relative" data-testid="monthly-chart" role="img" aria-label={label}>
      {width > 0 && (
        <div className="flex">
          <div ref={scrollRef} className="no-scrollbar min-w-0 flex-1 overflow-x-auto" onScroll={() => setHover(null)}>
            <svg width={scroll ? plotW : plotWVisible} height={H} className="block">
              {ticks.map((t) => (
                <line key={t} x1={0} x2={scroll ? plotW : plotWVisible} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgb(255 255 255 / 0.22)' : GRID} />
              ))}
              {months.map((m, i) => {
                const cx = i * slot + slot / 2;
                const top = y(Math.max(0, m.pnlCents));
                const bottom = y(Math.min(0, m.pnlCents));
                const bh = Math.max(m.pnlCents === 0 ? 0 : 2, bottom - top);
                const r = Math.min(4, barW / 2, bh);
                const x0 = cx - barW / 2;
                // rounded data-end only; flat end anchored on the baseline
                const d =
                  m.pnlCents >= 0
                    ? `M${x0},${zeroY}V${zeroY - bh + r}Q${x0},${zeroY - bh} ${x0 + r},${zeroY - bh}H${x0 + barW - r}Q${x0 + barW},${zeroY - bh} ${x0 + barW},${zeroY - bh + r}V${zeroY}Z`
                    : `M${x0},${zeroY}V${zeroY + bh - r}Q${x0},${zeroY + bh} ${x0 + r},${zeroY + bh}H${x0 + barW - r}Q${x0 + barW},${zeroY + bh} ${x0 + barW},${zeroY + bh - r}V${zeroY}Z`;
                const dim = hover !== null && hover !== i;
                return (
                  <g key={m.month}>
                    {m.pnlCents !== 0 && <path d={d} fill={m.pnlCents > 0 ? POS : NEG} opacity={dim ? 0.4 : 1} />}
                    {(i % labelEvery === 0 || i === months.length - 1) && (
                      <text x={cx} y={H - 6} fill={hover === i ? '#f4f4f5' : AXIS_TEXT} fontSize={10.5} textAnchor="middle">
                        {formatMonth(m.month, locale, 'short').replace(/\s?\d{4}年?/, '').replace(/^(\D+)\s\d+$/, '$1')}
                      </text>
                    )}
                    {/* generous hit target */}
                    <rect
                      x={i * slot}
                      y={0}
                      width={slot}
                      height={H}
                      fill="transparent"
                      onPointerEnter={() => setHover(i)}
                      onPointerDown={() => setHover(i)}
                      onPointerLeave={() => setHover(null)}
                      data-testid={`bar-${m.month}`}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
          <svg width={padR} height={H} className="block shrink-0">
            {ticks.map((t) => (
              <text key={t} x={6} y={y(t)} dy="0.32em" fill={AXIS_TEXT} fontSize={10.5} className="num">
                {t === 0 ? '$0' : formatCompact(t)}
              </text>
            ))}
          </svg>
        </div>
      )}
      {h && hover !== null && (
        <Tooltip x={hover * slot + slot / 2 - scrollX} width={width - padR}>
          <div className="text-ink-3">{formatMonth(h.month, locale)}</div>
          <div className={`num font-semibold ${h.pnlCents > 0 ? 'text-pos' : h.pnlCents < 0 ? 'text-neg' : 'text-ink'}`}>
            {formatMoney(h.pnlCents, { sign: 'always' })}
          </div>
          <div className="num text-ink-2">{tradesLabel(h.trades)}</div>
        </Tooltip>
      )}
    </div>
  );
}
