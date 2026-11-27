# Features roadmap

Living backlog of what the app could do with data the spreadsheet already has
but the app doesn't use yet, plus bigger structural additions (write support).
Update this file as items move between stages — it's meant to be referenced
during work, not just written once.

Status: 💡 idea → 🚧 in progress → ✅ done → ⏸️ blocked

---

## Infrastructure

| Item | Status | Notes |
|---|---|---|
| Apps Script write endpoint (`doPost`) | ✅ done | Shared foundation for add-book, lending, and any future mutation. `addBook` action live and tested against production (both via curl and the browser form). Accepts title-only, isbn-only, or both. |
| Write-endpoint auth | ✅ done | Token check in place (`WRITE_TOKEN` script property). Since the Apps Script source + the webapp's JS are both public (public repo, GitHub Pages), a token embedded in client code isn't a real secret — it only blocks casual/bot abuse of the bare URL, not a motivated visitor reading page source. Acceptable tradeoff for a family app; revisit if that changes. |
| Book row stable ID | 💡 idea | Books sheet has no equivalent of the Loans sheet's `LoanID`. `handleSetHeldBy`/`handleAddBook` currently match by exact Title (first match), same limitation the pre-existing menu tooling already had — fine for now, revisit if duplicate titles cause a wrong-row edit. |
| ISBN enrichment trigger | ✅ done | `runEnrichmentBatch` in `apps-script/enrich.gs`, time-driven trigger (every 1 min). Finds Books rows with an ISBN but blank Title (scan-only adds), looks up OPAC SBN → Open Library fallback → cover search (Open Library + Google Books), fills in Title/Author/Publisher/Year/Language/Subjects/Cover URL. Ported from the standalone `enrich_books_from_isbn.py` (Airtable-based, now unused). Live-tested end to end (including a transient-fetch-error retry fix — see `apps-script/enrich.gs` history). |
| Legacy iOS Shortcut endpoint | ✅ done | `doGet`/`doPost` in `apps-script/api.gs` dispatch on request shape: a `secret` param (checked against the `WEBAPP_SECRET` script property) routes to the restored Shortcut flow — scan → ToReview staging → inline enrichment via `enrichSingleRow`/`runEnrichment` (`apps-script/EnrichISBNBooks_v2.gs`, not tracked in git, still live in the Apps Script project) — while `token`+`action` keeps using this app's own direct-to-Books flow. Live-tested (fresh scan + same-shelf copy-increment). **Known issue:** duplicate-ISBN detection across the full Books sheet is unreliable on a large sheet (~1070+ rows) — occasionally misses a real duplicate, not yet root-caused (possibly a timing/formula-recalculation interaction, not purely a logic bug). Low severity: worst case is a redundant ToReview entry, never a duplicate in Books itself, since moving ToReview → Books is still a manual, human-reviewed step. |
| Books row Status/Active Loans formulas on new rows | ✅ done | `_setComputedStatusFormulas_` in `apps-script/api.gs` sets the same `IF`/`SUMPRODUCT` formulas `_restructureBooks` (HomeLibrary_v2.gs) sets for pre-existing rows, on any row `handleAddBook`/`handleSetHeldBy` touches — so a book added via the webapp, Shortcut-via-ToReview-move, or the original menu tooling all compute "In prestito"/"Con X" the same way. Previously, webapp-added rows had blank Status/Active Loans forever. |
| Authors sheet `_splitAuthors` fix | ✅ done | `HomeLibrary_v2.gs` now also splits on `"; "` (author + illustrator pairs), not just `", "` — 4 real cases found where 2 people were being counted as 1 bogus author, undercounting 2 people (`Ines Belski Lagazzi`, `Stelio Martelli`/`Stefania Stefani`) who also appear correctly elsewhere as solo credits. Verified against all known cases. 2 rarer `"Name1 e Name2 Surname"` cases left as manual sheet fixes (too risky to generalize from 2 examples). |
| `parseLoans`/`books` endpoint missing Loans fields | 💡 idea | Only exposes `id`/`book`/`lentBy`/`borrowedBy`/`dateLent`. Missing `Expected Return`, `Notes`, loan `Library` — **blocks** an overdue badge and a full Lending UI loan-history view. Needed before/alongside the Lending UI work below. |

## Data-driven features (unused sheet columns)

| Column | Status | Feature |
|---|---|---|
| **ISBN** | 🚧 in progress | Barcode-scan add-book flow (camera, `html5-qrcode` lib) in Catalogo → feeds `addBook` endpoint with isbn-only → `runEnrichmentBatch` fills in the rest within ~1-2 min. Natural pairing with the iOS Shortcut idea below (same endpoint, different entry point). |
| **Cover URL** | 💡 idea | Real book cover thumbnails in Catalogo instead of the decorative color bar. Read-only, no backend change needed. |
| **Subjects** | 💡 idea | Genre/topic filter chips alongside language/shelf in Catalogo. |
| **SeriesName / SeriesOrder** | ✅ done | Exposed by `parseBooks` (`sn`/`so` compact fields), shown as a gold pill badge next to the shelf badge (`.book-series`, `renderBookRow` in `js/ui.js`). Data applied to production via `apps-script/one_off_series_mapping.gs` (also stripped the now-redundant volume number out of each title, e.g. "1: Harry Potter e la pietra filosofale" → "Harry Potter e la pietra filosofale") — live-verified in browser: badges, clean titles, and correct Catalogo letter-bucket all confirmed. See that file for which series were identified and why some were deliberately left out (same-title duplicate copies, unclear translated-edition numbering). More series can be added the same way later (it's just a title→{series,order} map, re-run is idempotent). |
| **ReadBy** | 💡 idea | "Chi l'ha letto" badge/stat — distinct from `Held By` (who has it physically right now). |
| **Publisher / Year** | 💡 idea | Needs a book detail screen (books currently have no tap-through view) to have somewhere to show these. |
| **Copies** | 🚧 in progress | Data-model rule now settled: same ISBN scanned at the **same** shelf = another physical copy → `Copies` is bumped by 1 on the existing Books row (no new row, no ToReview trip). Same ISBN at a **different** shelf = a genuinely distinct copy living elsewhere → its own row, not a duplicate. Implemented in the legacy Shortcut's `_handleAddBookShortcut`/`_incrementCopiesShortcut_` (`apps-script/api.gs`). Not yet applied to the webapp's own scan flow, since that scanner doesn't currently ask which shelf you're scanning into before each ISBN — would need that UI first. Catalogo display still doesn't reflect `Copies > 1` specially (e.g. "2 copie disponibili").  |
| **Status** | 💡 idea | Unknown value set so far (e.g. maybe "On Shelf / Lost / Being Repaired"?) — check actual values in the sheet before designing a filter/badge around it. |
| **Active Loans** (Books sheet) | 💡 idea | May duplicate what's already computed from the Loans sheet — check whether it's a formula before building parallel logic. |
| **Expected Return** (Loans sheet) | 💡 idea | Overdue badge ("in ritardo da N giorni") on active loans. |
| **Notes** (both sheets) | 💡 idea | Free-text shown on a book/loan detail view. |

## Structural features

| Feature | Status | Notes |
|---|---|---|
| **Add book endpoint** | ✅ done | `doPost` action `addBook` in `apps-script/api.gs`, appends a row to the Books sheet. Header-mapped (robust to column reordering); accepts title and/or isbn. |
| **Add book UI (webapp)** | ✅ done | "+ Aggiungi libro" form in Catalogo calling the endpoint above, with optimistic local update. |
| **Scan ISBN UI (webapp)** | 🚧 in progress | "📷 Scansiona ISBN" button in Catalogo opens a camera barcode reader (bottom sheet), continuous-scan mode for adding a stack of books quickly. Each scan calls `addBook({isbn})` immediately; enrichment happens later (see infra table). Needs testing on an actual phone camera — not verifiable from a desktop browser session. |
| **iOS Shortcut add-book flow** | ✅ done | Already existed (built before this webapp effort, in `HomeLibrary_v2.gs`/`WebAppEndpoint_v2.gs`/`EnrichISBNBooks_v2.gs`, discovered via the sheet's own auto-generated README) and in active family use — a real Shortcut scans → secret-gated POST → ToReview → inline enrichment. Temporarily broken when `WebAppEndpoint_v2.gs` was deleted to resolve a `doPost` collision; restored by merging its logic into `apps-script/api.gs` (see Infrastructure table). A separate, intentionally different pipeline from the webapp's own scan feature above (ToReview-staged + immediate enrich vs. Books-direct + timer enrich). |
| **Lending workflow (lend/return in-app)** | 🚧 in progress — **UI next, own PR** | Backend done: `doPost` actions `setHeldBy` (informal "X has it" marker), `lendBook` (append to Loans), `returnBook` (set Date Returned by LoanID) — all in `apps-script/api.gs`, not yet tested against production. **Design rule, per explicit decision:** `Library` is always the book's permanent home shelf and is *never* written by any of these three actions — only `Held By` (informal) or a new Loans row (formal) changes, and `Status`/`Active Loans` (computed formulas) reflect "In prestito"/"Con X" on top of that, same as the pre-existing sheet design. This also fixes a real data-quality gap found in the live sheet: several pre-existing rows have a **blank** Library whenever `Held By` is set (e.g. "Delitto e castigo", "Castità..." — Library got cleared instead of preserved by whatever process entered them originally); that's unrecoverable now, so it's a one-off manual sheet fix, not something to script. Still missing: the webapp UI ("Presta"/"Segna restituito" buttons) and the `parseLoans` field gap noted in the Infrastructure table above (blocks an overdue badge). |
| **Book detail view** | 💡 idea — **next, own PR** | Tap-through screen for a book — prerequisite for showing Publisher/Year/Notes/Series/Subjects, and a natural home for the lend/return buttons above instead of (or in addition to) inline Catalogo-row actions. |

---

## Already shipped

- Core PWA: selector screen, Io/Catalogo/Famiglia tabs, bottom sheet, offline cache (`sw.js`).
- Live data via Apps Script (`doGet`), with shelf/heldBy/active-loans column mapping fixed to match the real sheet headers.
- Daily GitHub Action sync (`scripts/sync.py`) as the bundled offline fallback.
- Catalogo: alphabetical list with letter-section headers (leading Italian/English articles ignored for sorting, e.g. "Il senso religioso" files under S), sub-sorted by shelf within each letter so same-shelf books cluster together (`sortCatalogBooks`/`groupLetter` in `js/app.js`, `renderGroupedBookList` in `js/ui.js`).
- Book spine color is now a stable per-shelf color (`shelfColor` in `js/data.js`), replacing the old purely-decorative per-row-index color cycle.
