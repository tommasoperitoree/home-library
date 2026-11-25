import {
  MEMBERS,
  loadLibraryData,
  getSelectedMember,
  setSelectedMember,
  bookLangCode,
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

function renderTabCatalogo() {
  const panel = panels.catalogo;
  panel.innerHTML = '';

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

sheetBackdrop.addEventListener('click', () => closeBottomSheet(sheetBackdrop, bottomSheet));

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
