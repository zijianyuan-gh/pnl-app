import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Info, X } from 'lucide-react';
import { formatMoney, pnlTone, type Cents } from '../lib/money';

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

// ---------- Buttons ----------

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
        size === 'sm' && 'min-h-9 px-3 text-sm',
        size === 'md' && 'min-h-11 px-4 text-[15px]',
        size === 'lg' && 'min-h-[52px] px-5 text-[17px]',
        variant === 'primary' && 'bg-ink text-black hover:bg-white',
        variant === 'secondary' && 'bg-surface-3 text-ink hover:bg-[#2e2e33]',
        variant === 'ghost' && 'text-ink-2 hover:text-ink',
        variant === 'danger' && 'bg-neg text-black hover:brightness-110',
        variant === 'danger-ghost' && 'text-neg hover:bg-neg/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/5 hover:text-ink active:bg-white/10 disabled:opacity-30',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------- Segmented control ----------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; tone?: 'pos' | 'neg' }[];
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 rounded-[9px] px-2 font-semibold transition',
              size === 'md' ? 'min-h-10 text-[15px]' : 'min-h-8 text-[13px]',
              active
                ? o.tone === 'pos'
                  ? 'bg-pos/18 text-pos shadow-sm'
                  : o.tone === 'neg'
                    ? 'bg-neg/18 text-neg shadow-sm'
                    : 'bg-surface-3 text-ink shadow-sm'
                : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Money ----------

export function Money({
  cents,
  sign = 'always',
  className,
  colored = true,
  showCents = true,
  testId,
}: {
  testId?: string;
  cents: Cents;
  sign?: 'always' | 'negative' | 'never';
  className?: string;
  colored?: boolean;
  showCents?: boolean;
}) {
  const tone = pnlTone(cents);
  return (
    <span
      data-testid={testId}
      data-cents={cents}
      className={cx('num', colored && tone === 'pos' && 'text-pos', colored && tone === 'neg' && 'text-neg', className)}
    >
      {formatMoney(cents, { sign, cents: showCents })}
    </span>
  );
}

// ---------- Sheet (bottom sheet on phones, dialog on desktop) ----------

export function Sheet({
  open,
  onClose,
  title,
  headerLeft,
  headerRight,
  children,
  footer,
  labelledBy,
  size = 'md',
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
  size?: 'md' | 'lg';
  testId?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    // focus the panel for screen readers without popping the keyboard
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid={testId}>
      <div className="animate-fade-in absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        tabIndex={-1}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          marginBottom: 'var(--kb)',
          maxHeight: 'calc(min(var(--vvh, 100dvh), 100dvh) - max(var(--sat), 12px) - 8px)',
        }}
        className={cx(
          'animate-sheet-in sm:animate-pop-in relative flex w-full flex-col overflow-hidden rounded-t-[22px] bg-surface shadow-2xl outline-none sm:mb-0 sm:rounded-[22px]',
          size === 'md' ? 'sm:max-w-[480px]' : 'sm:max-w-[640px]',
        )}
      >
        <div
          className="shrink-0 touch-none border-b border-line"
          onTouchStart={(e) => (drag.current = { y: e.touches[0].clientY, dy: 0 })}
          onTouchMove={(e) => {
            if (!drag.current) return;
            const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
            drag.current.dy = dy;
            setDragY(dy);
          }}
          onTouchEnd={() => {
            const dy = drag.current?.dy ?? 0;
            drag.current = null;
            setDragY(0);
            if (dy > 90) onClose();
          }}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20 sm:hidden" aria-hidden />
          <div className="grid min-h-12 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 pb-1.5 pt-1 sm:pt-2">
            <div className="flex justify-start">{headerLeft}</div>
            {title ? (
              <h2 id={titleId} className="truncate text-center text-[17px] font-semibold">
                {title}
              </h2>
            ) : (
              <span />
            )}
            <div className="flex justify-end">
              {headerRight ?? (
                <IconButton label="Close" onClick={onClose}>
                  <X size={20} />
                </IconButton>
              )}
            </div>
          </div>
        </div>
        <div className="scroll-area min-h-0 flex-1 px-4 pb-4 pt-3">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line bg-surface px-4 pt-3" style={{ paddingBottom: 'max(var(--sab), 12px)' }}>
            {footer}
          </div>
        )}
        {!footer && <div className="shrink-0" style={{ height: 'var(--sab)' }} />}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Lists (iOS inset grouped) ----------

export function Group({
  title,
  children,
  className,
  footer,
  inset,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  /** use inside sheets (raised surface) */
  inset?: boolean;
}) {
  return (
    <section className={cx('mb-6', className)}>
      {title && <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>}
      <div className={cx('overflow-hidden rounded-2xl', inset ? 'bg-surface-2' : 'bg-surface')}>{children}</div>
      {footer && <div className="mt-2 px-1 text-[13px] leading-snug text-ink-3">{footer}</div>}
    </section>
  );
}

export function Row({
  label,
  sub,
  value,
  valueSub,
  onClick,
  chevron,
  icon,
  className,
  testId,
}: {
  label: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueSub?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  icon?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const content = (
    <>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-ink">{label}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{sub}</span>}
      </span>
      {(value !== undefined || valueSub) && (
        <span className="shrink-0 text-right">
          {value !== undefined && <span className="block text-[15px] font-semibold">{value}</span>}
          {valueSub && <span className="mt-0.5 block text-[12px] text-ink-3">{valueSub}</span>}
        </span>
      )}
      {chevron && <ChevronRight size={18} className="shrink-0 text-ink-3" />}
    </>
  );
  const cls = cx(
    'flex w-full min-h-[52px] items-center gap-3 px-4 py-2.5 text-left [&+&]:border-t [&+&]:border-line',
    onClick && 'transition active:bg-white/5 hover:bg-white/[0.03]',
    className,
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} data-testid={testId}>
      {content}
    </button>
  ) : (
    <div className={cls} data-testid={testId}>
      {content}
    </div>
  );
}

// ---------- Misc ----------

export function AccountDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} aria-hidden />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">{icon}</div>}
      <p className="text-[17px] font-semibold">{title}</p>
      {body && <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-ink-3">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Tap-to-reveal definition popover, used for statistic definitions. */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: PointerEvent) => {
      if (!btn.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), window.innerWidth - width - 12);
    setPos({ left, top: r.bottom + 6, width });
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={!!pos}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="relative -my-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-3 before:absolute before:-inset-2.5 before:content-[''] hover:text-ink-2"
      >
        <Info size={14} />
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="animate-fade-in fixed z-[90] rounded-xl border border-line-strong bg-surface-3 px-3 py-2.5 text-[13px] font-normal normal-case leading-snug tracking-normal text-ink-2 shadow-xl"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

export function FieldLabel({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between px-1 text-[13px] font-medium text-ink-2">
      <span>{children}</span>
      {hint && <span className="text-[12px] font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 px-1 text-[13px] text-neg">
      {children}
    </p>
  );
}

export function Chip({
  active,
  children,
  onClick,
  className,
  testId,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cx(
        'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition',
        active ? 'border-ink/80 bg-ink text-black' : 'border-line-strong bg-transparent text-ink-2 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}
