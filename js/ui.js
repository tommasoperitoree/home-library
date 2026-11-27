// DOM helpers / rendering functions.
import { SHELVES, LANGUAGES, bookLangCode, shelfColor } from './data.js';

export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Compact name, for chips and row badges.
export function shelfLabel(key) {
  const shelf = SHELVES.find((s) => s.key === key);
  return shelf ? shelf.label : key;
}

// Full name (the sheet's own Library value), for anywhere with room.
export function shelfName(key) {
  return key || '';
}

export function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

export function formatDateDMY(isoOrDmy) {
  if (!isoOrDmy) return '—';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoOrDmy)) return isoOrDmy;
  const d = new Date(isoOrDmy);
  if (isNaN(d)) return isoOrDmy;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function renderMemberGrid(container, members, onSelect) {
  container.innerHTML = '';
  for (const member of members) {
    const btn = el(
      'button',
      { className: 'member-btn', onClick: () => onSelect(member.name) },
      [
        memberFaceEl(member, 'member-face'),
        el('span', { className: 'member-name', text: member.name }),
      ]
    );
    container.appendChild(btn);
  }
}

// Shared face-or-emoji renderer: an <img> of the member's face icon when one
// is set, falling back to the emoji span (e.g. if a member is ever added
// without a face asset).
export function memberFaceEl(member, className) {
  if (member.face) {
    return el('img', { className, attrs: { src: member.face, alt: member.name } });
  }
  return el('span', { className, text: member.emoji });
}

export function renderBookRow(book, index, { loanedTitles = new Set(), onOpen } = {}) {
  const isLoaned = loanedTitles.has(book.t);
  const meta = [];
  if (book.sn) {
    const seriesText = book.so !== undefined && book.so !== null && book.so !== ''
      ? `${book.sn} #${book.so}`
      : book.sn;
    meta.push(el('span', { className: 'book-series', text: seriesText }));
  }
  if (book.l) meta.push(el('span', { className: 'book-shelf', text: shelfLabel(book.l) }));
  if (book.h) meta.push(el('span', { className: 'badge-held', text: `con ${book.h}` }));
  if (isLoaned) meta.push(el('span', { className: 'badge-loan', text: '📤 in prestito' }));

  return el(
    'div',
    {
      className: onOpen ? 'book-row book-row-clickable' : 'book-row',
      onClick: onOpen ? () => onOpen(book) : undefined,
    },
    [
      el('div', { className: 'book-spine', attrs: { style: `background:${shelfColor(book.l)}` } }),
      el('div', { className: 'book-info' }, [
        el('div', { className: 'book-title', text: book.t }),
        el('div', { className: 'book-author', text: book.a || '—' }),
        el('div', { className: 'book-meta' }, meta),
      ]),
    ]
  );
}

export function renderBookList(container, books, opts = {}) {
  container.innerHTML = '';
  if (!books.length) {
    container.appendChild(el('div', { className: 'card-empty', text: 'Nessun libro trovato.' }));
    return;
  }
  books.forEach((book, i) => container.appendChild(renderBookRow(book, i, opts)));
}

// Like renderBookList, but inserts a header divider whenever groupKeyFn(book)
// changes from the previous book — used by Catalogo's alphabetical+letter-
// header list. groupKeyFn is caller-supplied so this stays agnostic of any
// particular grouping rule (e.g. Italian/English leading-article stripping).
export function renderGroupedBookList(container, books, groupKeyFn, opts = {}) {
  container.innerHTML = '';
  if (!books.length) {
    container.appendChild(el('div', { className: 'card-empty', text: 'Nessun libro trovato.' }));
    return;
  }
  let lastGroup = null;
  books.forEach((book, i) => {
    const group = groupKeyFn(book);
    if (group !== lastGroup) {
      container.appendChild(el('div', { className: 'catalog-letter-header', text: group }));
      lastGroup = group;
    }
    container.appendChild(renderBookRow(book, i, opts));
  });
}

export function renderChipRow(container, items, activeKey, onSelect) {
  container.innerHTML = '';
  for (const item of items) {
    const chip = el('button', {
      className: `chip${item.key === activeKey ? ' active' : ''}`,
      text: item.label,
      onClick: () => onSelect(item.key),
    });
    container.appendChild(chip);
  }
}

export function languageChips() {
  return [{ key: 'Tutti', label: 'Tutti' }, ...LANGUAGES];
}

export function shelfChips() {
  return [{ key: 'Tutti', label: 'Tutti' }, ...SHELVES.map((s) => ({ key: s.key, label: s.label }))];
}

export function makeExpandableCard(titleText, count, bodyBuilder, { autoOpen = false } = {}) {
  const card = el('div', { className: `card${autoOpen && count > 0 ? ' open' : ''}` });
  const body = el('div', { className: 'card-body' });
  bodyBuilder(body);

  const header = el(
    'div',
    {
      className: 'card-header',
      onClick: () => card.classList.toggle('open'),
    },
    [
      el('span', {}, [
        document.createTextNode(titleText + ' '),
        el('span', { className: 'card-header-count', text: String(count) }),
      ]),
      el('span', { className: 'card-chevron', text: '▾' }),
    ]
  );

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

export function openBottomSheet(backdrop, sheet, contentContainer, builder) {
  contentContainer.innerHTML = '';
  builder(contentContainer);
  backdrop.classList.remove('hidden');
  sheet.classList.remove('hidden');
}

export function closeBottomSheet(backdrop, sheet) {
  backdrop.classList.add('hidden');
  sheet.classList.add('hidden');
}

export function renderStatsGrid(container, stats) {
  container.innerHTML = '';
  for (const stat of stats) {
    container.appendChild(
      el('div', { className: 'stat-tile' }, [
        el('div', { className: 'stat-value', text: String(stat.value) }),
        el('div', { className: 'stat-label', text: stat.label }),
      ])
    );
  }
}
