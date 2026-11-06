import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../state/app';
import { fmt } from '../i18n';
import {
  addCashFlow, addTrade, createAccount, deleteCashFlows, deleteTrades, updateCashFlow, updateTrade,
} from '../db/actions';
import { ACCOUNT_COLORS, type Account } from '../db/types';
import { addDays, formatDate, isValidISODate, isValidTime } from '../lib/dates';
import { centsToInput, formatMoney, parseMoney } from '../lib/money';
import { AccountDot, Button, Chip, ErrorText, FieldLabel, Segmented, Sheet, cx } from './ui';

type Kind = 'trade' | 'deposit' | 'withdrawal';
const LAST_ACCOUNT_KEY = 'daybook.lastAccount';
/**
 * Unsaved new entry, kept on this device only (localStorage) so an app update, an iOS memory
 * kill or an accidental swipe-close never loses what was typed. Cleared on save or "Discard".
 */
export const DRAFT_KEY = 'daybook.draft.v1';
const DRAFT_MAX_AGE = 3 * 86_400_000;

interface Draft {
  savedAt: number;
  kind: Kind;
  accountId: string;
  date: string;
  sign: 'pos' | 'neg';
  amount: string;
  symbol: string;
  platform: string;
  tags: string[];
  fees: string;
  notes: string;
  side: 'long' | 'short' | null;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  entryTime: string;
  exitTime: string;
}

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    if (!d || typeof d !== 'object' || Date.now() - d.savedAt > DRAFT_MAX_AGE) return null;
    return d;
  } catch {
    return null;
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export function QuickAddSheet() {
  const { addRequest, closeAdd } = useApp();
  // Remount the form for every request so state always starts clean
  const key = useMemo(() => Math.random(), [addRequest]);
  if (!addRequest) return null;
  return <QuickAddForm key={key} onClose={closeAdd} />;
}

function QuickAddForm({ onClose }: { onClose: () => void }) {
  const { addRequest: req, accounts, trades, today, accountFilter, T, locale, toast, confirm } = useApp();
  const editTrade = req?.editTrade;
  const editFlow = req?.editFlow;
  const isEdit = !!(editTrade || editFlow);

  const activeAccounts = accounts.filter((a) => !a.archived);
  const defaultAccountId = (() => {
    const candidates = [editTrade?.accountId, editFlow?.accountId, req?.accountId, accountFilter, lsGet(LAST_ACCOUNT_KEY)];
    for (const c of candidates) if (c && accounts.some((a) => a.id === c)) return c;
    return activeAccounts[0]?.id ?? accounts[0]?.id ?? '';
  })();

  // A saved draft only applies to new entries, and only if its account still exists
  const [draft] = useState<Draft | null>(() => {
    if (isEdit) return null;
    const d = readDraft();
    return d && accounts.some((a) => a.id === d.accountId) ? d : null;
  });
  const [draftNotice, setDraftNotice] = useState(!!draft);
  const D = draft;

  const [kind, setKind] = useState<Kind>(editFlow ? editFlow.type : editTrade ? 'trade' : (D?.kind ?? req?.kind ?? 'trade'));
  const [accountId, setAccountId] = useState(D?.accountId ?? defaultAccountId);
  const [date, setDate] = useState(editTrade?.date ?? editFlow?.date ?? D?.date ?? req?.date ?? today);
  const [sign, setSign] = useState<'pos' | 'neg'>(editTrade ? (editTrade.pnlCents < 0 ? 'neg' : 'pos') : (D?.sign ?? 'pos'));
  const [amount, setAmount] = useState(
    editTrade ? centsToInput(editTrade.pnlCents) : editFlow ? centsToInput(editFlow.amountCents) : (D?.amount ?? ''),
  );
  const [symbol, setSymbol] = useState(editTrade?.symbol ?? D?.symbol ?? '');
  const [platform, setPlatform] = useState(editTrade?.platform ?? D?.platform ?? '');
  const [tags, setTags] = useState<string[]>(editTrade?.tags ?? D?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [fees, setFees] = useState(editTrade?.feesCents != null ? centsToInput(editTrade.feesCents) : (D?.fees ?? ''));
  const [notes, setNotes] = useState(editTrade?.notes ?? editFlow?.notes ?? D?.notes ?? '');
  const [side, setSide] = useState<'long' | 'short' | null>(editTrade?.side ?? D?.side ?? null);
  const [quantity, setQuantity] = useState(editTrade?.quantity ?? D?.quantity ?? '');
  const [entryPrice, setEntryPrice] = useState(editTrade?.entryPrice ?? D?.entryPrice ?? '');
  const [exitPrice, setExitPrice] = useState(editTrade?.exitPrice ?? D?.exitPrice ?? '');
  const [entryTime, setEntryTime] = useState(editTrade?.entryTime ?? D?.entryTime ?? '');
  const [exitTime, setExitTime] = useState(editTrade?.exitTime ?? D?.exitTime ?? '');
  const detailSource = editTrade ?? (D ? { ...D, feesCents: D.fees ? 1 : null } : null);
  const [showMore, setShowMore] = useState(
    !!detailSource &&
      !!(detailSource.symbol || detailSource.platform || detailSource.tags.length || detailSource.feesCents != null || detailSource.notes ||
        detailSource.side || detailSource.quantity || detailSource.entryPrice || detailSource.exitPrice || detailSource.entryTime || detailSource.exitTime),
  );

  // Persist the unsaved new entry on every change
  useEffect(() => {
    if (isEdit) return;
    // (tags alone don't count: they are carried over by "Save & next" on purpose)
    const meaningful = amount.trim() || symbol.trim() || notes.trim() || fees.trim() || entryPrice || exitPrice;
    try {
      if (!meaningful) localStorage.removeItem(DRAFT_KEY);
      else {
        const d: Draft = { savedAt: Date.now(), kind, accountId, date, sign, amount, symbol, platform, tags, fees, notes, side, quantity, entryPrice, exitPrice, entryTime, exitTime };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      }
    } catch {
      /* storage unavailable (private mode) — nothing to do */
    }
  }, [isEdit, kind, accountId, date, sign, amount, symbol, platform, tags, fees, notes, side, quantity, entryPrice, exitPrice, entryTime, exitTime]);

  const discardDraft = () => {
    clearDraft();
    setDraftNotice(false);
    setKind(req?.kind ?? 'trade');
    setAccountId(defaultAccountId);
    setDate(req?.date ?? today);
    setSign('pos');
    setAmount('');
    setSymbol('');
    setPlatform('');
    setTags([]);
    setFees('');
    setNotes('');
    setSide(null);
    setQuantity('');
    setEntryPrice('');
    setExitPrice('');
    setEntryTime('');
    setExitTime('');
    setShowMore(false);
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);


  // Suggestions from history
  const suggestions = useMemo(() => {
    const recent = [...trades].sort((a, b) => b.updatedAt - a.updatedAt);
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].slice(0, 30);
    const tagCount = new Map<string, number>();
    for (const t of trades) for (const g of t.tags) tagCount.set(g, (tagCount.get(g) ?? 0) + 1);
    return {
      symbols: uniq(recent.map((t) => t.symbol)),
      platforms: uniq(recent.map((t) => t.platform)),
      tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 12),
    };
  }, [trades]);

  const account = accounts.find((a) => a.id === accountId);
  const parsed = parseMoney(amount);
  const absCents = parsed.ok ? Math.abs(parsed.cents) : null;
  const signedCents = absCents === null ? null : sign === 'neg' ? -absCents : absCents;

  const onAmountChange = (v: string) => {
    // Typing a minus sign switches to Loss; the field itself always holds an unsigned number
    const trimmed = v.trim();
    if (/^[-−]/.test(trimmed) && kind === 'trade') {
      setSign('neg');
      v = trimmed.replace(/^[-−]\s*/, '');
    } else if (trimmed.startsWith('+') && kind === 'trade') {
      setSign('pos');
      v = trimmed.slice(1);
    }
    setAmount(v.replace(/[^\d.,$\s]/g, ''));
    if (errors.amount) setErrors((e) => ({ ...e, amount: '' }));
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').slice(0, 40);
    if (!t) return;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t]);
    setTagDraft('');
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!accountId || !account) e.account = T.add.errAccount;
    if (!isValidISODate(date)) e.date = T.add.errDate;
    if (!parsed.ok) e.amount = T.add.errAmount;
    else if (kind !== 'trade' && absCents === 0) e.amount = T.add.errAmountZeroFlow;
    if (kind === 'trade' && fees.trim()) {
      const f = parseMoney(fees);
      if (!f.ok || f.cents < 0) e.fees = T.add.errFees;
    }
    if (entryTime && !isValidTime(entryTime)) e.entryTime = 'HH:MM';
    if (exitTime && !isValidTime(exitTime)) e.exitTime = 'HH:MM';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (again: boolean) => {
    if (busy || !validate()) {
      if (!parsed.ok) amountRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const accName = account!.name;
      lsSet(LAST_ACCOUNT_KEY, accountId);
      if (kind === 'trade') {
        const feesParsed = fees.trim() ? parseMoney(fees) : null;
        const input = {
          accountId,
          date,
          pnlCents: signedCents!,
          feesCents: feesParsed && feesParsed.ok ? Math.abs(feesParsed.cents) : null,
          symbol: symbol.trim(),
          platform: platform.trim(),
          tags: tagDraft.trim() ? [...tags, tagDraft.trim()] : tags,
          notes: notes.trim(),
          side,
          quantity: quantity.trim() || null,
          entryPrice: entryPrice.trim() || null,
          exitPrice: exitPrice.trim() || null,
          entryTime: entryTime || null,
          exitTime: exitTime || null,
        };
        if (editTrade) {
          const undo = await updateTrade(editTrade.id, input);
          toast({ message: T.add.updated, tone: 'success', action: { label: T.common.undo, onClick: undo } });
        } else {
          const { undo } = await addTrade(input);
          toast({
            message: fmt(T.add.saved, { amount: formatMoney(signedCents!, { sign: 'always' }), account: accName }),
            tone: 'success',
            action: { label: T.common.undo, onClick: undo },
          });
        }
      } else {
        const input = { accountId, date, type: kind, amountCents: absCents!, notes: notes.trim() };
        if (editFlow) {
          const undo = await updateCashFlow(editFlow.id, input);
          toast({ message: T.add.updated, tone: 'success', action: { label: T.common.undo, onClick: undo } });
        } else {
          const { undo } = await addCashFlow(input);
          toast({
            message: fmt(T.add.savedFlow, {
              type: kind === 'deposit' ? T.add.kindDeposit : T.add.kindWithdrawal,
              amount: formatMoney(absCents!),
            }),
            tone: 'success',
            action: { label: T.common.undo, onClick: undo },
          });
        }
      }
      if (!isEdit) clearDraft();
      setDraftNotice(false);
      if (again && !isEdit) {
        // Continuous entry: keep account, date, kind, platform; clear the rest
        setAmount('');
        setSymbol('');
        setFees('');
        setNotes('');
        setTagDraft('');
        setQuantity('');
        setEntryPrice('');
        setExitPrice('');
        setEntryTime('');
        setExitTime('');
        setSide(null);
        setErrors({});
        amountRef.current?.focus();
      } else onClose();
    } catch (e) {
      toast({ message: fmt(T.errors.generic, { msg: (e as Error).message }), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: editFlow ? T.add.deleteConfirmFlowTitle : T.add.deleteConfirmTitle,
      body: T.add.deleteConfirmBody,
      confirmLabel: T.common.delete,
      destructive: true,
    });
    if (!ok) return;
    const undo = editTrade ? await deleteTrades([editTrade.id]) : await deleteCashFlows([editFlow!.id]);
    toast({ message: T.add.deleted, action: { label: T.common.undo, onClick: undo } });
    onClose();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  const title = editTrade ? T.add.titleEdit : editFlow ? T.add.titleEditFlow : T.add.titleNew;

  if (!accounts.length) {
    return <NeedAccount onClose={onClose} />;
  }

  const pickerAccounts: Account[] = account && account.archived ? [account, ...activeAccounts] : activeAccounts;
  const beforeStart = account && isValidISODate(date) && date < account.startDate;
  const yesterday = addDays(today, -1);

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      testId="quick-add"
      initialFocus={isEdit ? undefined : amountRef}
      headerLeft={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {T.common.cancel}
        </Button>
      }
      headerRight={
        <Button variant="ghost" size="sm" className="!text-ink" onClick={() => save(false)} disabled={busy} data-testid="qa-save-top">
          {T.common.save}
        </Button>
      }
      footer={
        <div className="flex gap-2">
          {isEdit ? (
            <Button variant="danger-ghost" onClick={remove} className="px-3" aria-label={T.common.delete} data-testid="qa-delete">
              <Trash2 size={18} />
              {T.common.delete}
            </Button>
          ) : (
            <Button onClick={() => save(true)} disabled={busy} className="flex-1 whitespace-nowrap" data-testid="qa-save-next">
              {T.common.saveAndNext}
            </Button>
          )}
          <Button variant="primary" onClick={() => save(false)} disabled={busy} className="flex-1" data-testid="qa-save">
            {T.common.save}
          </Button>
        </div>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {draftNotice && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-warn/10 py-1 pl-3 pr-1 text-[13px] text-warn" role="status" data-testid="draft-notice">
            <span>{T.add.draftRestored}</span>
            <button type="button" onClick={discardDraft} className="min-h-9 rounded-lg px-3 font-semibold hover:bg-white/5" data-testid="draft-discard">
              {T.add.draftDiscard}
            </button>
          </div>
        )}
        {!isEdit && (
          <Segmented
            className="mb-4"
            size="sm"
            label="Entry type"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setErrors({});
            }}
            options={[
              { value: 'trade', label: T.add.kindTrade },
              { value: 'deposit', label: T.add.kindDeposit },
              { value: 'withdrawal', label: T.add.kindWithdrawal },
            ]}
          />
        )}

        {/* Amount */}
        <div className="mb-4">
          {kind === 'trade' && (
            <div className="mb-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={T.add.netPnl}>
              <SignButton active={sign === 'pos'} tone="pos" onClick={() => setSign('pos')} testId="sign-profit">
                <Plus size={18} strokeWidth={3} /> {T.money.profit}
              </SignButton>
              <SignButton active={sign === 'neg'} tone="neg" onClick={() => setSign('neg')} testId="sign-loss">
                <Minus size={18} strokeWidth={3} /> {T.money.loss}
              </SignButton>
            </div>
          )}
          <label htmlFor="qa-amount" className="sr-only">
            {kind === 'trade' ? T.add.netPnl : T.add.amount}
          </label>
          <div
            className={cx(
              'flex items-center rounded-2xl border bg-surface-2 px-4 transition',
              errors.amount ? 'border-neg/70' : 'border-transparent focus-within:border-line-strong',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'num select-none pr-1 text-[34px] font-semibold',
                kind !== 'trade' ? 'text-ink-2' : sign === 'pos' ? 'text-pos' : 'text-neg',
              )}
            >
              {kind === 'trade' ? (sign === 'pos' ? '+' : '−') : kind === 'deposit' ? '+' : '−'}$
            </span>
            <input
              id="qa-amount"
              ref={amountRef}
              data-testid="qa-amount"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="0.00"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              aria-invalid={!!errors.amount}
              aria-describedby="qa-amount-hint"
              className="num h-[68px] min-w-0 flex-1 bg-transparent text-[34px] font-semibold text-ink outline-none placeholder:text-ink-3/60"
            />
          </div>
          <ErrorText>{errors.amount}</ErrorText>
          <p id="qa-amount-hint" className="mt-1.5 px-1 text-[12.5px] text-ink-3">
            {kind === 'trade'
              ? signedCents === 0
                ? T.add.breakeven
                : signedCents !== null
                  ? `${T.add.netPnl}: ${formatMoney(signedCents, { sign: 'always' })} · ${T.add.netHint}`
                  : T.add.netHint
              : T.add.flowHint}
            {parsed.ok && parsed.rounded && ` · ${T.add.roundedWarn}`}
          </p>
        </div>

        {/* Account */}
        <div className="mb-4">
          <FieldLabel>{T.common.account}</FieldLabel>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5" role="group" aria-label={T.common.account}>
            {pickerAccounts.map((a) => (
              <Chip key={a.id} active={a.id === accountId} onClick={() => setAccountId(a.id)} testId={`qa-account-${a.name}`}>
                <AccountDot color={a.color} />
                {a.name}
              </Chip>
            ))}
          </div>
          <ErrorText>{errors.account}</ErrorText>
        </div>

        {/* Date */}
        <div className="mb-4">
          <FieldLabel htmlFor="qa-date" hint={isValidISODate(date) ? formatDate(date, locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : undefined}>
            {T.common.date}
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Chip active={date === today} onClick={() => setDate(today)}>
              {T.common.today}
            </Chip>
            <Chip active={date === yesterday} onClick={() => setDate(yesterday)}>
              {T.common.yesterday}
            </Chip>
            <input
              id="qa-date"
              data-testid="qa-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={!!errors.date}
              className="field num min-h-9 min-w-[150px] flex-1 py-1.5"
            />
          </div>
          <ErrorText>{errors.date}</ErrorText>
          {beforeStart && (
            <p className="mt-1.5 px-1 text-[12.5px] leading-snug text-warn">
              {fmt(T.add.beforeStart, { account: account!.name, date: formatDate(account!.startDate, locale) })}
            </p>
          )}
        </div>

        {kind !== 'trade' ? (
          <div className="mb-2">
            <FieldLabel htmlFor="qa-notes" hint={T.common.optional}>
              {T.add.notes}
            </FieldLabel>
            <input id="qa-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              aria-expanded={showMore}
              data-testid="qa-more"
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-1 text-[15px] font-medium text-ink-2"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0">{showMore ? T.common.less : T.common.more}</span>
                {!showMore && <span className="truncate text-[13px] font-normal text-ink-3">{T.add.symbol} · {T.add.tags} · {T.add.fees}</span>}
              </span>
              {showMore ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {showMore && (
              <div className="animate-fade-in mt-2 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="qa-symbol">{T.add.symbol}</FieldLabel>
                    <input
                      id="qa-symbol"
                      data-testid="qa-symbol"
                      className="field"
                      list="dl-symbols"
                      value={symbol}
                      placeholder={T.add.symbolPh}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      onChange={(e) => setSymbol(e.target.value)}
                    />
                    <datalist id="dl-symbols">{suggestions.symbols.map((s) => <option key={s} value={s} />)}</datalist>
                  </div>
                  <div>
                    <FieldLabel htmlFor="qa-platform">{T.add.platform}</FieldLabel>
                    <input
                      id="qa-platform"
                      className="field"
                      list="dl-platforms"
                      value={platform}
                      placeholder={T.add.platformPh}
                      onChange={(e) => setPlatform(e.target.value)}
                    />
                    <datalist id="dl-platforms">{suggestions.platforms.map((s) => <option key={s} value={s} />)}</datalist>
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="qa-tag">{T.add.tags}</FieldLabel>
                  <div className="field flex min-h-11 flex-wrap items-center gap-1.5 py-1.5">
                    {tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-3 py-0.5 pl-2.5 pr-1 text-[14px]">
                        {t}
                        <button
                          type="button"
                          aria-label={`${T.common.delete} ${t}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:text-ink"
                          onClick={() => setTags(tags.filter((x) => x !== t))}
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                    <input
                      id="qa-tag"
                      data-testid="qa-tag"
                      value={tagDraft}
                      placeholder={tags.length ? '' : T.add.tagsPh}
                      enterKeyHint="enter"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/[,，]$/.test(v)) addTag(v.slice(0, -1));
                        else setTagDraft(v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag(tagDraft);
                        } else if (e.key === 'Backspace' && !tagDraft && tags.length) setTags(tags.slice(0, -1));
                      }}
                      onBlur={() => addTag(tagDraft)}
                      className="min-w-[8ch] flex-1 bg-transparent py-1 outline-none placeholder:text-ink-3"
                    />
                  </div>
                  {suggestions.tags.filter((s) => !tags.includes(s)).length > 0 && (
                    <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4">
                      {suggestions.tags
                        .filter((s) => !tags.includes(s))
                        .map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => addTag(s)}
                            className="min-h-8 shrink-0 rounded-full border border-line-strong px-3 text-[13px] text-ink-2"
                          >
                            + {s}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div>
                  <FieldLabel htmlFor="qa-fees" hint={T.common.optional}>
                    {T.add.fees}
                  </FieldLabel>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
                    <input
                      id="qa-fees"
                      data-testid="qa-fees"
                      className="field num pl-7"
                      inputMode="decimal"
                      value={fees}
                      placeholder="0.00"
                      aria-invalid={!!errors.fees}
                      onChange={(e) => setFees(e.target.value.replace(/[^\d.,]/g, ''))}
                    />
                  </div>
                  <ErrorText>{errors.fees}</ErrorText>
                  <p className="mt-1.5 px-1 text-[12.5px] leading-snug text-ink-3">{T.add.feesHint}</p>
                </div>

                <div>
                  <FieldLabel htmlFor="qa-notes">{T.add.notes}</FieldLabel>
                  <textarea
                    id="qa-notes"
                    className="field min-h-20 resize-y"
                    value={notes}
                    placeholder={T.add.notesPh}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div>
                  <FieldLabel>{T.add.side}</FieldLabel>
                  <Segmented
                    size="sm"
                    label={T.add.side}
                    value={side ?? 'none'}
                    onChange={(v) => setSide(v === 'none' ? null : (v as 'long' | 'short'))}
                    options={[
                      { value: 'none', label: '—' },
                      { value: 'long', label: T.add.long },
                      { value: 'short', label: T.add.short },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="qa-entry-price">{T.add.entryPrice}</FieldLabel>
                    <input id="qa-entry-price" className="field num" inputMode="decimal" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="qa-exit-price">{T.add.exitPrice}</FieldLabel>
                    <input id="qa-exit-price" className="field num" inputMode="decimal" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="qa-entry-time">{T.add.entryTime}</FieldLabel>
                    <input id="qa-entry-time" type="time" className="field num" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} aria-invalid={!!errors.entryTime} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="qa-exit-time">{T.add.exitTime}</FieldLabel>
                    <input id="qa-exit-time" type="time" className="field num" value={exitTime} onChange={(e) => setExitTime(e.target.value)} aria-invalid={!!errors.exitTime} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="qa-qty">{T.add.quantity}</FieldLabel>
                    <input id="qa-qty" className="field num" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {/* lets the keyboard "Go" key submit */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}

function SignButton({
  active,
  tone,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  tone: 'pos' | 'neg';
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'flex min-h-11 items-center justify-center gap-1.5 rounded-xl border text-[15px] font-semibold transition',
        active
          ? tone === 'pos'
            ? 'border-pos/60 bg-pos/15 text-pos'
            : 'border-neg/60 bg-neg/15 text-neg'
          : 'border-line-strong text-ink-3 hover:text-ink-2',
      )}
    >
      {children}
    </button>
  );
}

/** First-run: create an account inline so the very first entry is still quick. */
function NeedAccount({ onClose }: { onClose: () => void }) {
  const { T, today, toast, openAdd, addRequest } = useApp();
  return (
    <Sheet open onClose={onClose} title={T.add.needAccountTitle}>
      <p className="mb-4 text-[14px] leading-relaxed text-ink-2">{T.add.needAccountBody}</p>
      <AccountForm
        initial={{ name: '', startingBalanceCents: 0, startDate: today, color: ACCOUNT_COLORS[0] }}
        submitLabel={T.common.continue}
        onSubmit={async (v) => {
          const acc = await createAccount(v);
          toast({ message: T.accounts.created, tone: 'success' });
          openAdd({ ...(addRequest ?? {}), accountId: acc.id });
        }}
      />
    </Sheet>
  );
}

export interface AccountFormValue {
  name: string;
  startingBalanceCents: number;
  startDate: string;
  color: string;
}

export function AccountForm({
  initial,
  onSubmit,
  submitLabel,
  excludeId,
}: {
  initial: AccountFormValue;
  onSubmit: (v: AccountFormValue) => Promise<void>;
  submitLabel: string;
  excludeId?: string;
}) {
  const { T, accounts, toast } = useApp();
  const [name, setName] = useState(initial.name);
  const [bal, setBal] = useState(initial.startingBalanceCents ? centsToInput(initial.startingBalanceCents) : '');
  const [balNeg, setBalNeg] = useState(initial.startingBalanceCents < 0);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [color, setColor] = useState(initial.color);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const er: Record<string, string> = {};
    const n = name.trim();
    if (!n) er.name = T.accounts.errName;
    else if (accounts.some((a) => a.id !== excludeId && a.name.trim().toLowerCase() === n.toLowerCase())) er.name = T.accounts.errNameTaken;
    const p = bal.trim() ? parseMoney(bal) : ({ ok: true, cents: 0 } as const);
    if (!p.ok) er.balance = T.accounts.errBalance;
    if (!isValidISODate(startDate)) er.date = T.add.errDate;
    setErrors(er);
    if (Object.keys(er).length || !p.ok) return;
    setBusy(true);
    try {
      const cents = Math.abs(p.cents) * (balNeg || p.cents < 0 ? -1 : 1);
      await onSubmit({ name: n, startingBalanceCents: cents, startDate, color });
    } catch (err) {
      toast({ message: fmt(T.errors.generic, { msg: (err as Error).message }), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="account-form">
      <div>
        <FieldLabel htmlFor="acc-name">{T.accounts.name}</FieldLabel>
        <input
          id="acc-name"
          data-testid="acc-name"
          className="field"
          value={name}
          maxLength={60}
          placeholder={T.accounts.namePh}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
        />
        <ErrorText>{errors.name}</ErrorText>
      </div>
      <div>
        <FieldLabel htmlFor="acc-balance">{T.accounts.startingBalance}</FieldLabel>
        <div className="relative">
          <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2">{balNeg ? '−$' : '$'}</span>
          <input
            id="acc-balance"
            data-testid="acc-balance"
            className="field num pl-8"
            inputMode="decimal"
            value={bal}
            placeholder="0.00"
            onChange={(e) => {
              const v = e.target.value;
              if (/^\s*[-−]/.test(v)) setBalNeg(true);
              setBal(v.replace(/[^\d.,]/g, ''));
            }}
            aria-invalid={!!errors.balance}
          />
          {balNeg && (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-ink-3" onClick={() => setBalNeg(false)}>
              ±
            </button>
          )}
        </div>
        <ErrorText>{errors.balance}</ErrorText>
      </div>
      <div>
        <FieldLabel htmlFor="acc-date">{T.accounts.startDate}</FieldLabel>
        <input id="acc-date" data-testid="acc-date" type="date" className="field num" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <ErrorText>{errors.date}</ErrorText>
        <p className="mt-1.5 px-1 text-[12.5px] leading-snug text-ink-3">{T.accounts.startDateHelp}</p>
      </div>
      <div>
        <FieldLabel>{T.accounts.color}</FieldLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={T.accounts.color}>
          {ACCOUNT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cx('flex h-11 w-11 items-center justify-center rounded-full border-2 transition', c === color ? 'border-ink' : 'border-transparent')}
            >
              <span className="h-7 w-7 rounded-full" style={{ background: c }} />
            </button>
          ))}
        </div>
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy} data-testid="acc-submit">
        {submitLabel}
      </Button>
    </form>
  );
}
