// ISBN enrichment — runs as a time-driven trigger, buffering scan-only adds
// (books added with just an ISBN, no title — see handleAddBook in api.gs)
// and filling in Title/Author/Publisher/Year/Language/Subjects/Cover URL.
//
// Ported from the standalone enrich_books_from_isbn.py script (which targeted
// an Airtable base that's no longer part of this project) — same lookup
// strategy (OPAC SBN first, Open Library fallback, cover search + validation),
// rewritten to read/write the Books sheet directly instead. Summary,
// Translator, and Physical Description from the original script are dropped:
// this sheet has no columns for them.
//
// A row whose ISBN is confirmed genuinely not found (both sources responded,
// neither has a record) is moved to ToReview rather than left in Books with
// a placeholder title — Books is the live, family-facing catalog, and a
// "⚠️ ISBN non trovato" title sitting there (visible in the webapp's
// Catalogo) is just clutter. ToReview is exactly the staging area that
// already exists for "needs a human" rows (same sheet the legacy iOS
// Shortcut flow uses) — see moveNotFoundRowsToToReview_ below.
//
// One-time setup (run once from the Apps Script editor, function picker):
//   installEnrichmentTrigger
// This registers a trigger that calls runEnrichmentBatch() every minute.
// To remove it later: run uninstallEnrichmentTrigger.
//
// Optional: Project Settings → Script Properties → GOOGLE_BOOKS_API_KEY, to
// raise the (already generous for family-scale use) anonymous Google Books
// quota used for cover lookups.

const ENRICH_MAX_PER_RUN = 5; // keeps each run comfortably under the 6-minute trigger limit

function installEnrichmentTrigger() {
  removeEnrichmentTriggers_();
  ScriptApp.newTrigger('runEnrichmentBatch').timeBased().everyMinutes(1).create();
}

function uninstallEnrichmentTrigger() {
  removeEnrichmentTriggers_();
}

function removeEnrichmentTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'runEnrichmentBatch') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

function runEnrichmentBatch() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Books');
  if (!sheet) return;

  const values = sheet.getDataRange().getValues();
  const header = values[0].map(normalizeHeaderKey);

  const idx = {
    title: header.indexOf('title'),
    author: header.indexOf('author'),
    isbn: header.indexOf('isbn'),
    publisher: header.indexOf('publisher'),
    year: header.indexOf('year'),
    language: header.indexOf('language'),
    subjects: header.indexOf('subjects'),
    coverUrl: header.indexOf('coverurl'),
    library: header.indexOf('library'),
    copies: header.indexOf('copies'),
    scannedTime: header.indexOf('scannedtime'),
  };
  if (idx.title < 0 || idx.isbn < 0) return;

  let processed = 0;
  const notFound = []; // {sheetRow, isbn, row} — handled after the loop, see below

  for (let r = 1; r < values.length && processed < ENRICH_MAX_PER_RUN; r++) {
    const row = values[r];
    const title = String(row[idx.title] || '').trim();
    const isbn = cleanIsbn_(row[idx.isbn]);
    if (title || !isbn) continue; // only pending (isbn set, title blank) rows

    processed++;
    const sheetRow = r + 1; // 1-indexed for getRange
    const info = lookupIsbn_(isbn);

    if (info === undefined) {
      // A fetch/parse error happened somewhere along the way (network blip,
      // non-200, bad JSON) rather than both sources genuinely having no
      // record. Leave the title blank so this row gets retried next run,
      // instead of treating it as a confirmed miss.
      Utilities.sleep(300);
      continue;
    }

    if (!info || !info.title) {
      // Confirmed miss — queue for move-to-ToReview. Don't touch the sheet
      // yet: deleting Books rows mid-loop would shift the row numbers this
      // loop's remaining iterations rely on (they were all computed from
      // the single getDataRange() snapshot taken above).
      notFound.push({ sheetRow, isbn, row });
      Utilities.sleep(300);
      continue;
    }

    sheet.getRange(sheetRow, idx.title + 1).setValue(info.title);
    if (idx.author >= 0 && info.author) sheet.getRange(sheetRow, idx.author + 1).setValue(info.author);
    if (idx.publisher >= 0 && info.publisher) sheet.getRange(sheetRow, idx.publisher + 1).setValue(info.publisher);

    if (idx.year >= 0 && info.year) {
      const yearMatch = String(info.year).match(/\b(\d{4})\b/);
      if (yearMatch) sheet.getRange(sheetRow, idx.year + 1).setValue(Number(yearMatch[1]));
    }

    // Italian is the default/omitted value elsewhere in this app (see
    // normalizeLanguage in api.gs) — only write a non-Italian language.
    if (idx.language >= 0 && info.language && info.language !== 'Italian') {
      sheet.getRange(sheetRow, idx.language + 1).setValue(info.language);
    }

    if (idx.subjects >= 0 && info.subjects) sheet.getRange(sheetRow, idx.subjects + 1).setValue(info.subjects);
    if (idx.coverUrl >= 0 && info.coverUrl) sheet.getRange(sheetRow, idx.coverUrl + 1).setValue(info.coverUrl);

    Utilities.sleep(300);
  }

  if (notFound.length) moveNotFoundRowsToToReview_(ss, idx, notFound);
}

// Moves confirmed-not-found rows out of Books and into ToReview, carrying
// over whatever Books already had for them (ISBN, Library, Copies, Scanned
// time), with ReviewStatus "Manca Titolo" so they show up for a human to
// fill in manually — same staging sheet and ReviewStatus values the legacy
// iOS Shortcut flow already uses (apps-script/api.gs's _handleAddBookShortcut).
// Deletes from Books in descending row order so each deletion doesn't shift
// the row numbers of the others still queued in this same call.
function moveNotFoundRowsToToReview_(ss, booksIdx, entries) {
  const reviewSheet = ss.getSheetByName('ToReview');
  if (!reviewSheet) return; // no staging sheet to move to — leave as-is

  const booksSheet = ss.getSheetByName('Books');
  const reviewHeaderRaw = reviewSheet.getRange(1, 1, 1, reviewSheet.getLastColumn()).getValues()[0];
  const reviewCol = {};
  reviewHeaderRaw.forEach((name, i) => { if (name) reviewCol[String(name).trim()] = i + 1; });

  const sorted = entries.slice().sort((a, b) => b.sheetRow - a.sheetRow);

  for (const entry of sorted) {
    const row = entry.row;
    const newRow = new Array(reviewHeaderRaw.length).fill('');
    const set = (name, value) => {
      const col = reviewCol[name];
      if (col && value !== undefined && value !== null && value !== '') newRow[col - 1] = value;
    };

    set('ReviewStatus', 'Manca Titolo');
    set('ScanNote', 'ISBN non trovato su SBN né OpenLibrary');
    set('ISBN', entry.isbn);
    if (booksIdx.library >= 0) set('Library', row[booksIdx.library]);
    if (booksIdx.copies >= 0) set('Copies', row[booksIdx.copies] || 1);
    if (booksIdx.scannedTime >= 0) set('Scanned time', row[booksIdx.scannedTime]);

    reviewSheet.appendRow(newRow);
    booksSheet.deleteRow(entry.sheetRow);
  }
}

// Each lookup_* function below returns one of three things:
//   an info object  — found
//   null             — confirmed: the source responded normally and has no
//                      record for this ISBN
//   undefined        — unknown: the request itself failed (network error,
//                      non-200, unparseable body) — NOT the same as "no
//                      record", and must not be treated as a final answer.
function lookupIsbn_(isbn) {
  let erred = false;

  let result = lookupSbn_(isbn);
  if (result === undefined) { erred = true; result = null; }

  if (!result) {
    Utilities.sleep(300);
    const ol = lookupOpenLibrary_(isbn);
    if (ol === undefined) erred = true;
    else if (ol) result = ol;
  }

  if (result) {
    result.coverUrl = findCoverUrl_(isbn);
    return result;
  }

  // Neither source found it. If at least one of them failed to respond
  // rather than cleanly answering "no match", the verdict is unknown —
  // propagate that so the caller retries later instead of giving up.
  return erred ? undefined : null;
}

function lookupSbn_(isbn) {
  const url = 'https://opac.sbn.it/opacmobilegw/search.json?isbn=' + encodeURIComponent(isbn);
  let resp;
  try {
    resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    return undefined;
  }
  if (resp.getResponseCode() !== 200) return undefined;

  let data;
  try {
    data = JSON.parse(resp.getContentText());
  } catch (e) {
    return undefined;
  }
  if (!data || data.error) return undefined;
  if (!data.briefRecords || !data.briefRecords.length) return null;

  const record = data.briefRecords[0];
  let title = record.titolo;
  if (title && title.indexOf(' / ') !== -1) {
    title = title.split(' / ')[0];
  }
  if (title) title = title.replace(/^'+/, '').trim();
  if (!title) return null;

  const pub = parsePubblicazione_(record.pubblicazione);

  let language = null;
  let subjects = null;
  const facets = data.facetRecords || [];
  for (const facet of facets) {
    if (facet.facetName === 'lingua' && facet.facetValues && facet.facetValues.length) {
      const fv = facet.facetValues[0];
      if (Array.isArray(fv) && fv.length > 1) {
        language = normalizeLanguage(String(fv[1]));
      }
    }
    if (facet.facetName === 'soggettof' && facet.facetValues && facet.facetValues.length) {
      const names = {};
      for (const fvv of facet.facetValues) {
        if (Array.isArray(fvv) && fvv.length && fvv[0]) {
          names[String(fvv[0]).trim()] = true;
        }
      }
      const sorted = Object.keys(names).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      if (sorted.length) subjects = sorted.join(', ');
    }
  }

  return {
    source: 'OPAC SBN',
    title: title,
    author: formatAuthorName_(record.autorePrincipale),
    publisher: pub.publisher,
    year: pub.year,
    language: language,
    subjects: subjects,
  };
}

function lookupOpenLibrary_(isbn) {
  const url = 'https://openlibrary.org/api/books?bibkeys=ISBN:' + encodeURIComponent(isbn) + '&format=json&jscmd=data';
  let resp;
  try {
    resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    return undefined;
  }
  if (resp.getResponseCode() !== 200) return undefined;

  let data;
  try {
    data = JSON.parse(resp.getContentText());
  } catch (e) {
    return undefined;
  }

  const record = data['ISBN:' + isbn];
  if (!record || !record.title) return null;

  const authors = (record.authors || []).map((a) => a.name).filter(Boolean).join(', ') || null;
  const publishers = (record.publishers || []).map((p) => p.name).filter(Boolean).join(', ') || null;

  return {
    source: 'Open Library',
    title: record.title,
    author: authors,
    publisher: publishers,
    year: record.publish_date || null,
    language: null,
    subjects: null,
  };
}

function findCoverUrl_(isbn) {
  const candidates = ['https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false'];
  candidates.push(...googleBooksCoverCandidates_(isbn));

  const seen = {};
  for (const url of candidates) {
    if (seen[url]) continue;
    seen[url] = true;
    if (isImageUrl_(url)) return url;
  }

  const plain = 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg';
  if (!seen[plain] && isImageUrl_(plain)) return plain;

  return null;
}

function googleBooksCoverCandidates_(isbn) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_BOOKS_API_KEY');
  let url = 'https://www.googleapis.com/books/v1/volumes?q=isbn:' + encodeURIComponent(isbn) + '&maxResults=5&projection=lite';
  if (apiKey) url += '&key=' + encodeURIComponent(apiKey);

  let resp;
  try {
    resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    return [];
  }
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) return [];

  let data;
  try {
    data = JSON.parse(resp.getContentText());
  } catch (e) {
    return [];
  }

  const candidates = [];
  const sizes = ['extraLarge', 'large', 'medium', 'thumbnail', 'smallThumbnail'];
  for (const item of data.items || []) {
    const links = (item.volumeInfo && item.volumeInfo.imageLinks) || {};
    for (const size of sizes) {
      if (links[size]) candidates.push(String(links[size]).replace('http://', 'https://'));
    }
  }
  return candidates;
}

function isImageUrl_(url) {
  if (!url) return false;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) return false;

    const headers = resp.getAllHeaders();
    let contentType = '';
    for (const key in headers) {
      if (key.toLowerCase() === 'content-type') {
        contentType = String(headers[key]).split(';')[0].toLowerCase();
        break;
      }
    }
    if (contentType.indexOf('image/') !== 0) return false;

    const bytes = resp.getBlob().getBytes();
    return !!(bytes && bytes.length > 0);
  } catch (e) {
    return false;
  }
}

function formatAuthorName_(raw) {
  if (!raw) return raw;
  const formatted = [];
  for (let part of String(raw).split(';')) {
    part = part.trim();
    if (!part) continue;
    const commaIdx = part.indexOf(',');
    if (commaIdx !== -1) {
      const last = part.slice(0, commaIdx).trim();
      const first = part.slice(commaIdx + 1).trim();
      formatted.push((first + ' ' + last).trim());
    } else {
      formatted.push(part);
    }
  }
  return formatted.length ? formatted.join('; ') : null;
}

function parsePubblicazione_(value) {
  if (!value) return { publisher: null, year: null };
  const yearMatch = String(value).match(/\b(\d{4})\b/);
  const year = yearMatch ? yearMatch[1] : null;

  let publisher = null;
  const colonIdx = value.indexOf(':');
  if (colonIdx !== -1) {
    const afterColon = value.slice(colonIdx + 1);
    const commaIdx = afterColon.indexOf(',');
    const beforeComma = commaIdx !== -1 ? afterColon.slice(0, commaIdx) : afterColon;
    publisher = beforeComma.trim() || null;
  }

  return { publisher, year };
}

function cleanIsbn_(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '');
}

// ONE-OFF MIGRATION — run once manually from the Apps Script editor's
// function picker. Handles rows left stuck in Books with the old sentinel
// title from before moveNotFoundRowsToToReview_ existed: clears their Title
// back to blank (restoring the normal "pending enrichment" state) and runs
// runEnrichmentBatch() immediately, which re-confirms the miss and moves
// them to ToReview via the current logic — no separate move code needed
// here. Safe to re-run; a no-op once no sentinel rows remain.
function migrateStuckNotFoundRows_oneOff() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Books');
  if (!sheet) return;

  const values = sheet.getDataRange().getValues();
  const header = values[0].map(normalizeHeaderKey);
  const titleCol = header.indexOf('title');
  if (titleCol < 0) return;

  const SENTINEL = '⚠️ ISBN non trovato — inserisci manualmente';
  let cleared = 0;
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][titleCol] || '').trim() === SENTINEL) {
      sheet.getRange(r + 1, titleCol + 1).setValue('');
      cleared++;
    }
  }

  Logger.log('Cleared ' + cleared + ' stuck "not found" row(s).');
  if (cleared > 0) runEnrichmentBatch();
}
