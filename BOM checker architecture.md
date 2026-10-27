# EEZ BOM checker: architecture proposal

Status: proposal, 2026-10-26
Based on: `BOM checker project scope.md`, the clarifications in section 2, and research into the DigiKey, Mouser, TME and KiCad 10 formats (October 2026).

---

## 1. Summary

| Area | Decision |
|---|---|
| Platform | Electron + TypeScript, React UI. Windows x64 and Linux x64 (Ubuntu 22.04+ / Mint 21+) builds |
| Process split | All file access, secrets and supplier API calls run in the Electron **main process**. The UI (renderer) sees an API key only when the user shows or copies it in supplier settings |
| Suppliers | Built-in plugins behind one interface: **DigiKey** (Product Information API v4), **Mouser** (Search API v1), **TME** (API v2). Nothing to install separately |
| Storage | One BOM = one project file (`.eezbom`, JSON). App settings and the encrypted credential vault live in the user's app-data folder. No database |
| Calculated columns | Order Qty, Unit price, Total price, Availability and Best price are **calculated, not stored**, so changing Qty updates them instantly without collecting again |
| Security | Credentials encrypted with AES-256-GCM using a key derived from the user's password (scrypt). Unlocked once per session |
| Currency | Every supplier is asked for EUR. The currency of each response is checked; prices in any other currency are flagged, not converted |
| KiCad | Built-in KiCad 10 schematic parser with variant selection. No KiCad installation needed |
| Export | `.xlsx`, `.ods`, `.csv` through one library (SheetJS), with saved column and row filters |
| Maintainability | Mainstream libraries and as few of them as possible. Each replaceable library sits behind one module. Supplier and KiCad format changes stay inside one folder each, with recorded-response tests. CI and automated dependency updates from day one |

---

## 2. Clarifications to the scope

These were agreed after the scope document was written:

1. Two quantity columns per supplier: `<S>_MOQ` is the supplier's minimum order quantity. `<S>_Order Qty` is the larger of the BOM Qty and the MOQ, rounded up to the supplier's order multiple.
2. All prices are compared in **EUR**, and every supplier is asked to return EUR. v1 has no exchange-rate setting, unless the live test shows that a supplier can't return the user's own prices in EUR (5.5).
3. Unit price is the **price-break tier for the order quantity**, not the single-unit price.
4. Best price is ranked by **total price** (Order Qty × unit price, in EUR), only among suppliers that have enough stock.
5. DigiKey uses Product Information **API v4**.
6. Supplier integrations are internal plugins **compiled into the app**.
7. The settings password is never stored. The key that encrypts credentials is derived from it with a slow key-derivation function.
8. Cells containing alternatives (`A or B`) are **flagged** for the user to fix and skipped during collection.
9. Credentials are unlocked **once per session**: the app asks for the password on the first Collect.
10. The app **must** use the **user's own account prices** from every supplier. For DigiKey this may require a one-time browser sign-in (7.1).
11. Direct **KiCad 10 project import** with variant selection is in the first version.

---

## 3. Technology stack

The app will be maintained for years, so every choice favours three things:
- mainstream, actively maintained projects with stable APIs;
- as few dependencies as possible;
- no native modules, which would need rebuilding for each platform and Electron version.

Any third-party library that might need replacing is used from **one module only**, so replacing it touches one folder.

| Concern | Choice | Why it suits long-term maintenance |
|---|---|---|
| Shell | Electron | Required. A new major version ships about every 8 weeks and only the latest 3 get security fixes, so plan an Electron upgrade about every 6 months (3.2) |
| Language | TypeScript (strict) everywhere | When a supplier API model or the project format changes, the compiler points to every place affected. Main and UI share the same types. Held at 6.0 until typescript-eslint supports TypeScript 7 |
| UI | React (current major) + Zustand | React is the most widely known UI library, so it's the easiest to find maintainers for. Zustand is tiny with a stable API |
| Build | Vite, via electron-vite | Vite is mainstream. electron-vite is only a thin configuration layer over it; if it were ever abandoned, replacing it means rewriting config, not code |
| Table | AG Grid Community (MIT) | Editing, column groups, pinning, sorting/filtering and cell styling are built in, so there's far less of our own table code to maintain than with a headless library. It releases about one major version a year, with migration guides. Used only in `renderer/table/` |
| CSV | PapaParse | Mature, stable, no dependencies |
| Export | SheetJS Community Edition | The only maintained library that writes xlsx, ods and csv. **Caveat:** it's distributed from `cdn.sheetjs.com`, not the npm registry, so update bots don't see it and updating it is a manual step in the upgrade checklist. It doesn't write cell colours (see 11). Used only in `main/export/` |
| Crypto | Node built-in `crypto` (scrypt, AES-256-GCM) | No dependency at all; updated along with Electron |
| Validation | zod | Widely used. The same schemas validate project files, settings and IPC messages, and drive file-format migrations |
| Logging | electron-log | Writes a log file in app data that users can send when something goes wrong |
| Tests | Vitest, plus a Playwright smoke test of the packaged app | Vitest uses the same config as Vite. Playwright can launch and drive the Electron app |
| Code style | ESLint + Prettier | Keeps the code consistent no matter who maintains it |
| Packaging | electron-builder | The most widely used Electron packager. Windows NSIS installer (per-user, no admin rights). Linux AppImage + `.deb` |

### 3.1 What is expected to change, and where it's contained

| Change | Recent example | How the design contains it |
|---|---|---|
| Supplier API versions | TME v1 → v2 (2026); DigiKey v3 → v4; DigiKey `Customer-Id` header → `Account-Id` (Nov 2025) | Each supplier is one folder: API client, mapping to `SupplierOffer`, recorded responses for tests. Recorded responses catch breaking changes in tests, and **Test connection** in Settings helps diagnose problems on users' machines |
| KiCad file format | KiCad 11 nightlies already add new variant tokens | The parser checks the file version. Each supported KiCad version has its own golden-test project |
| Project and settings files | New columns, new suppliers | `schemaVersion` plus one migration function per version, tested against old sample files |
| Electron / Node | Security releases | Upgrade checklist: Electron major about every 6 months, then tests and a smoke test on both operating systems |
| New supplier | e.g. LCSC | "Adding a supplier" guide: implement the interface in a new folder and register it |

### 3.2 Maintenance practices (set up in milestone 1)

- **Updates:** the lockfile is committed. Dependabot opens dependency-update PRs.
- **CI:** every PR runs lint, type checks, tests and both platform builds.
- **Documentation** in `docs/`: developer setup, this architecture document, "Adding a supplier", the upgrade checklist (Electron, SheetJS) and a CHANGELOG.
- **New dependencies** need a stated reason in the PR. Node, Electron and browser APIs come first.
- **Releases** are tagged in git. CI attaches the Windows and Linux installers to a GitHub Release.

---

## 4. Process architecture

```
┌──────────────────────── Renderer (React UI) ────────────────────────┐
│ BOM table · import dialogs · collect dialog · summary · settings    │
│ Calculations (pricing, best price) run here, from shared/           │
└───────────────▲─────────────────────────────────────────────────────┘
                │ typed IPC via preload (contextBridge), no Node access
┌───────────────┴──────────────── Main process ───────────────────────┐
│ ProjectService     open/save .eezbom, CSV import, KiCad import      │
│ Vault              password, encrypted credentials                  │
│ CollectionEngine   job queue, rate limiters, retries, progress      │
│ SupplierRegistry   DigiKey · Mouser · TME plugins                   │
│ ExportService      xlsx / ods / csv                                 │
└─────────────────────────────────────────────────────────────────────┘
shared/  data model types, pricing & best-price functions, lifecycle mapping
```

- **API calls run in main.** That keeps secrets out of the UI, and avoids CORS: DigiKey sends no CORS headers.
- **Electron hardening:**
  - `contextIsolation` and `sandbox` on, `nodeIntegration` off, strict Content Security Policy.
  - Navigation and new windows are blocked, except the DigiKey sign-in window (7.1).
  - Outgoing requests are limited to the supplier API hosts.
- **Calculations live in `shared/` as pure functions.** The table, the summary and the export all use the same code.

### Source layout

```
src/
  main/
    index.ts                 app lifecycle, windows, menu
    ipc/                     IPC handlers (one file per service)
    project/                 load/save, csv-import.ts, kicad/ (sexpr.ts, project.ts, bom.ts)
    vault/                   vault.ts, kdf.ts
    collection/              engine.ts, rate-limiter.ts, usage-store.ts
    export/                  export.ts, filters.ts
    suppliers/
      types.ts               SupplierPlugin interface
      registry.ts
      digikey/  mouser/  tme/    (client.ts, map.ts, fixtures/)
  preload/index.ts           exposes the typed API
  renderer/
    App.tsx  table/  dialogs/  settings/
    suppliers/               per-supplier settings panels (e.g. DigiKey sign-in)
  shared/
    model.ts  pricing.ts  best-price.ts  lifecycle.ts  currency.ts
```

---

## 5. Data model

### 5.1 Project file (`.eezbom`)

The project file is a versioned JSON document. 1,000 rows with three suppliers' results come to well under a few MB, and the file can be committed to git next to the KiCad project.

```ts
interface Project {
  schemaVersion: 4;                     // 2 added `collected`, 3 `buildQuantity`, 4 `source.kicadValues`
  source: { kind: 'manual' | 'csv' | 'kicad'; path?: string; variant?: string; importedAt?: string };
  suppliers: SupplierId[];              // suppliers that have a part-number column in this BOM
  customColumns: ColumnDef[];           // user-defined columns, plus unmapped imported ones (e.g. LCSC)
  rows: BomRow[];
  buildQuantity: number;                // units to build; every Qty is multiplied by it (1 by default)
  collected: {                         // not part of the undo history
    results: Partial<Record<SupplierId, Record<string, LookupResult>>>;  // by part number (trimmed, upper case)
    runs: Partial<Record<SupplierId, CollectionRun>>;  // last run per supplier; used for "Continue"
  };
}

interface BomRow {
  id: string;                           // stable UUID; survives sorting and re-import
  reference: string;                    // "C1,C2,C3"
  value: string;
  qty: number;
  footprint: string;
  custom: Record<string, string>;
  partNumbers: Partial<Record<SupplierId, string>>;  // trimmed; "" or "-" means not defined
}

type LookupResult =
  | { status: 'found'; fetchedAt: string; runId: string; offer: SupplierOffer; matchedBy: 'supplierPN' | 'mpn' }
  | { status: 'notFound'; fetchedAt: string; runId: string }
  | { status: 'ambiguous'; fetchedAt: string; runId: string; candidates: SupplierOffer[] }
  | { status: 'error'; fetchedAt: string; runId: string; message: string };

interface SupplierOffer {
  supplierPartNumber: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  description: string;
  packaging?: string;                   // e.g. "Cut Tape (CT)"
  stockQty: number;
  moq: number;
  orderMultiple: number;                // 1 when the supplier doesn't report one
  priceBreaks: { qty: number; unitPrice: number }[];  // in `currency`, ascending by qty
  priceKind: 'account' | 'list';        // whether the user's account pricing was applied
  currency: string;                     // ISO 4217, as reported by the supplier
  lifecycle: Lifecycle | null;          // normalised (5.4)
  lifecycleRaw: string | null;          // supplier's own text, shown in a tooltip
  rohs: string | null;
  productUrl?: string;
  datasheetUrl?: string;
}
```

- **`Row` isn't stored.** It's the display index (1…n), renumbered when rows are sorted or deleted. On CSV import the `#` column maps to it and is otherwise ignored.
- **Results are stored per supplier part number**, not per row. A part number used in several rows is looked up once, editing a cell shows whatever was collected for its new value, and undoing an edit never loses collected data.
- **Supplier offers are stored exactly as returned**, in the original currency, plus the normalised fields above.
- **DigiKey's API terms forbid building a parts database** from API data. Results live only inside the BOM they were collected for, and the app keeps no shared cache.

### 5.2 Columns

| Group | Columns |
|---|---|
| Base (mandatory) | `Row`, `Reference`, `Value`, `Qty`, `Footprint` |
| Part numbers (editable) | `DigiKey`, `Mouser`, `TME`: same names as the KiCad fields and the example CSV |
| Per supplier (read-only, calculated from the stored offer) | `<S>_Manufacturer`, `<S>_Stock Qty`, `<S>_MOQ`, `<S>_Order Qty`, `<S>_Unit price`, `<S>_Total price`, `<S>_Availability`, `<S>_Status`, `<S>_RoHS` |
| Best (shown when 2+ suppliers have results) | `Best_Supplier`, `Best_Order Qty`, `Best_Unit price`, `Best_Total price` |
| Custom | Any user-defined columns (text or number) |

`<S>` is the supplier display name: `DigiKey`, `Mouser` or `TME`. All prices are in EUR (5.5).

### 5.3 Pricing rules (`shared/pricing.ts`)

For one row and one supplier:

1. **Order Qty** = `ceil(max(Qty × build quantity, MOQ) / multiple) × multiple`. DigiKey reports no order multiple, so its multiple is 1.
2. **Unit price** = the price of the largest break whose quantity ≤ Order Qty.
   - The account price list is used when the supplier returned one that isn't empty. Otherwise the list price is used.
   - If Order Qty is below the first break, the first break's price is used and the cell is flagged.
3. **Total price** = Unit price × Order Qty, in EUR (5.5). Full precision is kept internally. Unit price is displayed with 4 decimals (passives often cost under €0.01), totals with 2.
4. **Availability**:
   - `In stock` when Stock Qty ≥ Order Qty.
   - `Partial (n)` when 0 < Stock Qty < Order Qty.
   - `Out of stock` when Stock Qty is 0.
   - `Not orderable` when the supplier marks the part that way.

**Best price (`shared/best-price.ts`).**
- **Candidates:** suppliers whose result is `found`, whose Availability is `In stock` and whose prices are in EUR.
- **Choice:** the candidate with the lowest Total price. Ties go to a supplier order set in Settings.
- **No candidate:** the Best columns stay blank and the row is marked "no supplier can deliver the full quantity".

The scope's example works out as follows. Mouser is €1 × 20 but has only 10 in stock, so it isn't a candidate. DigiKey at €1.20 × 20 with enough stock wins.

**Out of scope for v1:** buying *more* than needed to reach a cheaper price break. DigiKey offers a "better value" quantity endpoint that could support this later.

### 5.4 Lifecycle status

Each supplier's status is mapped to one normalised value. The supplier's own text is kept for the tooltip.

| Normalised | DigiKey `ProductStatus` | Mouser `LifecycleStatus` | TME `product_status[]` flags |
|---|---|---|---|
| Active | `Active` | *null* (Mouser omits it for active parts) | no lifecycle-relevant flag |
| New | `Preliminary` | `New Product` | `NEW` |
| NRND | `Not For New Designs` | `Not Recommended for New Designs` | n/a |
| Last time buy / EOL | `Last Time Buy` | `End of Life` | `AVAILABLE_WHILE_STOCKS_LAST`, `MOQ_VALID_WHILE_STOCKS_LAST` |
| Special order | n/a | `Factory Special Order` | `ONLY_FOR_SPECIAL_ORDER` |
| Obsolete / Discontinued | `Obsolete`, `Discontinued at Digi-Key` | `Obsolete`, `IsDiscontinued` = Yes | n/a |
| Not orderable | n/a | n/a | `NOT_IN_OFFER`, `CANNOT_BE_ORDERED`, `PRODUCT_BLOCKED`, `INVALID` |

- **Colours:** amber for New, NRND, LTB/EOL and Special order. Red for Obsolete/Discontinued and Not orderable. Active is uncoloured, and blank means the supplier didn't say.
- **DigiKey** status text follows the request language, so requests always use `en` and the mapping prefers the numeric `ProductStatus.Id`.
- **Unconfirmed:** that Mouser's *null* means Active, and the TME "no flag = Active" rule. Both need a check with live keys (section 13).

**RoHS** is shown as the supplier's text, with case variants normalised ("RoHS3 Compliant", "ROHS3 Compliant" → one value). **TME does not return RoHS** in either API version, so `TME_RoHS` stays blank.

### 5.5 Currency

All three suppliers can return EUR, so v1 has **no exchange-rate setting**:

| Supplier | How EUR is obtained |
|---|---|
| DigiKey | `X-DIGIKEY-Locale-Currency: EUR` together with a eurozone `X-DIGIKEY-Locale-Site`. Croatia (`HR`) isn't an accepted site, so the default is a neighbouring eurozone site, `SI`; it can be changed in Settings. On the `US` site DigiKey always answers in USD |
| Mouser | There's no request parameter: Mouser answers in the currency of the account that owns the API key. That is expected to be EUR for a Croatian account |
| TME | `currency=EUR` with `country=HR` |

- **The currency of every response is still checked:** DigiKey `SearchLocaleUsed.Currency`, Mouser `PriceBreaks[].Currency`, TME `prices.currency`. Non-ISO codes are mapped to ISO; Mouser sends `RMB` for `CNY`.
- **Prices that come back in another currency** are marked "not in EUR" and left out of best price, and a banner explains why. Nothing is silently mixed or converted.
- **Fallback:** the live test (section 13) might show that DigiKey returns the user's own prices only in USD, e.g. because the account's pricing agreement is tied to the US site. In that case a manual rate is added: `1 USD = x EUR`, saved with the date it was set, applied at calculation time, and shown in the summary and export. The addition is small and self-contained: `shared/currency.ts` plus one field in Settings → General.

---

## 6. Supplier plugins

### 6.1 Interface

```ts
interface SupplierPlugin {
  id: SupplierId;                         // 'digikey' | 'mouser' | 'tme'
  name: string;                           // display name and column prefix
  headerHints: RegExp[];                  // auto-detect the part-number column on import
  configFields: ConfigField[];            // drives the generic settings form; `secret: true` fields go to the vault
  rateLimits: RateLimitDefaults;          // perSecond, perMinute, perDay, maxBatchSize: user-editable
  normalizePartNumber(raw: string): string;
  testConnection(ctx: SupplierContext): Promise<TestResult>;
  lookup(partNumbers: string[], ctx: SupplierContext): Promise<Map<string, LookupResult>>;
}

interface SupplierContext {
  config: Record<string, string>;         // non-secret settings
  secrets: Record<string, string>;        // from the unlocked vault (main process only)
  http: RateLimitedHttp;                  // fetch wrapper: limiter, retries, secret-redacting logs
  signal: AbortSignal;
}
```

- **Two halves per plugin.** The `main` half (above) handles lookups. An optional `renderer` half supplies a custom settings panel, e.g. DigiKey's "Sign in" button.
- **Registration is static.** Plugins are registered in `registry.ts` at build time; there is no dynamic loading. Adding a supplier means adding a folder and a registry entry.
- **The plugin owns batching.** The engine hands it a batch no larger than `maxBatchSize` and gets back a result for every input.

### 6.2 Matching rules (all suppliers)

1. **Normalise:** trim, and treat empty and `-` as not defined. TME symbols are also upper-cased.
2. **Exact match first:** a result counts only if the supplier part number equals the requested one, ignoring case.
3. **MPN fallback.** The example BOM has manufacturer part numbers in some supplier columns, e.g. DigiKey `RC0805FR-071KL` and Mouser `GMR100HJBFA10L0`. If there's no exact match, the plugin tries the value as a manufacturer part number:
   - one candidate is accepted and shown as "matched by MPN";
   - several (different packaging or manufacturers) become `ambiguous`. The user picks one from a list in the cell, and the choice is written back as the real supplier part number.
4. **Packaging must match.** DigiKey returns every packaging variation for a product, and Mouser lists reels as separate part numbers. The offer always comes from the exact packaging requested, because MOQ and prices differ per packaging.

### 6.3 Per-supplier details

| | DigiKey | Mouser | TME |
|---|---|---|---|
| API | Product Information v4: `GET /products/v4/search/{pn}/productdetails` | Search API v1: `POST /api/v1/search/partnumber` (v2 adds no part-number search) | API v2 (REST GET). v1 is retired: keys created after 14 May 2026 can't use it and it ends 30 June 2027 |
| Auth | OAuth2 client credentials; token valid 10 min, no refresh. Optional browser sign-in (7.1) | `apiKey` query parameter. Needs the **Search** key, not the Order key | OAuth2 client credentials with a private key (token + secret); token valid 5 min, refreshable |
| Parts per call | 1 | 10 (`a\|b\|c`) | 50 (needs `/products` + `/products/data`; `/products/files` for datasheets only on request) |
| Calls for a 125-row BOM | ~125 | ~13 | ~6 |
| Default limits | 120/min, 1,000/day, plus an unpublished per-second limit (breaching it gives a 10-minute 403 suspension) → run at 1 request per 0.6 s | 30/min, 1,000/day | Not published for v2; default 2 requests/s (v1's limit for price/stock calls) |
| Throttle signal | 429 + `Retry-After`; `X-RateLimit-Remaining` on every response | **403** with `Errors[].Code = TooManyRequests` (per minute and per day); no headers | 429 + `Retry-After` (v1); v2 unknown, so 403 and 429 are both treated as throttling |
| Not found | HTTP 404 | Missing from `Parts` | Missing from `elements` |
| Currency | `X-DIGIKEY-Locale-Currency: EUR` with a eurozone `X-DIGIKEY-Locale-Site` (default `SI`) | Fixed by the account's country; prices are localised strings (`"6,85 €"`) | `currency=EUR`, `country=HR` |
| Account pricing | `MyPricing[]` when `X-DIGIKEY-Account-Id` is sent (to verify; see 7.1) | Presumably follows the key's account (to verify) | Default with a private key; each break has a `special` flag |
| MOQ / multiple | Variation `MinimumOrderQuantity` / none | `Min` / `Mult` | `minimal_amount` / `multiples` |
| Stock | Variation `QuantityAvailableforPackageType` | `AvailabilityInStock` (the free-text `Availability` is localised) | `stock_quantity` |
| Status / RoHS | `ProductStatus` / `Classifications.RohsStatus` | `LifecycleStatus` / `ROHSStatus` | `product_status[]` / none |

**DigiKey notes**
- **Pick the variation.** The plugin uses the `ProductVariations[]` entry whose `DigiKeyProductNumber` equals the requested number. MOQ, stock and prices are taken from that variation, not from the product as a whole.
- **Digi-Reel numbers** need an extra `/digireelpricing` call because of the reeling fee.
- **Encoding:** part numbers are URL-encoded before sending; some contain `/`.
- **Locale:** `SearchLocaleUsed` is always read from the response. DigiKey silently replaces invalid locale combinations, e.g. EUR on the US site falls back to USD.
- **Quota:** the 1,000/day limit belongs to the user's own DigiKey app. The engine records `X-RateLimit-Remaining` from each response.
- **Two error formats:** API calls return RFC 7807-style errors, but the token endpoint uses an older format. Both are handled.

**Mouser notes**
- **Check `Errors` before the HTTP status.** An invalid key returns **HTTP 200** with an `Errors` entry.
- **Prices are parsed independently of locale.** All characters except digits and separators are stripped, and the last separator is the decimal point.
- **The API key is in the URL**, so it is removed from all logs.
- **Results are matched back by `MouserPartNumber`.** A batch doesn't say which input each result answers. Results whose part number is `N/A` are dropped.

**TME notes**
- **One malformed symbol can fail a whole batch.** The API answers `E_INPUT_PARAMS_VALIDATION_ERROR` for all 50. The plugin then splits the batch in halves until it finds the bad symbol, which is reported as an error.
- **Net vs gross:** `prices.type` says whether prices are NET or GROSS, which depends on the account's settings. The app warns if prices come back GROSS.
- **Links:** product page links are built from the symbol. Datasheet links come from `/products/files` (document type `DTE`) and are opened in the browser, never downloaded by the app.

**LCSC notes** (from LCSC's OpenAPI guide; not yet tried with a real key)
- **API:** the "agent" API at `https://ips.lcsc.com` (sandbox: `https://sandbox-api.lcsc.com`). `GET /rest/api/agent/product/v1/productdetails` for LCSC numbers (`C2040`); `GET …/keywordsearch` for manufacturer part numbers, matched with the rules in 6.2. One part per call.
- **Auth:** headers `key`, `nonce`, `timestamp` (seconds) and `signature` = SHA-256 of `key=…&nonce=…&secret=…&timestamp=…` followed by the sorted, `URLEncoder`-encoded query. Calls from an IP address not registered for the account get HTTP 401; key, timestamp and signature problems come back as HTTP 200 with business code 4001 or 4003.
- **Access:** free, after LCSC approves an application (lcsc.com/agent/apply); new keys work only in the sandbox at first. Limits: about 60 searches per minute and 1,000 per day; 429 throttles and 430 is the daily limit.
- **Currency:** `currency=EUR`. The guide says it applies only when asking for prices alone, so when a full answer has another currency the plugin asks again with `returnInformation=ProductPricing`.
- **Data:** `standardPricing` breaks (no account prices), `quantityAvailable`, `minimumOrderQuantity` / `incrementQuantity`. Lifecycle is only `isOnSale` (Active / Not orderable); RoHS comes from `productParameters` when present.

---

## 7. Authentication and the credential vault

### 7.1 DigiKey account pricing

DigiKey's documentation suggests that the standard client-credentials login plus the user's **Account ID** header returns `MyPricing`. This could not be confirmed without a live key. Plan:

1. **v1 ships with client credentials + Account ID.** The first live test checks whether `MyPricing` comes back.
2. **If it doesn't, browser sign-in (3-legged OAuth) is built as part of v1**, because the user's own prices are required.
   - Settings gets a **Sign in to DigiKey** button. It opens a window with DigiKey's login page.
   - The redirect to `https://localhost:8139/digikey_callback` (registered in the user's DigiKey app) is **intercepted inside Electron**, so no local web server is needed.
   - The app exchanges the returned code for tokens. Access tokens last 30 min.
   - The refresh token is **replaced on every use** and expires after about 90 days. The app saves the new one atomically after each refresh and never runs two refreshes at once.
   - When the refresh token expires, Settings asks the user to sign in again.

### 7.2 Vault design

Files in the app-data folder (`%APPDATA%\EEZ BOM checker\` on Windows, `~/.config/EEZ BOM checker/` on Linux):

| File | Contents | Protected |
|---|---|---|
| `settings.json` | Locale and rate-limit settings, supplier order, export presets | No (not sensitive) |
| `recent-documents.json` | Up to 10 recently opened BOMs and imported files (start page, File → Open Recent) | No |
| `window-state.json` | Main window size, position and maximized state | No |
| `vault.json` | API keys, secrets, Account ID, DigiKey refresh token | Encrypted |
| `usage.json` | Calls made today per supplier, for daily quotas | No |

```jsonc
// vault.json
{
  "version": 1,
  "kdf": { "alg": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<base64>" },
  "wrappedKey": { "iv": "…", "ct": "…", "tag": "…" },   // data key, encrypted with the password key
  "secrets":    { "iv": "…", "ct": "…", "tag": "…" }    // all credentials, encrypted with the data key
}
```

- **Password key:** `scrypt(password, salt)` produces a 256-bit password key. A random 256-bit data key encrypts the credentials (AES-256-GCM), and the password key encrypts the data key.
- **Password check:** a wrong password fails the GCM authentication of `wrappedKey`. This acts as the salted, slow password verifier, so no separate hash is stored. One check costs about 0.3 s, which makes guessing slow.
- **Changing the password** re-encrypts only the data key, with a new salt. Writes are atomic (temp file + rename).
- **Once-per-session unlock.** After the password is entered, the data key stays in main-process memory until the app quits or the user picks **Lock**. The first Collect of a session asks for the password.
- **Settings access.** Opening the **Suppliers** section of Settings asks for the password every time, even when the vault is unlocked, so the section stays protected while the app is left open. **General** (supplier order for ties, export presets and similar) needs no password.
- **The UI receives credential values only on request.** It learns "set / not set"; a value is sent only when the user clicks Show or Copy next to it in supplier settings, which needs an open settings session (the password). Copying goes through main's clipboard, because the renderer's permission requests are all denied.
- **First run:** the user creates the password. **Forgotten password:** "Reset vault" deletes all stored credentials; there is no recovery by design.
- **Limits:** this protects against copying the files and casual access. It cannot protect against malware running as the same user while the vault is unlocked.

---

## 8. Collection engine

**Starting a run**
- **Collect** opens a dialog with one checkbox per supplier in the BOM, plus "All". Selected suppliers run **in parallel**, since each has its own limits. Within one supplier, batches run **one after another**.
- **Work list:** rows whose part number for that supplier is defined, isn't flagged (`A or B`), and, when continuing, has no result from the current run.
- **Duplicates:** a part number that appears in several rows is looked up once.
- **Quota check:** before starting, the engine compares the calls needed with what's left of today's quota. It warns if the run won't finish today.

**Rate limiting and retries**
- **Rate limiter:** each supplier gets a limiter with per-second, per-minute and per-day windows (defaults in 6.3, editable in Settings).
- **Daily usage** is saved in `usage.json`, so the quota is respected across projects and restarts. Counters reset at the time DigiKey reports in its headers; for the others, midnight UTC is assumed.
- **Retries:**

| Situation | Response |
|---|---|
| Throttled | Wait `Retry-After` (or 1 s, 2 s, 4 s), up to 3 times |
| Network error or 5xx | Back off, up to 3 times |
| 401 | Get a new token once |
| Daily limit reached | Stop the supplier's job as *interrupted: daily limit reached* |

**Progress and interruption**
- **Progress** is reported to the UI about 10 times a second: supplier, done/total, current reference and part number, and found / not found / errors so far. The dialog shows one progress bar per supplier and a **Cancel** button.
- **Interruption** can be a cancel, a daily limit, a network failure or a crash. Results are written into the project after **every batch**, and a recovery copy goes to app data, so at most one batch is lost. A crash recovery copy is offered on the next start.
- **Continue:** when a supplier's last run has rows left, a **Continue** button appears. **Collect again** re-checks everything, e.g. to refresh stock.

**Summary** shown at the end of a run, per supplier and in total:
- duration;
- requested / found / not found / ambiguous / errors;
- available (In stock) / not available;
- API calls used and remaining today.

**Looking up Values** (optional, GitHub #10)
- **Work list:** with the option on, rows whose cell for the supplier is empty (not "-") add their Value to the work list when it looks like a manufacturer part number (`valueAsPartNumber`: letters and digits, no spaces). Generic passive values (100n, 4u7, 10k, 0R010) are skipped; SI prefixes are case-sensitive, so 1N4148 isn't read as "1n". The plugins already resolve manufacturer part numbers (6.2), so nothing supplier-specific is added.
- **Filling in:** when the run ends, one match puts the supplier's part number in the cell (its result is copied under that number); several matches put the Value in the cell, so the user chooses the item; no match leaves the cell empty. This is one undo step.
- **Not done:** turning a generic value plus footprint into one part. The APIs can only return candidates for that, and choosing one needs defaults for dielectric, voltage, tolerance and packaging.

---

## 9. Creating and importing a BOM

### 9.0 From scratch

A BOM doesn't have to come from a file. This is also the quickest way to test supplier lookups with a few parts.

- **New** creates an empty table with the mandatory columns (`Row`, `Reference`, `Value`, `Qty`, `Footprint`).
- **Add row** appends a row and starts editing its Reference. Cells are typed in directly; Tab moves to the next cell. Selected rows can be deleted.
- **Columns…** adds or removes part-number columns for DigiKey, Mouser and TME, and adds, renames or deletes custom text and number columns (5.2). A supplier's Collect option appears once its column has at least one part number.
- Every edit can be undone (Ctrl+Z) and redone (Ctrl+Y).
- The same rules apply as for imported data: values are trimmed, `-` or empty means "no part number", and `A or B` is flagged.

### 9.1 CSV

- **Parsing:** PapaParse detects the delimiter (`,`, `;` or tab). Files are read as UTF-8, with or without BOM; another encoding can be chosen in the dialog.
- **Mapping dialog:** each column maps to `Row` (ignored), `Reference`, `Value`, `Qty`, `Footprint`, *\<Supplier\> part number*, *Custom column* or *Ignore*.
  - The app suggests a mapping from the headers. `#` maps to Row, and `DigiKey` / `Digi-Key`, `Mouser`, `TME` map to the suppliers.
  - The last mapping is remembered per header set.
  - The example's `LCSC` column becomes a custom column, since there is no LCSC plugin.
- **Cell values:**
  - Every value is trimmed. The example BOM has many part numbers with trailing spaces.
  - If `Qty` is missing, it is taken from the number of references.
- **Flagging:** a supplier cell containing ` or ` (any case) is shown in red with "multiple alternatives, choose one" and is skipped during collection. Row 115 of the example has this in every supplier column.

### 9.2 KiCad 10 project

**Opening a project and choosing a variant**
1. Read the `.kicad_pro` JSON. `schematic.top_level_sheets[].filename` gives the root schematic(s); if missing, `<project>.kicad_sch` is used.
2. **Variants:** the list is "Default" plus `schematic.variants[].name`, plus any variant name found inside the schematics. If there is more than one, the user picks one.
3. **Version check:** every sheet must have `(version 20260306)` (KiCad 10.0.x). Older files are rejected with "requires KiCad 10". Newer ones (KiCad 11 nightlies) load with a warning.

**Walking the schematics**
- A small hand-written S-expression parser reads each sheet file once.
- The hierarchy walk builds sheet paths (`/<root uuid>/<sheet uuid>/…`). Each file is visited once per sheet instance, and loops are detected.
- For each placed symbol, the reference and unit come from the `instances` entry whose path equals the current sheet path. Entries left over from other projects are ignored; the example's root sheet has some from `MCU r3B6`.

**Deciding what goes in the BOM**
- **Flags for the chosen variant:**
  - The variant's override is used if present, otherwise the symbol's default (`(dnp …)`, `(in_bom …)`).
  - The flags are combined with those of every parent sheet, so a DNP sheet excludes everything on it.
  - Variant `(field …)` overrides replace Value, Footprint and supplier fields.
- **Excluded:**
  - references starting with `#`, i.e. power symbols (these have `in_bom yes` in the files, so the flag can't be relied on);
  - DNP parts;
  - parts excluded from the BOM.
  - `on_board no` does not exclude a part.
- **Multi-unit parts** are merged by reference and included if any unit passes. A warning is shown when units disagree: IC17 in *Basic* has inconsistent flags across its units.

**Building the table**
- **Grouping:** rows are grouped like the Symbol Fields Table, by the project's group-by fields (`bom_settings`; Value + Footprint in the example). A group is **split** if its supplier part numbers differ, so no part number is lost. References are sorted naturally, and Qty is the number of unique references.
- **Columns:** supplier fields are detected by name. Other non-empty fields go through the same mapping dialog as CSV import. Always-empty fields, such as `MF`, `MP` and `PN` in the example, are hidden.
- **Golden test:** the DCP405plus project at commit `4d7d253` must give Default = 366 parts / 124 rows matching `BOM example.csv`, and Basic = 322 parts / 119 rows.
  - The CSV has one extra row, `M1`, which isn't in the current schematics, so the CSV was probably exported from a slightly different revision.
- **Re-import:** importing again (KiCad or CSV) keeps the supplier data already collected. Results are stored per part number, so only part numbers that are new need collecting ("Only part numbers without data").
- **Warnings:** a newer file format, symbols without a reference for their sheet, unannotated or duplicate references, and multi-unit parts whose units disagree in a way that changes whether the part is included.

The `kicad-cli sch export bom --variant` alternative was rejected. It requires KiCad 10.0.6+ installed, variant export had bugs until recently, and its output would still need parsing.

### 9.3 Syncing from the KiCad project (GitHub #30)

- **Reading:** the project is read as on import (main's `loadKicadProject`), and the variant's table is mapped to BOM columns with the import's own header rules (`shared/kicad-sync.ts`): Value, Footprint, supplier part numbers, and custom columns of the same name.
- **Three-way:** `source.kicadValues` (file format 4) keeps KiCad's values at the last import or sync, per reference and column. A difference where the BOM still has that value is a KiCad change (offered, ticked); one where KiCad still has it is a BOM change (kept, not offered); anything else is offered unticked. Without these values (older files), every difference is offered unticked except added parts.
- **Applying** (one undo step): accepted values are set per reference; a row whose references end up with different values is split, keeping its other cells; removed references leave their row; added parts join the one row of their KiCad row-mates if its values match, or get a new row at the end. Rows whose references KiCad never had are left alone. Then KiCad's current values become `kicadValues`.
- **Update KiCad…** records the values it wrote in `kicadValues`, so the next sync doesn't see them as changes.

### 9.4 Writing back to the KiCad project (GitHub #11)

- **Matching:** the project is read again (`readKicadDesign`) and grouped for the BOM's variant, exactly as on import. A BOM row is used only when its references, ignoring order and spaces, are exactly those of one KiCad row. Everything else is reported with a reason (not in the project, DNP/excluded in the variant, grouped differently now, or a reference in two rows).
- **Fields:** a supplier column goes to the field named like the supplier (or the single field its header pattern matches); it's added as a hidden copy of the symbol's Footprint field when missing. A custom column goes to the field of the same name, only if it exists. Values are compared trimmed, so KiCad's text isn't touched where only spaces differ.
- **Targets:** every unit of every reference in the row. In a non-default variant, an existing `(variant … (field …))` override is changed; otherwise the symbol's property. Overrides are never added. A symbol on a sheet used several times can belong to two rows; if they want different values, it's left unchanged and reported.
- **Editing** (`kicad/edit.ts`): a second, position-keeping S-expression parser finds the value tokens; only those are replaced, so the rest of the file stays byte for byte as KiCad wrote it. Each changed file is parsed again and every written value checked before anything is saved.
- **Backup:** the `.kicad_pro` and all schematics are copied to `bom-checker-backups/<YYYY-MM-DD_HHMMSS>/` in the project folder, with `backup.json` listing the originals. Files are written atomically; if one fails, those already written are put back. The dialog can restore a backup made in the same session.
- **Open in KiCad:** KiCad's lock files (`~<file>.lck`) trigger a warning, since saving in KiCad would overwrite the update.

---

## 10. Table UI

- **Toolbar:** New · Open · Save · Import CSV · Open KiCad project · **Collect** · **Continue** · Export · Settings · Lock.
- **Columns:**
  - Row, Reference and Value are pinned on the left.
  - Each supplier's columns form a collapsible group: collapsed, it shows the part number, Total price and Availability. The Best group and then custom columns follow.
  - Columns can be shown or hidden, and custom columns added, renamed or deleted.
- **Editing:**
  - Base, part-number and custom cells are editable, and rows can be added or deleted.
  - Changing a part number clears that supplier's result for the row and marks it for collection.
  - Changing Qty recalculates the row instantly.
- **Cell states:** invalid input (red), a status badge on part numbers (found, not found, several matches, error); the several-matches badge opens a list to choose the item. Lifecycle colours (5.4), availability colours, and a highlight when the order quantity is below the first price break.
- **Context menu:** open the product page or datasheet, and re-collect this row.

---

## 11. Export

- **Formats:** `.xlsx`, `.ods`, `.csv` (UTF-8 with BOM, so Excel opens it correctly).
- **Dialog:** pick **columns**, **rows** and **format**. Combinations can be saved as presets.

| Preset | Columns | Rows |
|---|---|---|
| All data | everything | all |
| All Mouser data | Base + Mouser | rows with a Mouser part number |
| Best price from Mouser | Base + Mouser + Best | rows where `Best_Supplier` = Mouser |
| Not available anywhere | Base + all suppliers | rows with no Best supplier |

  "Mouser" in these presets can be any supplier.

- **Typed cells:** numbers and prices are written as numeric cells, not text.
- **Info sheet** (xlsx/ods only): BOM, source file, KiCad variant, export filter, how prices and the best price were chosen, the preferred supplier order, collection dates per supplier, and total prices.
- **No colours:** SheetJS Community Edition can't write cell styles, so status colours don't appear in exported files. If coloured `.xlsx` output is wanted, ExcelJS could be added for xlsx only.

---

## 12. Build, packaging and testing

**Packaging**
- **Windows:** x64 NSIS installer, installed per user without admin rights. Without code signing, SmartScreen warns on first install; a signing certificate can be added later.
- **Linux:** x64 AppImage (runs on Ubuntu and Mint without installing) plus a `.deb`.
- **CI:** GitHub Actions builds Windows on `windows-latest` and Linux on `ubuntu-22.04`. Building against the older glibc lets the Linux build run on Ubuntu 22.04+ and Mint 21+.
- **Native modules:** none, so no rebuilds per platform.
- **Auto-update** is not in v1. electron-updater with GitHub Releases can add it later.

**Tests (Vitest)**
- **Calculations:** pricing (Order Qty, breaks, MOQ/multiple), best price (including the scope's stock example), currency and Mouser price-string parsing, lifecycle mapping.
- **Import:** CSV import using `BOM example.csv`, and the KiCad golden test (9.2).
- **Vault:** wrong password, password change, corrupted file.
- **Rate limiter and retry logic,** with fake timers.
- **Plugins:** each is tested against recorded API responses (with credentials removed) from the first live session.

---

## 13. To verify with live credentials

These points couldn't be settled from documentation and should be the first thing tested once the plugins can make calls. **Test connection** in Settings → Suppliers answers most of them: it shows the currency and whether the prices are the account's own. For the rest, turn on **Write supplier API responses to the log file** (Settings → General) and look at the responses in the log file.

1. **DigiKey:** does client credentials + Account ID return `MyPricing`? If not, build the browser sign-in (7.1).
2. **DigiKey:** with site `SI` and currency EUR, does `MyPricing` come back, and do the prices match what the user actually pays? If the user's own prices come only in USD, add the exchange-rate fallback (5.5).
3. **Mouser:** does the Search key return the account's own prices, in EUR? If not, the only documented route is the Cart API. It reads prices by putting parts into a real cart on the account, which would need a separate decision. Also: does `Exact` apply to each part in a batch, and how do missing parts show up?
4. **Mouser:** does `LifecycleStatus = null` always mean Active?
5. **TME v2:** what are the real rate limits? Do special prices come back in EUR? Are prices NET? Confirm there's no RoHS data.

---

## 14. Suggested milestones

1. **Skeleton:** Electron app, typed IPC, empty table, logging. Lint, tests, Dependabot and CI builds for Windows and Linux. Developer README.
2. **BOM basics:** data model, table, creating a BOM from scratch (9.0), save/load `.eezbom`, then CSV import with mapping.
3. **Security:** vault, password flows, Settings (General + Suppliers).
4. **Collection:** engine with rate limiting, resume and summary; the Mouser plugin first (simplest), then TME, then DigiKey; live verification (section 13).
5. **Calculations:** pricing, currency, best price, status colours, ambiguity picker.
6. **KiCad import** with variants and the golden test.
7. **Export** with filters and presets.
8. **Finish:** installers, user guide.

---

## 15. Status

### Version 0.5.0

Sync KiCad… for changes made in the KiCad project (#30, section 9.3; file format 4), choosing one of several matching items from a list in the table (#15), a Basic data only export (#21), and Value pinned with Row and Reference (#26). Unit tests: 192; end-to-end tests: 14.

### Version 0.4.0

Writing part numbers back into the KiCad project (#11, section 9.4). Unit tests: 185; end-to-end tests: 13.

### Version 0.3.0

LCSC as a fourth supplier (#9), built from LCSC's API guide, and an optional lookup of the Value as a manufacturer part number for rows without one (#10, section 8). Unit tests: 172; end-to-end tests: 12.

### Version 0.2.0

Built from GitHub issues #1–#8: a Total row, Show and Copy for saved credentials, resizable dialogs and a remembered window position, hiding a supplier's columns from the View menu, collection dates per supplier, a build quantity (file format 3), and a start page with recent documents, file drop and File → Close. Unit tests: 159; end-to-end tests: 11.

### Version 0.1.0

All eight milestones are done. Everything below is covered by unit tests (148) and end-to-end tests (10). The end-to-end tests ran against the packaged Windows app and the packaged Linux app (in WSL), using a local fake supplier server.

### Scope requirements

| Scope | Where |
|---|---|
| Electron app for Windows and Linux (Ubuntu / Mint) | NSIS installer; AppImage and `.deb` (12) |
| Table of components; manual entry; CSV import | 9.0, 9.1 |
| Load from a KiCad 10 project, choose the design variant, skip DNP / excluded symbols | 9.2; golden test against KiCad's own export |
| Mandatory columns Row, Reference, Value, Qty, Footprint; custom columns | 5.2 |
| Supplier columns prefixed with the supplier name | 5.2 (table headers show the full name on hover; exports use it as the column name) |
| CSV: choose the part-number columns, trim values | 9.1 |
| API settings per supplier, editable parameters, requests per minute and per day | 6.3, 7.2, 8 |
| Credentials encrypted; settings behind a password that can be changed | 7.2 |
| Supplier integrations as plugins | 6.1 (compiled in) |
| Collect for one, several or all suppliers; progress with the current part; only defined part numbers (empty or `-` skipped) | 8 |
| Summary: duration, requested vs found, available vs not | 8 |
| Continue an interrupted collection | 8 |
| Manufacturer, Stock Qty, Unit price, MOQ, Order Qty, Total price, Availability, Status (coloured unless active, blank if unknown), RoHS | 5.2–5.4 |
| Best price and supplier, skipping suppliers without enough stock | 5.3 |
| Export to ods, xlsx, csv with filters | 11 |

### Changes from this proposal

- **Collected data is stored per part number** (`project.collected`), not per row. A part number used in several rows is looked up once; undo never loses collected data; importing again keeps data for unchanged part numbers. This replaced the planned "Reload from KiCad" command.
- **No exchange rates.** All three suppliers return EUR when asked (5.5); prices in other currencies are flagged and left out of totals.
- **TME uses API v2** (OAuth). TME stopped issuing keys for v1 in May 2026.
- **DigiKey browser sign-in (7.1) isn't built.** It's only needed if the live test shows that the account number doesn't return the account's own prices.
- **Tooling:** Dependabot instead of Renovate; TypeScript 6.0 until typescript-eslint supports 7.

### Open

1. **Live verification with real API keys** (section 13). DigiKey and Mouser work with real keys; TME is still to be confirmed. Settings → Test connection answers most points; the log option records the responses.
2. **Code signing** for the Windows installer, to avoid the SmartScreen warning.
3. **Not built yet:** automatic updates, opening `.eezbom` files by double-click, dark mode.
4. **LCSC** (#9) is built from LCSC's API guide and still needs a test with a real key.
