import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { useApp } from '../state/app';
import { Button, cx } from './ui';

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(var(--tabbar-h) + var(--sab) + 12px + var(--kb))' }}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'animate-toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line-strong bg-surface-3/95 py-2 pl-4 pr-2 shadow-xl backdrop-blur',
          )}
        >
          {t.tone === 'error' ? (
            <AlertTriangle size={18} className="shrink-0 text-neg" />
          ) : t.tone === 'success' ? (
            <CheckCircle2 size={18} className="shrink-0 text-pos" />
          ) : null}
          <span className="num min-w-0 flex-1 py-1.5 text-[14px] leading-snug">{t.message}</span>
          {t.action ? (
            <button
              type="button"
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold text-link hover:bg-white/5"
              onClick={async () => {
                dismissToast(t.id);
                await t.action!.onClick();
              }}
            >
              <RotateCcw size={15} />
              {t.action.label}
            </button>
          ) : (
            <span className="w-2" />
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const { confirmState, T } = useApp();
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTyped('');
    if (confirmState?.typeToConfirm) setTimeout(() => inputRef.current?.focus(), 50);
  }, [confirmState]);
  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirmState.resolve(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirmState]);
  if (!confirmState) return null;
  const c = confirmState;
  const okEnabled = !c.typeToConfirm || typed.trim() === c.typeToConfirm;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-6" style={{ paddingBottom: 'var(--kb)' }}>
      <div className="animate-fade-in absolute inset-0 bg-black/70" onClick={() => c.resolve(false)} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="animate-pop-in relative w-full max-w-[340px] rounded-[20px] bg-surface-2 p-5 shadow-2xl"
      >
        <h2 id="confirm-title" className="text-[17px] font-semibold leading-snug">
          {c.title}
        </h2>
        {c.body && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{c.body}</p>}
        {c.typeToConfirm && (
          <input
            ref={inputRef}
            className="field mt-4"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={c.typePlaceholder ?? c.typeToConfirm}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={c.typePlaceholder ?? c.typeToConfirm}
            data-testid="confirm-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && okEnabled) c.resolve(true);
            }}
          />
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button onClick={() => c.resolve(false)} data-testid="confirm-cancel">
            {T.common.cancel}
          </Button>
          <Button
            variant={c.destructive ? 'danger' : 'primary'}
            disabled={!okEnabled}
            onClick={() => c.resolve(true)}
            data-testid="confirm-ok"
          >
            {c.confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
