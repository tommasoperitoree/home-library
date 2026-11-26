import {
  MEMBERS,
  SHELVES,
  LANGUAGES,
  loadLibraryData,
  getSelectedMember,
  setSelectedMember,
  bookLangCode,
  addBook,
} from './data.js';
import {
  renderMemberGrid,
  renderBookList,
  renderChipRow,
  languageChips,
  shelfChips,
  makeExpandableCard,
  openBottomSheet,
  closeBottomSheet,
  renderStatsGrid,
  timeGreeting,
  formatDateDMY,
  el,
} from './ui.js';

const state = {
  user: null,
  books: [],
  loans: [],
  updatedAt: null,
  activeTab: 'io',
  catalogo: {
    search: '',
    lang: 'Tutti',
    shelf: 'Tutti',
    page: 1,
    pageSize: 50,
  },
};

const selectorScreen = document.getElementById('selector-screen');
const appEl = document.getElementById('app');
const memberGrid = document.getElementById('member-grid');
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

function selectMember(name) {
  state.user = name;
  setSelectedMember(name);
  selectorScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  renderActiveTab();
}

function switchTab(tab) {
  stopActiveScanner();
  state.activeTab = tab;
  tabTitle.textContent = TAB_TITLES[tab];
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle('hidden', key !== tab);
  }
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  renderActiveTab();
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
        renderBookList(list, heldBooks, { loanedTitles: loaned });
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
  return state.books.filter((b) => {
    if (term && !(b.t.toLowerCase().includes(term) || (b.a || '').toLowerCase().includes(term))) {
      return false;
    }
    if (lang !== 'Tutti' && bookLangCode(b) !== lang) return false;
    if (shelf !== 'Tutti' && b.l !== shelf) return false;
    return true;
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
  renderBookList(listEl, results.slice(0, visibleCount), { loanedTitles: loaned });

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
    renderBookList(bookList, heldBooks, { loanedTitles: loanedTitlesSet() });
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

sheetBackdrop.addEventListener('click', () => {
  stopActiveScanner();
  closeBottomSheet(sheetBackdrop, bottomSheet);
});

// ---------- Boot ----------

navButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

async function boot() {
  renderMemberGrid(memberGrid, MEMBERS, selectMember);

  const { books, loans, updatedAt } = await loadLibraryData();
  state.books = books || [];
  state.loans = loans || [];
  state.updatedAt = updatedAt;

  const existingUser = getSelectedMember();
  if (existingUser && MEMBERS.some((m) => m.name === existingUser)) {
    selectMember(existingUser);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
