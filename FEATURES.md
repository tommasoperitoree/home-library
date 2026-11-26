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
| Book row stable ID | 💡 idea | Books sheet has no equivalent of the Loans sheet's `LoanID`. Needed before any feature that edits an *existing* book row safely (vs. the loans flow, which already has `LoanID` to target). |
| ISBN enrichment trigger | 🚧 in progress | `runEnrichmentBatch` in `apps-script/enrich.gs`, time-driven trigger (every 1 min, closest Apps Script allows to a 2-min buffer). Finds Books rows with an ISBN but blank Title (scan-only adds), looks up OPAC SBN → Open Library fallback → cover search (Open Library + Google Books), fills in Title/Author/Publisher/Year/Language/Subjects/Cover URL. Ported from the standalone `enrich_books_from_isbn.py` (which targeted a now-unused Airtable base) — Summary/Translator/Physical Description dropped since the sheet has no columns for them. Needs the one-time `installEnrichmentTrigger` run from the Apps Script editor to activate. Not yet live-tested against production (needs a real scanned ISBN to verify end to end). |

## Data-driven features (unused sheet columns)

| Column | Status | Feature |
|---|---|---|
| **ISBN** | 🚧 in progress | Barcode-scan add-book flow (camera, `html5-qrcode` lib) in Catalogo → feeds `addBook` endpoint with isbn-only → `runEnrichmentBatch` fills in the rest within ~1-2 min. Natural pairing with the iOS Shortcut idea below (same endpoint, different entry point). |
| **Cover URL** | 💡 idea | Real book cover thumbnails in Catalogo instead of the decorative color bar. Read-only, no backend change needed. |
| **Subjects** | 💡 idea | Genre/topic filter chips alongside language/shelf in Catalogo. |
| **SeriesName / SeriesOrder** | 💡 idea | Group a series together; show "Libro 3 di 5"; sort within series. |
| **ReadBy** | 💡 idea | "Chi l'ha letto" badge/stat — distinct from `Held By` (who has it physically right now). |
| **Publisher / Year** | 💡 idea | Needs a book detail screen (books currently have no tap-through view) to have somewhere to show these. |
| **Copies** | ⏸️ blocked on a data-model decision | Book availability currently assumes 1 row = 1 physical copy (`HeldBy` blank = available). If a title has `Copies > 1`, that assumption may already be wrong. Needs clarifying how multi-copy titles should display before building more on top. |
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
| **iOS Shortcut add-book flow** | 💡 idea | Camera → barcode → Google Books API lookup → POST to the same `addBook` endpoint. Webapp could offer a `shortcuts://run-shortcut?name=...` launcher button once the Shortcut exists and is shared to family devices. |
| **Lending workflow (lend/return in-app)** | 💡 idea | `doPost` actions `lendBook` (append to Loans) / `returnBook` (set Date Returned on a LoanID). UI: "Presta" button on a book, "Segna restituito" on an active loan row in Io/Famiglia. |
| **Book detail view** | 💡 idea | Tap-through screen for a book — prerequisite for showing Publisher/Year/Notes/Series/Subjects. |

---

## Already shipped

- Core PWA: selector screen, Io/Catalogo/Famiglia tabs, bottom sheet, offline cache (`sw.js`).
- Live data via Apps Script (`doGet`), with shelf/heldBy/active-loans column mapping fixed to match the real sheet headers.
- Daily GitHub Action sync (`scripts/sync.py`) as the bundled offline fallback.
