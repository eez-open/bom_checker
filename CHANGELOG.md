# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
