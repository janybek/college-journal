import ky from './i18n/ky.js';
import ru from './i18n/ru.js';
import en from './i18n/en.js';
import { setPref } from './session.js';

// Texts of the interface in three languages. Nothing here touches the DOM or storage at load time.
export const LANGS = ['ky', 'ru', 'en'];
export const DEFAULT_LANG = 'ky';

const BASE = { ky, ru, en };
const hasOwn = (object, key) => object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
const textIn = (dict, key) => (hasOwn(dict, key) && typeof dict[key] === 'string' ? dict[key] : undefined);

// dicts: { ky, ru, en }. Missing in `lang` -> Russian -> the key itself. '{name}' is filled from params.
export function translate(dicts, lang, key, params) {
  const text = textIn(dicts[lang], key) ?? textIn(dicts.ru, key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (hasOwn(params, name) ? String(params[name]) : match));
}

let dicts = BASE;
let current = DEFAULT_LANG;
let listener = null;

const changed = () => { if (listener) listener(); };

export function t(key, params) {
  return translate(dicts, current, key, params);
}

export function getLang() {
  return current;
}

// Switches the language, remembers it on this device and redraws the screen if the language changed.
export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  const previous = current;
  current = lang;
  setPref('lang', lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (lang !== previous) changed();
}

// Applies rows of the «Переводы» sheet on top of the built-in texts. An empty cell keeps the built-in text.
export function applyOverrides(rows) {
  const next = { ky: { ...ky }, ru: { ...ru }, en: { ...en } };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.key !== 'string' || row.key === '') continue;
    for (const lang of LANGS) {
      const value = row[lang] === undefined || row[lang] === null ? '' : String(row[lang]).trim();
      if (value !== '') next[lang][row.key] = value;
    }
  }
  const before = JSON.stringify(dicts);
  dicts = next;
  if (JSON.stringify(next) !== before) changed();
}

// Registers the function that redraws the current screen after the language or the texts change.
export function onTextsChange(fn) {
  listener = fn;
}
