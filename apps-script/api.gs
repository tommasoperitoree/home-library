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

function doGet(e) {
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
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'invalid JSON body' });
  }

  if (!checkToken(payload.token)) {
    return jsonResponse({ error: 'unauthorized' });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  if (payload.action === 'addBook') {
    return handleAddBook(ss, payload);
  }

  return jsonResponse({ error: 'unknown action' });
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
