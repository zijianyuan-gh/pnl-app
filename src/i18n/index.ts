import { en, type Dict } from './en';
import { zh } from './zh';
import type { Lang } from '../db/types';

export type { Dict };

export function detectLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : ['en'];
  return langs.some((l) => l?.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

export function dictFor(lang: Lang): Dict {
  return lang === 'zh' ? zh : en;
}

export function localeFor(lang: Lang): string {
  return lang === 'zh' ? 'zh-CN' : 'en-US';
}

/**
 * "{n} trades" → "3 trades". English plurals: "{n|trade|trades}" → "1 trade" / "3 trades".
 */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, k, one, many) => {
      const v = vars[k];
      return `${v} ${Number(v) === 1 ? one : many}`;
    })
    .replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
