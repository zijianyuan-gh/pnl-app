/**
 * iOS only shows the on-screen keyboard if an input is focused *synchronously inside* a tap.
 * Quick Add renders after the tap, so we focus an invisible decimal input during the tap and
 * the sheet then moves focus to the real amount field — iOS keeps the keyboard up across the
 * move. No-op on devices without a touch screen.
 */
let proxy: HTMLInputElement | null = null;

export function primeKeyboard() {
  if (typeof matchMedia === 'undefined' || !matchMedia('(pointer: coarse)').matches) return;
  if (!proxy) {
    proxy = document.createElement('input');
    proxy.setAttribute('inputmode', 'decimal');
    proxy.setAttribute('aria-hidden', 'true');
    proxy.tabIndex = -1;
    proxy.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none;';
    proxy.addEventListener('blur', () => proxy?.remove());
  }
  document.body.appendChild(proxy);
  proxy.focus({ preventScroll: true });
}
