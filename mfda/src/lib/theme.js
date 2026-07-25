/**
 * Dark/light theme. Persisted per-browser; defaults to the OS preference.
 * The palette itself lives in index.css as CSS variables — toggling is just
 * flipping the `dark` class on <html> (also done pre-paint by an inline
 * script in index.html to avoid a light flash on load).
 */
const KEY = 'mfda-theme';

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable */
  }
  applyTheme(theme);
}

export function initTheme() {
  applyTheme(getTheme());
}
