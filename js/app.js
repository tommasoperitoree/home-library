import {
  MEMBERS,
  SHELVES,
  LANGUAGES,
  loadLibraryData,
  getSelectedMember,
  setSelectedMember,
  getLastTab,
  setLastTab,
  bookLangCode,
  addBook,
  setHeldBy,
  lendBook,
  returnBook,
  setLibrary,
  scanIsbn,
  setCopies,
  addCopyToShelf,
  isbnKey,
  getScanShelf,
  setScanShelf,
} from './data.js';
import {
  renderMemberGrid,
  memberFaceEl,
  renderBookList,
  renderGroupedBookList,
  renderChipRow,
  languageChips,
  shelfChips,
  makeExpandableCard,
  openBottomSheet,
  closeBottomSheet,
  renderStatsGrid,
  timeGreeting,
  formatDateDMY,
  shelfLabel,
  shelfName,
  el,
} from './ui.js';

const state = {
  user: null,
  books: [],
  loans: [],
  updatedAt: null,
  activeTab: 'catalogo',
  catalogo: {
    search: '',
    lang: 'Tutti',
    shelf: 'Tutti',
    page: 1,
    pageSize: 50,
  },
};

const tabTitle = document.getElementById('tab-title');
const panels = {
  io: document.getElementById('tab-io'),
  catalogo: document.getElementById('tab-catalogo'),
  famiglia: document.getElementById('tab-famiglia'),
};
const navButtons = document.querySelectorAll('.nav-btn');
const sheetBackdrop = document.getElementById('sheet-backdrop');
const bottomSheet = document.getElementById('bottom-sheet');
const sheetContent = document.getElementById('sheet-content');

const TAB_TITLES = { io: 'Io', catalogo: 'Catalogo', famiglia: 'Famiglia' };

function loanedTitlesSet() {
  return new Set(state.loans.map((l) => l.book));
}

// Picking a member is only ever prompted from within the Io tab (or, if
// needed, from a lending action elsewhere — see ensureUser below); there is
// no separate full-screen gate blocking the rest of the app anymore.
function selectMember(name) {
  state.user = name;
  setSelectedMember(name);
  renderActiveTab();
}

function switchTab(tab) {
  stopActiveScanner();
  state.activeTab = tab;
  setLastTab(tab);
  tabTitle.textContent = TAB_TITLES[tab];
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle('hidden', key !== tab);
  }
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  renderActiveTab();
}

// Used by lending actions (which need to know who's acting) when they're
// triggered from Catalogo/Famiglia before any member has ever been picked.
// Renders the same chooser inline in place of `container`'s contents and
// calls onPicked once a member is chosen, instead of leaving e.g. "Tieni tu
// (null)" on screen.
function ensureUser(container, onPicked) {
  if (state.user) {
    onPicked();
    return;
  }
  renderChooser(container, onPicked);
}

// Unconditionally renders the "Chi sei?" member chooser into `container`,
// calling onPicked once a member is chosen. Used both by ensureUser (only
// when no identity is set yet) and directly by the Io header's face button
// (to let someone switch identity any time, overwriting whoever's active).
function renderChooser(container, onPicked) {
  container.innerHTML = '';
  container.appendChild(
    el('div', { className: 'io-chooser' }, [
      el('h2', { className: 'selector-title', text: 'Chi sei?' }),
      el('p', { className: 'selector-subtitle', text: 'Dicci chi sei per continuare.' }),
      el('div', { className: 'member-grid' }),
    ])
  );
  const grid = container.querySelector('.member-grid');
  renderMemberGrid(grid, MEMBERS, (name) => {
    selectMember(name);
    onPicked();
  });
}

function renderActiveTab() {
  if (state.activeTab === 'io') renderTabIo();
  if (state.activeTab === 'catalogo') renderTabCatalogo();
  if (state.activeTab === 'famiglia') renderTabFamiglia();
}

// ---------- Tab: Io ----------

function renderTabIo() {
  const panel = panels.io;
  panel.innerHTML = '';

  if (!state.user) {
    ensureUser(panel, () => renderTabIo());
    return;
  }

  const heldBooks = state.books.filter((b) => b.h === state.user);
  const myLoans = state.loans.filter((l) => l.lentBy === state.user);
  const loaned = loanedTitlesSet();

  const currentMember = MEMBERS.find((m) => m.name === state.user);
  panel.appendChild(
    el('div', { className: 'io-header' }, [
      el(
        'button',
        {
          className: 'io-switch-user',
          onClick: () => renderChooser(panel, () => renderTabIo()),
        },
        currentMember ? [memberFaceEl(currentMember, 'io-switch-user-face')] : []
      ),
      el('div', { className: 'greeting', text: `${timeGreeting()}, ${state.user}!` }),
    ])
  );

  panel.appendChild(
    makeExpandableCard(
      '📚 I tuoi libri',
      heldBooks.length,
      (body) => {
        const list = el('div');
        renderBookList(list, heldBooks, { loanedTitles: loaned, onOpen: openBookDetailSheet });
        body.appendChild(list);
      },
      { autoOpen: true }
    )
  );

  panel.appendChild(
    makeExpandableCard(
      '📤 Prestiti attivi',
      myLoans.length,
      (body) => {
        if (!myLoans.length) {
          body.appendChild(el('div', { className: 'card-empty', text: 'Nessun prestito attivo.' }));
          return;
        }
        for (const loan of myLoans) {
          body.appendChild(
            el('div', { className: 'book-row' }, [
              el('div', { className: 'book-info' }, [
                el('div', { className: 'book-title', text: loan.book }),
                el('div', {
                  className: 'book-author',
                  text: `a ${loan.borrowedBy} · dal ${formatDateDMY(loan.dateLent)}`,
                }),
              ]),
            ])
          );
        }
      },
      { autoOpen: true }
    )
  );
}

// ---------- Tab: Catalogo ----------

function filteredCatalogBooks() {
  const { search, lang, shelf } = state.catalogo;
  const term = search.trim().toLowerCase();
  const filtered = state.books.filter((b) => {
    if (term && !(b.t.toLowerCase().includes(term) || (b.a || '').toLowerCase().includes(term))) {
      return false;
    }
    if (lang !== 'Tutti' && bookLangCode(b) !== lang) return false;
    if (shelf !== 'Tutti' && b.l !== shelf) return false;
    return true;
  });
  return sortCatalogBooks(filtered);
}

// Leading articles ignored when alphabetizing (and for the A/B/C.. letter
// headers), so e.g. "Il senso religioso" files under S, not I — standard
// library-catalog convention, since without it "I"/"L" would swallow a huge
// share of the Italian titles here.
const LEADING_ARTICLES = ["l'", 'il ', 'lo ', 'la ', 'gli ', 'le ', 'i ', 'un ', 'uno ', 'una ', 'the ', 'a ', 'an '];

function titleSortKey(title) {
  const t = (title || '').trim();
  const lower = t.toLowerCase();
  for (const art of LEADING_ARTICLES) {
    if (lower.startsWith(art)) return t.slice(art.length).trimStart();
  }
  return t;
}

// Letter-header bucket for a title: first letter of its sort key, accents
// folded to the base letter (so È/E group together), '#' for anything that
// doesn't start with a letter.
function groupLetter(title) {
  const key = titleSortKey(title);
  const first = key.charAt(0).toUpperCase();
  const base = first.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /[A-Z]/.test(base) ? base : '#';
}

// Primary: alphabetical letter bucket. Secondary (within a letter):
// library/shelf, so each shelf's books cluster together and share a spine
// color. Tertiary: title itself, for a stable order within a shelf cluster.
// Books with no Library sort after every shelf within their letter.
function sortCatalogBooks(books) {
  return [...books].sort((a, b) => {
    const la = groupLetter(a.t);
    const lb = groupLetter(b.t);
    if (la !== lb) return la.localeCompare(lb, 'it');

    const libA = a.l ? shelfLabel(a.l) : '￿';
    const libB = b.l ? shelfLabel(b.l) : '￿';
    const libCompare = libA.localeCompare(libB, 'it');
    if (libCompare !== 0) return libCompare;

    return titleSortKey(a.t).localeCompare(titleSortKey(b.t), 'it');
  });
}

const LANG_CODE_TO_NAME = { EN: 'English', ES: 'Spanish', DE: 'German' };

function renderTabCatalogo() {
  const panel = panels.catalogo;
  panel.innerHTML = '';

  const addBookSection = el('div');
  panel.appendChild(addBookSection);
  renderAddBookToggle(addBookSection);

  const searchBox = el('div', { className: 'search-box' });
  const searchInput = el('input', {
    className: 'search-input',
    attrs: { type: 'search', placeholder: 'Cerca per titolo o autore…' },
  });
  searchInput.value = state.catalogo.search;
  searchInput.addEventListener('input', (e) => {
    state.catalogo.search = e.target.value;
    state.catalogo.page = 1;
    renderCatalogResults();
  });
  searchBox.appendChild(searchInput);
  panel.appendChild(searchBox);

  const langRow = el('div', { className: 'chip-row' });
  panel.appendChild(langRow);
  const onLangSelect = (key) => {
    state.catalogo.lang = key;
    state.catalogo.page = 1;
    renderChipRow(langRow, languageChips(), state.catalogo.lang, onLangSelect);
    renderCatalogResults();
  };
  renderChipRow(langRow, languageChips(), state.catalogo.lang, onLangSelect);

  const shelfRow = el('div', { className: 'chip-row' });
  panel.appendChild(shelfRow);
  const onShelfSelect = (key) => {
    state.catalogo.shelf = key;
    state.catalogo.page = 1;
    renderChipRow(shelfRow, shelfChips(), state.catalogo.shelf, onShelfSelect);
    renderCatalogResults();
  };
  renderChipRow(shelfRow, shelfChips(), state.catalogo.shelf, onShelfSelect);

  panel.appendChild(el('div', { className: 'result-count', attrs: { id: 'result-count' } }));
  panel.appendChild(el('div', { attrs: { id: 'catalog-list' } }));
  panel.appendChild(el('div', { attrs: { id: 'catalog-load-more' } }));

  renderCatalogResults();
}

function renderAddBookToggle(container) {
  container.innerHTML = '';
  container.appendChild(
    el('div', { className: 'catalogo-actions' }, [
      el('button', {
        className: 'add-book-toggle',
        text: '+ Aggiungi libro',
        onClick: () => renderAddBookForm(container),
      }),
      el('button', {
        className: 'scan-isbn-btn',
        text: '📷 Scansiona ISBN',
        onClick: () => openIsbnScanner(),
      }),
    ])
  );
}

let activeScanner = null;
let activeScanCleanup = null;

function stopActiveScanner() {
  if (activeScanCleanup) {
    const cleanup = activeScanCleanup;
    activeScanCleanup = null;
    cleanup();
  }
  if (!activeScanner) return;
  const scanner = activeScanner;
  activeScanner = null;
  scanner.stop().catch(() => {});
}

// Beep + vibration on each scan, so it's obvious a barcode was read even
// without looking at the screen. The AudioContext has to be created from a
// tap (iOS), hence unlockScanAudio() on the "Inizia" button.
let scanAudioCtx = null;

function unlockScanAudio() {
  try {
    scanAudioCtx = scanAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (scanAudioCtx.state === 'suspended') scanAudioCtx.resume();
  } catch {
    scanAudioCtx = null;
  }
}

function scanFeedback(ok) {
  try {
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [60, 60, 60]);
  } catch { /* ignore */ }
  if (!scanAudioCtx) return;
  try {
    const osc = scanAudioCtx.createOscillator();
    const gain = scanAudioCtx.createGain();
    osc.frequency.value = ok ? 880 : 300;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(scanAudioCtx.destination);
    osc.start();
    osc.stop(scanAudioCtx.currentTime + 0.12);
  } catch { /* ignore */ }
}

// Scanner flow: pick the shelf first (remembered for next time), then scan.
// Each barcode calls scanIsbn, which looks the book up and files it straight
// on that shelf in Books (or in ToReview if the ISBN isn't found anywhere).
// An ISBN that's already catalogued opens a popup instead (see
// showDuplicate) — scanning pauses until it's closed.
function openIsbnScanner() {
  openBottomSheet(sheetBackdrop, bottomSheet, sheetContent, renderScanSetup);
}

function renderScanSetup(container) {
  container.innerHTML = '';
  const select = shelfSelectEl(getScanShelf(), 'Scegli scaffale…');
  const message = el('div', { className: 'form-message' });
  const startBtn = el('button', { className: 'btn-primary', text: '📷 Inizia a scansionare' });
  startBtn.addEventListener('click', () => {
    if (!select.value) {
      message.textContent = 'Scegli prima lo scaffale.';
      message.className = 'form-message error';
      return;
    }
    setScanShelf(select.value);
    unlockScanAudio();
    renderScanSession(container, select.value);
  });

  container.appendChild(el('h2', { text: '📷 Scansiona ISBN' }));
  container.appendChild(el('div', { className: 'book-author', text: 'In quale scaffale metti i libri che scansioni?' }));
  container.appendChild(el('div', { className: 'form-row scan-setup-select' }, [select]));
  container.appendChild(message);
  container.appendChild(
    el('div', { className: 'form-actions' }, [
      startBtn,
      el('button', { className: 'btn-secondary', text: 'Chiudi', onClick: () => closeBottomSheet(sheetBackdrop, bottomSheet) }),
    ])
  );
}

function renderScanSession(container, initialShelf) {
  let shelf = initialShelf;
  let scanner = null;
  let paused = false;
  let lastCode = '';
  let ignoreUntil = 0;
  let addedCount = 0;
  let booksChanged = false;
  let overlay = null;
  const inFlight = new Set();
  const dupQueue = [];

  container.innerHTML = '';

  // --- Shelf bar ("Scaffale: Scala  [Cambia]") ---
  const shelfBar = el('div', { className: 'scan-shelf-bar' });
  const renderShelfBar = () => {
    shelfBar.innerHTML = '';
    shelfBar.appendChild(el('span', { text: 'Scaffale:' }));
    shelfBar.appendChild(el('strong', { text: shelfName(shelf) }));
    shelfBar.appendChild(
      el('button', {
        className: 'scan-shelf-change',
        text: 'Cambia',
        onClick: () => {
          shelfBar.innerHTML = '';
          const sel = shelfSelectEl(shelf, 'Scegli scaffale…');
          sel.addEventListener('change', () => {
            if (sel.value) {
              shelf = sel.value;
              setScanShelf(shelf);
            }
            renderShelfBar();
          });
          shelfBar.appendChild(sel);
          shelfBar.appendChild(el('button', { className: 'scan-shelf-change', text: '✕', onClick: renderShelfBar }));
        },
      })
    );
  };
  renderShelfBar();

  // --- Status banner, counter, log ---
  const banner = el('div', { className: 'scan-banner info', text: 'Inquadra il codice a barre del libro.' });
  const setBanner = (kind, text) => {
    banner.className = `scan-banner ${kind}`;
    banner.textContent = text;
  };
  const counter = el('div', { className: 'scan-counter', text: '0 libri aggiunti in questa sessione' });
  const bumpCounter = () => {
    addedCount += 1;
    counter.textContent = `${addedCount} ${addedCount === 1 ? 'libro aggiunto' : 'libri aggiunti'} in questa sessione`;
  };
  const log = el('div', { className: 'scan-log' });
  const addLogEntry = (text) => {
    const entry = el('div', { className: 'scan-log-entry pending', text });
    log.prepend(entry);
    while (log.children.length > 30) log.lastChild.remove();
    return (kind, newText) => {
      entry.className = `scan-log-entry ${kind}`;
      entry.textContent = newText;
    };
  };

  const pauseScanner = () => {
    paused = true;
    try { if (scanner) scanner.pause(true); } catch { /* not scanning */ }
  };
  const resumeScanner = () => {
    paused = false;
    try { if (scanner) scanner.resume(); } catch { /* not paused */ }
  };

  // Books from state.books with this ISBN, in the same shape scanIsbn's
  // 'duplicate' response uses — lets the popup open instantly, without a
  // round-trip, for anything the app already knows about.
  const localMatches = (key) =>
    state.books
      .filter((b) => b.isbn && isbnKey(b.isbn) === key)
      .map((b) => ({ title: b.t, author: b.a || '', library: b.l || '', copies: b.copies || 1, cover: b.cover || '', heldBy: b.h || '' }));

  const updateLocalCopies = (isbn, library, copies) => {
    const key = isbnKey(isbn);
    const book = state.books.find((b) => b.isbn && isbnKey(b.isbn) === key && (b.l || '') === library);
    if (book) book.copies = copies > 1 ? copies : undefined;
    booksChanged = true;
  };

  // --- "Già in libreria" popup ---
  const showDuplicate = (res) => {
    if (overlay) {
      dupQueue.push(res);
      return;
    }
    pauseScanner();
    const matches = res.matches;
    overlay = el('div', { className: 'scan-dup-overlay' });
    const card = el('div', { className: 'scan-dup-card' });
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      overlay = null;
      // The book is probably still in front of the camera: don't reopen the
      // popup for it straight away.
      lastCode = isbnKey(res.isbn);
      ignoreUntil = Date.now() + 5000;
      if (dupQueue.length) {
        showDuplicate(dupQueue.shift());
        return;
      }
      resumeScanner();
      setBanner('info', 'Inquadra il codice a barre del libro.');
    };

    const renderCard = (note, noteKind) => {
      card.innerHTML = '';
      const first = matches[0];
      card.appendChild(
        el('div', { className: 'scan-dup-header' }, [
          first.cover ? el('img', { className: 'scan-dup-cover', attrs: { src: first.cover, alt: '' } }) : null,
          el('div', {}, [
            el('div', { className: 'scan-dup-kicker', text: '🔁 Già in libreria' }),
            el('div', { className: 'book-title', text: first.title || `ISBN ${res.isbn} (dettagli in arrivo)` }),
            first.author ? el('div', { className: 'book-author', text: first.author }) : null,
          ]),
        ])
      );

      card.appendChild(el('div', { className: 'sheet-section-title', text: 'Dove si trova' }));
      for (const m of matches) {
        let count = m.copies;
        const countEl = el('span', { className: 'scan-dup-count', text: String(count) });
        const saveBtn = el('button', { className: 'scan-dup-save hidden', text: 'Salva' });
        const refresh = () => {
          countEl.textContent = String(count);
          saveBtn.classList.toggle('hidden', count === m.copies);
        };
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          try {
            await setCopies({ isbn: res.isbn, library: m.library, copies: count });
            m.copies = count;
            updateLocalCopies(res.isbn, m.library, count);
            renderCard(`Copie in ${m.library ? shelfName(m.library) : 'senza scaffale'}: ${count}.`, 'success');
          } catch (err) {
            saveBtn.disabled = false;
            renderCard(`Errore: ${err.message}`, 'error');
          }
        });
        card.appendChild(
          el('div', { className: 'scan-dup-row' }, [
            el('div', { className: 'scan-dup-where' }, [
              el('div', { className: 'scan-dup-shelf', text: m.library ? shelfName(m.library) : 'Senza scaffale' }),
              m.heldBy ? el('div', { className: 'book-author', text: `con ${m.heldBy}` }) : null,
            ]),
            el('div', { className: 'scan-dup-stepper' }, [
              el('button', { className: 'scan-dup-step', text: '−', attrs: { 'aria-label': 'Una copia in meno' }, onClick: () => { if (count > 1) { count -= 1; refresh(); } } }),
              countEl,
              el('button', { className: 'scan-dup-step', text: '+', attrs: { 'aria-label': 'Una copia in più' }, onClick: () => { count += 1; refresh(); } }),
            ]),
            saveBtn,
          ])
        );
      }

      card.appendChild(el('div', { className: 'sheet-section-title', text: 'Aggiungi una copia in un altro scaffale' }));
      const defaultOther = matches.some((m) => m.library === shelf) ? '' : shelf;
      const otherSelect = shelfSelectEl(defaultOther, 'Scegli scaffale…');
      const addBtn = el('button', { className: 'btn-secondary', text: '➕ Aggiungi' });
      addBtn.addEventListener('click', async () => {
        const library = otherSelect.value;
        if (!library) {
          renderCard('Scegli uno scaffale.', 'error');
          return;
        }
        addBtn.disabled = true;
        try {
          const out = await addCopyToShelf({ isbn: res.isbn, library });
          const existing = matches.find((m) => m.library === library);
          if (existing) {
            existing.copies = out.copies;
            updateLocalCopies(res.isbn, library, out.copies);
          } else {
            matches.push({ ...matches[0], library, copies: 1, heldBy: '' });
            const key = isbnKey(res.isbn);
            const source = state.books.find((b) => b.isbn && isbnKey(b.isbn) === key);
            if (source) {
              state.books.push({ ...source, l: library, copies: undefined, h: undefined, notes: undefined });
              booksChanged = true;
            }
            bumpCounter();
          }
          renderCard(`Aggiunta una copia in ${shelfName(library)}.`, 'success');
        } catch (err) {
          addBtn.disabled = false;
          renderCard(`Errore: ${err.message}`, 'error');
        }
      });
      card.appendChild(el('div', { className: 'scan-dup-add' }, [otherSelect, addBtn]));

      if (note) card.appendChild(el('div', { className: `form-message ${noteKind || ''}`, text: note }));
      card.appendChild(
        el('div', { className: 'form-actions' }, [
          el('button', { className: 'btn-primary', text: 'Chiudi e continua', onClick: close }),
        ])
      );
    };
    renderCard();
  };

  // --- Scan handling ---
  const handleScanResult = (res, code, targetShelf, update) => {
    const where = shelfName(targetShelf);
    if (res.status === 'added') {
      state.books.push(res.book);
      booksChanged = true;
      bumpCounter();
      const msg = `✅ ${res.book.t}${res.book.a ? ` — ${res.book.a}` : ''} · in ${where}`;
      update('success', msg);
      setBanner('success', msg);
    } else if (res.status === 'queued') {
      bumpCounter();
      const msg = `✅ ISBN ${code} aggiunto in ${where} — titolo in arrivo tra 1-2 minuti`;
      update('success', msg);
      setBanner('success', msg);
    } else if (res.status === 'notFound') {
      const msg = `❓ ISBN ${code} non trovato — messo in ToReview (${where})`;
      update('warn', msg);
      setBanner('warn', msg);
      scanFeedback(false);
    } else if (res.status === 'pendingReview') {
      const msg = `❓ ISBN ${code} è già in ToReview, in attesa di revisione`;
      update('warn', msg);
      setBanner('warn', msg);
    } else if (res.status === 'duplicate') {
      update('info', `🔁 ${(res.matches[0] && res.matches[0].title) || code} — già in libreria`);
      showDuplicate(res);
    }
  };

  const onScan = (decodedText) => {
    if (paused) return;
    const code = decodedText.replace(/[^0-9Xx]/g, '').toUpperCase();
    const key = isbnKey(code);
    const now = Date.now();
    if (key === lastCode && now < ignoreUntil) return;
    lastCode = key;
    ignoreUntil = now + 3000;

    const isIsbn = (code.length === 13 && /^97[89]/.test(code)) || code.length === 10;
    if (!isIsbn) {
      setBanner('warn', `Il codice ${decodedText} non è un ISBN — cerca il codice a barre che inizia con 978 o 979.`);
      scanFeedback(false);
      return;
    }
    if (inFlight.has(key)) {
      setBanner('info', `⏳ ISBN ${code} già in elaborazione…`);
      return;
    }
    scanFeedback(true);

    const local = localMatches(key);
    if (local.length) {
      addLogEntry('')('info', `🔁 ${local[0].title} — già in libreria`);
      showDuplicate({ isbn: code, matches: local });
      return;
    }

    inFlight.add(key);
    const targetShelf = shelf;
    const update = addLogEntry(`⏳ ${code} — cerco il libro…`);
    setBanner('info', `⏳ ISBN ${code} letto, cerco il libro…`);
    scanIsbn({ isbn: code, library: targetShelf })
      .then((res) => handleScanResult(res, code, targetShelf, update))
      .catch((err) => {
        const msg = `⚠️ ISBN ${code} — errore: ${err.message}`;
        update('error', msg);
        setBanner('error', msg);
        scanFeedback(false);
      })
      .finally(() => inFlight.delete(key));
  };

  const closeSession = () => {
    stopActiveScanner();
    closeBottomSheet(sheetBackdrop, bottomSheet);
  };

  // Controls and feedback sit above the camera (sticky), so the video can
  // never push "Chiudi" or the latest result out of view.
  container.appendChild(
    el('div', { className: 'scan-top' }, [
      el('div', { className: 'scan-title-row' }, [
        el('h2', { text: '📷 Scansiona ISBN' }),
        el('button', { className: 'scan-close', text: 'Chiudi', onClick: closeSession }),
      ]),
      shelfBar,
      banner,
    ])
  );
  container.appendChild(el('div', { attrs: { id: 'isbn-reader' } }));
  container.appendChild(counter);
  container.appendChild(log);

  activeScanCleanup = () => {
    if (overlay) overlay.remove();
    overlay = null;
    if (booksChanged) renderActiveTab();
  };

  if (!window.Html5Qrcode) {
    setBanner('error', 'Libreria di scansione non disponibile.');
    return;
  }
  // Book barcodes are EAN-13; restricting the formats makes detection faster
  // and more reliable than the library's default (which includes QR etc.).
  const F = window.Html5QrcodeSupportedFormats;
  const config = { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } };
  if (F) config.formatsToSupport = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128].filter((f) => f !== undefined);
  scanner = new window.Html5Qrcode('isbn-reader', config);
  activeScanner = scanner;
  scanner
    .start(
      { facingMode: 'environment' },
      {
        fps: 10,
        aspectRatio: 1.6,
        qrbox: (w, h) => ({ width: Math.floor(Math.min(280, w * 0.85)), height: Math.floor(Math.min(110, h * 0.5)) }),
      },
      onScan
    )
    .catch((err) => setBanner('error', `Impossibile avviare la fotocamera: ${err}`));
}

function renderAddBookForm(container) {
  container.innerHTML = '';

  const titleInput = el('input', { className: 'form-input', attrs: { type: 'text', placeholder: 'Titolo *' } });
  const authorInput = el('input', { className: 'form-input', attrs: { type: 'text', placeholder: 'Autore' } });
  const isbnInput = el('input', { className: 'form-input', attrs: { type: 'text', placeholder: 'ISBN (opzionale)' } });

  const shelfSelect = el('select', { className: 'form-select' }, [
    el('option', { text: 'Scaffale (opzionale)', attrs: { value: '' } }),
    ...SHELVES.map((s) => el('option', { text: s.key, attrs: { value: s.key } })),
  ]);

  const langSelect = el('select', { className: 'form-select' }, [
    el('option', { text: 'Italiano (default)', attrs: { value: '' } }),
    ...LANGUAGES.filter((l) => l.key !== 'IT').map((l) => el('option', { text: l.label, attrs: { value: l.key } })),
  ]);

  const message = el('div', { className: 'form-message' });

  const cancelBtn = el('button', {
    className: 'btn-secondary',
    text: 'Annulla',
    onClick: () => renderAddBookToggle(container),
  });

  const submitBtn = el('button', { className: 'btn-primary', text: 'Aggiungi' });
  submitBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      message.textContent = 'Il titolo è obbligatorio.';
      message.className = 'form-message error';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Aggiungo…';
    message.textContent = '';

    const author = authorInput.value.trim();
    const shelf = shelfSelect.value;
    const langCode = langSelect.value;
    const langName = LANG_CODE_TO_NAME[langCode] || '';

    try {
      await addBook({
        title,
        author,
        shelf,
        language: langName,
        isbn: isbnInput.value.trim(),
      });

      // Optimistic local update so it shows up in Catalogo immediately,
      // ahead of the next full refetch from the sheet.
      const newBook = { t: title, a: author };
      if (shelf) newBook.l = shelf;
      if (langName) newBook.lang = langName;
      state.books.push(newBook);

      message.textContent = `"${title}" aggiunto.`;
      message.className = 'form-message success';
      setTimeout(() => {
        renderAddBookToggle(container);
        renderCatalogResults();
      }, 900);
    } catch (err) {
      message.textContent = `Errore: ${err.message}`;
      message.className = 'form-message error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Aggiungi';
    }
  });

  container.appendChild(
    el('div', { className: 'add-book-form' }, [
      el('h3', { text: 'Nuovo libro' }),
      el('div', { className: 'form-row' }, [titleInput]),
      el('div', { className: 'form-row' }, [authorInput]),
      el('div', { className: 'form-row' }, [shelfSelect]),
      el('div', { className: 'form-row' }, [langSelect]),
      el('div', { className: 'form-row' }, [isbnInput]),
      message,
      el('div', { className: 'form-actions' }, [submitBtn, cancelBtn]),
    ])
  );
  titleInput.focus();
}

function renderCatalogResults() {
  const panel = panels.catalogo;
  const resultCount = panel.querySelector('#result-count');
  const listEl = panel.querySelector('#catalog-list');
  const loadMoreEl = panel.querySelector('#catalog-load-more');
  const loaned = loanedTitlesSet();

  const results = filteredCatalogBooks();
  resultCount.textContent = `${results.length} ${results.length === 1 ? 'libro trovato' : 'libri trovati'}`;

  const visibleCount = Math.min(results.length, state.catalogo.page * state.catalogo.pageSize);
  renderGroupedBookList(listEl, results.slice(0, visibleCount), (b) => groupLetter(b.t), { loanedTitles: loaned, onOpen: openBookDetailSheet });

  loadMoreEl.innerHTML = '';
  if (visibleCount < results.length) {
    loadMoreEl.appendChild(
      el('button', {
        className: 'load-more-btn',
        text: `Carica altri (${results.length - visibleCount})`,
        onClick: () => {
          state.catalogo.page += 1;
          renderCatalogResults();
        },
      })
    );
  }
}

// ---------- Tab: Famiglia ----------

function renderTabFamiglia() {
  const panel = panels.famiglia;
  panel.innerHTML = '';

  const list = el('div', { className: 'card' });
  panel.appendChild(list);

  for (const member of MEMBERS) {
    const heldCount = state.books.filter((b) => b.h === member.name).length;
    const loanCount = state.loans.filter((l) => l.lentBy === member.name).length;
    const row = el(
      'div',
      { className: 'member-row', onClick: () => openMemberSheet(member) },
      [
        memberFaceEl(member, 'member-row-face'),
        el('span', { className: 'member-row-name', text: member.name }),
        el('span', {
          className: 'member-row-stats',
          html: `${heldCount} libri<br>${loanCount} prestiti`,
        }),
      ]
    );
    list.appendChild(row);
  }

  const totalCopies = state.books.length;
  const uniqueTitles = new Set(state.books.map((b) => `${b.t}|${b.a || ''}`)).size;
  const uniqueAuthors = new Set(state.books.map((b) => b.a).filter(Boolean)).size;
  const activeLoans = state.loans.length;

  const statsGrid = el('div', { className: 'stats-grid' });
  panel.appendChild(statsGrid);
  renderStatsGrid(statsGrid, [
    { value: uniqueTitles, label: 'Titoli' },
    { value: totalCopies, label: 'Copie totali' },
    { value: uniqueAuthors, label: 'Autori unici' },
    { value: activeLoans, label: 'Prestiti attivi' },
  ]);

  panel.appendChild(
    el('div', {
      className: 'footer-note',
      text: `Dati aggiornati al ${formatDateDMY(state.updatedAt)}`,
    })
  );
}

function openMemberSheet(member) {
  openBottomSheet(sheetBackdrop, bottomSheet, sheetContent, (container) => {
    container.appendChild(
      el('div', { className: 'sheet-member-header' }, [
        memberFaceEl(member, 'sheet-member-face'),
        el('h2', { text: member.name }),
      ])
    );

    const heldBooks = state.books.filter((b) => b.h === member.name);
    const memberLoans = state.loans.filter((l) => l.lentBy === member.name);

    container.appendChild(el('div', { className: 'sheet-section-title', text: `Libri (${heldBooks.length})` }));
    const bookList = el('div');
    renderBookList(bookList, heldBooks, { loanedTitles: loanedTitlesSet(), onOpen: openBookDetailSheet });
    container.appendChild(bookList);

    container.appendChild(el('div', { className: 'sheet-section-title', text: `Prestiti (${memberLoans.length})` }));
    if (!memberLoans.length) {
      container.appendChild(el('div', { className: 'card-empty', text: 'Nessun prestito attivo.' }));
    } else {
      for (const loan of memberLoans) {
        container.appendChild(
          el('div', { className: 'book-row' }, [
            el('div', { className: 'book-info' }, [
              el('div', { className: 'book-title', text: loan.book }),
              el('div', {
                className: 'book-author',
                text: `a ${loan.borrowedBy} · dal ${formatDateDMY(loan.dateLent)}`,
              }),
            ]),
          ])
        );
      }
    }
  });
}

// ---------- Book detail sheet ----------
//
// Opened by tapping any book row (Catalogo, Io's "I tuoi libri", or a
// member's book list in Famiglia). Shows everything known about the book
// (cover, series, shelf, publisher/year/ISBN, subjects, notes) plus the
// lending actions in one place. Three mutually-exclusive lending states,
// same precedence as the sheet's own Status formula (In prestito > Con X >
// available): an active Loans row always wins over the informal Held By
// marker. Lending/holding never changes Library on its own; it's only
// written when the user explicitly picks a shelf — "Cambia scaffale", or
// confirming/choosing where the book goes when putting it back.
const LANG_FULL_NAME = { IT: 'Italiano', EN: 'Inglese', ES: 'Spagnolo', DE: 'Tedesco' };

// <select> of every known shelf, preselecting `current`. A current value not
// in SHELVES (a shelf the sheet has but this app's list doesn't) is kept as
// an option so it isn't silently lost.
function shelfSelectEl(current, placeholder) {
  const options = [el('option', { text: placeholder, attrs: { value: '' } })];
  if (current && !SHELVES.some((s) => s.key === current)) {
    options.push(el('option', { text: current, attrs: { value: current } }));
  }
  for (const s of SHELVES) options.push(el('option', { text: s.key, attrs: { value: s.key } }));
  const select = el('select', { className: 'form-select' }, options);
  select.value = current || '';
  return select;
}

function openBookDetailSheet(book) {
  let mode = 'main'; // 'main' | 'lend' | 'chooseUser' | 'changeShelf' | 'putBack' | 'putBackPick'
  let pendingAfterUser = null; // 'heldBy' | 'lend' — which action to resume once a member is picked
  let putBackKind = null; // 'loan' | 'held' — which "put back" action the putBack modes complete

  function renderSheetBody(container) {
    container.innerHTML = '';
    if (book.cover) {
      container.appendChild(el('img', { className: 'detail-cover', attrs: { src: book.cover, alt: book.t } }));
    }
    container.appendChild(el('h2', { text: book.t }));
    if (book.a) container.appendChild(el('div', { className: 'book-author', text: book.a }));

    const activeLoan = state.loans.find((l) => l.book === book.t);

    const metaRows = [];
    if (book.sn) {
      const seriesText = book.so !== undefined && book.so !== null && book.so !== ''
        ? `${book.sn} #${book.so}`
        : book.sn;
      metaRows.push(['Serie', seriesText]);
    }
    if (book.l) metaRows.push(['Scaffale', shelfName(book.l)]);
    if (book.copies > 1) metaRows.push(['Copie', String(book.copies)]);
    metaRows.push(['Lingua', LANG_FULL_NAME[bookLangCode(book)] || bookLangCode(book)]);
    if (book.pub) metaRows.push(['Editore', book.pub]);
    if (book.year) metaRows.push(['Anno', String(book.year)]);
    if (book.isbn) metaRows.push(['ISBN', book.isbn]);
    if (book.subjects) metaRows.push(['Argomenti', book.subjects]);

    const metaGrid = el('div', { className: 'detail-meta' });
    for (const [label, value] of metaRows) {
      metaGrid.appendChild(el('div', { className: 'detail-meta-label', text: label }));
      metaGrid.appendChild(el('div', { className: 'detail-meta-value', text: value }));
    }
    container.appendChild(metaGrid);

    if (book.notes) {
      container.appendChild(el('div', { className: 'sheet-section-title', text: 'Note' }));
      container.appendChild(el('div', { className: 'book-author', text: book.notes }));
    }

    container.appendChild(el('div', { className: 'sheet-section-title', text: 'Stato' }));
    const statusLines = [];
    if (activeLoan) {
      statusLines.push(`In prestito a ${activeLoan.borrowedBy} · dal ${formatDateDMY(activeLoan.dateLent)}`);
      if (activeLoan.expectedReturn) statusLines.push(`Rientro previsto: ${activeLoan.expectedReturn}`);
    } else if (book.h) {
      statusLines.push(`Con: ${book.h}`);
    } else {
      statusLines.push('Disponibile');
    }
    container.appendChild(el('div', { className: 'book-author', html: statusLines.join('<br>') }));

    const message = el('div', { className: 'form-message' });

    const runAction = (successMsg, fn) => {
      message.textContent = '';
      return fn()
        .then(() => {
          message.textContent = successMsg;
          message.className = 'form-message success';
          setTimeout(() => {
            mode = 'main';
            renderSheetBody(container);
            renderActiveTab();
          }, 700);
        })
        .catch((err) => {
          message.textContent = `Errore: ${err.message}`;
          message.className = 'form-message error';
        });
    };

    if (mode === 'chooseUser') {
      container.appendChild(el('div', { className: 'sheet-section-title', text: 'Chi sei?' }));
      const grid = el('div', { className: 'member-grid' });
      container.appendChild(grid);
      renderMemberGrid(grid, MEMBERS, (name) => {
        selectMember(name);
        // Back to the normal view now that an identity is set — for "Tieni
        // tu" they'll tap it once more (now it'll work); for "Presta a
        // qualcuno" go straight into the lend form since nothing further is
        // needed from them first.
        mode = pendingAfterUser === 'lend' ? 'lend' : 'main';
        pendingAfterUser = null;
        renderSheetBody(container);
      });
      return;
    }

    if (mode === 'changeShelf') {
      const select = shelfSelectEl(book.l, 'Scegli scaffale…');
      const saveBtn = el('button', { className: 'btn-primary', text: 'Salva' });
      saveBtn.addEventListener('click', () => {
        const library = select.value;
        if (!library) {
          message.textContent = 'Scegli uno scaffale.';
          message.className = 'form-message error';
          return;
        }
        if (library === (book.l || '')) {
          mode = 'main';
          renderSheetBody(container);
          return;
        }
        saveBtn.disabled = true;
        runAction(`Spostato in ${shelfName(library)}.`, async () => {
          await setLibrary({ title: book.t, library });
          book.l = library;
        }).finally(() => {
          saveBtn.disabled = false;
        });
      });
      container.appendChild(el('div', { className: 'sheet-section-title', text: 'Cambia scaffale' }));
      container.appendChild(el('div', { className: 'form-row' }, [select]));
      container.appendChild(message);
      container.appendChild(
        el('div', { className: 'form-actions' }, [
          saveBtn,
          el('button', { className: 'btn-secondary', text: 'Annulla', onClick: () => { mode = 'main'; renderSheetBody(container); } }),
        ])
      );
      return;
    }

    if (mode === 'putBack' || mode === 'putBackPick') {
      // The shelf the book normally lives on. If the Books row's Library is
      // blank (a known data gap, see FEATURES.md), fall back to the shelf the
      // loan was recorded as coming from.
      const home = book.l || (putBackKind === 'loan' && activeLoan ? activeLoan.library : '') || '';
      const successMsg = putBackKind === 'loan' ? 'Restituito' : 'Rimesso a posto';

      const doPutBack = (library) => {
        // Only send `library` when it actually changes the Books row.
        const libraryField = library !== (book.l || '') ? { library } : {};
        return runAction(`${successMsg} in ${shelfName(library)}.`, async () => {
          if (putBackKind === 'loan') {
            await returnBook({ loanId: activeLoan.id, title: book.t, ...libraryField });
            state.loans = state.loans.filter((l) => l.id !== activeLoan.id);
          } else {
            await setHeldBy({ title: book.t, heldBy: '', ...libraryField });
            book.h = undefined;
          }
          book.l = library;
          putBackKind = null;
        });
      };
      const cancel = () => {
        mode = 'main';
        putBackKind = null;
        renderSheetBody(container);
      };

      if (mode === 'putBack' && home) {
        container.appendChild(el('div', { className: 'sheet-section-title', text: 'Dove lo rimetti?' }));
        container.appendChild(el('div', { className: 'book-author', text: `Rimetterlo in ${shelfName(home)}?` }));
        const yesBtn = el('button', { className: 'btn-primary', text: `✅ Sì, in ${shelfName(home)}` });
        yesBtn.addEventListener('click', () => {
          yesBtn.disabled = true;
          doPutBack(home).finally(() => { yesBtn.disabled = false; });
        });
        container.appendChild(
          el('div', { className: 'form-actions' }, [
            yesBtn,
            el('button', { className: 'btn-secondary', text: '🗂️ Altro scaffale', onClick: () => { mode = 'putBackPick'; renderSheetBody(container); } }),
          ])
        );
        container.appendChild(message);
        container.appendChild(
          el('div', { className: 'form-actions' }, [
            el('button', { className: 'btn-secondary', text: 'Annulla', onClick: cancel }),
          ])
        );
        return;
      }

      // No known home shelf, or the user wants a different one: pick it.
      const select = shelfSelectEl(mode === 'putBackPick' ? '' : home, 'Scegli scaffale…');
      const confirmBtn = el('button', { className: 'btn-primary', text: 'Conferma' });
      confirmBtn.addEventListener('click', () => {
        const library = select.value;
        if (!library) {
          message.textContent = 'Scegli uno scaffale.';
          message.className = 'form-message error';
          return;
        }
        confirmBtn.disabled = true;
        doPutBack(library).finally(() => { confirmBtn.disabled = false; });
      });
      container.appendChild(el('div', { className: 'sheet-section-title', text: 'In quale scaffale lo rimetti?' }));
      if (!home) {
        container.appendChild(el('div', { className: 'book-author', text: 'Questo libro non ha ancora uno scaffale.' }));
      }
      container.appendChild(el('div', { className: 'form-row' }, [select]));
      container.appendChild(message);
      container.appendChild(
        el('div', { className: 'form-actions' }, [
          confirmBtn,
          el('button', { className: 'btn-secondary', text: 'Annulla', onClick: cancel }),
        ])
      );
      return;
    }

    if (mode === 'lend') {
      const borrowedByInput = el('input', {
        className: 'form-input',
        attrs: { type: 'text', placeholder: 'A chi presti? *' },
      });
      const expectedReturnInput = el('input', { className: 'form-input', attrs: { type: 'date' } });
      const submitBtn = el('button', { className: 'btn-primary', text: 'Registra prestito' });

      submitBtn.addEventListener('click', () => {
        const borrowedBy = borrowedByInput.value.trim();
        if (!borrowedBy) {
          message.textContent = 'Indica a chi presti il libro.';
          message.className = 'form-message error';
          return;
        }
        submitBtn.disabled = true;
        runAction('Prestito registrato.', async () => {
          const res = await lendBook({
            title: book.t,
            library: book.l || '',
            lentBy: state.user,
            borrowedBy,
            expectedReturn: expectedReturnInput.value || undefined,
          });
          state.loans.push({
            id: res.loanId,
            book: book.t,
            library: book.l || '',
            lentBy: state.user,
            borrowedBy,
            dateLent: formatDateDMY(new Date().toISOString()),
            expectedReturn: expectedReturnInput.value ? formatDateDMY(expectedReturnInput.value) : '',
            notes: '',
          });
        }).finally(() => {
          submitBtn.disabled = false;
        });
      });

      const cancelBtn = el('button', {
        className: 'btn-secondary',
        text: 'Annulla',
        onClick: () => {
          mode = 'main';
          renderSheetBody(container);
        },
      });

      container.appendChild(el('div', { className: 'form-row' }, [borrowedByInput]));
      container.appendChild(el('div', { className: 'form-row' }, [expectedReturnInput]));
      container.appendChild(message);
      container.appendChild(el('div', { className: 'form-actions' }, [submitBtn, cancelBtn]));
      return;
    }

    const actions = el('div', { className: 'form-actions' });

    if (activeLoan) {
      actions.appendChild(
        el('button', {
          className: 'btn-primary',
          text: '✅ Segna restituito',
          onClick: () => {
            putBackKind = 'loan';
            mode = 'putBack';
            renderSheetBody(container);
          },
        })
      );
    } else if (book.h) {
      actions.appendChild(
        el('button', {
          className: 'btn-primary',
          text: '↩️ Rimetti a posto',
          onClick: () => {
            putBackKind = 'held';
            mode = 'putBack';
            renderSheetBody(container);
          },
        })
      );
    } else {
      actions.appendChild(
        el('button', {
          className: 'btn-primary',
          text: state.user ? `📍 Tieni tu (${state.user})` : '📍 Tieni tu',
          onClick: () => {
            if (!state.user) {
              pendingAfterUser = 'heldBy';
              mode = 'chooseUser';
              renderSheetBody(container);
              return;
            }
            runAction('Segnato: lo tieni tu.', async () => {
              await setHeldBy({ title: book.t, heldBy: state.user });
              book.h = state.user;
            });
          },
        })
      );
      actions.appendChild(
        el('button', {
          className: 'btn-secondary',
          text: '📤 Presta a qualcuno',
          onClick: () => {
            if (!state.user) {
              pendingAfterUser = 'lend';
              mode = 'chooseUser';
              renderSheetBody(container);
              return;
            }
            mode = 'lend';
            renderSheetBody(container);
          },
        })
      );
    }

    container.appendChild(actions);
    container.appendChild(
      el('div', { className: 'form-actions' }, [
        el('button', {
          className: 'btn-secondary',
          text: book.l ? '🗂️ Cambia scaffale' : '🗂️ Assegna scaffale',
          onClick: () => {
            mode = 'changeShelf';
            renderSheetBody(container);
          },
        }),
      ])
    );
    container.appendChild(message);
  }

  openBottomSheet(sheetBackdrop, bottomSheet, sheetContent, renderSheetBody);
}

sheetBackdrop.addEventListener('click', () => {
  stopActiveScanner();
  closeBottomSheet(sheetBackdrop, bottomSheet);
});

// ---------- Boot ----------

navButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

async function boot() {
  const existingUser = getSelectedMember();
  if (existingUser && MEMBERS.some((m) => m.name === existingUser)) {
    state.user = existingUser;
  }

  const { books, loans, updatedAt } = await loadLibraryData();
  state.books = books || [];
  state.loans = loans || [];
  state.updatedAt = updatedAt;

  // Land on whatever tab was last used; Catalogo on a first-ever visit.
  const savedTab = getLastTab();
  switchTab(savedTab && panels[savedTab] ? savedTab : 'catalogo');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
