import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';
import { useApp } from '../state/app';
import { fmt } from '../i18n';
import { buildBackup, restoreBackup, serializeBackup } from '../db/backup';
import { formatMoney } from '../lib/money';
import { Button, Sheet } from '../components/ui';
import { DaybookNative, isNative } from './bridge';
import { decideRecovery, shouldWriteSnapshot, type RecoveryDecision } from './recovery';

// ---- tiny store for native status shown in Settings ----
interface NativeStatus {
  autoBackupAt: number | null;
  autoBackupError: string | null;
  biometry: 'faceID' | 'touchID' | 'opticID' | 'none';
  canAuthenticate: boolean;
}
let status: NativeStatus = { autoBackupAt: null, autoBackupError: null, biometry: 'none', canAuthenticate: false };
const listeners = new Set<() => void>();
function setStatus(p: Partial<NativeStatus>) {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
}
export function useNativeStatus(): NativeStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export function biometryLabel(T: ReturnType<typeof useApp>['T'], b: NativeStatus['biometry']): string {
  return b === 'faceID' ? 'Face ID' : b === 'touchID' ? 'Touch ID' : b === 'opticID' ? 'Optic ID' : T.lock.passcode;
}

/**
 * iOS-only background services: automatic backup copy in Files, recovery from it when the app's
 * storage is found empty, and the App Lock. Renders nothing in the browser / PWA.
 */
export function NativeServices() {
  if (!isNative()) return null;
  return (
    <>
      <AutoBackup />
      <AppLockGate />
    </>
  );
}

function AutoBackup() {
  const { accounts, trades, cashflows, settings, T, locale, toast } = useApp();
  const [phase, setPhase] = useState<'checking' | 'offer' | 'ready'>('checking');
  const [offer, setOffer] = useState<Extract<RecoveryDecision, { action: 'offer' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = { accounts: accounts.length, trades: trades.length, cashflows: cashflows.length };

  // 1. At launch: is there an automatic copy we should offer back?
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const files = await DaybookNative.readSnapshot();
        const d = decideRecovery(counts, files, settings.erasedAt ?? null);
        if (!alive) return;
        setStatus({ autoBackupAt: files.modifiedAt });
        if (d.action === 'offer') {
          setOffer(d);
          setPhase('offer');
        } else setPhase('ready');
      } catch {
        if (alive) setPhase('ready');
      }
    })();
    void DaybookNative.biometry()
      .then((b) => setStatus({ biometry: b.biometry, canAuthenticate: b.available }))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // run once with the data present at launch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Keep the copy current (never with an empty database, never before recovery is decided)
  const write = useCallback(async () => {
    try {
      const text = serializeBackup(await buildBackup());
      await DaybookNative.writeSnapshot({ text });
      setStatus({ autoBackupAt: Date.now(), autoBackupError: null });
    } catch (e) {
      setStatus({ autoBackupError: String((e as Error)?.message ?? e) });
    }
  }, []);
  const canWrite = phase === 'ready' && shouldWriteSnapshot(counts);
  useEffect(() => {
    if (!canWrite) return;
    const id = window.setTimeout(() => void write(), 1200);
    return () => window.clearTimeout(id);
  }, [canWrite, accounts, trades, cashflows, write]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && canWrite) void write();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [canWrite, write]);

  if (phase !== 'offer' || !offer) return null;
  const b = offer.backup;
  const net = b.trades.reduce((s, t) => s + t.pnlCents, 0);
  return (
    <Sheet open onClose={() => setPhase('ready')} title={T.native.recoveryTitle} testId="recovery-sheet">
      <p className="text-[15px] leading-relaxed text-ink-2">
        {fmt(T.native.recoveryBody, {
          date: offer.modifiedAt ? new Date(offer.modifiedAt).toLocaleString(locale) : '—',
          summary: fmt(T.data.restoreSummary, { a: b.accounts.length, t: b.trades.length, f: b.cashflows.length, net: formatMoney(net, { sign: 'always' }) }),
        })}
      </p>
      <div className="mt-5 grid gap-2">
        <Button
          variant="primary"
          size="lg"
          disabled={busy}
          data-testid="recovery-restore"
          onClick={async () => {
            setBusy(true);
            try {
              await restoreBackup(b, 'replace');
              toast({ message: T.native.recovered, tone: 'success' });
              setPhase('ready');
            } catch (e) {
              toast({ message: fmt(T.errors.generic, { msg: (e as Error).message }), tone: 'error' });
            } finally {
              setBusy(false);
            }
          }}
        >
          {T.native.recoveryRestore}
        </Button>
        <Button size="lg" onClick={() => setPhase('ready')} data-testid="recovery-skip">
          {T.native.recoverySkip}
        </Button>
      </div>
    </Sheet>
  );
}

/** Screen lock with Face ID / Touch ID / passcode. It hides the app; it is not encryption. */
function AppLockGate() {
  const { settings, T } = useApp();
  const enabled = !!settings.appLock;
  const nativeStatus = useNativeStatus();
  const [locked, setLocked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    void DaybookNative.setPrivacyCover({ enabled }).catch(() => {});
    if (!enabled) setLocked(false);
  }, [enabled]);

  const unlock = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      const r = await DaybookNative.authenticate({ reason: T.lock.reason, cancelTitle: T.common.cancel });
      if (r.success) setLocked(false);
      else if (r.error !== 'cancelled') setError(r.error === 'passcode_not_set' ? T.lock.noPasscode : T.lock.failed);
    } finally {
      inFlight.current = false;
    }
  }, [T]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && enabledRef.current && !inFlight.current) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Ask right away when the locked app comes to the front
  useEffect(() => {
    if (!locked) return;
    const tryNow = () => document.visibilityState === 'visible' && void unlock();
    const id = window.setTimeout(tryNow, 400);
    document.addEventListener('visibilitychange', tryNow);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('visibilitychange', tryNow);
    };
  }, [locked, unlock]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (locked) root?.setAttribute('inert', '');
    else if (!document.querySelector('[role=dialog]')) root?.removeAttribute('inert');
  }, [locked]);

  if (!locked) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="lock-title" className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-bg px-8 text-center" data-testid="lock-screen">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">
        <Lock size={30} aria-hidden />
      </div>
      <h1 id="lock-title" className="text-[20px] font-semibold">
        {T.lock.title}
      </h1>
      {error && (
        <p role="alert" className="mt-2 text-[14px] text-neg">
          {error}
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-6 min-w-[220px]" onClick={() => void unlock()} data-testid="lock-unlock">
        {fmt(T.lock.unlockWith, { method: biometryLabel(T, nativeStatus.biometry) })}
      </Button>
    </div>,
    document.body,
  );
}
