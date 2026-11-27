// ═══════════════════════════════════════════════════════════════════════════
// HOME LIBRARY — Apps Script v2
// ═══════════════════════════════════════════════════════════════════════════
//
// HOW TO USE
// ──────────
// 1. Open your Google Sheet → Extensions → Apps Script
// 2. Paste this as its own file (alongside api.gs and enrich.gs)
// 3. Save (Ctrl+S / Cmd+S)
// 4. Reload the spreadsheet — a "📚 Libreria" menu will appear
// 5. Run  📚 Libreria → ⚙️ Setup iniziale  ONCE (skip if Books/Loans/Authors/
//    Libraries/Wishlist/ToReview/Series Tracker/Stats already look restructured)
//
// NOTE: the original version of this file had a "SCAN → TOREVIEW" section at
// the bottom (doPost + receiveScannedBook) that served as a web-app entry
// point writing scanned ISBNs into a ToReview staging sheet. That section has
// been removed here on purpose: this project's real web app is api.gs, which
// defines its own doPost/doGet writing straight to Books (see FEATURES.md).
// Apps Script runs every .gs file in one shared global scope, so two files
// each declaring `function doPost(e)` collide silently — only one wins,
// unpredictably. Keep api.gs as the sole doPost/doGet in this project.
//
// ═══════════════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const SH = {
  BOOKS:    'Books',
  AUTHORS:  'Authors',
  LOANS:    'Loans',
  LIBS:     'Libraries',
  FAMILY:   'FamilyMembers',
  WISHLIST: 'Wishlist',
  REVIEW:   'ToReview',
  SERIES:   'Series Tracker',
  STATS:    'Stats',
};

// Books column indices (0-based) AFTER restructure
// Columns: Title | Author | Library | Copies | ISBN | Publisher | Year |
//          Language | Held By | Status | Active Loans | Subjects | Notes |
//          Cover URL | Scanned time | SeriesName | SeriesOrder | ReadBy
const BC = {
  TITLE:        0,
  AUTHOR:       1,
  LIBRARY:      2,
  COPIES:       3,
  ISBN:         4,
  PUBLISHER:    5,
  YEAR:         6,
  LANGUAGE:     7,
  HELD_BY:      8,
  STATUS:       9,   // formula
  ACTIVE_LOANS: 10,  // formula
  SUBJECTS:     11,
  NOTES:        12,
  COVER_URL:    13,  // hidden
  SCANNED:      14,
  SERIES_NAME:  15,
  SERIES_ORDER: 16,
  READ_BY:      17,
};

// Loans column indices (0-based)
// LoanID | Book Title | Library | Lent By | Borrowed By |
// Date Lent | Expected Return | Date Returned | Notes
const LC = {
  ID:              0,
  BOOK_TITLE:      1,
  LIBRARY:         2,
  LENT_BY:         3,
  BORROWED_BY:     4,
  DATE_LENT:       5,
  EXPECTED_RETURN: 6,
  DATE_RETURNED:   7,
  NOTES:           8,
};

// ToReview column indices (0-based)
// ReviewStatus | ScanNote | Title | Author | Library | Copies |
// ISBN | Publisher | Year | Language | Held By | Subjects | Notes |
// Cover URL | Scanned time | SeriesName | SeriesOrder | ReadBy
const RC = {
  STATUS:    0,
  SCAN_NOTE: 1,
  TITLE:     2,
  AUTHOR:    3,
  LIBRARY:   4,
  COPIES:    5,
  ISBN:      6,
  PUBLISHER: 7,
  YEAR:      8,
  LANGUAGE:  9,
  HELD_BY:   10,
  SUBJECTS:  11,
  NOTES:     12,
  COVER_URL: 13,
  SCANNED:   14,
  SERIES_NAME:  15,
  SERIES_ORDER: 16,
  READ_BY:      17,
};


// ─────────────────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Libreria')
    .addItem('Arricchisci da ISBN (ToReview)', 'enrichToReviewFromISBN')
    .addItem('Aggiorna Autori',           'refreshAuthorsSheet')
    .addItem('Aggiorna Librerie',         'refreshLibrariesSheet')
    .addItem('Aggiorna Serie',            'refreshSeriesSheet')
    .addItem('Aggiorna Statistiche',      'refreshStatsSheet')
    .addSeparator()
    .addItem('✓  Sposta ToReview → Books', 'moveReviewedBookToLibrary')
    .addSeparator()
    .addItem('📖  Registra prestito',       'showLoanDialog')
    .addItem('↩  Registra restituzione',   'showReturnDialog')
    .addSeparator()
    .addItem('⚙️  Setup iniziale (eseguire una volta)', 'setupLibrary')
    .addToUi();
}


// ─────────────────────────────────────────────────────────────────────────
// SETUP — run once
// ─────────────────────────────────────────────────────────────────────────

function setupLibrary() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert(
    'Setup Libreria di Casa',
    'Questo script:\n' +
    '  • Ristruttura Books: rimuove Physical Description e Condition,\n' +
    '    aggiunge SeriesName, SeriesOrder, ReadBy\n' +
    '  • Corregge gli anni "1820" (placeholder Marietti → vuoto)\n' +
    '  • Aggiorna Authors con supporto multi-autore\n' +
    '  • Aggiorna Loans: LoanID, Expected Return, Date Returned\n' +
    '  • Riscrive Libraries con conteggio # Titoli e # Copie\n' +
    '  • Aggiorna formule FamilyMembers\n' +
    '  • Crea Wishlist, ToReview, Series Tracker, Stats\n\n' +
    'Un backup di Books verrà creato prima di ogni modifica.\n\n' +
    'Continuare?',
    ui.ButtonSet.YES_NO
  );
  if (r !== ui.Button.YES) return;

  try {
    _backupBooks();
    _restructureBooks();
    refreshAuthorsSheet();
    _updateLoans();
    refreshLibrariesSheet();
    _updateFamilyFormulas();
    _createWishlist();
    _createToReview();
    refreshSeriesSheet();
    refreshStatsSheet();
    ui.alert(
      '✓ Setup completato!\n\n' +
      'Verifica ogni foglio e poi elimina Books_BACKUP se tutto è corretto.\n\n' +
      'PROSSIMI PASSI:\n' +
      '  1. Compila SeriesName / SeriesOrder in Books per le serie\n' +
      '  2. Correggi il prestito doppio in Loans (prima riga aveva due titoli)\n' +
      '  3. Invia il tuo Apps Script esistente per aggiornare la scansione ISBN'
    );
  } catch (err) {
    ui.alert('Errore durante il setup:\n' + err.message + '\n\n' + err.stack);
    throw err;
  }
}


// ─────────────────────────────────────────────────────────────────────────
// BOOKS — restructure
// ─────────────────────────────────────────────────────────────────────────

function _backupBooks() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(SH.BOOKS);
  const old = ss.getSheetByName(SH.BOOKS + '_BACKUP');
  if (old) ss.deleteSheet(old);
  src.copyTo(ss).setName(SH.BOOKS + '_BACKUP');
}

function _restructureBooks() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SH.BOOKS);
  const raw = sh.getDataRange().getValues();
  const idx = _headerMap(raw[0]);

  const NEW_HEADERS = [
    'Title', 'Author', 'Library', 'Copies',
    'ISBN', 'Publisher', 'Year', 'Language',
    'Held By', 'Status', 'Active Loans',
    'Subjects', 'Notes', 'Cover URL', 'Scanned time',
    'SeriesName', 'SeriesOrder', 'ReadBy',
  ];

  const output = [NEW_HEADERS];

  for (let i = 1; i < raw.length; i++) {
    const r     = raw[i];
    const title = String(r[idx['Title']] ?? '').trim();
    const isbn  = String(r[idx['ISBN']]  ?? '').trim();
    if (!title && !isbn) continue;   // skip fully empty rows

    // Fix Marietti "1820" placeholder
    let year = r[idx['Year']] ?? '';
    if (year == 1820) year = '';

    output.push([
      title,
      r[idx['Author']]      ?? '',
      r[idx['Library']]     ?? '',
      r[idx['Copies']]      || 1,
      isbn,
      r[idx['Publisher']]   ?? '',
      year,
      r[idx['Language']]    ?? '',
      r[idx['Held By']]     ?? '',
      '',                            // Status  — formula added below
      '',                            // Active Loans — formula added below
      r[idx['Subjects']]    ?? '',
      r[idx['Notes']]       ?? '',
      r[idx['Cover URL']]   ?? '',
      r[idx['Scanned time']]?? '',
      '',                            // SeriesName  — fill manually
      '',                            // SeriesOrder
      '',                            // ReadBy
    ]);
  }

  sh.clearContents();
  sh.clearFormats();
  sh.getRange(1, 1, output.length, NEW_HEADERS.length).setValues(output);

  // Add Status and Active Loans formulas row by row
  const lastRow = output.length;
  if (lastRow > 1) {
    const statusF = [];
    const loansF  = [];
    for (let r = 2; r <= lastRow; r++) {
      loansF.push([
        `=IFERROR(SUMPRODUCT((Loans!B$2:B$2000=A${r})*(Loans!H$2:H$2000="")),0)`,
      ]);
      statusF.push([
        `=IF(K${r}>0,"In prestito",IF(I${r}<>"","Con "&I${r},""))`,
      ]);
    }
    sh.getRange(2, BC.STATUS       + 1, lastRow - 1, 1).setFormulas(statusF);
    sh.getRange(2, BC.ACTIVE_LOANS + 1, lastRow - 1, 1).setFormulas(loansF);
  }

  _formatBooksSheet(sh, NEW_HEADERS.length);
}

function _formatBooksSheet(sh, numCols) {
  sh.getRange(1, 1, 1, numCols)
    .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  sh.setFrozenRows(1);

  const W = [250,180,185,55,145,130,55,80,100,110,85,210,210,80,130,165,80,165];
  W.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const maxRows = sh.getMaxRows() - 1;

  // setNumberFormat removed — Airtable-imported typed columns block it.
  // Google Sheets displays numbers correctly without explicit formats.

  try { sh.hideColumns(BC.COVER_URL + 1); } catch(_) {}

  try {
    sh.getRange(2, BC.LANGUAGE + 1, maxRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['Italian','English','Spanish','German','French','Other'], true)
        .build()
    );
  } catch(_) {}

  try {
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($J2<>"",$J2="In prestito")')
        .setBackground('#e8f0fe')
        .setRanges([sh.getRange(2, 1, maxRows, numCols)])
        .build()
    ]);
  } catch(_) {}
}


// ─────────────────────────────────────────────────────────────────────────
// AUTHORS — multi-author-aware refresh
// ─────────────────────────────────────────────────────────────────────────

/**
 * Splits an Author field into separate names. Handles two separator
 * conventions found in this sheet: "; " between distinct people (commonly
 * author + illustrator, e.g. "Ines Belski Lagazzi; Giuseppino De Roma" —
 * without this, that whole string was being counted as one bogus author,
 * undercounting people who also appear elsewhere as a solo credit), and
 * ", " within the comma-joined-name logic below.
 *
 * Deliberately NOT handled: "Jaël e Clément Lebeaume" / "Zelia e Luigi
 * Martìn" style joins (" e " between two first names sharing a surname) —
 * only 2 known cases, and a blanket " e " split risks wrongly breaking
 * other names that legitimately contain that word. Fix those 2 by hand in
 * the sheet instead.
 *
 * Works correctly for:
 *   "Dante Alighieri, Franco Nembrini"       → ["Dante Alighieri", "Franco Nembrini"]
 *   "Ines Belski Lagazzi; Giuseppino De Roma" → ["Ines Belski Lagazzi", "Giuseppino De Roma"]
 *   "Ludwig van Beethoven"                   → ["Ludwig van Beethoven"]
 *   "Sant'Agostino"                          → ["Sant'Agostino"]
 *   "Fratelli Grimm"                         → ["Fratelli Grimm"]
 */
function _splitAuthors(str) {
  if (!str) return [];
  str = String(str).trim();
  if (!str) return [];

  if (str.includes(';')) {
    const segments = str.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
    return segments.reduce((all, seg) => all.concat(_splitAuthorsByComma_(seg)), []);
  }
  return _splitAuthorsByComma_(str);
}

function _splitAuthorsByComma_(str) {
  if (!str.includes(', ')) return [str];

  const parts   = str.split(', ');
  const authors = [];
  let   current = '';

  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;

    if (!current) {
      current = p;
      continue;
    }

    // A token starts a new author when:
    //   1. it begins with an uppercase letter (or accented upper)
    //   2. the accumulated current already looks like a full name (contains a space)
    const startsUpper   = /^[A-ZÀÈÌÒÙÁÉÍÓÚÄÖÜ']/.test(p);
    const prevIsComplete = current.includes(' ');

    if (startsUpper && prevIsComplete) {
      authors.push(current.trim());
      current = p;
    } else {
      current += ', ' + p;   // continuation ("van der X", etc.)
    }
  }
  if (current.trim()) authors.push(current.trim());
  return authors;
}

function refreshAuthorsSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const bSh = ss.getSheetByName(SH.BOOKS);
  let   aSh = ss.getSheetByName(SH.AUTHORS);
  if (!aSh) aSh = ss.insertSheet(SH.AUTHORS);

  // Preserve hand-written Notes by author name
  const savedNotes = {};
  if (aSh.getLastRow() > 1) {
    const ad   = aSh.getDataRange().getValues();
    const nIdx = ad[0].indexOf('Notes');
    if (nIdx >= 0) {
      for (let i = 1; i < ad.length; i++) {
        if (ad[i][0]) savedNotes[String(ad[i][0])] = ad[i][nIdx] || '';
      }
    }
  }

  const data  = bSh.getDataRange().getValues();
  const hdr   = data[0];
  const tCol  = hdr.indexOf('Title');
  const aCol  = hdr.indexOf('Author');

  const map = {};  // name → Set<title>
  for (let i = 1; i < data.length; i++) {
    const title  = String(data[i][tCol] || '').trim();
    const author = String(data[i][aCol] || '').trim();
    if (!title || !author) continue;
    for (const name of _splitAuthors(author)) {
      if (!map[name]) map[name] = new Set();
      map[name].add(title);
    }
  }

  // Sort by last name (Italian-aware)
  const sorted = Object.keys(map).sort((a, b) => {
    const la = a.split(' ').filter(Boolean).pop() || a;
    const lb = b.split(' ').filter(Boolean).pop() || b;
    return la.localeCompare(lb, 'it');
  });

  const NEW_HEADERS = ['Name', 'Count (Books)', 'Books', 'Notes'];
  const output = [NEW_HEADERS];
  for (const name of sorted) {
    const books = [...map[name]].sort();
    output.push([name, books.length, books.join(', '), savedNotes[name] || '']);
  }

  aSh.clearContents();
  aSh.clearFormats();
  aSh.getRange(1, 1, output.length, 4).setValues(output);

  aSh.getRange(1,1,1,4).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
  aSh.setFrozenRows(1);
  aSh.setColumnWidth(1, 215);
  aSh.setColumnWidth(2, 85);
  aSh.setColumnWidth(3, 580);
  aSh.setColumnWidth(4, 260);
}


// ─────────────────────────────────────────────────────────────────────────
// LIBRARIES — refresh with title count + copy count
// ─────────────────────────────────────────────────────────────────────────

function refreshLibrariesSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const bSh = ss.getSheetByName(SH.BOOKS);
  let   lSh = ss.getSheetByName(SH.LIBS);
  if (!lSh) lSh = ss.insertSheet(SH.LIBS);

  const data  = bSh.getDataRange().getValues();
  const hdr   = data[0];
  const tCol  = hdr.indexOf('Title');
  const lCol  = hdr.indexOf('Library');
  const cCol  = hdr.indexOf('Copies');

  const map = {};  // library → { titles: Set, copies: number }
  for (let i = 1; i < data.length; i++) {
    const lib   = String(data[i][lCol] || '').trim();
    const title = String(data[i][tCol] || '').trim();
    const cop   = Number(data[i][cCol]) || 1;
    if (!lib || !title) continue;
    if (!map[lib]) map[lib] = { titles: new Set(), copies: 0 };
    map[lib].titles.add(title);
    map[lib].copies += cop;
  }

  const NEW_HEADERS = ['Name', '# Titoli', '# Copie', 'Libri'];
  const output = [NEW_HEADERS];
  for (const lib of Object.keys(map).sort()) {
    output.push([lib, map[lib].titles.size, map[lib].copies,
      [...map[lib].titles].sort().join(', ')]);
  }

  lSh.clearContents();
  lSh.clearFormats();
  lSh.getRange(1, 1, output.length, 4).setValues(output);
  lSh.getRange(1,1,1,4).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
  lSh.setFrozenRows(1);
  lSh.setColumnWidth(1, 215); lSh.setColumnWidth(2, 80);
  lSh.setColumnWidth(3, 80);  lSh.setColumnWidth(4, 700);
}


// ─────────────────────────────────────────────────────────────────────────
// LOANS — update structure
// ─────────────────────────────────────────────────────────────────────────

function _updateLoans() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let   sh = ss.getSheetByName(SH.LOANS);
  if (!sh) { sh = ss.insertSheet(SH.LOANS); }

  const raw     = sh.getDataRange().getValues();
  const headers = raw[0];
  if (headers[0] === 'LoanID') { _formatLoansSheet(sh); return; }  // already updated

  const idx = _headerMap(headers);
  const NEW_HEADERS = [
    'LoanID', 'Book Title', 'Library',
    'Lent By (family member)', 'Borrowed By (external)',
    'Date Lent', 'Expected Return', 'Date Returned', 'Notes',
  ];

  const output  = [NEW_HEADERS];
  let   counter = 1;

  for (let i = 1; i < raw.length; i++) {
    const r         = raw[i];
    const bookCell  = String(r[idx['Book Title'] ?? 0] || '').trim();
    if (!bookCell) continue;

    // The original first row had two titles in one cell: split them
    const titles = bookCell.includes('","') || bookCell.includes('", "')
      ? bookCell.split(/",\s*"/).map(t => t.replace(/"/g, '').trim())
      : [bookCell];

    for (const title of titles) {
      output.push([
        'L' + String(counter).padStart(3, '0'),
        title,
        '',   // Library — fill manually (or we could look it up)
        r[idx['Lent By (family member)'] ?? 1] || '',
        r[idx['Borrowed By (external)'] ?? 2]  || '',
        r[idx['Date Lent'] ?? 3] || '',
        '',   // Expected Return — fill manually
        '',   // Date Returned — boolean TRUE converted: left blank (date unknown)
              // NOTE: if old Returned = TRUE, the loan was returned but we don't know when.
              //       Those rows are highlighted in yellow below for manual date entry.
        r[idx['Returned'] ?? 4] === true ? 'DATA MANCANTE' : '',
      ]);
      counter++;
    }
  }

  sh.clearContents();
  sh.clearFormats();
  sh.getRange(1, 1, output.length, NEW_HEADERS.length).setValues(output);
  _formatLoansSheet(sh);
}

function _formatLoansSheet(sh) {
  sh.getRange(1,1,1,9).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
  sh.setFrozenRows(1);

  const dateFmt = 'dd/mm/yyyy';
  const mr = sh.getMaxRows() - 1;
  try {
  sh.getRange(2, LC.DATE_LENT      + 1, mr, 1).setNumberFormat(dateFmt);
  sh.getRange(2, LC.EXPECTED_RETURN+ 1, mr, 1).setNumberFormat(dateFmt);
  sh.getRange(2, LC.DATE_RETURNED  + 1, mr, 1).setNumberFormat(dateFmt);
  } catch(_) {}

  const W = [60,250,185,135,135,100,110,110,230];
  W.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const dataR = sh.getRange(2, 1, mr, 9);

  // Overdue (Expected < today, not returned)
  const overdueRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(G2<>"",G2<TODAY(),H2="")')
    .setBackground('#fce8e6').setFontColor('#c5221f')
    .setRanges([dataR]).build();

  // Due within 7 days
  const nearRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(G2<>"",G2>=TODAY(),G2<=TODAY()+7,H2="")')
    .setBackground('#fef9c3')
    .setRanges([dataR]).build();

  // Returned
  const returnedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H2<>"",H2<>"DATA MANCANTE")')
    .setBackground('#e6f4ea')
    .setRanges([dataR]).build();

  // Date missing (old boolean TRUE converted)
  const missingRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('DATA MANCANTE')
    .setBackground('#fff3cd').setFontColor('#856404')
    .setRanges([sh.getRange(2, LC.DATE_RETURNED + 1, mr, 1)]).build();

  sh.setConditionalFormatRules([overdueRule, nearRule, returnedRule, missingRule]);
}


// ─────────────────────────────────────────────────────────────────────────
// FAMILY MEMBERS — fix formulas
// ─────────────────────────────────────────────────────────────────────────

function _updateFamilyFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SH.FAMILY);
  if (!sh || sh.getLastRow() < 2) return;

  for (let r = 2; r <= sh.getLastRow(); r++) {
    // # Books held (Held By column = Books col I = column 9 = 1-based)
    sh.getRange(r, 2).setFormula(`=COUNTIF(Books!I:I,A${r})`);
    // # Active loans lent by this person
    sh.getRange(r, 3).setFormula(
      `=SUMPRODUCT((Loans!D$2:D$500=A${r})*(Loans!H$2:H$500=""))`
    );
  }

  // Format header if needed
  sh.getRange(1,1,1,sh.getLastColumn())
    .setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
  sh.setFrozenRows(1);
}


// ─────────────────────────────────────────────────────────────────────────
// WISHLIST
// ─────────────────────────────────────────────────────────────────────────

function _createWishlist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SH.WISHLIST)) return;
  const sh = ss.insertSheet(SH.WISHLIST);

  const HEADERS = ['Title','Author','SeriesName','SeriesOrder',
                   'Priority','RequestedBy','Notes','ISBN','Link','Added'];
  sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  sh.getRange(1,1,1,HEADERS.length)
    .setBackground('#f9ab00').setFontColor('#000').setFontWeight('bold');
  sh.setFrozenRows(1);

  const mr = sh.getMaxRows() - 1;
  sh.getRange(2, 5, mr, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['Alta','Media','Bassa'], true).build()
  );
  sh.getRange(2, 10, mr, 1).setNumberFormat('dd/mm/yyyy');

  // Priority colour coding
  const rangePri = sh.getRange(2, 1, mr, HEADERS.length);
  const priAlta  = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2="Alta"').setBackground('#fce8e6').setRanges([rangePri]).build();
  const priMedia = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2="Media"').setBackground('#fef9c3').setRanges([rangePri]).build();
  sh.setConditionalFormatRules([priAlta, priMedia]);

  const W = [250,180,160,80,80,120,230,150,250,105];
  W.forEach((w,i) => sh.setColumnWidth(i+1, w));
}


// ─────────────────────────────────────────────────────────────────────────
// TOREVIEW — staging sheet for ISBN scans
// ─────────────────────────────────────────────────────────────────────────

function _createToReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SH.REVIEW)) return;
  const sh = ss.insertSheet(SH.REVIEW);

  const HEADERS = [
    'ReviewStatus','ScanNote',
    'Title','Author','Library','Copies',
    'ISBN','Publisher','Year','Language',
    'Held By','Subjects','Notes','Cover URL','Scanned time',
    'SeriesName','SeriesOrder','ReadBy',
  ];
  sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  sh.getRange(1,1,1,HEADERS.length)
    .setBackground('#e6710d').setFontColor('#fff').setFontWeight('bold');
  sh.setFrozenRows(1);

  const mr = sh.getMaxRows() - 1;
  sh.getRange(2, 1, mr, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['Manca ISBN','Manca Autore','Manca Titolo','Duplicato','Pronto'], true)
      .build()
  );

  const rangeAll = sh.getRange(2, 1, mr, HEADERS.length);
  const pronto   = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$A2="Pronto"').setBackground('#e6f4ea').setRanges([rangeAll]).build();
  const dup      = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$A2="Duplicato"').setBackground('#f3e8ff').setRanges([rangeAll]).build();
  sh.setConditionalFormatRules([pronto, dup]);

  const W = [115,165,250,185,185,55,150,130,55,80,100,210,210,80,135,165,80,165];
  W.forEach((w,i) => sh.setColumnWidth(i+1, w));
}

/**
 * Moves the active row from ToReview → Books.
 * Row must have ReviewStatus = "Pronto".
 * Run via: 📚 Libreria → ✓ Sposta ToReview → Books
 */
function moveReviewedBookToLibrary() {
  const ui  = SpreadsheetApp.getUi();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();

  if (ss.getActiveSheet().getName() !== SH.REVIEW) {
    ui.alert('Seleziona prima una riga nel foglio ToReview.');
    return;
  }

  const rSh = ss.getSheetByName(SH.REVIEW);
  const bSh = ss.getSheetByName(SH.BOOKS);
  const row = rSh.getActiveRange().getRow();

  if (row < 2) { ui.alert('Seleziona una riga dati, non l\'intestazione.'); return; }

  const rData = rSh.getRange(row, 1, 1, rSh.getLastColumn()).getValues()[0];
  if (String(rData[RC.STATUS]).trim() !== 'Pronto') {
    ui.alert('Imposta ReviewStatus = "Pronto" prima di spostare il libro in Books.');
    return;
  }

  // Map ToReview columns → Books columns
  const newBookRow = [
    rData[RC.TITLE],
    rData[RC.AUTHOR],
    rData[RC.LIBRARY],
    rData[RC.COPIES] || 1,
    rData[RC.ISBN],
    rData[RC.PUBLISHER],
    rData[RC.YEAR],
    rData[RC.LANGUAGE],
    rData[RC.HELD_BY],
    '',   // Status  — formula set below
    '',   // Active Loans — formula set below
    rData[RC.SUBJECTS],
    rData[RC.NOTES],
    rData[RC.COVER_URL],
    rData[RC.SCANNED],
    rData[RC.SERIES_NAME],
    rData[RC.SERIES_ORDER],
    rData[RC.READ_BY],
  ];

  bSh.appendRow(newBookRow);
  const newRow = bSh.getLastRow();
  bSh.getRange(newRow, BC.ACTIVE_LOANS + 1)
     .setFormula(`=IFERROR(SUMPRODUCT((Loans!B$2:B$2000=A${newRow})*(Loans!H$2:H$2000="")),0)`);
  bSh.getRange(newRow, BC.STATUS + 1)
     .setFormula(`=IF(K${newRow}>0,"In prestito",IF(I${newRow}<>"","Con "&I${newRow},""))`);

  rSh.deleteRow(row);
  ui.alert('✓ Libro aggiunto a Books!');

  // Auto-refresh derived sheets
  refreshAuthorsSheet();
  refreshLibrariesSheet();
}


// ─────────────────────────────────────────────────────────────────────────
// SERIES TRACKER
// ─────────────────────────────────────────────────────────────────────────

function refreshSeriesSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const bSh = ss.getSheetByName(SH.BOOKS);
  let   sSh = ss.getSheetByName(SH.SERIES);
  if (!sSh) sSh = ss.insertSheet(SH.SERIES);

  // Preserve manually-entered TotalVolumes and Notes
  const savedTotal = {};
  const savedNotes = {};
  if (sSh.getLastRow() > 1) {
    const sd = sSh.getDataRange().getValues();
    for (let i = 1; i < sd.length; i++) {
      const name = String(sd[i][0] || '').trim();
      if (name) { savedTotal[name] = sd[i][1]; savedNotes[name] = sd[i][5] || ''; }
    }
  }

  const data  = bSh.getDataRange().getValues();
  const hdr   = data[0];
  const snCol = hdr.indexOf('SeriesName');
  const soCol = hdr.indexOf('SeriesOrder');
  const tCol  = hdr.indexOf('Title');

  const map = {};  // seriesName → [{order, title}]
  for (let i = 1; i < data.length; i++) {
    const sn = String(data[i][snCol] || '').trim();
    if (!sn) continue;
    if (!map[sn]) map[sn] = [];
    map[sn].push({ order: data[i][soCol], title: String(data[i][tCol] || '') });
  }

  const NEW_HEADERS = ['SeriesName','TotalVolumes','HaveVolumes','Missing','Status','Notes'];
  const output = [NEW_HEADERS];

  for (const name of Object.keys(map).sort()) {
    const have    = map[name].length;
    const total   = savedTotal[name] ?? '';
    const tNum    = Number(total);
    const missing = (total !== '' && !isNaN(tNum)) ? Math.max(0, tNum - have) : '?';
    const status  = (total !== '' && !isNaN(tNum))
      ? (have >= tNum ? '✓ Completa' : `${have}/${tNum}`)
      : `${have} vol.`;
    output.push([name, total, have, missing, status, savedNotes[name] || '']);
  }

  if (output.length === 1) {
    output.push(['(compila SeriesName in Books per popolare questa tabella)',
                 '','','','','']);
  }

  sSh.clearContents();
  sSh.clearFormats();
  sSh.getRange(1, 1, output.length, NEW_HEADERS.length).setValues(output);

  sSh.getRange(1,1,1,6).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
  sSh.setFrozenRows(1);

  const mr = sSh.getMaxRows() - 1;
  const completeR  = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('✓').setBackground('#e6f4ea')
    .setRanges([sSh.getRange(2, 5, mr, 1)]).build();
  const incompR = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(B2<>"",ISNUMBER(B2),C2<B2)')
    .setBackground('#fce8e6')
    .setRanges([sSh.getRange(2, 1, mr, 6)]).build();
  sSh.setConditionalFormatRules([completeR, incompR]);

  const W = [250,110,110,80,130,250];
  W.forEach((w,i) => sSh.setColumnWidth(i+1, w));
}


// ─────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────

function refreshStatsSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let   sh  = ss.getSheetByName(SH.STATS);
  if (!sh) sh = ss.insertSheet(SH.STATS);
  sh.clearContents();
  sh.clearFormats();

  // Collect library names for the per-shelf section
  const bSh    = ss.getSheetByName(SH.BOOKS);
  const bRaw   = bSh.getDataRange().getValues();
  const lColIdx = bRaw[0].indexOf('Library');
  const libs   = [...new Set(
    bRaw.slice(1).map(r => String(r[lColIdx] || '').trim()).filter(Boolean)
  )].sort();

  // Build rows array: [label, value/formula, sparkline-formula]
  // We track the 1-based sheet row for sparkline max references.
  const rows   = [];
  const SECTION = '#e8f0fe';

  const push = (label, val, spark='') => rows.push([label, val, spark]);

  push('HOME LIBRARY — STATISTICHE', `=TEXT(NOW(),"dd/mm/yyyy hh:mm")`, '');
  push('', '', '');
  push('📚  CATALOGO', '', '');                                // row 3  (section)
  push('Titoli nel catalogo',   `=COUNTA(Books!A:A)-1`,      ''); // row 4 ← totalRow
  push('Copie totali',          `=IFERROR(SUMPRODUCT((Books!A2:A5000<>"")*IFERROR(VALUE(Books!D2:D5000),1)),0)`, '');
  push('Autori unici',          `=COUNTA(Authors!A:A)-1`,    '');
  push('Serie tracciate',       `=COUNTA('Series Tracker'!A:A)-1`, '');
  push('In wishlist',           `=COUNTA(Wishlist!A:A)-1`,   '');
  push('In ToReview',           `=COUNTA(ToReview!A:A)-1`,   '');
  push('', '', '');

  const totalRow = 4;  // 1-based row of "Titoli nel catalogo" in sheet

  push('🌍  PER LINGUA', '', '');  // section
  const langs = [['Italiano','Italian'],['Inglese','English'],
                 ['Spagnolo','Spanish'],['Tedesco','German']];
  const langStartRow = rows.length + 1;  // first lang row (1-based)
  langs.forEach(([label, val], i) => {
    const r = rows.length + 1;
    push(label,
      `=COUNTIF(Books!H:H,"${val}")`,
      `=IFERROR(SPARKLINE(B${r},{"charttype","bar";"max",B${totalRow};"color","#1a73e8"}),"")`,
    );
  });
  const otherRow = rows.length + 1;
  const sumLangs = langs.map((_, i) => `B${langStartRow + i}`).join('+');
  push('Altre',
    `=B${totalRow}-(${sumLangs})`,
    `=IFERROR(SPARKLINE(B${otherRow},{"charttype","bar";"max",B${totalRow};"color","#80868b"}),"")`,
  );
  push('', '', '');

  push('📍  PER SCAFFALE', '', '');  // section
  libs.forEach(lib => {
    const r   = rows.length + 1;
    const esc = lib.replace(/"/g, '""');
    push(lib,
      `=COUNTIF(Books!C:C,"${esc}")`,
      `=IFERROR(SPARKLINE(B${r},{"charttype","bar";"max",B${totalRow};"color","#fbbc04"}),"")`,
    );
  });
  push('', '', '');

  push('📖  PRESTITI', '', '');  // section
  push('Prestiti registrati',      `=COUNTA(Loans!A:A)-1`, '');
  push('Prestiti attivi',
       `=SUMPRODUCT((Loans!A2:A500<>"")*( Loans!H2:H500=""))`, '');
  push('In scadenza (≤ 7 gg)',
       `=SUMPRODUCT((Loans!G2:G500<>"")*(Loans!G2:G500>=TODAY())*(Loans!G2:G500<=TODAY()+7)*(Loans!H2:H500=""))`, '');
  push('Scaduti',
       `=SUMPRODUCT((Loans!G2:G500<>"")*(Loans!G2:G500<TODAY())*(Loans!H2:H500=""))`, '');

  // Write all rows
  sh.getRange(1, 1, rows.length, 3).setValues(rows);

  // ── Formatting ────────────────────────────────────────────────────────
  // Title row
  sh.getRange(1,1,1,3).setFontSize(14).setFontWeight('bold')
    .setBackground('#1a73e8').setFontColor('#ffffff');

  // Section headers
  const sectionLabels = new Set([
    '📚  CATALOGO','🌍  PER LINGUA','📍  PER SCAFFALE','📖  PRESTITI'
  ]);
  rows.forEach((row, i) => {
    if (sectionLabels.has(row[0])) {
      sh.getRange(i+1, 1, 1, 3).setBackground(SECTION).setFontWeight('bold');
    }
  });

  sh.getRange(1, 2, rows.length, 1).setHorizontalAlignment('right');
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 85);
  sh.setColumnWidth(3, 190);
  sh.setFrozenRows(1);
  sh.setTabColor('#34a853');
}


// ─────────────────────────────────────────────────────────────────────────
// LOAN DIALOGS
// ─────────────────────────────────────────────────────────────────────────

function showLoanDialog() {
  const html = HtmlService.createHtmlOutput(`<!DOCTYPE html><html><head>
<style>
  body{font-family:Arial,sans-serif;padding:16px;font-size:13px}
  h3{margin-top:0;color:#1a73e8}
  label{display:block;margin-top:10px;font-weight:bold;color:#333}
  input{width:100%;box-sizing:border-box;padding:6px;margin-top:4px;
        border:1px solid #ccc;border-radius:4px}
  button{margin-top:16px;padding:8px 20px;background:#1a73e8;color:#fff;
         border:none;border-radius:4px;cursor:pointer;font-size:14px;width:100%}
  button:hover{background:#1557b0}
</style></head><body>
<h3>📖 Nuovo Prestito</h3>
<label>Titolo libro</label>
<input id="title" placeholder="Titolo esatto...">
<label>Scaffale</label>
<input id="library" placeholder="es. Libreria bianca - mansarda">
<label>Prestato da (membro famiglia)</label>
<input id="lentBy" placeholder="es. Tommi">
<label>Prestato a</label>
<input id="borrowedBy" placeholder="Nome del prestatario">
<label>Data prestito</label>
<input type="date" id="dateLent">
<label>Rientro previsto</label>
<input type="date" id="expectedReturn">
<label>Note</label>
<input id="notes" placeholder="...">
<button onclick="submit()">Registra Prestito</button>
<script>
document.getElementById('dateLent').valueAsDate=new Date();
function submit(){
  google.script.run
    .withSuccessHandler(()=>google.script.host.close())
    .withFailureHandler(e=>alert('Errore: '+e.message))
    .addLoanEntry(
      document.getElementById('title').value,
      document.getElementById('library').value,
      document.getElementById('lentBy').value,
      document.getElementById('borrowedBy').value,
      document.getElementById('dateLent').value,
      document.getElementById('expectedReturn').value,
      document.getElementById('notes').value
    );
}
</script></body></html>`)
    .setTitle('Nuovo Prestito').setWidth(385).setHeight(530);
  SpreadsheetApp.getUi().showModalDialog(html, 'Nuovo Prestito');
}

function addLoanEntry(title, library, lentBy, borrowedBy, dateLent, expectedReturn, notes) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SH.LOANS);
  const id  = 'L' + String(sh.getLastRow()).padStart(3, '0');
  const dL  = dateLent       ? new Date(dateLent)       : new Date();
  const dE  = expectedReturn ? new Date(expectedReturn)  : '';
  sh.appendRow([id, title, library, lentBy, borrowedBy, dL, dE, '', notes || '']);
  if (title) _setHeldBy(title, lentBy || borrowedBy);
}

// ──────────────────────────────────────────

function showReturnDialog() {
  const ui  = SpreadsheetApp.getUi();
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SH.LOANS);
  const raw = sh.getDataRange().getValues();

  const open = raw.slice(1).filter(r => r[LC.BOOK_TITLE] && !r[LC.DATE_RETURNED]);
  if (!open.length) { ui.alert('Nessun prestito attivo.'); return; }

  const opts = open.map(r =>
    `<option value="${r[LC.ID]}">${r[LC.ID]}: ${r[LC.BOOK_TITLE]} → ${r[LC.BORROWED_BY]}</option>`
  ).join('');

  const html = HtmlService.createHtmlOutput(`<!DOCTYPE html><html><head>
<style>
  body{font-family:Arial,sans-serif;padding:16px;font-size:13px}
  h3{margin-top:0;color:#34a853}
  label{display:block;margin-top:10px;font-weight:bold;color:#333}
  select,input{width:100%;box-sizing:border-box;padding:6px;margin-top:4px;
               border:1px solid #ccc;border-radius:4px}
  button{margin-top:16px;padding:8px 20px;background:#34a853;color:#fff;
         border:none;border-radius:4px;cursor:pointer;font-size:14px;width:100%}
</style></head><body>
<h3>↩ Registra Restituzione</h3>
<label>Prestito</label>
<select id="loanId">${opts}</select>
<label>Data restituzione</label>
<input type="date" id="dateReturned">
<button onclick="submit()">Registra Restituzione</button>
<script>
document.getElementById('dateReturned').valueAsDate=new Date();
function submit(){
  google.script.run
    .withSuccessHandler(()=>google.script.host.close())
    .withFailureHandler(e=>alert('Errore: '+e.message))
    .recordReturn(
      document.getElementById('loanId').value,
      document.getElementById('dateReturned').value
    );
}
</script></body></html>`)
    .setTitle('Registra Restituzione').setWidth(385).setHeight(265);
  SpreadsheetApp.getUi().showModalDialog(html, 'Registra Restituzione');
}

function recordReturn(loanId, dateReturned) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SH.LOANS);
  const raw = sh.getDataRange().getValues();
  for (let i = 1; i < raw.length; i++) {
    if (String(raw[i][LC.ID]).trim() === loanId) {
      sh.getRange(i + 1, LC.DATE_RETURNED + 1).setValue(new Date(dateReturned));
      _setHeldBy(String(raw[i][LC.BOOK_TITLE]), '');
      return;
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/** Returns { headerName: columnIndex } map */
function _headerMap(headers) {
  const m = {};
  headers.forEach((h, i) => { if (h) m[String(h).trim()] = i; });
  return m;
}

/** Silently skips if the range belongs to a typed column (Google Sheets smart chip). */
function _trySetFmt(range, fmt) {
  try { range.setNumberFormat(fmt); } catch (_) {}
}

/** Sets Held By in the first Books row matching title */
function _setHeldBy(title, person) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(SH.BOOKS);
  const raw = sh.getDataRange().getValues();
  const tC  = raw[0].indexOf('Title');
  const hC  = raw[0].indexOf('Held By');
  if (tC < 0 || hC < 0) return;
  for (let i = 1; i < raw.length; i++) {
    if (String(raw[i][tC]).trim() === title.trim()) {
      sh.getRange(i + 1, hC + 1).setValue(person || '');
      return;
    }
  }
}
