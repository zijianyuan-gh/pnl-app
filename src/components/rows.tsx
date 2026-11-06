import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { Account, CashFlow, Trade } from '../db/types';
import { useApp } from '../state/app';
import { formatMoney } from '../lib/money';
import { AccountDot, Money } from './ui';

export function TradeRow({ trade, account, showAccount = true }: { trade: Trade; account?: Account; showAccount?: boolean }) {
  const { openAdd, T } = useApp();
  const meta = [showAccount && account?.name, trade.platform].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={() => openAdd({ editTrade: trade })}
      data-testid="trade-row"
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03] active:bg-white/5 [&+&]:border-t [&+&]:border-line"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {account && showAccount && <AccountDot color={account.color} />}
          <span className="truncate text-[15px] font-medium">{trade.symbol || T.trades.untitled}</span>
          {trade.side && (
            <span className="shrink-0 rounded bg-surface-3 px-1.5 py-px text-[11px] font-medium uppercase text-ink-2">
              {trade.side === 'long' ? T.add.long : T.add.short}
            </span>
          )}
        </span>
        {(meta || trade.tags.length > 0 || trade.notes) && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12.5px] text-ink-3">
            {meta && <span className="min-w-[4ch] truncate">{meta}</span>}
            {trade.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="max-w-[45%] shrink-0 truncate rounded-full bg-surface-3 px-2 py-px text-[11.5px] text-ink-2">
                {tag}
              </span>
            ))}
            {!meta && trade.tags.length === 0 && trade.notes && <span className="truncate">{trade.notes}</span>}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <Money cents={trade.pnlCents} className="block text-[16px] font-semibold" />
        {trade.feesCents ? (
          <span className="num block text-[11.5px] text-ink-3">
            {T.add.fees} {formatMoney(trade.feesCents)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function FlowRow({ flow, account, showAccount = true }: { flow: CashFlow; account?: Account; showAccount?: boolean }) {
  const { openAdd, T } = useApp();
  const dep = flow.type === 'deposit';
  return (
    <button
      type="button"
      onClick={() => openAdd({ editFlow: flow })}
      data-testid="flow-row"
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03] active:bg-white/5 [&+&]:border-t [&+&]:border-line"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2">
        {dep ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{dep ? T.add.kindDeposit : T.add.kindWithdrawal}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
          {[showAccount && account?.name, flow.notes].filter(Boolean).join(' · ')}
        </span>
      </span>
      {/* Transfers are shown neutral — they are not profit or loss */}
      <span className="num shrink-0 text-[16px] font-semibold text-ink-2">
        {dep ? '+' : '−'}
        {formatMoney(flow.amountCents, { sign: 'never' })}
      </span>
    </button>
  );
}
