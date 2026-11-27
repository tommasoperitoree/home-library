// Google Apps Script Web App source.
// Deploy as: Web App, Execute as: Me, Access: Anyone.
//
// Spreadsheet "Books" sheet columns (actual): Title, Author, Library, Copies,
//   ISBN, Publisher, Year, Language, Held By, Status, Active Loans, Subjects,
//   Notes, Cover URL, Scanned time, SeriesName, SeriesOrder, ReadBy
//   (only Title, Author, Library, Language, Held By are used — see parseBooks)
// Spreadsheet "Loans" sheet columns (actual): LoanID, Book Title, Library,
//   Lent By (family member), Borrowed By (external), Date Lent,
//   Expected Return, Date Returned, Notes
//   (rows with a non-empty Date Returned are excluded — only active loans are returned)

const SPREADSHEET_ID = '1HoeEFx_-alYJg6KtL9UUmmDZQZsMwSTY_biIoeSZoUw';

// Legacy iOS Shortcut auth — ported from the old WebAppEndpoint_v2.gs (which
// used to own doPost/doGet before it was merged in here to avoid a duplicate
// doPost/doGet collision between that file and this one). The Shortcut on
// the family's phone(s) sends a `secret` param and expects the ToReview-
// staging flow below — do not change the response shapes in
// _routeShortcut/_handleAddBookShortcut/_handleEnrichShortcut without
// updating the Shortcut itself.
//
// Unlike WEBAPP_SECRET's old home (a live-editor-only file, never committed
// anywhere), this file is tracked in a public GitHub repo — so the actual
// secret value lives in Project Settings → Script Properties → WEBAPP_SECRET
// (same pattern as WRITE_TOKEN below), not hardcoded here. Set it once to
// match whatever value the Shortcut already sends.
function getWebappSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WEBAPP_SECRET');
}

function doGet(e) {
  const params = _mergeParams(e);
  if (params.secret) {
    return _routeShortcut(params);
  }

  const action = (e.parameter && e.parameter.action) || 'books';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (action === 'books') {
    const books = parseBooks(ss.getSheetByName('Books'));
    const loans = parseLoans(ss.getSheetByName('Loans'));
    return jsonResponse({ books, loans, updatedAt: new Date().toISOString() });
  }

  if (action === 'stats') {
    const books = parseBooks(ss.getSheetByName('Books'));
    const loans = parseLoans(ss.getSheetByName('Loans'));
    const uniqueAuthors = new Set(books.map((b) => b.a).filter(Boolean));
    return jsonResponse({
      books: books.length,
      authors: uniqueAuthors.size,
      loans: loans.length,
      updatedAt: new Date().toISOString(),
    });
  }

  if (action === 'debug') {
    const booksSheet = ss.getSheetByName('Books');
    const loansSheet = ss.getSheetByName('Loans');
    return jsonResponse({
      booksHeaderRaw: booksSheet ? booksSheet.getDataRange().getValues()[0] : null,
      loansHeaderRaw: loansSheet ? loansSheet.getDataRange().getValues()[0] : null,
    });
  }

  return jsonResponse({ error: 'unknown action' });
}

// Write endpoint. Body must be JSON (sent as Content-Type: text/plain from
// the browser to avoid a CORS preflight, which Apps Script web apps can't
// handle) with shape { action, token, ...actionFields }.
//
// Set the shared token in Project Settings → Script Properties → WRITE_TOKEN.
// Note: since this script's source and the webapp's client JS are both
// public, this token only deters casual/bot abuse of the bare URL — it is
// not a substitute for real per-user auth.
function doPost(e) {
  const params = _mergeParams(e);

  if (params.secret) {
    return _routeShortcut(params);
  }

  if (!checkToken(params.token)) {
    return jsonResponse({ error: 'unauthorized' });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (params.action === 'addBook') {
    return handleAddBook(ss, params);
  }

  return jsonResponse({ error: 'unknown action' });
}

// Merges query-string params with a JSON body, whichever are present.
// Used by both doGet and doPost so the iOS Shortcut's request — whatever
// shape it actually sends (query params, form body, or JSON body) — and
// this app's own JSON-body POSTs both resolve to one flat object.
function _mergeParams(e) {
  let params = (e && e.parameter) || {};
  if (e && e.postData && e.postData.contents) {
    try {
      params = Object.assign({}, params, JSON.parse(e.postData.contents));
    } catch (err) {
      // Not JSON (or empty) — fall back to whatever e.parameter gave us.
    }
  }
  return params;
}

// ─────────────────────────────────────────────────────────────────────────
// LEGACY iOS SHORTCUT ROUTE — ported from WebAppEndpoint_v2.gs
// ─────────────────────────────────────────────────────────────────────────
// Secret-gated (not token-gated like the webapp's addBook above). Writes a
// stub row to ToReview and enriches it inline in the same request (via
// enrichSingleRow in EnrichISBNBooks_v2.gs), rather than the webapp's
// scan flow, which writes straight to Books and enriches later on a timer.
// These are two intentionally separate pipelines feeding two different
// staging areas — do not merge them without updating the Shortcut.

function _routeShortcut(params) {
  const expected = getWebappSecret_();
  if (!expected || params.secret !== expected) {
    return jsonResponse({ ok: false, message: 'Failed: secret non valido.' });
  }
  try {
    if (params.action === 'enrich') return _handleEnrichShortcut();
    return _handleAddBookShortcut(params);
  } catch (err) {
    return jsonResponse({ ok: false, message: 'Failed: ' + err.toString() });
  }
}

function _handleEnrichShortcut() {
  const result = runEnrichment(); // lives in EnrichISBNBooks_v2.gs
  if (result.error) return jsonResponse({ ok: false, message: 'Failed: ' + result.error });
  const message =
    'Arricchiti: ' + result.enriched +
    (result.notFound.length ? ', non trovati: ' + result.notFound.length : '') +
    (result.remaining ? ', rimasti: ' + result.remaining + ' (riesegui)' : '');
  return jsonResponse({
    ok: true, enriched: result.enriched,
    notFound: result.notFound, remaining: result.remaining || 0, message,
  });
}

/**
 * Receives an ISBN scan from the iOS Shortcut.
 * Params: isbn (required), secret (required), library (optional shelf name).
 */
function _handleAddBookShortcut(params) {
  const isbn = (params.isbn || '').toString().replace(/[^0-9Xx]/g, '').trim();
  if (!isbn) return jsonResponse({ ok: false, message: 'Failed: nessun ISBN fornito.' });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const dup = _findExistingIsbnShortcut(isbn, ss);
  if (dup) {
    const loc = dup.library ? ` (${dup.library})` : '';
    return jsonResponse({
      ok: false, duplicate: true,
      message: `⚠️ ISBN già presente in ${dup.sheet}${loc} — non aggiunto.`,
    });
  }

  const reviewSheet = ss.getSheetByName('ToReview');
  if (!reviewSheet) {
    return jsonResponse({ ok: false, message: 'Failed: foglio ToReview non trovato. Hai eseguito il Setup?' });
  }

  const headerRow = reviewSheet.getRange(1, 1, 1, reviewSheet.getLastColumn()).getValues()[0];
  const col = _buildColMapShortcut(headerRow);

  const numCols = headerRow.length;
  const newRow = new Array(numCols).fill('');
  if (col['ReviewStatus']) newRow[col['ReviewStatus'] - 1] = 'Cercando...';
  if (col['ScanNote'])     newRow[col['ScanNote']     - 1] = 'Scansionato via Shortcut';
  if (col['ISBN'])         newRow[col['ISBN']         - 1] = isbn;
  if (col['Library'])      newRow[col['Library']      - 1] = (params.library || '').trim();
  if (col['Copies'])       newRow[col['Copies']       - 1] = 1;
  if (col['Scanned time']) newRow[col['Scanned time'] - 1] = new Date();

  reviewSheet.appendRow(newRow);
  const row = reviewSheet.getLastRow();

  // enrichSingleRow lives in EnrichISBNBooks_v2.gs (same Apps Script project)
  const found  = enrichSingleRow(reviewSheet, row, col, isbn);
  const title  = String(col['Title']  ? reviewSheet.getRange(row, col['Title']).getValue()        : '');
  const status = String(col['ReviewStatus'] ? reviewSheet.getRange(row, col['ReviewStatus']).getValue() : '');

  const message = found
    ? `✓ "${title}" aggiunto a ToReview — ${status}`
    : `ISBN ${isbn} in ToReview — titolo non trovato, controlla manualmente`;

  return jsonResponse({ ok: true, row, isbn, title, status, message });
}

/** Checks both Books and ToReview for a row with this ISBN. */
function _findExistingIsbnShortcut(isbn, ss) {
  for (const sheetName of ['Books', 'ToReview']) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) continue;

    const data  = sh.getDataRange().getValues();
    const isbnC = data[0].indexOf('ISBN');
    const libC  = data[0].indexOf('Library');
    if (isbnC < 0) continue;

    for (let i = 1; i < data.length; i++) {
      const existing = String(data[i][isbnC]).replace(/[^0-9Xx]/g, '');
      if (existing && existing === isbn) {
        return { sheet: sheetName, library: libC >= 0 ? String(data[i][libC]) : '' };
      }
    }
  }
  return null;
}

function _buildColMapShortcut(headerRow) {
  const m = {};
  headerRow.forEach((name, i) => { if (name) m[String(name).trim()] = i + 1; });
  return m;
}

function checkToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('WRITE_TOKEN');
  return !!expected && token === expected;
}

function handleAddBook(ss, payload) {
  const sheet = ss.getSheetByName('Books');
  if (!sheet) return jsonResponse({ error: 'Books sheet not found' });

  const title = String(payload.title || '').trim();
  const isbn = String(payload.isbn || '').trim();
  // A scan-only add (just an ISBN, no title yet) is allowed: it lands with a
  // blank Title, which runEnrichmentBatch (apps-script/enrich.gs) picks up
  // and fills in on its next run.
  if (!title && !isbn) return jsonResponse({ error: 'title or isbn is required' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const headerRaw = sheet.getDataRange().getValues()[0];
    const header = headerRaw.map(normalizeHeaderKey);
    const row = new Array(headerRaw.length).fill('');

    const setByKey = (key, value) => {
      const i = header.indexOf(key);
      if (i >= 0 && value !== undefined && value !== null && value !== '') row[i] = value;
    };

    setByKey('title', title);
    setByKey('author', payload.author || '');
    setByKey('library', payload.shelf || '');
    setByKey('language', payload.language || '');
    setByKey('isbn', payload.isbn || '');
    setByKey('publisher', payload.publisher || '');
    setByKey('year', payload.year || '');
    setByKey('coverurl', payload.coverUrl || '');
    setByKey('subjects', payload.subjects || '');
    setByKey('heldby', payload.heldBy || '');
    setByKey('scannedtime', new Date());

    sheet.appendRow(row);
    return jsonResponse({ ok: true, row: sheet.getLastRow() });
  } finally {
    lock.releaseLock();
  }
}

function parseBooks(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift().map(normalizeHeaderKey);

  const idx = {
    title: header.indexOf('title'),
    author: header.indexOf('author'),
    shelf: header.indexOf('library'),
    language: header.indexOf('language'),
    heldBy: header.indexOf('heldby'),
  };

  const books = [];
  for (const row of rows) {
    const title = String(row[idx.title] || '').trim();
    if (!title) continue;

    const book = {
      t: title,
      a: String(row[idx.author] || '').trim(),
    };

    const shelf = idx.shelf >= 0 ? String(row[idx.shelf] || '').trim() : '';
    if (shelf) book.l = shelf;

    const language = idx.language >= 0 ? String(row[idx.language] || '').trim() : '';
    const normalizedLang = normalizeLanguage(language);
    if (normalizedLang && normalizedLang !== 'Italian') book.lang = normalizedLang;

    const heldBy = idx.heldBy >= 0 ? String(row[idx.heldBy] || '').trim() : '';
    if (heldBy) book.h = heldBy;

    books.push(book);
  }
  return books;
}

function parseLoans(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift().map(normalizeHeaderKey);

  const idx = {
    id: header.indexOf('loanid'),
    book: header.indexOf('booktitle'),
    lentBy: header.indexOf('lentbyfamilymember'),
    borrowedBy: header.indexOf('borrowedbyexternal'),
    dateLent: header.indexOf('datelent'),
    dateReturned: header.indexOf('datereturned'),
  };

  const loans = [];
  for (const row of rows) {
    const book = String(row[idx.book] || '').trim();
    if (!book) continue;

    const dateReturned = idx.dateReturned >= 0 ? row[idx.dateReturned] : '';
    if (dateReturned) continue; // only active (unreturned) loans

    loans.push({
      id: String(row[idx.id] || '').trim(),
      book: book,
      lentBy: String(row[idx.lentBy] || '').trim(),
      borrowedBy: String(row[idx.borrowedBy] || '').trim(),
      dateLent: formatDateDMY(row[idx.dateLent]),
    });
  }
  return loans;
}

// Strips spaces/punctuation so header variants like "Library/Shelf",
// "Library / Shelf" or "library-shelf" all match the same lookup key.
function normalizeHeaderKey(h) {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLanguage(raw) {
  if (!raw) return '';
  const map = {
    italiano: 'Italian', italian: 'Italian', it: 'Italian',
    inglese: 'English', english: 'English', en: 'English',
    spagnolo: 'Spanish', spanish: 'Spanish', es: 'Spanish',
    tedesco: 'German', german: 'German', de: 'German',
  };
  const key = raw.toLowerCase();
  return map[key] || raw;
}

function formatDateDMY(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  return String(value).trim();
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
