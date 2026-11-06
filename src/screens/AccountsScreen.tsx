import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, ArchiveRestore, Database, Download, FileDown, FileUp, Globe, HardDrive, Plus, ShieldCheck, Smartphone,
  Trash2, Upload, Wallet,
} from 'lucide-react';
import { useApp } from '../state/app';
import { fmt } from '../i18n';
import { createAccount, deleteAccount, eraseAllData, updateAccount } from '../db/actions';
import { buildBackup, backupFileName, serializeBackup } from '../db/backup';
import { isStoragePersisted, requestPersistentStorage } from '../db/db';
import { ACCOUNT_COLORS, type Account, type Lang } from '../db/types';
import { exportCSV } from '../lib/csv';
import { dateToLocalISO, formatDate } from '../lib/dates';
import { deliverFile, isTouchDevice, makeFile, type SaveOutcome } from '../lib/files';
import { formatMoney } from '../lib/money';
import { primeKeyboard } from '../lib/keyboard';
import { isIOS, isStandalone } from '../lib/platform';
import { accountBalance, combinedBalance, type BalanceBreakdown } from '../lib/stats';
import { AccountForm } from '../components/QuickAdd';
import { FlowRow } from '../components/rows';
import { CsvImportSheet, ExportSheet, RestoreSheet, type PendingExport } from '../components/DataSheets';
import { AccountDot, Button, EmptyState, Group, InfoTip, Money, Row, Segmented, Sheet } from '../components/ui';

const BACKUP_DUE_DAYS = 14;

export function AccountsScreen({ createSignal }: { createSignal: number }) {
  const { T, accounts, trades, cashflows, today, toast } = useApp();
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (createSignal) setCreating(true);
  }, [createSignal]);

  const total = useMemo(() => combinedBalance(accounts, trades, cashflows), [accounts, trades, cashflows]);
  const balances = useMemo(() => new Map(accounts.map((a) => [a.id, accountBalance(a, trades, cashflows)])), [accounts, trades, cashflows]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) m.set(t.accountId, (m.get(t.accountId) ?? 0) + 1);
    return m;
  }, [trades]);
  const detail = accounts.find((a) => a.id === detailId) ?? null;
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <div className="mx-auto w-full max-w-[720px] pb-6">
      <header className="pt-safe px-safe sticky top-0 z-20 bg-bg/95 pb-2 backdrop-blur">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h1 className="text-[28px] font-bold tracking-tight">{T.accounts.title}</h1>
          <Button size="sm" onClick={() => setCreating(true)} data-testid="new-account">
            <Plus size={16} /> {T.accounts.add}
          </Button>
        </div>
      </header>

      <div className="px-safe pt-2">
        {accounts.length === 0 ? (
          <div className="mb-6 rounded-2xl bg-surface">
            <EmptyState
              icon={<Wallet size={26} />}
              title={T.accounts.empty}
              body={T.accounts.emptyBody}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={18} /> {T.accounts.add}
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <section className="mb-6 rounded-2xl bg-surface px-4 py-3.5" data-testid="total-card">
              <div className="flex flex-wrap items-center gap-1 text-[13px] font-medium text-ink-3">
                {T.accounts.total} · {T.money.estBalance}
                <InfoTip text={T.money.estBalanceHelp} label={T.money.estBalance} />
              </div>
              <div className="num mt-0.5 text-[30px] font-bold leading-tight tracking-tight" data-testid="total-balance">
                {formatMoney(total.estimatedCents)}
              </div>
              <BalanceBreakdownLine b={total} />
            </section>

            <Group title={T.accounts.title}>
              {active.map((a) => (
                <AccountRow key={a.id} a={a} b={balances.get(a.id)!} n={counts.get(a.id) ?? 0} onClick={() => setDetailId(a.id)} />
              ))}
            </Group>
            {archived.length > 0 && (
              <Group title={T.common.archived} footer={T.accounts.archivedNote}>
                {archived.map((a) => (
                  <AccountRow key={a.id} a={a} b={balances.get(a.id)!} n={counts.get(a.id) ?? 0} onClick={() => setDetailId(a.id)} />
                ))}
              </Group>
            )}
          </>
        )}

        <DataSection />
        <PrefsSection />
        <AboutSection />
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title={T.accounts.add}>
        {creating && (
          <AccountForm
            initial={{ name: '', startingBalanceCents: 0, startDate: today, color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length] }}
            submitLabel={T.accounts.add}
            onSubmit={async (v) => {
              await createAccount(v);
              toast({ message: T.accounts.created, tone: 'success' });
              setCreating(false);
            }}
          />
        )}
      </Sheet>

      {detail && <AccountDetailSheet account={detail} balance={balances.get(detail.id)!} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function BalanceBreakdownLine({ b }: { b: BalanceBreakdown }) {
  const { T } = useApp();
  const net = b.depositsCents - b.withdrawalsCents;
  return (
    <dl className="num mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px]">
      <div className="min-w-0">
        <dt className="text-ink-3">{T.accounts.starting}</dt>
        <dd className="truncate text-[14px] font-semibold">{formatMoney(b.startingCents)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-ink-3">{T.accounts.netDeposits}</dt>
        <dd className="truncate text-[14px] font-semibold text-ink-2">{formatMoney(net, { sign: 'always' })}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-ink-3">{T.accounts.tradingPnl}</dt>
        <dd className="truncate text-[14px] font-semibold">
          <Money cents={b.tradingPnlCents} />
        </dd>
      </div>
    </dl>
  );
}

function AccountRow({ a, b, n, onClick }: { a: Account; b: BalanceBreakdown; n: number; onClick: () => void }) {
  const { T } = useApp();
  return (
    <Row
      testId={`account-row-${a.name}`}
      onClick={onClick}
      chevron
      icon={<AccountDot color={a.color} size={12} />}
      label={a.name}
      sub={fmt(T.accounts.trades, { n })}
      value={<span className="num">{formatMoney(b.estimatedCents)}</span>}
      valueSub={<Money cents={b.tradingPnlCents} className="text-[12px]" />}
    />
  );
}

function AccountDetailSheet({ account, balance, onClose }: { account: Account; balance: BalanceBreakdown; onClose: () => void }) {
  const { T, locale, cashflows, trades, openAdd, toast, confirm } = useApp();
  const [editing, setEditing] = useState(false);
  const flows = useMemo(
    () => cashflows.filter((c) => c.accountId === account.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)),
    [cashflows, account.id],
  );
  const nTrades = trades.filter((t) => t.accountId === account.id).length;

  const remove = async () => {
    const ok = await confirm({
      title: fmt(T.accounts.deleteTitle, { name: account.name }),
      body: fmt(T.accounts.deleteBody, { trades: nTrades, flows: flows.length }),
      confirmLabel: T.common.delete,
      destructive: true,
      typeToConfirm: account.name,
      typePlaceholder: fmt(T.accounts.deleteType, { name: account.name }),
    });
    if (!ok) return;
    const undo = await deleteAccount(account.id);
    onClose();
    toast({ message: T.accounts.deleted, action: { label: T.common.undo, onClick: undo } });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? T.accounts.edit : account.name}
      testId="account-detail"
      headerLeft={
        editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            {T.common.cancel}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} data-testid="account-edit">
            {T.common.edit}
          </Button>
        )
      }
    >
      {editing ? (
        <AccountForm
          initial={account}
          excludeId={account.id}
          submitLabel={T.common.save}
          onSubmit={async (v) => {
            const undo = await updateAccount(account.id, v);
            toast({ message: T.accounts.saved, tone: 'success', action: { label: T.common.undo, onClick: undo } });
            setEditing(false);
          }}
        />
      ) : (
        <>
          <section className="mb-5 rounded-2xl bg-surface-2 px-4 py-3.5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
              <AccountDot color={account.color} /> {T.money.estBalance}
            </div>
            <div className="num mt-0.5 text-[30px] font-bold leading-tight" data-testid="account-balance">
              {formatMoney(balance.estimatedCents)}
            </div>
            <dl className="num mt-3 space-y-1.5 border-t border-line pt-3 text-[14px]">
              <Line label={`${T.accounts.starting} · ${formatDate(account.startDate, locale)}`} value={formatMoney(balance.startingCents)} />
              <Line label={T.accounts.deposits} value={formatMoney(balance.depositsCents, { sign: 'always' })} />
              <Line label={T.accounts.withdrawals} value={formatMoney(-balance.withdrawalsCents, { sign: 'always' })} />
              <Line label={T.accounts.tradingPnl} value={<Money cents={balance.tradingPnlCents} testId="account-pnl" />} />
            </dl>
            {balance.excludedTrades > 0 && (
              <p className="mt-2 text-[12.5px] text-warn">{fmt(T.accounts.excluded, { n: balance.excludedTrades })}</p>
            )}
          </section>

          <div className="mb-5 grid grid-cols-2 gap-2">
            <Button onClick={() => { primeKeyboard(); openAdd({ accountId: account.id, kind: 'deposit' }); }} data-testid="account-deposit">
              <Download size={16} /> {T.add.kindDeposit}
            </Button>
            <Button onClick={() => { primeKeyboard(); openAdd({ accountId: account.id, kind: 'withdrawal' }); }} data-testid="account-withdraw">
              <Upload size={16} /> {T.add.kindWithdrawal}
            </Button>
          </div>

          <Group title={T.accounts.transfers} inset>
            {flows.length === 0 ? (
              <p className="px-4 py-4 text-[14px] text-ink-3">{T.accounts.noTransfers}</p>
            ) : (
              flows.slice(0, 50).map((c) => (
                <div key={c.id} className="[&+&]:border-t [&+&]:border-line">
                  <div className="px-4 pt-2 text-[12px] text-ink-3">{formatDate(c.date, locale)}</div>
                  <FlowRow flow={c} showAccount={false} />
                </div>
              ))
            )}
          </Group>

          <Group inset>
            <Row
              onClick={async () => {
                const undo = await updateAccount(account.id, { archived: !account.archived });
                toast({ message: T.accounts.saved, action: { label: T.common.undo, onClick: undo } });
              }}
              icon={account.archived ? <ArchiveRestore size={18} className="text-ink-2" /> : <Archive size={18} className="text-ink-2" />}
              label={account.archived ? T.accounts.unarchive : T.accounts.archive}
              sub={T.accounts.archivedNote}
            />
            <Row onClick={remove} icon={<Trash2 size={18} className="text-neg" />} label={<span className="text-neg">{T.common.delete}</span>} testId="account-delete" />
          </Group>
        </>
      )}
    </Sheet>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 truncate text-ink-3">{label}</dt>
      <dd className="shrink-0 font-semibold">{value}</dd>
    </div>
  );
}

// ---------------- Data & backup ----------------

function DataSection() {
  const { T, locale, accounts, trades, cashflows, settings, setSettings, toast, confirm } = useApp();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [pending, setPending] = useState<PendingExport | null>(null);

  useEffect(() => {
    void isStoragePersisted().then(setPersisted);
  }, []);

  const finishExport = async (outcome: SaveOutcome, kind: PendingExport['kind']) => {
    if (outcome === 'cancelled') return;
    if (kind === 'json') await setSettings({ lastBackupAt: Date.now() });
    toast({ message: kind === 'json' ? T.data.exported : T.data.exportedCsv, tone: 'success' });
  };

  /** Desktop: download right away. Phone: prepare first, then share from a tap (iOS needs the gesture). */
  const offer = async (p: PendingExport) => {
    if (!isTouchDevice()) await finishExport(await deliverFile(p.file, false), p.kind);
    else setPending(p);
  };

  const daysSince = settings.lastBackupAt ? Math.floor((Date.now() - settings.lastBackupAt) / 86_400_000) : null;
  const due = trades.length > 0 && (daysSince === null || daysSince >= BACKUP_DUE_DAYS);

  const exportJson = async () => {
    try {
      const backup = await buildBackup();
      // serializeBackup re-parses and verifies the file before it leaves the app
      const text = serializeBackup(backup);
      await offer({
        kind: 'json',
        file: makeFile(backupFileName(), text, 'application/json'),
        digest: backup.integrity.digest,
        counts: fmt(T.data.counts, { a: backup.summary.accounts, t: backup.summary.trades, f: backup.summary.cashflows }),
      });
    } catch (e) {
      toast({ message: fmt(T.errors.generic, { msg: (e as Error).message }), tone: 'error' });
    }
  };

  const exportCsvFile = async () => {
    const csv = exportCSV(accounts, trades, cashflows);
    const d = new Date();
    const name = `daybook-trades-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
    await offer({ kind: 'csv', file: makeFile(name, csv, 'text/csv'), counts: fmt(T.data.counts, { a: accounts.length, t: trades.length, f: cashflows.length }) });
  };

  const erase = async () => {
    const ok = await confirm({
      title: T.data.eraseTitle,
      body: T.data.eraseBody,
      confirmLabel: T.data.eraseAll,
      destructive: true,
      typeToConfirm: T.data.eraseWord,
    });
    if (!ok) return;
    await eraseAllData();
    toast({ message: T.data.erased });
  };

  return (
    <>
      <Group
        title={T.data.title}
        footer={
          <span className="flex gap-2">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            <span>
              {T.data.localNote}
              <span className="mt-1.5 block" data-testid="backup-security">
                {T.data.backupSecurity}
              </span>
            </span>
          </span>
        }
      >
        <Row
          icon={<Database size={18} className="text-ink-2" />}
          label={T.data.lastBackup}
          sub={fmt(T.data.counts, { a: accounts.length, t: trades.length, f: cashflows.length })}
          value={
            <span className={due ? 'text-warn' : 'text-ink-2'} data-testid="last-backup">
              {settings.lastBackupAt ? formatDate(dateToLocalISO(new Date(settings.lastBackupAt)), locale) : T.data.never}
            </span>
          }
          valueSub={due && daysSince !== null ? fmt(T.data.backupDue, { n: BACKUP_DUE_DAYS }) : undefined}
        />
        {due && (
          <div className="flex items-start gap-2 border-t border-line bg-warn/10 px-4 py-2.5 text-[13px] text-warn">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            {daysSince === null ? T.data.noBackupYet : fmt(T.data.backupDue, { n: BACKUP_DUE_DAYS })}
          </div>
        )}
        <Row onClick={exportJson} icon={<FileDown size={18} className="text-link" />} label={T.data.exportJson} chevron testId="export-json" />
        <Row onClick={() => setRestoreOpen(true)} icon={<FileUp size={18} className="text-link" />} label={T.data.restoreJson} chevron testId="restore-json" />
        <Row onClick={exportCsvFile} icon={<FileDown size={18} className="text-ink-2" />} label={T.data.exportCsv} chevron testId="export-csv" />
        <Row onClick={() => setCsvOpen(true)} icon={<FileUp size={18} className="text-ink-2" />} label={T.data.importCsv} chevron testId="import-csv" />
        <Row
          icon={<Smartphone size={18} className="text-ink-2" />}
          label={<span className="whitespace-normal text-[14px]">{isStandalone() ? T.data.modeStandalone : T.data.modeBrowser}</span>}
          testId="display-mode"
        />
        {isIOS() && !isStandalone() && (
          <div className="flex items-start gap-2 border-t border-line bg-warn/10 px-4 py-2.5 text-[13px] leading-snug text-warn" data-testid="safari-tab-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            {T.data.safariTabWarning}
          </div>
        )}
        <Row
          icon={<HardDrive size={18} className="text-ink-2" />}
          label={<span className="whitespace-normal text-[14px]">{persisted === true ? T.data.persisted : persisted === false ? T.data.notPersisted : T.data.persistUnknown}</span>}
          value={
            persisted === false ? (
              <Button
                size="sm"
                onClick={async () => {
                  setPersisted(await requestPersistentStorage());
                }}
              >
                {T.data.requestPersist}
              </Button>
            ) : undefined
          }
        />
      </Group>
      <Group>
        <Row onClick={erase} icon={<Trash2 size={18} className="text-neg" />} label={<span className="text-neg">{T.data.eraseAll}</span>} testId="erase-all" />
      </Group>
      <RestoreSheet open={restoreOpen} onClose={() => setRestoreOpen(false)} onExportFirst={exportJson} />
      <CsvImportSheet open={csvOpen} onClose={() => setCsvOpen(false)} />
      <ExportSheet pending={pending} onClose={() => setPending(null)} onDone={(o, k) => void finishExport(o, k)} />
    </>
  );
}

function PrefsSection() {
  const { T, settings, setSettings } = useApp();
  return (
    <Group title={T.prefs.title}>
      <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
        <Globe size={18} className="shrink-0 text-ink-2" />
        <span className="flex-1 text-[15px]">{T.prefs.language}</span>
        <Segmented
          size="sm"
          className="w-[210px]"
          label={T.prefs.language}
          value={(settings.lang ?? 'system') as Lang | 'system'}
          onChange={(v) => void setSettings({ lang: v === 'system' ? null : (v as Lang) })}
          options={[
            { value: 'system', label: T.prefs.system },
            { value: 'en', label: 'EN' },
            { value: 'zh', label: '中文' },
          ]}
        />
      </div>
    </Group>
  );
}

function AboutSection() {
  const { T } = useApp();
  return (
    <Group title={T.about.title}>
      <div className="px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
        <p className="font-semibold text-ink">
          {T.appName} · {fmt(T.about.version, { v: __APP_VERSION__ })}
        </p>
        <p className="mt-1">{T.about.privacy}</p>
        <p className="mt-1">{T.about.install}</p>
      </div>
    </Group>
  );
}
