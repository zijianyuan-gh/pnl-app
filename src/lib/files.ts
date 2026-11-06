export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

function isTouchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Save a generated file. On iPhone the share sheet ("Save to Files", AirDrop, iCloud Drive)
 * is the reliable path, especially inside a home-screen app; desktops get a normal download.
 */
export async function saveFile(name: string, content: string, mime: string): Promise<SaveOutcome> {
  const blob = new Blob([content], { type: mime });
  if (isTouchDevice() && typeof navigator.share === 'function' && typeof File !== 'undefined') {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
