// ONE-OFF SCRIPT — paste into the Apps Script editor, run
// applySeriesMapping_oneOff() once from the function picker, then delete
// this file (or just leave it; it's idempotent and does nothing once every
// matched title already has its SeriesName/SeriesOrder set).
//
// Fills SeriesName/SeriesOrder in Books for the series identified by
// scanning all 1074 books grouped by author (2025-11-27 pass), reviewed and
// approved before writing. Matches by EXACT Title string — if a title gets
// edited afterward this mapping silently stops applying to it (safe, no
// crash), so re-run after any bulk title edits if volumes seem to go
// missing from Series Tracker.
//
// Deliberately left OUT (same title repeated = multiple physical copies,
// not a multi-volume series): Il piccolo principe, I promessi sposi, Moby
// Dick, La strada, Canto di Natale, Assassinio sull'Orient Express, Il
// giorno della civetta, Il libro delle Ore, La mia storia, Giobbe, and
// similar single-title duplicates. Also left out: the plain "Comunione e
// liberazione" copy (unclear if it's the same series as the two dated
// volumes below, or an unrelated book about the movement).
//
// SeriesOrder left blank (null below) wherever the book's own title doesn't
// state a number — per instruction, no guessing at translated-edition
// numbering (Diario di una Schiappa / Diary of a Wimpy Kid especially:
// Italian and English editions of Diary of a Wimpy Kid are NOT renumbered
// the same way, so each stays its own SeriesName, consistent with "same
// book, different language -> different series" from this project's
// earlier discussion).

function applySeriesMapping_oneOff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Books');
  if (!sheet) throw new Error('Books sheet not found');

  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idx = {
    title: header.indexOf('Title'),
    seriesName: header.indexOf('SeriesName'),
    seriesOrder: header.indexOf('SeriesOrder'),
  };
  if (idx.title < 0 || idx.seriesName < 0 || idx.seriesOrder < 0) {
    throw new Error('Books sheet missing Title/SeriesName/SeriesOrder columns');
  }

  const MAPPING = {
    // --- Harry Potter (English) — canonical order, certain ---
    "Harry Potter and the philosopher's stone": { series: 'Harry Potter (EN)', order: 1 },
    'Harry Potter and the chamber of secrets': { series: 'Harry Potter (EN)', order: 2 },
    'Harry Potter and the prisoner of the Azkaban': { series: 'Harry Potter (EN)', order: 3 },
    'Harry Potter and the Goblet of Fire': { series: 'Harry Potter (EN)', order: 4 },
    'Harry Potter and the Order of the Phoenix': { series: 'Harry Potter (EN)', order: 5 },
    'Harry Potter and the Half-Blood Prince': { series: 'Harry Potter (EN)', order: 6 },
    'Harry Potter and the deathly hallows': { series: 'Harry Potter (EN)', order: 7 },

    // --- Harry Potter (Italian) — numbers already in your own titles ---
    "1: Harry Potter e la pietra filosofale": { series: 'Harry Potter (IT)', order: 1 },
    "Harry Potter e la pietra filosofale : romanzo": { series: 'Harry Potter (IT)', order: 1 },
    '2: Harry Potter e la camera dei segreti': { series: 'Harry Potter (IT)', order: 2 },
    '3: Harry Potter e il prigioniero di Azkaban': { series: 'Harry Potter (IT)', order: 3 },
    '4: Harry Potter e il Calice di Fuoco': { series: 'Harry Potter (IT)', order: 4 },
    "5: Harry Potter e l'Ordine della Fenice": { series: 'Harry Potter (IT)', order: 5 },
    '6: Harry Potter e il Principe Mezzosangue': { series: 'Harry Potter (IT)', order: 6 },
    'Harry Potter e il principe mezzosangue : romanzo': { series: 'Harry Potter (IT)', order: 6 },
    '7: Harry Potter e i doni della morte': { series: 'Harry Potter (IT)', order: 7 },

    // --- Il Signore degli Anelli ---
    "Il Signore degli Anelli I. La compagnia dell'anello": { series: 'Il Signore degli Anelli', order: 1 },
    'Il Signore degli Anelli II. Le due torri': { series: 'Il Signore degli Anelli', order: 2 },
    'Il Signore degli Anelli III. Il ritorno del re': { series: 'Il Signore degli Anelli', order: 3 },

    // --- Le Cronache di Narnia (only one volume unambiguously identified) ---
    "Le Cronache di Narnia. 2: Il leone, la strega e l'armadio": { series: 'Le Cronache di Narnia', order: 2 },

    // --- Il conte di Montecristo ---
    'Il conte di Montecristo': { series: 'Il conte di Montecristo', order: null },
    'Il conte di Montecristo - volume I': { series: 'Il conte di Montecristo', order: 1 },
    'Il conte di Montecristo - volume II': { series: 'Il conte di Montecristo', order: 2 },

    // --- Storia militare della Seconda Guerra Mondiale ---
    'Storia militare della Seconda Guerra Mondiale - Volume Primo': { series: 'Storia militare della Seconda Guerra Mondiale', order: 1 },
    'Storia militare della Seconda Guerra Mondiale - Volume Secondo': { series: 'Storia militare della Seconda Guerra Mondiale', order: 2 },

    // --- Eroi dell'Olimpo (Italian) — kept separate from Percy Jackson below ---
    "Eroi dell'Olimpo 1: L' eroe perduto": { series: "Eroi dell'Olimpo", order: 1 },
    "Eroi dell'Olimpo 2: Il figlio di Nettuno": { series: "Eroi dell'Olimpo", order: 2 },
    "Eroi dell'Olimpo 3: Il marchio di Atena": { series: "Eroi dell'Olimpo", order: 3 },
    "Eroi dell'Olimpo 5: Il sangue dell'Olimpo": { series: "Eroi dell'Olimpo", order: 5 },
    // (volume 4 missing from the catalog -- Series Tracker's Missing column
    // should show this once TotalVolumes is filled in manually)

    // --- Percy Jackson e gli Dei dell'Olimpo (Italian) — merging your "&"
    // and "e" title variants as the same series; "il libro segreto" / "le
    // storie segrete" are unnumbered companion volumes ---
    "Percy Jackson e gli dei dell'Olimpo : il ladro di fulmini": { series: "Percy Jackson e gli Dei dell'Olimpo", order: 1 },
    "Percy Jackson & gli dei dell'Olimpo : Il mare dei mostri": { series: "Percy Jackson e gli Dei dell'Olimpo", order: 2 },
    "Percy Jackson e gli dei dell'Olimpo 3: la maledizione del Titano": { series: "Percy Jackson e gli Dei dell'Olimpo", order: 3 },
    "Percy Jackson e gli Dei dell'Olimpo 4: La battaglia del labirinto": { series: "Percy Jackson e gli Dei dell'Olimpo", order: 4 },
    "Percy Jackson e gli Dei dell'Olimpo5: Lo scontro finale": { series: "Percy Jackson e gli Dei dell'Olimpo", order: 5 },
    "Percy Jackson e gli Dei dell'Olimpo 6:Il calice degli dei": { series: "Percy Jackson e gli Dei dell'Olimpo", order: 6 },
    "Percy Jackson e gli dei dell'Olimpo : il libro segreto": { series: "Percy Jackson e gli Dei dell'Olimpo", order: null },
    "Percy Jackson & gli dei dell'Olimpo : le storie segrete": { series: "Percy Jackson e gli Dei dell'Olimpo", order: null },

    // --- Percy Jackson racconta... (standalone companion books, no order) ---
    'Percy Jackson racconta gli dei greci': { series: 'Percy Jackson racconta', order: null },
    'Percy Jackson racconta gli eroi greci': { series: 'Percy Jackson racconta', order: null },

    // --- Wings of Fire (English) / I Regni del Fuoco (Italian) — kept
    // separate per language; both missing some volumes from the catalog ---
    'Wings of Fire 5: The Brightest Night': { series: 'Wings of Fire', order: 5 },
    'Wings of Fire 6: Moon Rising': { series: 'Wings of Fire', order: 6 },
    'Wings of Fire 8: Escaping Peril': { series: 'Wings of Fire', order: 8 },

    'I Regni del Fuoco. 2 La principessa perduta': { series: 'I Regni del Fuoco', order: 2 },
    'I Regni del Fuoco. 3 Nel cuore della foresta': { series: 'I Regni del Fuoco', order: 3 },
    "I Regni del Fuoco. 4 L' oscuro segreto": { series: 'I Regni del Fuoco', order: 4 },

    // --- Dante Alighieri, commentato da Franco Nembrini — 2 editions each ---
    "Dante Alighieri. Inferno. Commentato da Franco Nembrini. Illustrato da Gabriele Dell'Otto.": { series: 'Dante Alighieri (comm. Nembrini)', order: 1 },
    'Vol.1: Inferno': { series: 'Dante Alighieri (comm. Nembrini)', order: 1 },
    "Dante Alighieri. Purgatorio. Commentato da Franco Nembrini. Illustrato da Gabriele Dell'Otto.": { series: 'Dante Alighieri (comm. Nembrini)', order: 2 },
    'Vol. 2: Purgatorio': { series: 'Dante Alighieri (comm. Nembrini)', order: 2 },
    "Dante Alighieri. Paradiso. Commentato da Franco Nembrini. Illustrato da Gabriele Dell'Otto.": { series: 'Dante Alighieri (comm. Nembrini)', order: 3 },
    'Vol. 3: Paradiso': { series: 'Dante Alighieri (comm. Nembrini)', order: 3 },

    // --- La famiglia orsetti — no numbering in any title ---
    'La famiglia orsetti. Facciamo pace!': { series: 'La famiglia orsetti', order: null },
    'La famiglia orsetti. Si cambia casa': { series: 'La famiglia orsetti', order: null },
    'La famiglia orsetti. Tanti auguri, mamma!': { series: 'La famiglia orsetti', order: null },
    'La famiglia orsetti. Troppi impegni': { series: 'La famiglia orsetti', order: null },
    'La famiglia orsetti. Una sorellina in arrivo!': { series: 'La famiglia orsetti', order: null },

    // --- Barzellette super-top-compilation ---
    'Barzellette super-top-compilation 1': { series: 'Barzellette super-top-compilation', order: 1 },
    'Barzellette super-top-compilation 2': { series: 'Barzellette super-top-compilation', order: 2 },
    'Barzellette super-top-compilation 3': { series: 'Barzellette super-top-compilation', order: 3 },

    // --- Comunione e Liberazione (storia), Camisasca — the plain-title
    // copy is deliberately excluded (unclear if same series) ---
    'Comunione e liberazione. Le origini (1954-1968)': { series: 'Comunione e Liberazione (storia)', order: 1 },
    'Comunione e liberazione. La ripresa (1969-1976)': { series: 'Comunione e Liberazione (storia)', order: 2 },

    // --- PerCorso, Giussani — your own titles already say "volume
    // primo/secondo del PerCorso"; my first clustering pass missed this ---
    '1: Il senso religioso': { series: 'PerCorso', order: 1 },
    'Il senso religioso : volume primo del PerCorso': { series: 'PerCorso', order: 1 },
    "2: All'origine della pretesa cristiana": { series: 'PerCorso', order: 2 },
    "2: All'origine della pretesa cristiana : volume secondo del perCorso": { series: 'PerCorso', order: 2 },
    "All'origine della pretesa cristiana. Volume secondo del PerCorso": { series: 'PerCorso', order: 2 },

    // --- Diario di una Schiappa (Italian) — 5 numbered, rest unclear ---
    'Diario di una Schiappa. 1 Come resistere a una famiglia imbarazzante': { series: 'Diario di una Schiappa', order: 1 },
    'Diario di una Schiappa. 2 Come resistere alle vacanze catastrofiche': { series: 'Diario di una Schiappa', order: 2 },
    'Diario di una Schiappa. 3 Come resistere a una scuola disastrosa': { series: 'Diario di una Schiappa', order: 3 },
    'Diario di una Schiappa. 4 Come resistere ai cuccioli di casa': { series: 'Diario di una Schiappa', order: 4 },
    'Diario di una Schiappa. 5 Come resistere agli amici più strambi': { series: 'Diario di una Schiappa', order: 5 },
    'Diario di una Schiappa: COME RESISTERE ai passatempi più strani': { series: 'Diario di una Schiappa', order: null },
    'Diario di una schiappa : Vita da cani': { series: 'Diario di una Schiappa', order: null },
    'Diario di una schiappa : disastro totale': { series: 'Diario di una Schiappa', order: null },
    'Diario di una schiappa : guai in arrivo!': { series: 'Diario di una Schiappa', order: null },

    // --- Diary of a Wimpy Kid (English) — kept separate from the Italian
    // series above (different language = different SeriesName, per your
    // instruction); no numbering in any of these titles ---
    'Diary of a Wimpy Kid': { series: 'Diary of a Wimpy Kid', order: null },
    'Diary of a wimpy kid : The third wheel': { series: 'Diary of a Wimpy Kid', order: null },
    'Diary of a wimpy kid : hard luck': { series: 'Diary of a Wimpy Kid', order: null },
  };

  const matchedTitles = {};
  let applied = 0;

  for (let r = 1; r < values.length; r++) {
    const title = String(values[r][idx.title] || '').trim();
    const spec = MAPPING[title];
    if (!spec) continue;

    sheet.getRange(r + 1, idx.seriesName + 1).setValue(spec.series);
    if (spec.order !== null && spec.order !== undefined) {
      sheet.getRange(r + 1, idx.seriesOrder + 1).setValue(spec.order);
    }
    matchedTitles[title] = true;
    applied++;
  }

  const unmatched = Object.keys(MAPPING).filter((t) => !matchedTitles[t]);
  Logger.log('Applied SeriesName/SeriesOrder to ' + applied + ' rows.');
  if (unmatched.length) {
    Logger.log('NOT FOUND in Books (title text differs from what this mapping expects): ' + JSON.stringify(unmatched));
  }

  refreshSeriesSheet(); // lives in HomeLibrary_v2.gs

  const msg = 'Applied to ' + applied + ' rows.' +
    (unmatched.length ? '\n\n' + unmatched.length + ' titles in the mapping were not found exactly — see View > Logs (Executions) for the list.' : '\n\nAll titles matched.');
  SpreadsheetApp.getUi().alert(msg);
}
