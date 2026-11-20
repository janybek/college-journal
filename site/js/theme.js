import { setPref } from './session.js';

// Light and dark look. The inline script in index.html applies the stored theme before the first paint (it repeats
// pickTheme, because a module loads too late for that); this module keeps the page in step afterwards.

// Browser bar colour for each theme: the page background.
const THEME_COLORS = { dark: '#080d16', light: '#f9fcff' };

// Only an explicit "light" gives the light theme: dark is the default, and anything unexpected falls back to it.
export function pickTheme(stored) {
  return stored === 'light' ? 'light' : 'dark';
}

export function currentTheme() {
  return pickTheme(document.documentElement.dataset.theme);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

// A click on the toggle is the only thing that stores a theme on this device.
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  setPref('theme', next);
  applyTheme(next);
}
