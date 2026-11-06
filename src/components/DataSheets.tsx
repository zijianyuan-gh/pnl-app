import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../state/app';
import { fmt } from '../i18n';
import { parseBackup, restoreBackup, type ParsedBackup } from '../db/backup';
import { commitImport, undoImport } from '../db/importCsv';
import { buildImportPreview, guessMapping, IMPORT_FIELDS, parseCSV, type ImportField, type ImportOptions, type Mapping } from '../lib/csv';
import { formatDate, type DateOrder } from '../lib/dates';
import { readFileText } from '../lib/files';
import { formatMoney } from '../lib/money';
import { Button, FieldLabel, Money, Segmented, Sheet, cx } from './ui';

// ---------------- JSON restore ----------------

export function RestoreSheet({ open, onClose, onExportFirst }: { open: boolean; onClose: () => void; onExportFirst: () => void }) {
  const { T, locale, accounts, trades, toast, confirm } = useApp();
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setBackup(null);
    setError(null);
    setMode(accounts.length ? 'merge' : 'replace');
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBackup(null);
    let text: string;
    try {
      text = await readFileText(f);
    } catch {
      setError(T.data.errors.read);
      return;
    }
    const r = parseBackup(text);
    if (!r.ok) {
      const [code, ...rest] = r.error.split(':');
      const msg = (T.data.errors as Record<string, string>)[code] ?? r.error;
      setError(code === 'invalid_record' ? `${msg} ${rest.join(':')}` : msg);
      return;
    }
    setBackup(r.backup);
    setMode(accounts.length ? 'merge' : 'replace');
  };

  const run = async () => {
    if (!backup) return;
    if (mode === 'replace' && (accounts.length || trades.length)) {
      const ok = await confirm({
        title: T.data.restoreConfirmTitle,
        body: fmt(T.data.restoreConfirmBody, { a: accounts.length, t: trades.length }),
        confirmLabel: T.data.restoreReplace,
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await restoreBackup(backup, mode);
      toast({ message: fmt(T.data.restoreDone, { a: r.accounts, t: r.trades, f: r.cashflows }), tone: 'success' });
      close();
    } catch (e) {
      toast({ message: fmt(T.errors.generic, { msg: (e as Error).message }), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} title={T.data.restoreTitle} testId="restore-sheet">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        data-testid="restore-file"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-5 text-[15px] font-medium text-ink-2"
      >
        <FileJson size={26} />
        {T.data.restoreJson}
      </button>
      {error && (
        <div role="alert" className="mt-4 flex gap-2 rounded-xl bg-neg/10 px-3 py-2.5 text-[14px] text-neg" data-testid="restore-error">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {backup && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <CheckCircle2 size={16} className="text-pos" />
              {backup.exportedAt ? fmt(T.data.restoreFile, { date: new Date(backup.exportedAt).toLocaleString(locale) }) : T.data.restoreTitle}
            </p>
            <p className="num mt-1 text-[13px] text-ink-2" data-testid="restore-summary">
              {fmt(T.data.restoreSummary, {
                a: backup.summary.accounts,
                t: backup.summary.trades,
                f: backup.summary.cashflows,
                net: formatMoney(backup.summary.netPnlCents, { sign: 'always' }),
              })}
            </p>
          </div>
          <div className="space-y-2" role="radiogroup">
            {(['replace', 'merge'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                data-testid={`restore-mode-${m}`}
                className={cx(
                  'w-full rounded-2xl border px-4 py-3 text-left transition',
                  mode === m ? 'border-ink/70 bg-surface-2' : 'border-line-strong',
                )}
              >
                <span className="block text-[15px] font-semibold">{m === 'replace' ? T.data.restoreReplace : T.data.restoreMerge}</span>
                <span className="mt-0.5 block text-[13px] text-ink-3">{m === 'replace' ? T.data.restoreReplaceHelp : T.data.restoreMergeHelp}</span>
              </button>
            ))}
          </div>
          {mode === 'replace' && trades.length > 0 && (
            <Button className="w-full" onClick={onExportFirst}>
              {T.data.exportFirst}
            </Button>
          )}
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} size="lg" className="w-full" disabled={busy} onClick={run} data-testid="restore-run">
            {mode === 'replace' ? T.data.restoreReplace : T.data.restoreMerge}
          </Button>
        </div>
      )}
      {!backup && !error && (
        <p className="mt-4 px-1 text-[13px] leading-relaxed text-ink-3">{T.data.localNote}</p>
      )}
    </Sheet>
  );
}

// ---------------- CSV import ----------------

const PREVIEW_ROWS = 100;

export function CsvImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, locale, accounts, trades, cashflows, toast } = useApp();
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<ImportOptions>({
    dateOrder: 'auto',
    defaultAccountId: null,
    unknownAccounts: 'create',
    pnlIsGross: false,
    includeDuplicates: false,
  });
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const activeAccounts = accounts.filter((a) => !a.archived);

  const reset = () => {
    setTable(null);
    setMapping(null);
    setError(null);
    setFileName('');
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    reset();
    setFileName(f.name);
    try {
      const text = await readFileText(f);
      const t = parseCSV(text);
      if (t.length < 2) {
        setError(T.csv.noRows);
        return;
      }
      setTable(t);
      setMapping(guessMapping(t[0]));
      setOpts((o) => ({ ...o, defaultAccountId: o.defaultAccountId ?? activeAccounts[0]?.id ?? null }));
    } catch {
      setError(T.data.errors.read);
    }
  };

  const ready = !!(table && mapping && mapping.date !== null && mapping.pnl !== null);
  const preview = useMemo(
    () => (ready ? buildImportPreview(table!, mapping!, opts, { accounts, trades, cashflows }) : null),
    [ready, table, mapping, opts, accounts, trades, cashflows],
  );

  const run = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await commitImport(preview, opts.includeDuplicates);
      toast({
        message: fmt(T.csv.imported, { t: res.trades, f: res.cashflows }),
        tone: 'success',
        action: { label: T.common.undo, onClick: () => undoImport(res) },
      });
      close();
    } catch (e) {
      toast({ message: fmt(T.errors.generic, { msg: (e as Error).message }), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const headers = table?.[0] ?? [];
  const setField = (f: ImportField, v: string) => setMapping((m) => ({ ...(m as Mapping), [f]: v === '' ? null : Number(v) }));
  const willImport = preview ? preview.counts.trades + preview.counts.cashflows : 0;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={T.csv.title}
      size="lg"
      testId="csv-sheet"
      footer={
        preview ? (
          <Button variant="primary" size="lg" className="w-full" disabled={busy || willImport === 0} onClick={run} data-testid="csv-run">
            {T.csv.import} ({willImport})
          </Button>
        ) : undefined
      }
    >
      <input ref={input} type="file" accept=".csv,text/csv,text/plain,.tsv" className="sr-only" data-testid="csv-file" onChange={(e) => onFile(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-4 text-[15px] font-medium text-ink-2"
      >
        <FileSpreadsheet size={24} />
        {fileName || T.csv.pick}
      </button>
      {!table && !error && <p className="mt-3 px-1 text-[13px] leading-relaxed text-ink-3">{T.csv.pickHelp}</p>}
      {error && (
        <div role="alert" className="mt-4 flex gap-2 rounded-xl bg-neg/10 px-3 py-2.5 text-[14px] text-neg">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {table && mapping && (
        <div className="mt-5 space-y-5">
          <section>
            <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{T.csv.columns}</h3>
            <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              {IMPORT_FIELDS.map((f) => (
                <label key={f} className="flex items-center gap-2 rounded-xl bg-surface-2 py-1 pl-3 pr-1">
                  <span className="w-[42%] shrink-0 text-[13px] text-ink-2">
                    {T.csv.field[f]}
                    {(f === 'date' || f === 'pnl') && <span className="text-neg"> *</span>}
                  </span>
                  <select
                    className="field min-h-10 min-w-0 flex-1 bg-surface-3 py-1.5 text-[14px]"
                    value={mapping[f] ?? ''}
                    onChange={(e) => setField(f, e.target.value)}
                    data-testid={`map-${f}`}
                  >
                    <option value="">{T.csv.notMapped}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <FieldLabel>{T.csv.dateOrder}</FieldLabel>
              <Segmented
                size="sm"
                value={opts.dateOrder}
                onChange={(v) => setOpts({ ...opts, dateOrder: v as DateOrder })}
                options={[
                  { value: 'auto', label: T.csv.dateAuto },
                  { value: 'mdy', label: 'MM/DD/YYYY' },
                  { value: 'dmy', label: 'DD/MM/YYYY' },
                ]}
              />
            </div>
            <div>
              <FieldLabel htmlFor="csv-target">{T.csv.targetAccount}</FieldLabel>
              <select
                id="csv-target"
                className="field"
                value={opts.defaultAccountId ?? ''}
                onChange={(e) => setOpts({ ...opts, defaultAccountId: e.target.value || null })}
                data-testid="csv-target"
              >
                <option value="">—</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {mapping.account !== null && (
              <div>
                <FieldLabel>{T.csv.unknownAccounts}</FieldLabel>
                <Segmented
                  size="sm"
                  value={opts.unknownAccounts}
                  onChange={(v) => setOpts({ ...opts, unknownAccounts: v })}
                  options={[
                    { value: 'create', label: T.csv.createAccounts },
                    { value: 'default', label: T.csv.useTarget },
                  ]}
                />
              </div>
            )}
            {mapping.fees !== null && (
              <Toggle checked={opts.pnlIsGross} onChange={(v) => setOpts({ ...opts, pnlIsGross: v })} label={T.csv.pnlIsGross} help={T.csv.pnlIsNetHelp} />
            )}
            <Toggle checked={opts.includeDuplicates} onChange={(v) => setOpts({ ...opts, includeDuplicates: v })} label={T.csv.includeDuplicates} testId="csv-include-dups" />
          </section>

          {!ready ? (
            <p className="rounded-xl bg-warn/10 px-3 py-2.5 text-[14px] text-warn">{T.csv.needMapping}</p>
          ) : (
            preview && (
              <section>
                <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{T.csv.preview}</h3>
                <div className="mb-3 rounded-2xl bg-surface-2 px-4 py-3 text-[14px]">
                  <p className="num font-semibold" data-testid="csv-summary">
                    {fmt(T.csv.summary, { ok: preview.counts.ok, dup: preview.counts.duplicate, err: preview.counts.error })}
                  </p>
                  <p className="num mt-1 text-ink-2" data-testid="csv-will-import">
                    {fmt(T.csv.willImport, {
                      t: preview.counts.trades,
                      f: preview.counts.cashflows,
                      net: formatMoney(preview.netPnlCents, { sign: 'always' }),
                    })}
                  </p>
                  {preview.newAccounts.length > 0 && (
                    <p className="mt-1 text-ink-2">{fmt(T.csv.newAccounts, { names: preview.newAccounts.map((a) => a.name).join(', ') })}</p>
                  )}
                </div>
                <div className="overflow-hidden rounded-2xl bg-surface-2">
                  {preview.rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <div key={r.line} className="flex items-center gap-3 px-3 py-2 text-[13px] [&+&]:border-t [&+&]:border-line" data-testid="csv-row" data-status={r.status}>
                      <span className="num w-9 shrink-0 text-ink-3">{r.line}</span>
                      <span className="min-w-0 flex-1">
                        <span className="num block truncate">
                          {r.date ? formatDate(r.date, locale) : '—'} · {r.kind === 'trade' ? r.symbol || T.trades.untitled : r.kind === 'deposit' ? T.add.kindDeposit : T.add.kindWithdrawal}
                          {r.accountName && <span className="text-ink-3"> · {r.accountName}</span>}
                        </span>
                        {r.messages.length > 0 && (
                          <span className={cx('block truncate text-[12px]', r.status === 'error' ? 'text-neg' : 'text-warn')}>
                            {r.messages.map((m) => (T.csv.msg as Record<string, string>)[m] ?? m).join(' · ')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        {r.amountCents !== null &&
                          (r.kind === 'trade' ? (
                            <Money cents={r.amountCents} className="block font-semibold" />
                          ) : (
                            <span className="num block font-semibold text-ink-2">{formatMoney(r.amountCents)}</span>
                          ))}
                        <span
                          className={cx(
                            'block text-[11px] font-semibold uppercase',
                            r.status === 'ok' && 'text-pos',
                            r.status === 'duplicate' && 'text-warn',
                            r.status === 'error' && 'text-neg',
                          )}
                        >
                          {T.csv.status[r.status]}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {preview.rows.length > PREVIEW_ROWS && (
                  <p className="mt-2 px-1 text-[12.5px] text-ink-3">{fmt(T.csv.showingFirst, { n: PREVIEW_ROWS })}</p>
                )}
              </section>
            )
          )}
        </div>
      )}
    </Sheet>
  );
}

function Toggle({ checked, onChange, label, help, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#f4f4f5]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="text-[14px]">
        {label}
        {help && <span className="mt-0.5 block text-[12.5px] text-ink-3">{help}</span>}
      </span>
    </label>
  );
}
