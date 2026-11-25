// Data fetching + caching layer.
//
// APPS_SCRIPT_URL can be overridden by creating a `js/config.js` file
// (gitignored) that sets `window.APPS_SCRIPT_URL` before this module loads,
// e.g.:
//   window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXX/exec';

export const APPS_SCRIPT_URL =
  window.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbwLQtleZ5vkGoxp9N_3UsejNOIAlzVv6Hw_9u5pY6t4vhKXIWVJ1BX-aZm1ygC-mcJz/exec';

// WRITE_TOKEN gates write actions (addBook, …) and must match the
// `WRITE_TOKEN` script property set in the Apps Script project. Set it via
// `js/config.js` (gitignored): window.WRITE_TOKEN = '...'. Note this only
// deters casual abuse of the bare endpoint — it ships in the public client
// bundle, so it is not real secrecy. See FEATURES.md.
export const WRITE_TOKEN = window.WRITE_TOKEN || '';

export const CACHE_KEY = 'hl_cache_v1';
export const SELECTED_MEMBER_KEY = 'hl_selected_member';

export const MEMBERS = [
  { name: 'Giachi', emoji: '👴' },
  { name: 'Ale',    emoji: '🧒' },
  { name: 'Papà',   emoji: '👨' },
  { name: 'Tommi',  emoji: '🧔' },
  { name: 'Vitto',  emoji: '🧑' },
  { name: 'Gio',    emoji: '👦' },
  { name: 'Mamma',  emoji: '👩' },
  { name: 'Checco', emoji: '👶' },
];

export const SHELVES = [
  { key: 'Cubotti - cameretta grandi',          label: 'Cubotti G.' },
  { key: 'Cubotti - cameretta piccoli',         label: 'Cubotti P.' },
  { key: 'Cubotti - mansarda',                  label: 'Cubotti M.' },
  { key: 'Libreria - scala',                    label: 'Scala' },
  { key: 'Libreria bianca - cameretta piccoli', label: 'Bianca P.' },
  { key: 'Libreria bianca - mansarda',          label: 'Bianca M.' },
  { key: 'Libreria legno - mansarda',           label: 'Legno' },
  { key: 'Mensola - cameretta grandi',          label: 'Mensola G.' },
  { key: 'Mensola - letto Ale',                 label: 'Mensola Ale' },
];

export const LANGUAGES = [
  { key: 'IT', label: '🇮🇹 IT' },
  { key: 'EN', label: '🇬🇧 EN' },
  { key: 'ES', label: '🇪🇸 ES' },
  { key: 'DE', label: '🇩🇪 DE' },
];

const LANG_NAME_TO_CODE = {
  italian: 'IT', italiano: 'IT',
  english: 'EN', inglese: 'EN',
  spanish: 'ES', spagnolo: 'ES',
  german: 'DE', tedesco: 'DE',
};

export function bookLangCode(book) {
  if (!book.lang) return 'IT';
  const code = LANG_NAME_TO_CODE[book.lang.toLowerCase()];
  return code || book.lang.toUpperCase().slice(0, 2);
}

export function spineColor(index) {
  const colors = ['#C4913A', '#7B9E6B', '#6B87A0', '#A06B6B', '#8A7BAE', '#5C3D2E'];
  return colors[index % colors.length];
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchFromNetwork() {
  const url = `${APPS_SCRIPT_URL}?action=books`;
  const data = await fetchJson(url);
  localStorage.setItem(CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }));
  return data;
}

function fetchFromCache() {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.data;
  } catch {
    return null;
  }
}

async function fetchFromBundledFallback() {
  const [books, loans] = await Promise.all([
    fetchJson('data/books.json').catch(() => []),
    fetchJson('data/loans.json').catch(() => []),
  ]);
  return { books, loans, updatedAt: null };
}

/**
 * Load library data: network first, cache second, bundled static file last.
 * @returns {Promise<{books: object[], loans: object[], updatedAt: string|null}>}
 */
export async function loadLibraryData() {
  try {
    return await fetchFromNetwork();
  } catch {
    const cached = fetchFromCache();
    if (cached) return cached;
    return fetchFromBundledFallback();
  }
}

/**
 * Add a book via the Apps Script write endpoint.
 * @param {{title: string, author?: string, shelf?: string, language?: string,
 *   isbn?: string, publisher?: string, year?: string|number, coverUrl?: string,
 *   subjects?: string, heldBy?: string}} fields
 * @returns {Promise<{ok: true, row: number}>}
 */
export async function addBook(fields) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script web apps don't
    // handle; the body itself is still JSON and parsed as such server-side.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'addBook', token: WRITE_TOKEN, ...fields }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function getSelectedMember() {
  return localStorage.getItem(SELECTED_MEMBER_KEY);
}

export function setSelectedMember(name) {
  localStorage.setItem(SELECTED_MEMBER_KEY, name);
}

export function clearSelectedMember() {
  localStorage.removeItem(SELECTED_MEMBER_KEY);
}
