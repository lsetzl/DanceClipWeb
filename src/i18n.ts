export type Lang = 'ja' | 'en';

type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { ja: {}, en: {} };

export function define(ja: Dict, en: Dict) {
  Object.assign(dicts.ja, ja);
  Object.assign(dicts.en, en);
}

const KEY = 'dc.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    // ストレージが使えない環境では保存しない
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export let lang: Lang = initialLang();

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = dicts[lang][key] ?? dicts.ja[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function applyI18n(root: ParentNode = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle!)));
}

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // 同上
  }
  applyI18n();
}
