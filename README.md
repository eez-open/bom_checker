# EEZ BOM checker

A desktop app for Windows and Linux that checks a bill of materials against DigiKey, Mouser and TME. It reports stock, prices, minimum order quantities, lifecycle status and RoHS status, and picks the best-priced supplier for each part.

- What the app must do: [BOM checker project scope.md](BOM%20checker%20project%20scope.md)
- How it is built: [BOM checker architecture.md](BOM%20checker%20architecture.md)

## Development

You need Node.js 24 (see `.nvmrc`) and Git.

```sh
npm ci          # install dependencies
npm run dev     # start the app with hot reload
```

| Command                | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start the app in development mode with hot reload           |
| `npm run build`        | Build into `out/`                                           |
| `npm run preview`      | Start the built app                                         |
| `npm run check`        | Type check, lint, format check and unit tests (CI runs this) |
| `npm test`             | Unit tests (Vitest)                                         |
| `npm run test:e2e`     | Start the built app and run the smoke test (Playwright)     |
| `npm run format`       | Format all files with Prettier                              |
| `npm run icon`         | Render `build/icon.svg` to `build/icon.png` (app icon)      |
| `npm run pack`         | Build an unpacked app into `release/` for a quick try       |
| `npm run dist:win`     | Build the Windows installer into `release/`                 |
| `npm run dist:linux`   | Build the AppImage and `.deb` into `release/` (Linux only)  |

Run `npm run build` before `npm run test:e2e`. To test a packaged app instead, set `E2E_APP_PATH` to its executable.

### Project layout

```
src/
  main/       Electron main process: windows, security, IPC handlers, logging
  preload/    Exposes the typed API (window.api) to the UI
  renderer/   React UI
  shared/     Types and pure logic used by both sides (data model, IPC contract)
e2e/          Playwright end-to-end tests
build/        App icon (icon.svg is the source; electron-builder uses icon.png)
scripts/      Helper scripts
docs/         Developer documentation
```

BOM editing works on immutable `Project` objects: every operation in `src/shared/project-ops.ts` returns a new project. The UI store (`src/renderer/store/document.ts`) keeps the previous versions for undo, and compares with the last saved version to know whether there are unsaved changes.

The renderer has no Node.js access. Everything it needs from the main process goes through `window.api`, which is defined in `src/shared/ipc.ts`.

Dependencies used only by the UI (React, AG Grid) are `devDependencies`, because Vite bundles them into `out/renderer`. Only libraries that the main process loads at run time belong in `dependencies`; electron-builder copies those into the package.

### App data

Settings (`settings.json`), the encrypted supplier credentials (`vault.json`) and logs are stored in the app's data folder: `%APPDATA%\EEZ BOM checker` on Windows, `~/.config/EEZ BOM checker` on Linux. Set `EEZ_BOM_CHECKER_USER_DATA` to another folder to start with an empty profile; the end-to-end tests do this, so they never touch your own settings.

`EEZ_BOM_CHECKER_API_URLS` points the supplier integrations at other addresses, e.g. `{"mouser":"http://127.0.0.1:4567/mouser"}`. The end-to-end tests use it with the fake supplier server in `e2e/fake-suppliers.ts`, so they need neither network access nor real API keys.

The credential vault design is described in [BOM checker architecture.md](BOM%20checker%20architecture.md), section 7.2.

### Troubleshooting

If Electron prints `bad option: --remote-debugging-port` or starts as plain Node.js, the environment variable `ELECTRON_RUN_AS_NODE` is set. Processes started by VS Code extensions inherit it. Unset it, or run the command from a normal terminal.

## Releases

1. Update the version in `package.json` and the `CHANGELOG.md`.
2. Tag the commit (`git tag v0.2.0`) and push the tag.
3. CI builds both platforms, smoke-tests the packaged apps and creates a draft GitHub release with the installers attached. Review it and publish it.

Upgrading Electron and other major dependencies: [docs/upgrade-checklist.md](docs/upgrade-checklist.md).

## License

[MIT](LICENSE)
