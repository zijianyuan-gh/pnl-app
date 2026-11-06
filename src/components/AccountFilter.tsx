import { useState } from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { useApp } from '../state/app';
import { AccountDot, Sheet, cx } from './ui';

export function AccountFilterPill({ className }: { className?: string }) {
  const { accounts, accountFilter, setAccountFilter, T } = useApp();
  const [open, setOpen] = useState(false);
  const current = accounts.find((a) => a.id === accountFilter) ?? null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="account-filter"
        aria-label={`${T.common.account}: ${current?.name ?? T.common.allAccounts}`}
        className={cx(
          'inline-flex min-h-9 max-w-[52vw] items-center gap-2 rounded-full bg-surface-2 py-1 pl-3 pr-2.5 text-[14px] font-medium text-ink transition active:bg-surface-3',
          className,
        )}
      >
        {current ? <AccountDot color={current.color} /> : <Layers size={14} className="text-ink-2" />}
        <span className="truncate">{current?.name ?? T.common.allAccounts}</span>
        <ChevronDown size={15} className="shrink-0 text-ink-3" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={T.common.account}>
        <div className="overflow-hidden rounded-2xl bg-surface-2">
          {[null, ...accounts].map((a) => {
            const active = (a?.id ?? null) === accountFilter;
            return (
              <button
                key={a?.id ?? 'all'}
                type="button"
                onClick={() => {
                  setAccountFilter(a?.id ?? null);
                  setOpen(false);
                }}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[16px] transition active:bg-white/5 [&+&]:border-t [&+&]:border-line"
              >
                {a ? <AccountDot color={a.color} size={10} /> : <Layers size={16} className="text-ink-2" />}
                <span className="min-w-0 flex-1 truncate">
                  {a?.name ?? T.common.allAccounts}
                  {a?.archived && <span className="ml-2 text-[13px] text-ink-3">{T.common.archived}</span>}
                </span>
                {active && <Check size={18} className="text-ink" />}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
