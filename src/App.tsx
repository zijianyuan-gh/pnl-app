import { useCallback, useEffect, useState } from 'react';
import { BarChart3, CalendarDays, List, Plus, Wallet } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp, useKeyboardInset } from './state/app';
import { CalendarScreen } from './screens/CalendarScreen';
import { TradesScreen } from './screens/TradesScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { AccountsScreen } from './screens/AccountsScreen';
import { QuickAddSheet } from './components/QuickAdd';
import { ConfirmDialog, Toasts } from './components/overlays';
import { requestPersistentStorage } from './db/db';
import { cx } from './components/ui';
import { primeKeyboard } from './lib/keyboard';
import { isNative } from './native/bridge';
import { NativeServices } from './native/services';

type Tab = 'calendar' | 'trades' | 'analytics' | 'accounts';
const TABS: Tab[] = ['calendar', 'trades', 'analytics', 'accounts'];

function tabFromHash(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TABS as string[]).includes(h) ? (h as Tab) : 'calendar';
}

export default function App() {
  const { T, loaded, dbError, openAdd, accounts, trades } = useApp();
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [createSignal, setCreateSignal] = useState(0);
  useKeyboardInset();

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setTab = useCallback((t: Tab) => {
    if (window.location.hash !== `#/${t}`) window.location.hash = `/${t}`;
    setTabState(t);
  }, []);

  // Ask for durable storage once the user has real data
  useEffect(() => {
    if (trades.length > 0 || accounts.length > 0) void requestPersistentStorage();
  }, [trades.length > 0, accounts.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut on desktop: "n" opens quick add
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !/input|textarea|select/i.test(el.tagName) && !document.querySelector('[role=dialog],[role=alertdialog]')) {
        e.preventDefault();
        openAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openAdd]);

  if (dbError) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-[17px] font-semibold">{T.errors.storage}</p>
          <p className="mt-2 text-[13px] text-ink-3">{dbError}</p>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3" aria-busy="true">
        {T.common.loading}
      </div>
    );
  }

  const goCreateAccount = () => {
    setTab('accounts');
    setCreateSignal((n) => n + 1);
  };

  return (
    <div className="flex h-full flex-col">
      {/* the iOS app updates through the App Store; only the web version has a service worker */}
      {!isNative() && <UpdateBanner />}
      <main className="relative min-h-0 flex-1">
        {TABS.map((t) => (
          <div
            key={t}
            id={`screen-${t}`}
            className={cx('scroll-area absolute inset-0', t !== tab && 'hidden')}
            style={{ paddingBottom: 'calc(var(--tabbar-h) + var(--sab) + 16px)' }}
            aria-hidden={t !== tab}
          >
            {t === 'calendar' && <CalendarScreen onCreateAccount={goCreateAccount} />}
            {t === 'trades' && <TradesScreen />}
            {t === 'analytics' && <AnalyticsScreen />}
            {t === 'accounts' && <AccountsScreen createSignal={createSignal} />}
          </div>
        ))}
      </main>
      <TabBar tab={tab} setTab={setTab} />
      <QuickAddSheet />
      <ConfirmDialog />
      <Toasts />
      <NativeServices />
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { T, openAdd } = useApp();
  const item = (t: Tab, Icon: typeof CalendarDays) => (
    <button
      key={t}
      type="button"
      onClick={() => {
        if (t === tab) document.getElementById(`screen-${t}`)?.scrollTo({ top: 0, behavior: 'smooth' });
        setTab(t);
      }}
      aria-current={t === tab ? 'page' : undefined}
      data-testid={`tab-${t}`}
      className={cx(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pt-1 text-[10.5px] font-medium transition',
        t === tab ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      <Icon size={23} strokeWidth={t === tab ? 2.3 : 1.8} />
      <span className="truncate">{T.tabs[t]}</span>
    </button>
  );
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/92 backdrop-blur-xl"
      style={{ paddingBottom: 'var(--sab)', paddingLeft: 'var(--sal)', paddingRight: 'var(--sar)' }}
      aria-label="Main"
    >
      <div className="mx-auto flex h-[var(--tabbar-h)] max-w-[720px] items-stretch">
        {item('calendar', CalendarDays)}
        {item('trades', List)}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => {
              primeKeyboard();
              openAdd();
            }}
            aria-label={T.tabs.add}
            data-testid="tab-add"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-black shadow-lg shadow-black/40 transition active:scale-95"
          >
            <Plus size={26} strokeWidth={2.6} />
          </button>
        </div>
        {item('analytics', BarChart3)}
        {item('accounts', Wallet)}
      </div>
    </nav>
  );
}

/**
 * Activate the waiting service worker and reload once it controls the page. workbox-window only
 * reloads by itself when the page already had a controller at startup, so we listen ourselves.
 */
function applyUpdate(updateServiceWorker: (reload?: boolean) => Promise<void>) {
  let done = false;
  const reload = () => {
    if (done) return;
    done = true;
    window.location.reload();
  };
  navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });
  void updateServiceWorker(true);
  // Fallback: if the browser doesn't report the switch, reload anyway.
  setTimeout(reload, 4000);
}

function UpdateBanner() {
  const { T, addRequest, confirm } = useApp();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Check for a new version hourly and whenever the app returns to the foreground
      const check = () => void reg.update().catch(() => {});
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="pt-safe px-safe z-50 bg-surface-3 pb-2 text-[14px]" role="status" data-testid="update-banner">
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
        <span>{T.update.available}</span>
        <button type="button" className="min-h-9 rounded-lg bg-ink px-3 font-semibold text-black" onClick={async () => {
            // Never silently throw away an open entry (it is also auto-saved as a draft)
            if (addRequest && !(await confirm({ title: T.update.unsavedTitle, body: T.update.unsavedBody, confirmLabel: T.common.reload }))) return;
            applyUpdate(updateServiceWorker);
          }}
          data-testid="update-reload"
        >
          {T.common.reload}
        </button>
      </div>
    </div>
  );
}
