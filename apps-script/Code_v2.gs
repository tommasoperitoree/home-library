/**
 * Code_v2.gs — replace Code.gs with this file.
 *
 * CHANGES FROM v1:
 *   • Watches both Books (manual ISBN entry) and ToReview (manual ISBN entry)
 *   • When an ISBN is typed into ToReview and ReviewStatus is empty,
 *     auto-sets ReviewStatus = "Manca Titolo" as a reminder to enrich
 *
 * Note: simple onEdit triggers do NOT fire for edits made by scripts,
 * which is why WebAppEndpoint_v2.gs sets "Scanned time" itself.
 *
 * Reference copy only — this file is live in the Apps Script project (not
 * wired into api.gs/enrich.gs in this repo) but was never tracked in git
 * before now. Depends on the SH constant from HomeLibrary_v2.gs (same
 * Apps Script project, shared scope).
 */
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const name  = sheet.getName();

    // Only watch Books and ToReview
    if (name !== SH.BOOKS && name !== SH.REVIEW) return;
    if (e.range.getRow() === 1) return;  // ignore header edits

    const headerRow  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const isbnCol    = headerRow.indexOf("ISBN")         + 1;
    const scannedCol = headerRow.indexOf("Scanned time") + 1;
    if (!isbnCol || !scannedCol) return;

    // Only act when the ISBN column was part of the edited range
    const editedCol     = e.range.getColumn();
    const editedLastCol = editedCol + e.range.getNumColumns() - 1;
    if (isbnCol < editedCol || isbnCol > editedLastCol) return;

    const startRow = e.range.getRow();
    const numRows  = e.range.getNumRows();

    for (let i = 0; i < numRows; i++) {
      const row         = startRow + i;
      const isbnValue   = sheet.getRange(row, isbnCol).getValue();
      const scannedCell = sheet.getRange(row, scannedCol);

      // Stamp scan time if not already set
      if (isbnValue && !scannedCell.getValue()) {
        scannedCell.setValue(new Date());
      }

      // ToReview only: pre-fill ReviewStatus so the row is visible in context
      if (name === SH.REVIEW && isbnValue) {
        const statusCol = headerRow.indexOf("ReviewStatus") + 1;
        if (statusCol) {
          const statusCell = sheet.getRange(row, statusCol);
          if (!statusCell.getValue()) statusCell.setValue("Manca Titolo");
        }
      }
    }
  } catch (err) {
    Logger.log("onEdit error: " + err.toString());
  }
}
