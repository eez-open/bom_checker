# EEZ BOM checker – user guide

EEZ BOM checker takes a bill of materials (BOM) and checks every part at DigiKey, Mouser, TME and LCSC: is it in stock, what does it cost for the quantity you need, is it still active, and which supplier is cheapest for the whole order quantity. You can then export the result to Excel, LibreOffice or CSV.

## Contents

1. [Installing](#installing)
2. [Setting up supplier access](#setting-up-supplier-access)
3. [Creating a BOM](#creating-a-bom)
4. [Collecting supplier data](#collecting-supplier-data)
5. [Building several units](#building-several-units)
6. [Reading the table](#reading-the-table)
7. [Exporting](#exporting)
8. [Syncing with the KiCad project](#syncing-with-the-kicad-project)
9. [Updating the KiCad project](#updating-the-kicad-project)
10. [BOM lists: several BOMs together](#bom-lists-several-boms-together)
11. [Files and security](#files-and-security)
12. [Troubleshooting](#troubleshooting)

## Installing

- **Windows:** run `EEZ-BOM-checker-<version>-setup.exe`. The installer isn't signed yet, so Windows SmartScreen may warn: choose *More info → Run anyway*.
- **Ubuntu / Linux Mint:**
    - `.deb`: `sudo apt install ./EEZ-BOM-checker-<version>-amd64.deb`, then start *EEZ BOM checker* from the menu.
    - AppImage: make it executable (`chmod +x EEZ-BOM-checker-<version>-x86_64.AppImage`) and run it. Nothing is installed.

## Setting up supplier access

The app reads supplier data through each supplier's API (DigiKey, Mouser, TME, LCSC and Arrow), with your own API credentials. Your credentials are stored encrypted on your computer, protected by a password you choose.

1. Open **Settings** (toolbar, or Ctrl+,) and go to **Suppliers**.
2. The first time, choose a password (at least 8 characters). You need it to change supplier settings, and once per session to collect data. **It can't be recovered**: if you forget it, *Forgot the password?* deletes the stored credentials so you can start over.
3. For each supplier you use, enter the credentials, click **Save**, then **Test connection**. The test looks up one known part and shows the stock, the currency and whether the prices are your account's own.

Saved credentials appear as *Saved*. The eye button next to one shows it, and the copy button copies it to the clipboard.

### DigiKey

- Sign in at [developer.digikey.com](https://developer.digikey.com/), create an organization and a **production** app, and subscribe it to **Product Information v4**. Copy the app's **Client ID** and **Client secret**.
- **Account number**: your DigiKey customer account number, so DigiKey returns your own prices.
- **Site** and **Currency**: Croatia isn't a DigiKey site; a eurozone site (default: Slovenia) with EUR returns prices in EUR. DigiKey allows 1,000 requests per day per app, one part per request.

### Mouser

- Request a **Search API** key on Mouser's API page (it's sent by email). The *Order* API key doesn't work for searching.
- Mouser returns prices in your account's currency. Mouser allows 30 requests per minute and 1,000 per day; one request checks up to 10 parts.

### TME

TME's key links two sites: your shop account at tme.eu and a separate developer account at [developers.tme.eu](https://developers.tme.eu/).

1. On **developers.tme.eu**, open **API Token keys**, enter an application name (e.g. *BOM checker*) and click **Create application**. Its **Application secret** (click the eye icon) is the **App secret**.
2. On **tme.eu**, open **User panel → Applications → Register new app** and copy the **temporary token**. It can be used only once. The applications listed on that page show only the start of a token; that isn't the key.
3. Back on developers.tme.eu, paste it into your application's **Temporary token** field, choose the key purpose and click **Generate new private key**.
4. Click **Show private keys** and copy the private key: that's the **Token** (about 50 characters; the App secret is about 20).

The private key returns your own prices. **Country** (default HR), **Language** and **Currency** (default EUR) can be changed. One request checks up to 50 parts. TME doesn't provide RoHS information.

### LCSC

LCSC's API is free, but LCSC reviews each application, and it answers only calls from the internet addresses you register.

1. Log in to your account at [lcsc.com](https://www.lcsc.com/) (or register one).
2. Apply at [lcsc.com/agent/apply](https://www.lcsc.com/agent/apply). Describe the use as checking BOMs for your own purchasing with EEZ BOM checker, and accept the API Cooperation Agreement. The review usually takes 5–7 business days, and LCSC may ask for details about your company.
3. Register the **public IP address** of the network you'll use the app from (search the web for "what is my IP"). LCSC refuses calls from other addresses. If your internet provider changes your address from time to time, update it at lcsc.com/agent when Test connection reports *HTTP 401*.
4. LCSC sends a **Key** and a **Secret**. Enter them, set **API environment** to *Sandbox*, and click **Test connection**. New keys work only in the sandbox until LCSC activates them for production; switch to *Production* once they have.

The LCSC column takes LCSC part numbers (C2040) or manufacturer part numbers. Prices are LCSC's standard prices in EUR or USD. LCSC allows about 60 requests per minute and 1,000 per day, one part per request. LCSC only says whether a part is on sale: *Active* or *Not orderable*.

### Arrow

Arrow's Pricing & Availability API needs a login and an API key from Arrow.

1. Request access on [developers.arrow.com](https://developers.arrow.com/api/) (*Getting Started*). Arrow sends a **Login** and an **API key** for the Pricing & Availability API; the Order API has a key of its own, which doesn't work here.
2. Enter them under **Arrow**, choose the **Inventory sources** you buy from, click **Save Arrow settings**, then **Test connection**.

Arrow keeps stock in several **inventory sources**: Arrow Europe (EUROPE), Arrow North America (ACNA), Arrow Asia (ASIA) and the Verical marketplace (VERICAL). Each source you choose is a supplier of its own in the app, e.g. **Arrow (EUROPE)**: **Columns…** offers a part-number column for it, and it has its own stock, prices, Availability and place in the best price, so Arrow (EUROPE) and Arrow (ASIA) can be compared side by side. A part that's in Arrow's catalogue but not in a source's stock is *not found* there. The columns take manufacturer part numbers, as Arrow lists them; when Arrow has several packagings in a source, one with prices is shown first, then the one with the most stock, and the tooltip lists the others.

A part number typed in one Arrow column counts for all of them. When a source's cell is empty, **Collect…** looks up the part number of another Arrow column (the first from the left) and puts it in the cell afterwards, found or not, so the column shows whether that source has the part. An Arrow cell with `-` doesn't count. **Look up the Value where a part number is missing** is used only for rows without any Arrow part number.

Prices are Arrow's resale prices; with **Currency** EUR, Arrow converts prices from USD. **Part numbers per request** is 100 by default, the most Arrow's best practices name; Arrow's list search accepts up to 1000, so *1000* checks most BOMs in one request. Arrow's terms allow keeping its data for 48 hours only: older Arrow data is removed when the app starts and when a BOM is opened or saved, so collect again before ordering.

**Request limits** for each supplier are preset to the supplier's published limits. The app spaces out requests and counts them per day, also across projects and restarts. Lower the limits if you share an API key with other tools.

## Creating a BOM

The app starts on a start page: **Open BOM…**, or drop a file on the window (a BOM `.eezbom`, a KiCad project `.kicad_pro` or a CSV file). Below are the **recent documents**: BOMs you opened or saved, and the files you imported from. Click one to open it again; the × that appears on hover removes it from the list. The same list is in **File → Open Recent**. **File → Close** (Ctrl+W) goes back to the start page. File dialogs open in the folder of the file last chosen in one of their kind, also after a restart: one folder for BOMs and BOM lists (open, save, new list, add BOMs), one for CSV files, one for KiCad projects and one for exports and saved pictures.

### By hand

**New**, then **Add row**: the Reference cell starts editing. Type, then press Tab to move to the next cell and Enter to finish. **Columns…** adds part-number columns for DigiKey, Mouser, TME and LCSC, and your own text or number columns. Select rows with their checkboxes to delete them.

**References:** a row's Reference lists its parts, separated by commas, e.g. *C1, C2, C3*. Each part can be in one row only: a reference that another row already has can't be entered. The cell turns red, the status bar says which row has it, and Enter does nothing until it's changed (Escape gives up the edit). Rows that have one anyway, e.g. from an imported file, are red too; hover for the other row. Qty should be the number of references: when it isn't, Reference and Qty are amber, e.g. *KK1, KK2, KK3* with Qty 2. Decimal quantities (amounts, such as metres of tape) aren't compared.

Every change can be undone with **Ctrl+Z** and redone with **Ctrl+Y**, or with the **Undo** and **Redo** buttons next to Save.

### From a CSV file

**Import CSV…** (Ctrl+I) reads files such as KiCad's *Symbol Fields Table* export. In the dialog, check what each column becomes; the app suggests a mapping from the headers and remembers your choice for files with the same columns. If special characters (č, ž…) look wrong, change the text encoding.

### From a KiCad 10 project

**Import KiCad…** (Ctrl+K): choose the `.kicad_pro` file and, if the project has several design variants, the variant. Symbols that are *DNP* or *excluded from the bill of materials* in that variant are left out, also when the setting comes from their sheet; the variant's own part numbers and values are used. Rows are grouped like KiCad's Symbol Fields Table. Only KiCad 10 projects are supported: open older projects in KiCad 10 and save them first.

### Part-number cells

- Values are trimmed. An empty cell or `-` means "no part number from this supplier".
- A cell listing alternatives, such as `EPP-150-48 or LOP-200-48`, is shown in red and skipped: keep one part number.
- A manufacturer part number in a supplier column also works; the app recognises it.

Importing again (for example after changing the schematic) keeps the supplier data already collected for part numbers that are still in the BOM.

### Suppliers without an API

Some parts don't come from DigiKey, Mouser, TME or LCSC: a TFT display from a specialist shop, a metal enclosure, cardboard shipping boxes. In **Columns…**, under *Suppliers without an API*, add such a supplier by name. It gets a column group in the table where you type, for each row:

- **part number** (optional, for your reference);
- **Unit price** in EUR, with up to three lower prices for larger quantities (see below);
- **Stock Qty**: how many it has; leave it empty if it's always available, e.g. made to order;
- **MOQ**: the smallest quantity it sells (1 if empty);
- **One-time**: tick it for a one-time cost, such as a stencil or tooling. Its Qty isn't multiplied by Build qty, nor, in a BOM list's Combined BOM, by how many of the BOM a device has.

**Price breaks:** double-click the Unit price cell (or start typing in it) to open its prices: the unit price from 1, and up to three more, each from a quantity, e.g. 1.10 from 1, 1.00 from 25, 0.80 from 100 and 0.65 from 300. The price whose quantity the order quantity reaches applies to all of it: 5 cost 5.50, 25 cost 25.00 and 500 cost 325.00. Tab moves between the fields, Enter keeps the prices and Escape cancels; the rows may be typed in any order. The cell then shows the unit price for the order quantity, with a blue corner; hover for all prices. Exports have them in a *Price breaks* column.

Order Qty, Total price and Availability are calculated as for the other suppliers, and these suppliers take part in the best price: the cheapest total with enough stock wins; on equal totals, a supplier with an API is preferred. They're included in the Total row, the Rows filter and exports. Renaming or deleting one is done in **Columns…**; deleting removes what was typed for it (Ctrl+Z undoes it). The BOM file keeps such a supplier's name, part numbers and One-time ticks; its prices, stock and MOQ are kept on your computer with the collected supplier data, so a published BOM doesn't show them.

## Collecting supplier data

Click **Collect…**. The first time in a session, enter your password. Then, for each supplier:

- tick the suppliers to collect;
- choose what to collect: **All part numbers**, **Only part numbers without data** (including ones that got an error last time), or **Continue where it stopped** after an interrupted run;
- check the estimate: about how many requests it takes, and how many are left today.

To update only some parts, select their rows in the table first (the checkboxes on the left). **Collect…** then offers **Only the selected rows**, chosen by default, or **All rows**. With the selected rows, every supplier that has part numbers in them is ticked, to look them up again.

**Start** shows progress for each supplier and which part is being checked; **Cancel** stops. Collecting stops by itself when a daily limit is reached or credentials are rejected; open **Collect…** again later to continue where it stopped.

The summary shows how long it took, how many part numbers were found, not found or matched several items, and how many have enough stock for the order quantity.

To remove what was collected for some rows, e.g. to start over with them, select the rows and click **Forget data…** on the toolbar (or **Tools → Forget Supplier Data of Selected Rows…**). The data of every supplier is removed for their part numbers, and for their Values if those were looked up. Data is kept per part number, so other rows with the same part numbers lose it too. This can't be undone; collect again to get the data back. In a BOM list's *Combined* BOM, the data is removed from the list's BOMs.

### Finding part numbers from the Value

Tick **Look up the Value where a part number is missing** to search for rows whose part-number cell is empty. The Value is searched as a manufacturer part number at each selected supplier (e.g. *TPS54331DDA* or *1N4007*), so the supplier needs a part-number column (add one with **Columns…**).

- One matching item fills in the supplier's part number.
- When several items match, typically different packagings, the cell gets the Value, and the supplier's *Availability* column shows a list to choose the item from.
- When nothing matches, the cell stays empty.

For Arrow's inventory sources, another Arrow column's part number comes first, also without this option (see [Arrow](#arrow)).

A manufacturer part number counts as the same when it differs only in dashes, other punctuation or leading zeros: DigiKey lists Molex *22-01-3037* as *0022013037*. When DigiKey doesn't find a part number at all, the app also runs DigiKey's keyword search, which costs a second request; if none of the products it finds has the number, you choose among them.

Generic values such as *100n*, *4u7* or *10k*, names like *LED* or *Conn_01x04*, and cells with "-" are skipped: a value alone can't pick one capacitor out of thousands. Part numbers of digits only, as many connectors have (Molex *22-01-3037*, Würth *61300311121*), are looked up when they have at least 7 digits. The summary says how many part numbers were filled in, are left to choose, or weren't found. A Value looked up in an earlier run fills in an empty cell too. Filling in is one step that **Ctrl+Z** undoes. The option is remembered for next time. While it's off, each supplier says how many rows it could look up by their Value.

## Building several units

To check prices and stock for a production batch, enter the number of units in **Build qty** on the toolbar and press Enter. Every row's Qty is multiplied by it: a part used 10 times per board needs 250 for 25 boards. Order quantities, price breaks, availability and the best price follow at once, without collecting again, since the collected data has every price break. A *Total Qty* column shows the multiplied quantity. Total prices show the price per unit in parentheses, e.g. *62.50 (2.50)* for 25 units, in the table, the Total row and the status bar's best-price total. The build quantity is saved with the BOM, Ctrl+Z undoes a change, and exports include it.

**Qty can be a decimal** for parts used in fractions of their unit, e.g. 0.004 (m) of adhesive tape sold in 5 m rolls (type 0.004 or 0,004). The order quantity is still rounded up to whole packages: one 5 m roll covers up to 1,250 devices, and the 1,251st needs a second one.

## Reading the table

Each supplier has a group of columns. Click the arrow in the group header to show only the part number, *Total price* and *Availability*. The group header also shows when that supplier's data was last collected. The date is kept with the BOM's supplier data, and also appears in **Collect…** and on the Info sheet of exports.

**Searching and filtering:** above the table, **Search** (Ctrl+F, or Edit → Find…) shows only the rows that contain the text in any column, e.g. a reference, a value or a part number; Escape clears it. In a BOM list, the search stays when another BOM is shown. Once supplier data has been collected, **Rows** shows only the rows where one supplier has the best price, or *Best price: None in stock* for the parts no supplier can deliver. While a filter is on, the Total row adds up the shown rows, and **Show all** turns the filters off. The Row column keeps each row's number in the BOM.

To hide all columns of a supplier, or the Best price columns, uncheck them under **Columns** at the right of the bar above the table. Suppliers with an API and Best price are also in the **View** menu: Ctrl+1 to Ctrl+4 for DigiKey, Mouser, TME and LCSC, Ctrl+5 for Best price, and Ctrl+6 to Ctrl+9 for Arrow's inventory sources. Hiding only changes the view: the data stays, still counts for the best price, and can still be exported. The status bar lists hidden groups, with **Show all** to bring them back. The app remembers hidden groups for next time.

**Tabs:** to see one supplier at a time, tick **Tabs** at the right of the bar (or **View → Suppliers as Tabs**). Each supplier, and Best price, then has a tab above the table; the tab shows its columns with the BOM's own columns, and your own columns stay at the right. The same shortcuts choose the tab. The app remembers the layout and the tab.

| Column | Meaning |
|---|---|
| Badge in the part-number cell | ✓ found, ✗ not found, ? several items match (click to choose one), ! couldn't check. Hover over the cell for the details the supplier returned. |
| Manufacturer, Stock Qty, MOQ | As reported by the supplier. |
| Order Qty | What you need to buy: Qty (× build quantity), raised to the MOQ and rounded up to the order multiple. Example: Qty 3 with MOQ 10 → 10. |
| Unit price | The price break that applies to the Order Qty; highlighted if the quantity is below the first break. Hover to see whether it's your account's price. |
| Total price | Unit price × Order Qty, in EUR. |
| Availability | In stock, Partial (with the quantity in stock), Out of stock, or Not orderable. DigiKey keeps stock per packaging: when another packaging of the same product has stock, e.g. a box when cut tape is out of stock, hovering shows its part number, stock and MOQ. |
| Status | Active; **amber** for new, NRND, last time buy and special order; **red** for obsolete and not orderable. |
| RoHS | As reported (TME doesn't report it). |

**Best price** (shown when two or more suppliers have data): the supplier with the lowest total price that has the whole order quantity in stock. Equal totals go to your preferred supplier (*Settings → General*). *None in stock* means no supplier can deliver the full quantity, and the best-price total leaves such rows out: the Best price header then turns red with a warning sign, and its tooltip says how many rows that is. The status bar shows the best-price total of the BOM.

The **Total** row at the top adds up each *Total price* column, for every supplier and for Best price. Its tooltip says how many rows have a price. Quantities aren't added up: they're of different parts.

**Most expensive parts** (**Top 10** in the Best price header, *Most expensive parts* in the status bar, or **View → Most Expensive Parts…**) shows where the money goes: a ring chart of the 10 rows with the highest best-price totals, each in its own colour and numbered by rank, the rest of the BOM as one gray *Other* slice, and a table with each row's supplier, total and share of the best-price total. Point at a slice or a table row to find its match. Totals are for the build quantity; rows without a supplier that has enough stock aren't included, and a red line with a warning sign says how many there are, in the picture too. **Copy picture** puts the chart with its legend on the clipboard, e.g. for a document or an email; **Save as PNG…** saves it as an image.

**Several items match:** for example, a DigiKey part comes as cut tape and as a reel. Pick one in the list that the supplier's *Availability* column shows instead of a status; each entry has the item's part number, packaging, stock, MOQ and first price. For a side-by-side comparison, choose *Compare the items…* or click the **?** badge. The chosen item's part number replaces the old one in every row that used it, its data is shown at once, and Ctrl+Z undoes the choice.

Prices are compared in EUR. If a supplier returns another currency, a yellow bar says so; those prices aren't included in totals and the best price.

**Numbers** look as in the system's regional settings, e.g. *1.234,56* where decimals follow a comma. **Settings → General → Numbers** can choose a decimal point (*1,234.56*) or a decimal comma (*1.234,56*) instead. When typing a number in a cell, either "." or "," works before the decimals.

**Copying:** Ctrl+C copies the text of the selected cell, as shown, and the status bar says what was copied. In a BOM list's Combined BOM, which can't be edited, text in cells can also be selected with the mouse, and Value and part-number cells show a copy button while the pointer is over them.

Changing Qty updates all calculations at once, without collecting again.

## Exporting

**Export…** (Ctrl+E):

- **Preset**: e.g. *All data*, *Basic data only* (Row, Reference, Value, Qty, Footprint and the part numbers), *All Mouser data*, *Best price from Mouser*, *Not available anywhere*.
- **Columns**: which suppliers' part numbers and data, the Best price columns, and your own columns. Row, Reference, Value, Qty and Footprint are always included. **Part numbers only** leaves out the suppliers' data columns.
- **Rows**: all rows, rows with a supplier's part number, rows where a supplier has the best price, or rows that no supplier can deliver.
- **Format**: Excel (.xlsx), LibreOffice (.ods) or CSV. Excel and LibreOffice files also get an *Info* sheet with the source, the filter, when data was collected and the totals. They're formatted for reading and printing: the header row bold on orange, the rows alternately white and blue gray, Row and Qty centred, the BOM's own columns and the part numbers at set widths, and long reference lists wrapped. They print on A4 landscape at 83 %, with all columns in the print range and the file name and page number at the top. CSV files write numbers as the app shows them (*Settings → General → Numbers*): with a decimal comma, ";" separates the values, as spreadsheet programs expect in those regions.

To keep a combination, type a name and click **Save as preset**.

**Supplier data in exports:** an export with the suppliers' data columns or the Best price columns contains data collected through their APIs, which their terms don't allow passing on. Before such an export, the app says so and asks for your password (the one for the supplier settings) to confirm. Keep the file to yourself; to share a BOM, export *Basic data only*, which doesn't ask.

Column names follow the pattern `Supplier_Column`, e.g. `Mouser_Stock Qty`, `Mouser_Total price`, `Best_Supplier`.

## Syncing with the KiCad project

For a BOM imported from a KiCad 10 project, the toolbar's **Import KiCad…** becomes **Sync KiCad…** (also **File → Sync with KiCad Project…**). It reads the project again, for the same design variant, and lists what changed in KiCad since the import or the last sync:

- **New supplier columns:** part numbers in a field the BOM has no column for yet, e.g. LCSC.
- **Added in KiCad:** new parts. They join the BOM row of their KiCad row-mates when that row has the same values; otherwise they get a new row.
- **No longer in KiCad's BOM:** parts deleted in KiCad, or now DNP or excluded from the BOM. They leave their row; a row with no parts left goes.
- **Changed in KiCad:** a Value, Footprint, part number or other field that changed in KiCad. When only some parts of a row changed, they get a row of their own.
- **Rows to join into one:** parts that KiCad lists in one row but that are in several BOM rows with the same Value, Footprint and part numbers. That happens when KiCad renumbers parts (Annotate Schematic): a sync compares each reference with the part that had it before, so a renumbered part leaves its row for a row of its own. Ticked, the rows become one, in the place of the first, with their references and quantities together. Rows with different values in another column, e.g. one of your own, stay apart.

Tick what to bring into the BOM and click **Apply**; Ctrl+Z undoes it. With **Sort the rows by Reference** ticked (the app remembers the choice), the rows are then in the order of their lowest reference, as KiCad lists them (C2 before C10 before R1), so added parts are where their references put them instead of at the end; rows without a reference come last. What was done in the BOM is kept: rows and columns added by hand, and values changed in the BOM, e.g. a chosen item or a corrected part number, which aren't listed. The BOM file remembers what KiCad had at the import or the last sync to tell the two apart. A value changed on both sides is listed unticked, so the BOM's value stays unless you tick it.

BOMs imported with version 0.4 or older don't have that yet: there, every difference is listed, and only additions are ticked. After the first sync, they work like the others.

## Updating the KiCad project

For a BOM imported from a KiCad 10 project, **Update KiCad…** on the toolbar (or **File → Update KiCad Project…**) writes the part numbers, and Values if you choose, back into the project's schematics, e.g. after choosing items, fixing part numbers, finding them from the Value or unifying Values. Sync KiCad… only brings KiCad's changes into the BOM; Update KiCad… takes the BOM's changes to KiCad.

1. **Close the schematic in KiCad** (Schematic Editor). If KiCad still has it open, the dialog warns: saving it in KiCad would overwrite the update.
2. The dialog reads the project again and shows each change: references, field, the value in KiCad now and the new value. Untick a column to leave it out.
3. **Update KiCad project** writes the changes.

What's written:

- **Only rows that match exactly.** A row is used only when its references are exactly those of a row of KiCad's BOM for the same design variant, e.g. *C1,C2,C3* in both. Rows whose references differ, because a part was added, removed or regrouped in KiCad, or a reference was edited in the table, are listed as *left out*, with the reason. Import the project again to bring the BOM up to date.
- **Values** go to the symbols' Value field, when **Value** is ticked in the dialog. It isn't at first, because a Value also goes to the PCB (its silkscreen and fabrication layers) once the PCB is updated from the schematic; the app remembers your choice. An empty Value in the BOM leaves KiCad's.
- **Supplier part numbers** go to the KiCad field of the same name (*DigiKey*, *Mouser*, *TME*, *LCSC*). A field that doesn't exist yet is added as a hidden field. Custom columns go to the KiCad field of the same name, if there is one.
- **Every symbol of a row** gets the value, including all units of multi-unit parts.
- **Design variants:** for a BOM imported from a variant other than Default, values the variant overrides in KiCad are changed in that variant. Other values are changed in the symbols themselves, so the other variants get them too; the dialog warns about that.
- **Only the values change.** The rest of the schematic files stays exactly as KiCad wrote it.

**Backup and undo:** before writing, the project file and all its schematics are copied to `bom-checker-backups/<date_time>` in the project folder. **Restore the backup** in the dialog puts them back right away. Later, copy the files from that folder back into the project folder by hand.

## BOM lists: several BOMs together

The modules of one device often have their own BOMs, made at different times, and the same 10k resistor may have a different part number in each. Since the PCBA of all modules is ordered from one supplier at once, one part number per component means larger quantities, better prices and fewer parts to stock. A **BOM list** (`.eezbom-list`) keeps such BOMs together, finds those differences, and shows what to order for all of them.

**Creating a list:** **File → New BOM List…** (or *BOM list* on the start page) asks where to save the list. Next to it, it creates the **history BOM**, *<list> history.eezbom*, or uses the one already there. Then **Add BOMs…** adds `.eezbom` files: BOMs made by hand or imported from CSV or KiCad. The list keeps their paths relative to its own folder, so the folder can be moved or shared. **File → Open…** and *Open Recent* open lists like BOMs.

**Working with the BOMs:** the list is on the left and the selected BOM on the right, where everything works as with a single BOM: editing, Collect, Export, Update KiCad… and so on. While another BOM is shown, a BOM keeps its unsaved changes (marked with •) and its Ctrl+Z history. **Save** saves the BOM shown; **File → Save All** (Ctrl+Alt+S) saves every BOM of the list. **Remove** takes the selected BOM off the list; its file stays. File → Close closes the list, asking about unsaved BOMs.

**Combined** shows the rows of all BOMs, for ordering them together. Rows with the same supplier part numbers are one row, with the quantities added up; rows without part numbers are merged by Value and Footprint. *Reference* lists the references by BOM, and *Source BOM* the BOMs a row comes from. Suppliers without an API come along with what was typed for them, so they take part in the best price: a supplier with the same name in several BOMs is one supplier, and when merged rows have different values for it, the first BOM's are shown. Combined can't be edited, but it can be collected, which also gives the BOMs the new data (they then have unsaved changes), and exported like any BOM.

**Quantities for a number of devices:** the number next to each BOM in the list (**×**) says how many of it one device has, e.g. 2 for a module that's in the device twice; Combined's Qty is for one device. **Build qty** on the toolbar, while Combined is shown, is the number of devices: for 25 devices with two modules each, set the module's × to 2 and Build qty to 25, and the module's parts are ordered for 50. Order quantities, prices and Unify's quantities follow. The list saves both at once. A BOM's own Build qty counts only when it's shown by itself.

**Cost by BOM** (in the list, or **View → Cost by BOM…**) shows what each BOM costs when they're ordered together: a ring chart like *Most expensive parts*, with the same colours, and a table with each BOM's total and share. The rows are those of the Combined BOM, each at its best price for the number of devices, so the BOMs add up to Combined's best-price total; a row that several BOMs use is shared among them by their quantities. The 10 most expensive BOMs get a slice each, the rest one gray *Other* slice. **Copy picture** and **Save as PNG…** work as for the parts.

**The history BOM** remembers every component (Value and Footprint) with each combination of supplier part numbers used in the list's BOMs, also ones they no longer use, so they can be offered again. It gets new combinations when a BOM is added, after Unify's Apply, and whenever a BOM of the list is saved; *Used in* names the BOMs. It isn't unified itself. **Choose…** uses another `.eezbom` as the history.

**Checking rows against the history:** a part number may be in the history because it was out of stock when another, dearer one was chosen; it may be in stock now. Select rows of a BOM in the list and click **Check History…** under *History* (or **Tools → Check History…**); with no rows selected, all rows of the BOM are checked. The dialog lists the rows whose components (same Value and Footprint; untick **Same footprint** to match by Value alone) have other part numbers in the history, per supplier, with the row's own. **Collect…** gets their stock and prices for the row's quantity (with the BOM's Build qty), the cheapest in stock is marked *Best price*, and **Choose suggestions** picks it. **Apply** changes the BOM shown, with the collected data, without saving it; Ctrl+Z undoes it.

### Unifying part numbers

**Unify part numbers…** (in the list, or **Tools → Unify Part Numbers…**) first saves unsaved BOMs, then lists every component whose rows have different part numbers for a supplier, or different Values. Rows are the same component when Value and Footprint are equal: *10k* and *10K* are the same, but *10m* and *10M* aren't. Rows that already share a part number are too, so *10k* and *10K 1%* with the same DigiKey number are one component. Untick **Same footprint** to match by Value alone. An empty cell counts as different, so Unify can fill it in.

For each component, it shows the rows and BOMs it's used in, and the total quantity for the list's number of devices. For each supplier, every part number used for it is offered, also those from the history, with availability, stock, order quantity, unit price and total price **for the quantity of all rows**. The cheapest in stock is marked *Best price*.

- Choose a part number per supplier, type another one under **Other**, or **Keep as is**. For the Value, choose one, type another, or keep the rows' Values.
- The cheapest in stock is chosen at first. Without data, it's the most used part number, unless the supplier reported it as not found. **Choose suggestions** chooses them again, e.g. after collecting.
- **Collect…** collects the part numbers offered and typed in, so prices can be compared; the data is used here and goes to the BOMs on Apply.
- **Apply…** says how many rows of how many BOMs change, then saves those BOMs, after copying their files to `bom-checker-backups/<date_time>` next to the list. In the app, Ctrl+Z on a BOM undoes the change; save it again to keep that.

The history BOM isn't changed by Unify, but gets the new part numbers. BOMs imported from a KiCad project get the new part numbers in the BOM only: select each and use **Update KiCad…** to write them into the schematic.

## Files and security

- **Save** (Ctrl+S) stores the BOM in an `.eezbom` file: its rows, columns and part numbers, and what you typed for suppliers without an API. The app asks before closing, or before opening another BOM, if there are unsaved changes. Dropping a file on the window opens it too.
- **Supplier data stays on your computer.** What is collected from the suppliers (stock, prices, descriptions, lifecycle and so on) isn't saved in the `.eezbom` file but in the app's data folder, and is saved together with the BOM. So are the prices, stock and MOQ typed for suppliers without an API, which you may not want to publish. The suppliers' API terms don't allow passing their data on, so this keeps BOM files safe to publish, e.g. on GitHub; whoever opens a published BOM collects the data with their own credentials, and sees no prices of suppliers without an API. A BOM moved or renamed outside the app finds its data again on this computer, by an id in the file; a copy gets the data of the original. BOMs saved by 0.12.0 or earlier with such prices open with unsaved changes: saving them removes the prices from the file.
  - BOMs saved by version 0.8.0 or earlier still have the data in the file. They open with unsaved changes (an orange dot in a list); saving them removes it.
  - Exports with supplier columns contain supplier data, and *bom-checker-backups* folders may hold copies of such older BOMs: keep both out of what you publish, e.g. with `.gitignore`.
- **BOM lists** (`.eezbom-list`) only name their BOMs and history BOM; the rows are in those `.eezbom` files.
- **No absolute paths:** a BOM keeps the path of the CSV file or KiCad project it came from relative to its own folder, and lists keep their BOMs' paths relative to theirs, so a folder can be moved or shared, e.g. in git, as long as the files keep their places in it. Exports show the source relative to the BOM, or only its name when the BOM wasn't saved yet. BOMs saved by older versions open as before and get relative paths when saved again. Only a source on another drive than the BOM (Windows) keeps its full path.
- **Settings, credentials and supplier data** are kept in the app's data folder: `%APPDATA%\EEZ BOM checker` on Windows, `~/.config/EEZ BOM checker` on Linux. Supplier data is in its *supplier-data* folder, a file per BOM. Credentials are encrypted with your password (scrypt and AES-256-GCM); the password itself isn't stored.
- **Supplier settings** always ask for the password, even while the credentials are unlocked for collecting. **Tools → Lock Credentials** locks them until you enter the password again.
- **Change the password** in **Settings → General**, with the current one.

## Troubleshooting

- **Log file:** *Help → About → Show Log File*. It records every supplier request (without credentials) and errors.
- **Wrong or missing data from a supplier:** turn on *Settings → General → Write supplier API responses to the log file*, collect again, and send the log file to whoever maintains the app. Responses can include your account's prices.
- **"Mouser rejected the API key":** you entered the Order API key; use the Search API key.
- **DigiKey "refused access (HTTP 403)":** check that the app is a production app subscribed to Product Information v4. After too many requests in a short time, DigiKey blocks access for 10 minutes.
- **"The daily request limit is reached":** daily counts reset at midnight UTC (DigiKey tells the app its own reset time). Continue the next day with *Continue where it stopped*.
- **A part is "not found" although the supplier sells it:** check the part number in the supplier's shop; hover over the cell to see when it was checked.
