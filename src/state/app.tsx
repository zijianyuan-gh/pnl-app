import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../db/actions';
import type { Account, CashFlow, Lang, Settings, Trade } from '../db/types';
import { detectLang, dictFor, localeFor, type Dict } from '../i18n';
import { todayISO, type ISODate } from '../lib/dates';

export interface AddRequest {
  date?: ISODate;
  accountId?: string;
  kind?: 'trade' | 'deposit' | 'withdrawal';
  editTrade?: Trade;
  editFlow?: CashFlow;
}

export interface ToastInput {
  message: string;
  tone?: 'default' | 'success' | 'error';
  action?: { label: string; onClick: () => void | Promise<void> };
  duration?: number;
}

export interface ConfirmInput {
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** require the user to type this exact text */
  typeToConfirm?: string;
  typePlaceholder?: string;
}

interface AppState {
  loaded: boolean;
  dbError: string | null;
  accounts: Account[]; // sorted, including archived
  trades: Trade[];
  cashflows: CashFlow[];
  settings: Settings;
  setSettings: (p: Partial<Settings>) => Promise<void>;
  lang: Lang;
  T: Dict;
  locale: string;
  today: ISODate;
  accountFilter: string | null;
  setAccountFilter: (id: string | null) => void;
  openAdd: (req?: AddRequest) => void;
  addRequest: AddRequest | null;
  closeAdd: () => void;
  toast: (t: ToastInput) => void;
  toasts: (ToastInput & { id: number })[];
  dismissToast: (id: number) => void;
  confirm: (c: ConfirmInput) => Promise<boolean>;
  confirmState: (ConfirmInput & { resolve: (v: boolean) => void }) | null;
}

const Ctx = createContext<AppState | null>(null);

const FILTER_KEY = 'daybook.accountFilter';

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* ignore (private mode) */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    db.open().catch((e) => setDbError(String(e?.message ?? e)));
  }, []);

  const accounts = useLiveQuery(async () => (await db.accounts.toArray()).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt), []);
  const trades = useLiveQuery(() => db.trades.toArray(), []);
  const cashflows = useLiveQuery(() => db.cashflows.toArray(), []);
  const settings = useLiveQuery(() => getSettings(), []);
  const loaded = accounts !== undefined && trades !== undefined && cashflows !== undefined && settings !== undefined;

  const lang: Lang = settings?.lang ?? detectLang();
  const T = useMemo(() => dictFor(lang), [lang]);
  const locale = localeFor(lang);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  // Keep "today" fresh across midnight and when the app returns to the foreground.
  const [today, setToday] = useState(todayISO());
  useEffect(() => {
    const tick = () => setToday(todayISO());
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const [accountFilter, setAccountFilterState] = useState<string | null>(() => readLS(FILTER_KEY));
  const setAccountFilter = useCallback((id: string | null) => {
    setAccountFilterState(id);
    writeLS(FILTER_KEY, id);
  }, []);
  // Drop a filter pointing at a deleted account
  useEffect(() => {
    if (accounts && accountFilter && !accounts.some((a) => a.id === accountFilter)) setAccountFilter(null);
  }, [accounts, accountFilter, setAccountFilter]);

  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const openAdd = useCallback((req: AddRequest = {}) => setAddRequest(req), []);
  const closeAdd = useCallback(() => setAddRequest(null), []);

  const [toasts, setToasts] = useState<(ToastInput & { id: number })[]>([]);
  const toastId = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++toastId.current;
      // one toast at a time, so an Undo button always refers to the latest action
      setToasts([{ ...t, id }]);
      window.setTimeout(() => dismissToast(id), t.duration ?? (t.action ? 6000 : 3000));
    },
    [dismissToast],
  );

  const [confirmState, setConfirmState] = useState<AppState['confirmState']>(null);
  const confirm = useCallback(
    (c: ConfirmInput) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({
          ...c,
          resolve: (v) => {
            setConfirmState(null);
            resolve(v);
          },
        });
      }),
    [],
  );

  const setSettings = useCallback((p: Partial<Settings>) => saveSettings(p), []);

  const value: AppState = {
    loaded,
    dbError,
    accounts: accounts ?? [],
    trades: trades ?? [],
    cashflows: cashflows ?? [],
    settings: settings ?? DEFAULT_SETTINGS,
    setSettings,
    lang,
    T,
    locale,
    today,
    accountFilter,
    setAccountFilter,
    openAdd,
    addRequest,
    closeAdd,
    toast,
    toasts,
    dismissToast,
    confirm,
    confirmState,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Trades & flows filtered by the global account filter. */
export function useFiltered() {
  const { trades, cashflows, accounts, accountFilter } = useApp();
  return useMemo(() => {
    const acc = accountFilter ? accounts.filter((a) => a.id === accountFilter) : accounts;
    return {
      accounts: acc,
      trades: accountFilter ? trades.filter((t) => t.accountId === accountFilter) : trades,
      cashflows: accountFilter ? cashflows.filter((c) => c.accountId === accountFilter) : cashflows,
    };
  }, [trades, cashflows, accounts, accountFilter]);
}

/** Track the on-screen keyboard so bottom sheets stay above it (iOS Safari). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
      document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}
