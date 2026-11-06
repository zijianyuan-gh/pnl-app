export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

export function isTouchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

export function makeFile(name: string, content: string, mime: string): File {
  return new File([content], name, { type: mime });
}

/** Whether the system share sheet can take this file (iOS: AirDrop, "Save to Files", …). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Hand a prepared file to the user. Call this DIRECTLY from a tap/click handler with no
 * `await` before it: iOS Safari only opens the share sheet during a user gesture, so the
 * file must be built beforehand (see ExportSheet).
 */
export async function deliverFile(file: File, preferShare = isTouchDevice()): Promise<SaveOutcome> {
  if (preferShare && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'AbortError') return 'cancelled';
      // NotAllowedError etc. → fall back to a download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

export function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
