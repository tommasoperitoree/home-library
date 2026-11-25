// Google Apps Script Web App source.
// Deploy as: Web App, Execute as: Me, Access: Anyone.
//
// Spreadsheet "Books" sheet columns: Title, Author, Library/Shelf, Language, HeldBy
// Spreadsheet "Loans" sheet columns:  ID, Book, LentBy, BorrowedBy, DateLent

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

  return jsonResponse({ error: 'unknown action' });
}

function parseBooks(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift().map((h) => String(h).trim().toLowerCase());

  const idx = {
    title: header.indexOf('title'),
    author: header.indexOf('author'),
    shelf: header.indexOf('library/shelf'),
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
  const header = rows.shift().map((h) => String(h).trim().toLowerCase());

  const idx = {
    id: header.indexOf('id'),
    book: header.indexOf('book'),
    lentBy: header.indexOf('lentby'),
    borrowedBy: header.indexOf('borrowedby'),
    dateLent: header.indexOf('datelent'),
  };

  const loans = [];
  for (const row of rows) {
    const book = String(row[idx.book] || '').trim();
    if (!book) continue;

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
