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
} from './data.js';
import {
  renderMemberGrid,
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

  panel.appendChild(el('div', { className: 'greeting', text: `${timeGreeting()}, ${state.user}!` }));

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

function stopActiveScanner() {
  if (!activeScanner) return;
  const scanner = activeScanner;
  activeScanner = null;
  scanner.stop().catch(() => {});
}

// Scanned-only adds land with just an ISBN and a blank title; the Apps
// Script time-driven trigger (runEnrichmentBatch in apps-script/enrich.gs)
// fills in the rest within a minute or two, so books don't appear in
// Catalogo immediately after a scan — that's expected, not a bug.
function openIsbnScanner() {
  let scanCount = 0;
  let lastCode = '';
  let lastTime = 0;

  openBottomSheet(sheetBackdrop, bottomSheet, sheetContent, (container) => {
    const status = el('div', { className: 'form-message', text: 'Inquadra il codice a barre del libro.' });
    const counter = el('div', { className: 'scan-counter', text: '0 libri aggiunti in questa sessione' });
    const readerDiv = el('div', { attrs: { id: 'isbn-reader' } });

    const stopScanner = () => {
      stopActiveScanner();
      closeBottomSheet(sheetBackdrop, bottomSheet);
    };

    const onScan = async (decodedText) => {
      const isbn = decodedText.replace(/[^0-9Xx]/g, '');
      if (isbn.length !== 10 && isbn.length !== 13) return;

      const now = Date.now();
      if (isbn === lastCode && now - lastTime < 3000) return;
      lastCode = isbn;
      lastTime = now;

      status.textContent = `Aggiungo ISBN ${isbn}…`;
      try {
        await addBook({ isbn });
        scanCount += 1;
        counter.textContent = `${scanCount} ${scanCount === 1 ? 'libro aggiunto' : 'libri aggiunti'} in questa sessione`;
        status.textContent = `✅ ISBN ${isbn} in elaborazione (compare nel catalogo tra 1-2 minuti).`;
      } catch (err) {
        status.textContent = `Errore: ${err.message}`;
      }
    };

    container.appendChild(el('h2', { text: '📷 Scansiona ISBN' }));
    container.appendChild(readerDiv);
    container.appendChild(status);
    container.appendChild(counter);
    container.appendChild(
      el('div', { className: 'form-actions' }, [
        el('button', { className: 'btn-secondary', text: 'Chiudi', onClick: stopScanner }),
      ])
    );

    if (window.Html5Qrcode) {
      const scanner = new window.Html5Qrcode('isbn-reader');
      activeScanner = scanner;
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decodedText) => onScan(decodedText)
        )
        .catch((err) => {
          status.textContent = `Impossibile avviare la fotocamera: ${err}`;
        });
    } else {
      status.textContent = 'Libreria di scansione non disponibile.';
    }
  });
}

function renderAddBookForm(container) {
  container.innerHTML = '';

  const titleInput = el('input', { className: 'form-input', attrs: { type: 'text', placeholder: 'Titolo *' } });
  const authorInput = el('input', { className: 'form-input', attrs: { type: 'text', placeholder: 'Autore' } });
  const isbnInput = el('input', { className: 'form-input', attrs: { type: 'text', placeholder: 'ISBN (opzionale)' } });

  const shelfSelect = el('select', { className: 'form-select' }, [
    el('option', { text: 'Scaffale (opzionale)', attrs: { value: '' } }),
    ...SHELVES.map((s) => el('option', { text: s.label, attrs: { value: s.key } })),
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
        el('span', { className: 'member-row-emoji', text: member.emoji }),
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
      el('h2', { text: `${member.emoji} ${member.name}` })
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
// marker. Library is never written by anything here — only Held By or a
// new/updated Loans row changes, per the project's lending design rule.
const LANG_FULL_NAME = { IT: 'Italiano', EN: 'Inglese', ES: 'Spagnolo', DE: 'Tedesco' };

function openBookDetailSheet(book) {
  let mode = 'main'; // 'main' | 'lend' | 'chooseUser'
  let pendingAfterUser = null; // 'heldBy' | 'lend' — which action to resume once a member is picked

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
    if (book.l) metaRows.push(['Scaffale', shelfLabel(book.l)]);
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
          onClick: () =>
            runAction('Restituito.', async () => {
              await returnBook({ loanId: activeLoan.id });
              state.loans = state.loans.filter((l) => l.id !== activeLoan.id);
            }),
        })
      );
    } else if (book.h) {
      actions.appendChild(
        el('button', {
          className: 'btn-primary',
          text: '↩️ Rimetti a posto',
          onClick: () =>
            runAction('Rimesso a posto.', async () => {
              await setHeldBy({ title: book.t, heldBy: '' });
              book.h = undefined;
            }),
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
