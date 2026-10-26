# EEZ BOM checker – user guide

EEZ BOM checker takes a bill of materials (BOM) and checks every part at DigiKey, Mouser and TME: is it in stock, what does it cost for the quantity you need, is it still active, and which supplier is cheapest for the whole order quantity. You can then export the result to Excel, LibreOffice or CSV.

## Contents

1. [Installing](#installing)
2. [Setting up supplier access](#setting-up-supplier-access)
3. [Creating a BOM](#creating-a-bom)
4. [Collecting supplier data](#collecting-supplier-data)
5. [Reading the table](#reading-the-table)
6. [Exporting](#exporting)
7. [Files and security](#files-and-security)
8. [Troubleshooting](#troubleshooting)

## Installing

- **Windows:** run `EEZ-BOM-checker-<version>-setup.exe`. The installer isn't signed yet, so Windows SmartScreen may warn: choose *More info → Run anyway*.
- **Ubuntu / Linux Mint:**
    - `.deb`: `sudo apt install ./EEZ-BOM-checker-<version>-amd64.deb`, then start *EEZ BOM checker* from the menu.
    - AppImage: make it executable (`chmod +x EEZ-BOM-checker-<version>-x86_64.AppImage`) and run it. Nothing is installed.

## Setting up supplier access

The app reads supplier data through each supplier's API, with your own API credentials. Your credentials are stored encrypted on your computer, protected by a password you choose.

1. Open **Settings** (toolbar, or Ctrl+,) and go to **Suppliers**.
2. The first time, choose a password (at least 8 characters). You need it to change supplier settings, and once per session to collect data. **It can't be recovered**: if you forget it, *Forgot the password?* deletes the stored credentials so you can start over.
3. For each supplier you use, enter the credentials, click **Save**, then **Test connection**. The test looks up one known part and shows the stock, the currency and whether the prices are your account's own.

### DigiKey

- Sign in at [developer.digikey.com](https://developer.digikey.com/), create an organization and a **production** app, and subscribe it to **Product Information v4**. Copy the app's **Client ID** and **Client secret**.
- **Account number**: your DigiKey customer account number, so DigiKey returns your own prices.
- **Site** and **Currency**: Croatia isn't a DigiKey site; a eurozone site (default: Slovenia) with EUR returns prices in EUR. DigiKey allows 1,000 requests per day per app, one part per request.

### Mouser

- Request a **Search API** key on Mouser's API page (it's sent by email). The *Order* API key doesn't work for searching.
- Mouser returns prices in your account's currency. Mouser allows 30 requests per minute and 1,000 per day; one request checks up to 10 parts.

### TME

- In your tme.eu account, create an application to get a temporary token, then generate the private key at [developers.tme.eu](https://developers.tme.eu/): you get a **Token** and an **App secret**. The private key returns your own prices.
- **Country** (default HR), **Language** and **Currency** (default EUR). One request checks up to 50 parts. TME doesn't provide RoHS information.

**Request limits** for each supplier are preset to the supplier's published limits. The app spaces out requests and counts them per day, also across projects and restarts. Lower the limits if you share an API key with other tools.

## Creating a BOM

### By hand

**New**, then **Add row**: the Reference cell starts editing. Type, then press Tab to move to the next cell and Enter to finish. **Columns…** adds part-number columns for DigiKey, Mouser and TME, and your own text or number columns. Select rows with their checkboxes to delete them.

Every change can be undone with **Ctrl+Z** and redone with **Ctrl+Y**.

### From a CSV file

**Import CSV…** (Ctrl+I) reads files such as KiCad's *Symbol Fields Table* export. In the dialog, check what each column becomes; the app suggests a mapping from the headers and remembers your choice for files with the same columns. If special characters (č, ž…) look wrong, change the text encoding.

### From a KiCad 10 project

**Import KiCad…** (Ctrl+K): choose the `.kicad_pro` file and, if the project has several design variants, the variant. Symbols that are *DNP* or *excluded from the bill of materials* in that variant are left out, also when the setting comes from their sheet; the variant's own part numbers and values are used. Rows are grouped like KiCad's Symbol Fields Table. Only KiCad 10 projects are supported: open older projects in KiCad 10 and save them first.

### Part-number cells

- Values are trimmed. An empty cell or `-` means "no part number from this supplier".
- A cell listing alternatives, such as `EPP-150-48 or LOP-200-48`, is shown in red and skipped: keep one part number.
- A manufacturer part number in a supplier column also works; the app recognises it.

Importing again (for example after changing the schematic) keeps the supplier data already collected for part numbers that are still in the BOM.

## Collecting supplier data

Click **Collect…**. The first time in a session, enter your password. Then, for each supplier:

- tick the suppliers to collect;
- choose what to collect: **All part numbers**, **Only part numbers without data**, or **Continue where it stopped** after an interrupted run;
- check the estimate: about how many requests it takes, and how many are left today.

**Start** shows progress for each supplier and which part is being checked; **Cancel** stops. Collecting stops by itself when a daily limit is reached or credentials are rejected; open **Collect…** again later to continue where it stopped.

The summary shows how long it took, how many part numbers were found, not found or matched several items, and how many have enough stock for the order quantity.

## Reading the table

Each supplier has a group of columns. Click the arrow in the group header to show only the part number, *Total price* and *Availability*.

| Column | Meaning |
|---|---|
| Badge in the part-number cell | ✓ found, ✗ not found, ? several items match (click to choose one), ! couldn't check. Hover over the cell for the details the supplier returned. |
| Manufacturer, Stock Qty, MOQ | As reported by the supplier. |
| Order Qty | What you need to buy: Qty, raised to the MOQ and rounded up to the order multiple. Example: Qty 3 with MOQ 10 → 10. |
| Unit price | The price break that applies to the Order Qty; highlighted if the quantity is below the first break. Hover to see whether it's your account's price. |
| Total price | Unit price × Order Qty, in EUR. |
| Availability | In stock, Partial (with the quantity in stock), Out of stock, or Not orderable. |
| Status | Active; **amber** for new, NRND, last time buy and special order; **red** for obsolete and not orderable. |
| RoHS | As reported (TME doesn't report it). |

**Best price** (shown when two or more suppliers have data): the supplier with the lowest total price that has the whole order quantity in stock. Equal totals go to your preferred supplier (*Settings → General*). *None in stock* means no supplier can deliver the full quantity. The status bar shows the best-price total of the BOM.

**Several items match:** for example, a DigiKey part comes as cut tape and as a reel. Click the **?** badge, compare stock, MOQ and price, and choose one; its part number replaces the old one in every row that used it.

Prices are compared in EUR. If a supplier returns another currency, a yellow bar says so; those prices aren't included in totals and the best price.

Changing Qty updates all calculations at once, without collecting again.

## Exporting

**Export…** (Ctrl+E):

- **Preset**: e.g. *All data*, *All Mouser data*, *Best price from Mouser*, *Not available anywhere*.
- **Columns**: which suppliers' part numbers and data, the Best price columns, and your own columns. Row, Reference, Value, Qty and Footprint are always included.
- **Rows**: all rows, rows with a supplier's part number, rows where a supplier has the best price, or rows that no supplier can deliver.
- **Format**: Excel (.xlsx), LibreOffice (.ods) or CSV. Excel and LibreOffice files also get an *Info* sheet with the source, the filter, when data was collected and the totals.

To keep a combination, type a name and click **Save as preset**.

Column names follow the pattern `Supplier_Column`, e.g. `Mouser_Stock Qty`, `Mouser_Total price`, `Best_Supplier`.

## Files and security

- **Save** (Ctrl+S) stores the BOM with all collected data in an `.eezbom` file. The app asks before closing, or before opening another BOM, if there are unsaved changes.
- **Settings and credentials** are kept in the app's data folder: `%APPDATA%\EEZ BOM checker` on Windows, `~/.config/EEZ BOM checker` on Linux. Credentials are encrypted with your password (scrypt and AES-256-GCM); the password itself isn't stored.
- **Supplier settings** always ask for the password, even while the credentials are unlocked for collecting. **Tools → Lock Credentials** locks them until you enter the password again.

## Troubleshooting

- **Log file:** *Help → About → Show Log File*. It records every supplier request (without credentials) and errors.
- **Wrong or missing data from a supplier:** turn on *Settings → General → Write supplier API responses to the log file*, collect again, and send the log file to whoever maintains the app. Responses can include your account's prices.
- **"Mouser rejected the API key":** you entered the Order API key; use the Search API key.
- **DigiKey "refused access (HTTP 403)":** check that the app is a production app subscribed to Product Information v4. After too many requests in a short time, DigiKey blocks access for 10 minutes.
- **"The daily request limit is reached":** daily counts reset at midnight UTC (DigiKey tells the app its own reset time). Continue the next day with *Continue where it stopped*.
- **A part is "not found" although the supplier sells it:** check the part number in the supplier's shop; hover over the cell to see when it was checked.
