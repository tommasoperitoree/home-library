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
export const WRITE_TOKEN = window.WRITE_TOKEN || 'segretWriteHomeWebAppLibraryToken001';

export const CACHE_KEY = 'hl_cache_v1';
export const SELECTED_MEMBER_KEY = 'hl_selected_member';
export const LAST_TAB_KEY = 'hl_last_tab';
export const SCAN_SHELF_KEY = 'hl_scan_shelf';

export const MEMBERS = [
  { name: 'Papà',   emoji: '👨', face: 'icons/family/papa.svg' },
  { name: 'Mamma',  emoji: '👩', face: 'icons/family/mamma.svg' },
  { name: 'Tommi',  emoji: '🧔', face: 'icons/family/tommi.svg' },
  { name: 'Vitto',  emoji: '🧑', face: 'icons/family/vitto.svg' },
  { name: 'Checco', emoji: '👶', face: 'icons/family/checco.svg' },
  { name: 'Giachi', emoji: '👴', face: 'icons/family/giachi.svg' },
  { name: 'Gio',    emoji: '👦', face: 'icons/family/gio.svg' },
  { name: 'Ale',    emoji: '🧒', face: 'icons/family/ale.svg' },
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

// One color per known shelf (by its position in SHELVES), so the spine
// color is a stable visual cue for "which shelf this book lives on" instead
// of a meaningless per-row index. Falls back to a stable hash-based color
// for any shelf name not in SHELVES (e.g. the sheet gained a new shelf this
// hasn't been updated for yet), and a neutral gray when Library is blank.
const SHELF_COLOR_PALETTE = [
  '#C4913A', '#7B9E6B', '#6B87A0', '#A06B6B', '#8A7BAE',
  '#5C3D2E', '#D98E5F', '#4F8A8B', '#9C6B5E',
];
const NO_SHELF_COLOR = '#B9AFA0';

export function shelfColor(shelfKey) {
  if (!shelfKey) return NO_SHELF_COLOR;
  const idx = SHELVES.findIndex((s) => s.key === shelfKey);
  if (idx >= 0) return SHELF_COLOR_PALETTE[idx % SHELF_COLOR_PALETTE.length];

  let hash = 0;
  for (let i = 0; i < shelfKey.length; i++) hash = (hash * 31 + shelfKey.charCodeAt(i)) >>> 0;
  return SHELF_COLOR_PALETTE[hash % SHELF_COLOR_PALETTE.length];
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

async function postAction(action, fields) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script web apps don't
    // handle; the body itself is still JSON and parsed as such server-side.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: WRITE_TOKEN, ...fields }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * Add a book via the Apps Script write endpoint.
 * @param {{title: string, author?: string, shelf?: string, language?: string,
 *   isbn?: string, publisher?: string, year?: string|number, coverUrl?: string,
 *   subjects?: string, heldBy?: string}} fields
 * @returns {Promise<{ok: true, row: number}>}
 */
export function addBook(fields) {
  return postAction('addBook', fields);
}

/**
 * Sets (or clears, if heldBy is '') who's informally holding a book right
 * now. Matches the first Books row with an exact Title match server-side.
 * Only touches Library if `library` is passed (the "Rimetti a posto" flow).
 * @param {{title: string, heldBy: string, library?: string}} fields
 */
export function setHeldBy(fields) {
  return postAction('setHeldBy', fields);
}

/**
 * Registers a formal loan (appends a Loans row). `library` is just a record
 * of which shelf the copy came from — it's never written back to Books.
 * @param {{title: string, library?: string, lentBy: string, borrowedBy: string,
 *   dateLent?: string, expectedReturn?: string, notes?: string}} fields
 * @returns {Promise<{ok: true, loanId: string, row: number}>}
 */
export function lendBook(fields) {
  return postAction('lendBook', fields);
}

/**
 * Marks a Loans row returned by LoanID. Pass `title` + `library` to also set
 * the book's home shelf (Books.Library) in the same request.
 * @param {{loanId: string, dateReturned?: string, title?: string, library?: string}} fields
 */
export function returnBook(fields) {
  return postAction('returnBook', fields);
}

/**
 * Moves a book to a different home shelf (Books.Library), matched by exact
 * Title server-side.
 * @param {{title: string, library: string}} fields
 */
export function setLibrary(fields) {
  return postAction('setLibrary', fields);
}

/**
 * Scanner entry point: looks the ISBN up and files it on `library`.
 * Resolves to { status: 'added' | 'queued' | 'notFound' | 'duplicate' |
 * 'pendingReview', ... } — see handleScanIsbn in apps-script/api.gs.
 * @param {{isbn: string, library: string}} fields
 */
export function scanIsbn(fields) {
  return postAction('scanIsbn', fields);
}

/**
 * Sets Copies on the Books row with this ISBN on this shelf.
 * @param {{isbn: string, library: string, copies: number}} fields
 */
export function setCopies(fields) {
  return postAction('setCopies', fields);
}

/**
 * Adds one copy of an already-catalogued ISBN on `library` (bumps Copies if
 * that shelf already has it, otherwise a new row).
 * @param {{isbn: string, library: string}} fields
 * @returns {Promise<{status: 'incremented'|'added', copies: number}>}
 */
export function addCopyToShelf(fields) {
  return postAction('addCopyToShelf', fields);
}

// Canonical ISBN for comparisons (digits only, ISBN-10 -> ISBN-13). Mirrors
// isbnKey_ in apps-script/api.gs.
export function isbnKey(raw) {
  const s = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length !== 10) return s;
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}

export function getScanShelf() {
  try { return localStorage.getItem(SCAN_SHELF_KEY) || ''; } catch { return ''; }
}

export function setScanShelf(key) {
  try { localStorage.setItem(SCAN_SHELF_KEY, key); } catch { /* ignore */ }
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

export function getLastTab() {
  return localStorage.getItem(LAST_TAB_KEY);
}

export function setLastTab(tab) {
  localStorage.setItem(LAST_TAB_KEY, tab);
}
