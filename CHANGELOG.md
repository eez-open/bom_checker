# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- BOMs of a list with unsaved changes are marked with a larger, orange dot.

### Fixed

- Showing a list's Combined BOM marked BOMs as changed when another BOM had newer data for their part numbers. Now only data collected in Combined goes to the BOMs.

## [0.8.0] - 2026-10-28

### Added

- BOM lists (File → New BOM List…, `.eezbom-list`) for several BOMs ordered together, such as the modules of one device (#35):
    - The list's BOMs on the left and the selected one on the right, where everything works as for a single BOM. BOMs keep unsaved changes and undo while another is shown; File → Save All saves them all.
    - **Combined**: the rows of all BOMs, with rows of the same part numbers merged and quantities added up, and a Source BOM column; it can be collected and exported.
    - **Unify part numbers**: the components (same Value and Footprint) whose rows have different part numbers or Values, with every part number used for them, also earlier ones from the history, and stock and prices for the quantity of all rows. Choose one per supplier or type another; Apply saves the changed BOMs after a backup.
    - A **history BOM** remembers every component and part-number combination used in the list's BOMs.
- Most expensive parts: a colour for each of the 10 slices, numbered by rank; **Copy picture** and **Save as PNG…** for the chart with its legend; and a **Top 10** button in the Best price header (#28).

### Changed

- No absolute paths in the files the app writes (#34): a BOM keeps the path of its CSV file or KiCad project relative to its own folder, exports show it relative to the BOM, and backup folders list their files relative to themselves. BOMs saved by older versions get relative paths when saved again.

## [0.7.0] - 2026-10-27

### Added

- Most expensive parts (status bar, or View → Most Expensive Parts…): a ring chart of the 10 rows that cost the most at their best price, with the rest as Other, and a table with their totals and shares of the best price total (#28).
- Collect only the selected rows: with rows selected in the table, Collect… offers "Only the selected rows", chosen by default (#17).
- Checkboxes above the table show and hide the columns of each supplier, including suppliers without an API, and Best price, without going to the View menu (#5).
- Undo and Redo buttons on the toolbar, next to Save (#24).
- DigiKey keeps stock per packaging: when another packaging of the same product has stock (e.g. a box when cut tape is out of stock), the Availability and part-number tooltips show its part number, stock and MOQ.
- With "Look up the Value where a part number is missing" off, Collect… says for each supplier how many rows without a part number have a Value it could look up (#18).

### Changed

- Change password moved from Settings → Suppliers to Settings → General (#22).

### Fixed

- The Delete button counted rows selected in the BOM that was open before (#23).
- Looking up the Value didn't fill in an empty cell when the Value had been looked up in an earlier run (#18).
- "Only part numbers without data" now also tries again part numbers that got an error last time.

## [0.6.0] - 2026-10-27

### Added

- Suppliers without an API (Columns… → Suppliers without an API), for parts no API supplier has, such as a display from a specialist shop or an enclosure: type the part number, unit price, stock and MOQ in the table. Order quantity, total and availability are calculated, and they take part in the best price, the Total row, the Rows filter and exports (#20).
- Search the table (Ctrl+F, Edit → Find…) for text in any column (#29), and filter the rows by the supplier with the best price, or the parts no supplier can deliver (#25). While filtered, the Total row adds up the shown rows.
- With a build quantity above 1, total prices show the price per unit in parentheses, e.g. 62.50 (2.50): in the Total price columns, the Total row, the status bar and the export's Info sheet (#27).
- Qty can be a decimal, for parts used in fractions of their unit, e.g. 0.004 m of tape from 5 m rolls; order quantities are still whole packages (#19). BOM files are now format 5, which also holds the suppliers without an API.

### Changed

- The Row column shows each row's place in the BOM, also when the table is sorted or filtered.

## [0.5.0] - 2026-10-27

### Added

- Sync KiCad… (the toolbar's Import KiCad… for a BOM imported from KiCad) lists what changed in the KiCad project since the import: added and removed parts, changed values and part numbers, new supplier columns. Ticked changes are brought into the BOM; rows and columns added in the BOM, and values changed only in the BOM, are kept (#30). BOM files are now format 4, which remembers KiCad's values for this; older files open as before.
- When several supplier items match a part number, the Availability cell is a list to choose the item from, with each item's packaging, stock, MOQ and price; the chosen item's part number goes into the cell (#15).
- Export: the *Basic data only* preset and a *Part numbers only* option, for Row, Reference, Value, Qty, Footprint and the suppliers' part numbers without their data (#21).

### Changed

- The Value column stays in view with Row and Reference when scrolling to the supplier columns (#26).

## [0.4.0] - 2026-10-26

### Added

- Update KiCad… writes the part numbers back into the KiCad project the BOM was imported from (#11). Only rows whose references match a row of KiCad's BOM exactly are written; a preview lists every change and the rows left out. The project's files are backed up to bom-checker-backups first, and the dialog can restore them.

## [0.3.0] - 2026-10-26

### Added

- Look up the Value where a part number is missing (option in Collect…): for rows with an empty part-number cell, the Value is searched as a manufacturer part number. One match fills in the supplier's part number; several leave the Value to choose the item from. Generic values such as 100n or 10k are skipped.
- LCSC as a fourth supplier, through LCSC's official API (free, after LCSC approves an application; calls must come from a registered IP address). The LCSC column takes LCSC numbers (C2040) or manufacturer part numbers; LCSC columns in CSV files and KiCad projects are now imported as LCSC part numbers instead of a custom column. The user guide explains how to get the key and secret.

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
