# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-10-26

### Added

- A start page: Open BOM…, drop a file (.eezbom, .kicad_pro or .csv) on the window, or pick one of the 10 most recent documents. The same list is in File → Open Recent; File → Close (Ctrl+W) goes back to the start page.
- Build quantity (Build qty on the toolbar): multiplies every row's Qty for order quantities, prices, availability, the best price and exports, e.g. 25 boards. A Total Qty column shows the result. Saved with the BOM (file format 3; older files open with 1).
- When each supplier's data was last collected, in its column group header and in Collect…. Dates in tooltips and on the export's Info sheet use the same form, e.g. 2026-10-26 17:45.
- Hide or show all columns of a supplier, or the Best price columns, from the View menu (Ctrl+1 to Ctrl+4). The status bar lists hidden groups, with Show all.
- A Total row at the top of the table: the sum of each supplier's Total price column, of the Best price totals and of Qty.
- Show and copy buttons next to each API credential in Settings → Suppliers. The section is protected by the password, so saved values can be shown there.

### Changed

- Clearer help for TME credentials, in Settings and in the user guide: where the Token (private key) and App secret are found on developers.tme.eu.
- The main window opens with the size, position and maximized state it had last time (on a screen that is still connected).
- Dialogs grow with the window and their content, and can be resized from the bottom-right corner; each dialog remembers its size.

### Fixed

- Column widths you set are kept when columns are added, e.g. after collecting data.
- The Rows list in Export cut off its longest choice.

## [0.1.0] - 2026-10-26

First release.

### Added

- User guide (docs/user-guide.md; Help → User Guide).
- Linux packages include the icon in all standard sizes and are linked to their menu entry.
- Export to Excel (.xlsx), LibreOffice (.ods) or CSV (File → Export…, Ctrl+E). Choose the suppliers' columns, the Best price columns and custom columns, and which rows: all, rows with a supplier's part number, rows where a supplier has the best price, or rows no supplier can deliver. Built-in presets such as "All Mouser data" and "Best price from Mouser"; your own combinations can be saved as presets. Column names follow the scope (e.g. `Mouser_Stock Qty`); numbers are written as numbers. xlsx and ods files get an Info sheet with the source, filter, collection dates and totals. CSV is UTF-8 with a byte order mark.
- Import a BOM straight from a KiCad 10 project (Import KiCad…, Ctrl+K): choose the design variant; symbols that are DNP or excluded from the BOM in that variant are left out, including through their sheets; variant field overrides (e.g. other part numbers) are applied. Rows are grouped like KiCad's Symbol Fields Table, by the project's group-by fields, without merging different supplier part numbers. Fields the project's BOM hides start as "Don't import". KiCad 9 and older files are refused with an explanation.
- Importing again (KiCad or CSV) keeps the supplier data already collected for part numbers that are still in the BOM.
- Saving an imported BOM suggests the source's name, with the KiCad variant ("Board (Basic).eezbom").
- Calculated columns per supplier: Manufacturer, Stock Qty, MOQ, Order Qty (raised to the MOQ and rounded up to the order multiple), Unit price (the price break for the order quantity), Total price, Availability (in stock, partial, out of stock, not orderable), Status and RoHS. Each supplier's columns form a group that can be collapsed.
- Best price: the cheapest total among suppliers with the whole order quantity in stock; equal totals go to the preferred supplier (Settings → General). The status bar shows the best-price total of the BOM.
- Lifecycle status colours: amber for new, NRND, last time buy and special order; red for obsolete and not orderable.
- Choose the item when a part number matches several supplier items (e.g. packagings); the cell gets that item's part number.
- Prices are compared in EUR only. A banner explains when a supplier returned another currency.
- Collect supplier data (Collect… in the toolbar, Tools → Collect Supplier Data…) from DigiKey (Product Information API v4), Mouser (Search API) and TME (API v2), all suppliers in parallel. Requests are spaced out to stay within each supplier's per-minute and per-day limits; daily counts are kept across projects and restarts. Shows progress and can be cancelled. A run stopped by a daily limit, rejected credentials or Cancel can be continued where it stopped.
- Summary after collecting: duration, found / not found / several matches / errors, and how many parts have enough stock for the BOM quantity.
- Part-number cells show whether the part was found; the tooltip has the collected details (manufacturer, stock, MOQ, price breaks, status, RoHS). A manufacturer part number in a supplier column is recognised.
- Settings: Test connection for each supplier; option to write supplier API responses to the log file.
- Project files (format 2) store the collected data. Files from earlier versions open unchanged.
- Settings (Tools → Settings…, Ctrl+,). General: preferred supplier order. Suppliers: API credentials, site and currency options, and request limits for DigiKey, Mouser and TME.
- Supplier credentials are stored encrypted (scrypt + AES-256-GCM) with a password, which is asked every time supplier settings are opened. The password can be changed; if it's forgotten, the stored credentials can be deleted to start over. Tools → Lock Credentials forgets the unlocked credentials until the password is entered again.
- Create a BOM from scratch: add and delete rows, edit cells, add DigiKey, Mouser and TME part-number columns and custom text or number columns.
- Undo and redo for every BOM edit.
- Save and open BOMs as `.eezbom` project files. The app asks to save unsaved changes before closing, starting a new BOM or opening another one.
- Import CSV files, such as KiCad's Symbol Fields Table export. Columns are mapped in a dialog with suggestions; the text encoding is detected and the mapping is remembered for the next import.
- Part-number cells listing alternatives ("A or B") are highlighted.
- Application menu, toolbar and app icon.
- Application skeleton: Electron app with a sandboxed renderer, typed IPC, logging and a BOM table.
- Windows installer (NSIS) and Linux packages (AppImage, .deb), built and smoke-tested in CI.
- Lint, type check, unit tests (Vitest) and end-to-end tests (Playwright).
