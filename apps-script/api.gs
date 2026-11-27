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

  if (params.action === 'setHeldBy') {
    return handleSetHeldBy(ss, params);
  }

  if (params.action === 'lendBook') {
    return handleLendBook(ss, params);
  }

  if (params.action === 'returnBook') {
    return handleReturnBook(ss, params);
  }

  if (params.action === 'setLibrary') {
    return handleSetLibrary(ss, params);
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
  const library = String(params.library || '').trim();

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Same ISBN scanned again:
  //  - at the SAME shelf -> it's another physical copy of what's already
  //    catalogued there, not a duplicate entry: bump Copies on that Books
  //    row directly, skipping ToReview entirely.
  //  - at a DIFFERENT shelf -> a legitimately different physical copy
  //    living somewhere else: let it through as its own row, same as if
  //    the ISBN had never been seen before.
  //  - pending (still sitting in ToReview, not yet confirmed) at the SAME
  //    shelf -> block it; we can't safely merge into a row that isn't
  //    final yet.
  const match = _findExistingIsbnShortcut(isbn, ss);
  if (match && match.library === library) {
    if (match.sheet === 'Books') {
      return _incrementCopiesShortcut_(ss, match.row, library);
    }
    return jsonResponse({
      ok: false, duplicate: true,
      message: `⚠️ ISBN già in ToReview per "${library}" — in attesa di revisione, non aggiunto di nuovo.`,
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

/**
 * Checks both Books and ToReview for a row with this ISBN. Returns the
 * first match's sheet name, 1-based row number, and trimmed Library value
 * (not just whether a match exists) so the caller can decide same-shelf
 * (= another copy) vs different-shelf (= not a duplicate at all).
 */
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
        return {
          sheet: sheetName,
          row: i + 1,
          library: libC >= 0 ? String(data[i][libC] || '').trim() : '',
        };
      }
    }
  }
  return null;
}

/** Bumps Copies by 1 on an existing Books row — same ISBN, same shelf. */
function _incrementCopiesShortcut_(ss, rowNum, library) {
  const sheet = ss.getSheetByName('Books');
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalizeHeaderKey);
  const copiesCol = header.indexOf('copies');

  if (copiesCol < 0) {
    return jsonResponse({ ok: true, incrementedCopies: true, message: '✓ Copia aggiuntiva registrata (colonna Copie non trovata).' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cell = sheet.getRange(rowNum, copiesCol + 1);
    const newCount = (Number(cell.getValue()) || 1) + 1;
    cell.setValue(newCount);
    return jsonResponse({
      ok: true, incrementedCopies: true, copies: newCount,
      message: `✓ Copia aggiuntiva — "${library}" ora ha ${newCount} copie di questo ISBN.`,
    });
  } finally {
    lock.releaseLock();
  }
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
    const newRowNum = sheet.getLastRow();
    _setComputedStatusFormulas_(sheet, header, newRowNum);
    return jsonResponse({ ok: true, row: newRowNum });
  } finally {
    lock.releaseLock();
  }
}

// Column letter for a 1-based column index (1 -> A, 2 -> B, ... 27 -> AA).
function columnLetter_(oneBasedIndex) {
  let n = oneBasedIndex;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Gives a Books row live Status/Active Loans formulas, the same shape
// _restructureBooks (HomeLibrary_v2.gs) sets for existing rows — so a book
// added through any path (webapp, Shortcut-via-ToReview-move, or the
// original menu-driven restructure) shows "In prestito"/"Con X" the same
// way. `header` is the already-normalizeHeaderKey'd header array.
function _setComputedStatusFormulas_(sheet, header, rowNum) {
  const titleCol = header.indexOf('title');
  const heldByCol = header.indexOf('heldby');
  const statusCol = header.indexOf('status');
  const activeLoansCol = header.indexOf('activeloans');
  if (titleCol < 0 || statusCol < 0 || activeLoansCol < 0) return;

  const titleL = columnLetter_(titleCol + 1);
  const activeLoansL = columnLetter_(activeLoansCol + 1);

  // Loans!B = Book Title, Loans!H = Date Returned — fixed by that sheet's
  // own schema (see the file header comment), not re-derived per row.
  sheet.getRange(rowNum, activeLoansCol + 1).setFormula(
    `=IFERROR(SUMPRODUCT((Loans!B$2:B$2000=${titleL}${rowNum})*(Loans!H$2:H$2000="")),0)`
  );

  const heldByExpr = heldByCol >= 0
    ? `IF(${columnLetter_(heldByCol + 1)}${rowNum}<>"","Con "&${columnLetter_(heldByCol + 1)}${rowNum},"")`
    : '""';
  sheet.getRange(rowNum, statusCol + 1).setFormula(
    `=IF(${activeLoansL}${rowNum}>0,"In prestito",${heldByExpr})`
  );
}

// Sets (or clears, if heldBy is empty) who currently has a book physically —
// an informal "it's on someone's nightstand" marker, distinct from a formal
// Loans entry. Matches the first Books row with an exact Title match (same
// limitation as the rest of this codebase until books get a stable row ID —
// see FEATURES.md). Library is only touched when the caller explicitly
// passes `library` (the "Rimetti a posto" flow, where the user confirmed or
// picked the shelf the book goes back to) — never as a side effect of
// lending/holding by itself.
function handleSetHeldBy(ss, payload) {
  const sheet = ss.getSheetByName('Books');
  if (!sheet) return jsonResponse({ error: 'Books sheet not found' });

  const title = String(payload.title || '').trim();
  if (!title) return jsonResponse({ error: 'title is required' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const values = sheet.getDataRange().getValues();
    const header = values[0].map(normalizeHeaderKey);
    const titleCol = header.indexOf('title');
    const heldByCol = header.indexOf('heldby');
    if (titleCol < 0 || heldByCol < 0) return jsonResponse({ error: 'Books sheet missing Title/Held By columns' });

    for (let r = 1; r < values.length; r++) {
      if (String(values[r][titleCol] || '').trim() === title) {
        const rowNum = r + 1;
        sheet.getRange(rowNum, heldByCol + 1).setValue(String(payload.heldBy || '').trim());
        if (payload.library !== undefined && payload.library !== null) {
          const libraryCol = header.indexOf('library');
          if (libraryCol >= 0) sheet.getRange(rowNum, libraryCol + 1).setValue(String(payload.library).trim());
        }
        _setComputedStatusFormulas_(sheet, header, rowNum);
        return jsonResponse({ ok: true, row: rowNum });
      }
    }
    return jsonResponse({ error: 'book not found: ' + title });
  } finally {
    lock.releaseLock();
  }
}

// Appends a formal Loans entry. `library` here is only a record of which
// shelf the copy came from at the time of lending — it is NOT written back
// to the Books row. Books.Library stays untouched; a book's Status/Active
// Loans formulas (see _setComputedStatusFormulas_ above) pick up the new
// Loans row on their own via the existing SUMPRODUCT/IF formulas.
function handleLendBook(ss, payload) {
  const sheet = ss.getSheetByName('Loans');
  if (!sheet) return jsonResponse({ error: 'Loans sheet not found' });

  const title = String(payload.title || '').trim();
  if (!title) return jsonResponse({ error: 'title is required' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Matches addLoanEntry's existing convention (HomeLibrary_v2.gs):
    // LoanID is derived from the sheet's row count *before* appending.
    const id = 'L' + String(sheet.getLastRow()).padStart(3, '0');
    const dateLent = payload.dateLent ? new Date(payload.dateLent) : new Date();
    const expectedReturn = payload.expectedReturn ? new Date(payload.expectedReturn) : '';

    sheet.appendRow([
      id,
      title,
      payload.library || '',
      payload.lentBy || '',
      payload.borrowedBy || '',
      dateLent,
      expectedReturn,
      '',
      payload.notes || '',
    ]);
    return jsonResponse({ ok: true, loanId: id, row: sheet.getLastRow() });
  } finally {
    lock.releaseLock();
  }
}

// Marks a Loans row returned by LoanID. If the caller also passes `title`
// + `library` (the user confirmed or picked which shelf the book goes back
// to), the Books row's Library is updated too; otherwise it's left alone.
function handleReturnBook(ss, payload) {
  const sheet = ss.getSheetByName('Loans');
  if (!sheet) return jsonResponse({ error: 'Loans sheet not found' });

  const loanId = String(payload.loanId || '').trim();
  if (!loanId) return jsonResponse({ error: 'loanId is required' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const values = sheet.getDataRange().getValues();
    const header = values[0].map(normalizeHeaderKey);
    const idCol = header.indexOf('loanid');
    const returnedCol = header.indexOf('datereturned');
    if (idCol < 0 || returnedCol < 0) return jsonResponse({ error: 'Loans sheet missing LoanID/Date Returned columns' });

    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || '').trim() === loanId) {
        const rowNum = r + 1;
        const dateReturned = payload.dateReturned ? new Date(payload.dateReturned) : new Date();
        sheet.getRange(rowNum, returnedCol + 1).setValue(dateReturned);
        if (payload.library !== undefined && payload.library !== null && payload.title) {
          const libRes = _writeBooksLibrary_(ss, payload.title, payload.library);
          if (libRes.error) return jsonResponse({ ok: true, row: rowNum, libraryError: libRes.error });
        }
        return jsonResponse({ ok: true, row: rowNum });
      }
    }
    return jsonResponse({ error: 'loan not found: ' + loanId });
  } finally {
    lock.releaseLock();
  }
}

// Explicitly moves a book to a different home shelf (Books.Library). This is
// the only path besides the "put back" flows above that writes Library, and
// it's always a deliberate user action ("Cambia scaffale" in the webapp).
function handleSetLibrary(ss, payload) {
  const title = String(payload.title || '').trim();
  if (!title) return jsonResponse({ error: 'title is required' });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const res = _writeBooksLibrary_(ss, title, payload.library);
    return jsonResponse(res.error ? { error: res.error } : { ok: true, row: res.row });
  } finally {
    lock.releaseLock();
  }
}

// Sets Library on the first Books row whose Title exactly matches (same
// first-match limitation as handleSetHeldBy). Caller holds the lock.
function _writeBooksLibrary_(ss, title, library) {
  const sheet = ss.getSheetByName('Books');
  if (!sheet) return { error: 'Books sheet not found' };
  const wanted = String(title || '').trim();
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(normalizeHeaderKey);
  const titleCol = header.indexOf('title');
  const libraryCol = header.indexOf('library');
  if (titleCol < 0 || libraryCol < 0) return { error: 'Books sheet missing Title/Library columns' };
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][titleCol] || '').trim() === wanted) {
      sheet.getRange(r + 1, libraryCol + 1).setValue(String(library || '').trim());
      return { row: r + 1 };
    }
  }
  return { error: 'book not found: ' + wanted };
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
    seriesName: header.indexOf('seriesname'),
    seriesOrder: header.indexOf('seriesorder'),
    isbn: header.indexOf('isbn'),
    publisher: header.indexOf('publisher'),
    year: header.indexOf('year'),
    coverUrl: header.indexOf('coverurl'),
    subjects: header.indexOf('subjects'),
    notes: header.indexOf('notes'),
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

    const seriesName = idx.seriesName >= 0 ? String(row[idx.seriesName] || '').trim() : '';
    if (seriesName) book.sn = seriesName;

    const seriesOrder = idx.seriesOrder >= 0 ? row[idx.seriesOrder] : '';
    if (seriesOrder !== '' && seriesOrder !== null && seriesOrder !== undefined) book.so = seriesOrder;

    const isbn = idx.isbn >= 0 ? String(row[idx.isbn] || '').trim() : '';
    if (isbn) book.isbn = isbn;

    const publisher = idx.publisher >= 0 ? String(row[idx.publisher] || '').trim() : '';
    if (publisher) book.pub = publisher;

    const year = idx.year >= 0 ? row[idx.year] : '';
    if (year !== '' && year !== null && year !== undefined) book.year = year;

    const coverUrl = idx.coverUrl >= 0 ? String(row[idx.coverUrl] || '').trim() : '';
    if (coverUrl) book.cover = coverUrl;

    const subjects = idx.subjects >= 0 ? String(row[idx.subjects] || '').trim() : '';
    if (subjects) book.subjects = subjects;

    const notes = idx.notes >= 0 ? String(row[idx.notes] || '').trim() : '';
    if (notes) book.notes = notes;

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
    library: header.indexOf('library'),
    lentBy: header.indexOf('lentbyfamilymember'),
    borrowedBy: header.indexOf('borrowedbyexternal'),
    dateLent: header.indexOf('datelent'),
    expectedReturn: header.indexOf('expectedreturn'),
    dateReturned: header.indexOf('datereturned'),
    notes: header.indexOf('notes'),
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
      library: idx.library >= 0 ? String(row[idx.library] || '').trim() : '',
      lentBy: String(row[idx.lentBy] || '').trim(),
      borrowedBy: String(row[idx.borrowedBy] || '').trim(),
      dateLent: formatDateDMY(row[idx.dateLent]),
      expectedReturn: idx.expectedReturn >= 0 ? formatDateDMY(row[idx.expectedReturn]) : '',
      notes: idx.notes >= 0 ? String(row[idx.notes] || '').trim() : '',
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
