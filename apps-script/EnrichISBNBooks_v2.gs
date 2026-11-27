/**
 * EnrichISBNBooks_v2.gs — replace EnrichISBNBooks.gs with this file.
 *
 * CHANGES FROM v1:
 *   • Operates on ToReview (not Books)
 *   • Physical Description and Translator are no longer collected or written
 *   • The second SBN fetch (SBN_FULL_URL) is removed — it was only needed for
 *     physicalDescription, so this saves one HTTP call per book
 *   • ReviewStatus is set automatically after each lookup:
 *       "Pronto"       — title + author found
 *       "Manca Autore" — title found but no author
 *       "Manca Titolo" — nothing found
 *   • enrichSingleRow() is exported for WebAppEndpoint_v2 to call inline
 *   • formatAuthorName joins authors with ", " (not "; ") so _splitAuthors()
 *     in HomeLibrary_v2 correctly separates them in the Authors sheet
 *   • onOpen() removed — menu lives in HomeLibrary_v2.gs
 *     Add this line to that menu if you want it there:
 *       .addItem('Arricchisci da ISBN (ToReview)', 'enrichToReviewFromISBN')
 *
 * Reference copy only — this file is live in the Apps Script project (not
 * wired into api.gs/enrich.gs in this repo) but was never tracked in git
 * before now. Depends on the SH constant from HomeLibrary_v2.gs (same
 * Apps Script project, shared scope). api.gs's legacy Shortcut route
 * (_handleAddBookShortcut) calls enrichSingleRow from here directly.
 */

const SBN_SEARCH_URL      = "https://opac.sbn.it/opacmobilegw/search.json";
const OPENLIBRARY_BOOKS_URL = "https://openlibrary.org/api/books";
const SBN_LANGUAGE_MAP = {
  ita: "Italian",  eng: "English",    fre: "French",    fra: "French",
  ger: "German",   deu: "German",     swe: "Swedish",   spa: "Spanish",
  lat: "Latin",    por: "Portuguese",
};
const ENRICH_TIME_BUDGET_MS = 4.5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────

/** Menu-callable wrapper — shows result in an alert. */
function enrichToReviewFromISBN() {
  const result = runEnrichment();
  if (result.error) { SpreadsheetApp.getUi().alert(result.error); return; }
  SpreadsheetApp.getUi().alert(
    "Arricchiti: "  + result.enriched +
    (result.notFound.length ? "\nNon trovati: " + result.notFound.join(", ") : "") +
    (result.remaining ? "\n" + result.remaining + " rimasti — riesegui per continuare." : "")
  );
}

/**
 * Does the actual batch work with no UI calls — safe to call from the web app
 * or a time-driven trigger.  Returns { enriched, notFound, remaining, error? }
 */
function runEnrichment() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.REVIEW);
  if (!sheet) return { enriched: 0, notFound: [], error: "Foglio ToReview non trovato." };

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = _buildColMap(headerRow);

  if (!col["ISBN"] || !col["Title"]) {
    return { enriched: 0, notFound: [],
             error: "ToReview manca delle colonne richieste (ISBN, Title)." };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { enriched: 0, notFound: [], remaining: 0 };

  const numRows = lastRow - 1;
  const isbns   = sheet.getRange(2, col["ISBN"],  numRows, 1).getValues();
  const titles  = sheet.getRange(2, col["Title"], numRows, 1).getValues();

  const started = Date.now();
  let enriched = 0, remaining = 0;
  const notFound = [];

  for (let i = 0; i < numRows; i++) {
    const isbnRaw = isbns[i][0];
    if (!isbnRaw || titles[i][0]) continue;    // skip: no ISBN, or already has a title

    const isbn = isbnRaw.toString().replace(/[^0-9Xx]/g, "");
    if (!isbn) continue;
    if (Date.now() - started > ENRICH_TIME_BUDGET_MS) { remaining++; continue; }

    const row  = i + 2;
    const ok   = enrichSingleRow(sheet, row, col, isbn);
    if (ok) enriched++;
    else    notFound.push(isbn);
  }

  Logger.log("Enrichment done. enriched=" + enriched +
             " notFound=" + notFound.length + " remaining=" + remaining);
  return { enriched, notFound, remaining };
}

/**
 * Looks up one ISBN and fills blank cells in the given row of ToReview.
 * Sets ReviewStatus automatically.  Returns true if a title was found.
 *
 * Also called from WebAppEndpoint_v2.handleAddBook() for immediate enrichment
 * — and from api.gs's _handleAddBookShortcut in this repo, which replaced
 * WebAppEndpoint_v2.gs.
 */
function enrichSingleRow(sheet, row, col, isbn) {
  Logger.log("enrichSingleRow row=" + row + " isbn=" + isbn);
  const info = _lookupIsbn(isbn);

  if (!info || !info.title) {
    Logger.log("Not found: " + isbn);
    _writeIfBlank(sheet, row, col, "ReviewStatus", "Manca Titolo");
    _writeIfBlank(sheet, row, col, "ScanNote",     "ISBN non trovato su SBN né OpenLibrary");
    return false;
  }

  Logger.log("Found via " + info.source + ": " + info.title);

  _writeIfBlank(sheet, row, col, "Title",     info.title);
  _writeIfBlank(sheet, row, col, "Author",    info.author);
  _writeIfBlank(sheet, row, col, "Publisher", info.publisher);
  _writeIfBlank(sheet, row, col, "Year",      info.year);
  _writeIfBlank(sheet, row, col, "Language",  _matchLang(info.language));
  _writeIfBlank(sheet, row, col, "Subjects",  info.subjects);
  _writeIfBlank(sheet, row, col, "Cover URL", info.coverUrl);

  // Set ReviewStatus and ScanNote (always overwrite — these are set by us, not the user)
  const status = info.author ? "Pronto" : "Manca Autore";
  const note   = "Fonte: " + info.source + (info.author ? "" : " — autore non trovato, compila manualmente");
  if (col["ReviewStatus"]) sheet.getRange(row, col["ReviewStatus"]).setValue(status);
  if (col["ScanNote"])     sheet.getRange(row, col["ScanNote"]).setValue(note);

  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// LOOKUP
// ─────────────────────────────────────────────────────────────────────────

function _lookupIsbn(isbn) {
  return _lookupSbn(isbn) || _lookupOpenLibrary(isbn);
}

function _lookupSbn(isbn) {
  const data = _fetchJson(SBN_SEARCH_URL + "?isbn=" + encodeURIComponent(isbn));
  if (!data || data.error || !(data.briefRecords || []).length) return null;

  const record = data.briefRecords[0];
  let title    = record.titolo || "";
  if (title.includes(" / ")) title = title.split(" / ")[0].trim().replace(/^'/, "").trim();
  if (!title) return null;

  const author = _formatAuthorName(record.autorePrincipale);
  const pub    = _parsePubblicazione(record.pubblicazione);

  let language = "";
  (data.facetRecords || []).forEach(f => {
    if (f.facetName === "lingua" && (f.facetValues || []).length)
      language = SBN_LANGUAGE_MAP[f.facetValues[0][1]] || "";
  });

  let subjects = "";
  (data.facetRecords || []).forEach(f => {
    if (f.facetName === "soggettof" && (f.facetValues || []).length)
      subjects = [...new Set(
        f.facetValues.map(v => v[0]).filter(Boolean).map(n => n.trim())
      )].join(", ");
  });

  // ✦ Second SBN fetch (SBN_FULL_URL) has been removed:
  //   it was only used for physicalDescription and translator,
  //   neither of which is stored any more.

  return {
    source: "OPAC SBN", title, author,
    publisher: pub.publisher, year: pub.year,
    language, subjects,
    coverUrl: "https://covers.openlibrary.org/b/isbn/" + isbn + "-L.jpg?default=false",
  };
}

function _lookupOpenLibrary(isbn) {
  const data = _fetchJson(
    OPENLIBRARY_BOOKS_URL + "?bibkeys=ISBN:" + isbn + "&format=json&jscmd=data"
  );
  const key = "ISBN:" + isbn;
  if (!data || !data[key]) return null;
  const r = data[key];
  return {
    source:    "Open Library",
    title:     r.title || "",
    author:    (r.authors    || []).map(a => a.name).join(", "),
    publisher: (r.publishers || []).map(p => p.name).join(", "),
    year:      r.publish_date || "",
    language:  "", subjects: "",
    coverUrl:  "https://covers.openlibrary.org/b/isbn/" + isbn + "-L.jpg?default=false",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function _parsePubblicazione(text) {
  if (!text) return { publisher: "", year: "" };
  const yearMatch = text.match(/(\d{4})/);
  const year      = yearMatch ? yearMatch[1] : "";
  let publisher   = "";
  if (text.includes(":")) publisher = text.split(":")[1].split(",")[0].trim();
  return { publisher, year };
}

/**
 * Converts SBN "Lastname, Firstname; Lastname2, Firstname2"
 * to "Firstname Lastname, Firstname2 Lastname2".
 *
 * Uses ", " as separator (not "; ") so _splitAuthors() in HomeLibrary_v2.gs
 * correctly splits multi-author strings in the Authors sheet.
 */
function _formatAuthorName(raw) {
  if (!raw) return "";
  return raw.split(";").map(part => {
    part = part.trim();
    if (part.includes(",")) {
      const [last, first] = part.split(",");
      return (first.trim() + " " + last.trim()).trim();
    }
    return part;
  }).join(", ");
}

function _matchLang(language) {
  if (!language) return "";
  const valid = ["Italian","English","Swedish","French","German","Spanish","Latin","Portuguese","Other"];
  return valid.find(v => v.toLowerCase() === language.toLowerCase()) || "";
}

function _writeIfBlank(sheet, row, col, field, value) {
  if (!col[field] || value == null || value === "") return;
  const cell = sheet.getRange(row, col[field]);
  if (cell.getValue() === "") cell.setValue(value);
}

function _buildColMap(headerRow) {
  const m = {};
  headerRow.forEach((name, i) => { if (name) m[String(name).trim()] = i + 1; });
  return m;
}

function _fetchJson(url) {
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log("fetchJson: " + url + " → HTTP " + resp.getResponseCode());
      return null;
    }
    return JSON.parse(resp.getContentText());
  } catch (err) {
    Logger.log("fetchJson error: " + err.toString());
    return null;
  }
}
