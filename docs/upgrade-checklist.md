# Upgrade checklist

Dependabot opens update PRs weekly (npm) and monthly (GitHub Actions). GitHub Actions is disabled for the repository, so check out an update PR and run `npm run check`, `npm run build` and `npm run test:e2e` locally before merging it; minor and patch updates need nothing more. The upgrades below need a person.

## Electron (about every 6 months)

Electron ships a new major version about every 8 weeks, and only the latest three get security fixes. Upgrade at least every 6 months.

1. Read the "Breaking changes" page for every major version you skip: <https://www.electronjs.org/docs/latest/breaking-changes>.
2. Update `electron`, `electron-builder` and `electron-vite` together (Dependabot groups them).
3. Match `@types/node` to the Node.js version inside the new Electron:
   ```sh
   ELECTRON_RUN_AS_NODE=1 npx electron -p process.versions.node
   ```
4. Run `npm run check`, `npm run build` and `npm run test:e2e`.
5. Build and smoke-test both installers (README, "Testing and releases"). Install the Windows and Linux builds and click through the app once.

## TypeScript 7

TypeScript is held at 6.0 because typescript-eslint supports only TypeScript versions below 6.1. Check typescript-eslint's `typescript` peer dependency range (`npm view typescript-eslint peerDependencies`). Once it includes 7, remove the `typescript` entry from `ignore` in `.github/dependabot.yml` and upgrade.

## @types/node

`@types/node` majors are ignored by Dependabot because they must follow Electron's Node.js version (see the Electron steps above), not the latest Node.js.

## AG Grid (about once a year)

Read AG Grid's upgrade guide for the new major version. AG Grid is used only in `src/renderer/table/`, so changes stay in that folder.

## SheetJS (when the export feature exists)

SheetJS is installed from `cdn.sheetjs.com`, not the npm registry, so Dependabot doesn't see it. Check <https://cdn.sheetjs.com/> for new versions each time you upgrade Electron. It writes CSV exports and reads exported files back in tests; formatted xlsx and ods files are written by `src/main/export/spreadsheet.ts` (zipped with fflate, which Dependabot updates). After changing that file, open an export in Excel and in LibreOffice.
