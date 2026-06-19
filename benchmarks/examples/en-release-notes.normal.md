# taskline v2.3.0

## 🎉 New features
- **Recurring tasks** — Set tasks to repeat on a schedule, so routine work regenerates automatically instead of being re-entered by hand.
- **CSV export** — Export your task list to CSV for reporting, backups, or analysis in spreadsheets and other tools.

## 🐛 Bug fixes
- **Correct deadlines across midnight** — Fixed a timezone bug that caused deadlines falling just after midnight to be calculated on the wrong day.
- **No more crashes on empty titles** — Creating or saving a task with an empty title no longer crashes the app.

## ⚡ Performance
- **2× faster list rendering** — The task list now renders roughly twice as fast, for snappier scrolling and switching between views.

## ⚠️ Breaking changes
- **Node 16 is no longer supported** — taskline now requires Node 18 or later. Upgrade your Node.js runtime before updating to v2.3.0.

---

**Upgrade note:** Because of the dropped Node 16 support, confirm you're on Node 18+ before upgrading. All other changes are backward-compatible.

---

A couple of options depending on where these notes will live:
- Want a **terser changelog-style** version (Keep a Changelog format, one line per entry)?
- Should I add **version date** (2026-06-19) and a comparison link (`v2.2.x...v2.3.0`)?
