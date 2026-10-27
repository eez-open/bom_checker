import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerOpenDialog,
    cell,
    closeApp,
    launchApp,
    setUpCredentials
} from "./helpers";

const BOM = join(__dirname, "fixtures/value-bom.csv");
// Rows of value-bom.csv, in order.
const U1 = 0;
const R1 = 1;

test("looks up the Value where a part number is missing", async () => {
    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, BOM);
        await page.getByRole("button", { name: "Import CSV…" }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();

        await page.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        const byValue = collect.getByRole("checkbox", {
            name: "Look up the Value where a part number is missing"
        });
        await expect(byValue).not.toBeChecked();
        await expect(
            collect.getByText("No Mouser part numbers in the BOM.")
        ).toBeVisible();
        await expect(
            collect.getByRole("radio", { name: "All part numbers (1)" })
        ).toBeVisible();
        // With the option off, the dialog points to it (#18).
        await expect(
            collect.getByText(
                "2 rows have no Mouser part number but a Value that can be looked up"
            )
        ).toBeVisible();
        await expect(
            collect.getByText(
                "3 rows have no DigiKey part number but a Value that can be looked up"
            )
        ).toBeVisible();

        // DigiKey: TPS54331DDA, RMCF0805FT100K and 1N4148 by Value, plus
        // its part number. Mouser: the first two (100n is generic, and D1
        // says "-").
        await byValue.check();
        await expect(
            collect.getByRole("radio", { name: "All part numbers (4)" })
        ).toBeVisible();
        await expect(
            collect.getByRole("radio", { name: "All part numbers (2)" })
        ).toBeVisible();
        await collect.getByRole("button", { name: "Start" }).click();

        const summary = (supplier: string) =>
            collect.getByRole("region", { name: `${supplier} summary` });
        await expect(summary("Mouser")).toContainText(
            "From the Value: 1 filled in · 0 to choose · 1 not found"
        );
        await expect(summary("DigiKey")).toContainText(
            "From the Value: 0 filled in · 1 to choose · 2 not found"
        );
        await collect.getByRole("button", { name: "Close" }).click();

        // One match fills in Mouser's part number; several DigiKey
        // packagings leave the Value to choose from.
        await expect(cell(page, U1, "pn:mouser")).toHaveText(/595-TPS54331DDA/);
        await expect(
            cell(page, U1, "pn:mouser").locator(".pn-badge")
        ).toHaveAttribute("aria-label", "Found");
        await expect(cell(page, R1, "pn:digikey")).toHaveText(/RMCF0805FT100K/);
        await expect(
            cell(page, R1, "pn:digikey").getByRole("button", {
                name: "Choose the item"
            })
        ).toBeVisible();
        await expect(cell(page, U1, "data:mouser:totalPrice")).toHaveText(
            "2.10"
        );

        // Choose the cut tape from the list in Availability (#15).
        const choose = cell(page, R1, "data:digikey:availability").getByRole(
            "combobox",
            { name: "Choose the DigiKey item for RMCF0805FT100K" }
        );
        await expect(choose.locator("option")).toHaveText([
            "Choose an item…",
            /^RMCF0805FT100KCT-ND \(Cut Tape \(CT\)\) · stock 400,000 · from /,
            /^RMCF0805FT100KTR-ND \(Tape & Reel \(TR\)\) · stock 500,000 · MOQ 5,000 · from /,
            "Compare the items…"
        ]);
        await choose.selectOption({ index: 1 });
        await expect(cell(page, R1, "pn:digikey")).toHaveText(
            /RMCF0805FT100KCT-ND/
        );
        await expect(cell(page, R1, "data:digikey:availability")).toHaveText(
            "In stock"
        );

        // Choosing and filling in are one undo step each.
        await page.keyboard.press("Control+Z");
        await expect(cell(page, R1, "pn:digikey")).toHaveText(
            /^.?RMCF0805FT100K$/
        );
        await page.keyboard.press("Control+Z");
        await expect(cell(page, U1, "pn:mouser")).toHaveText("");
        await expect(cell(page, R1, "pn:digikey")).toHaveText("");

        // Only the selected rows (#17): U1, looked up by its Value for
        // both suppliers.
        await page
            .locator('.ag-row[row-index="0"] .ag-selection-checkbox input')
            .first()
            .check();
        await page.getByRole("button", { name: "Collect…" }).click();
        await expect(
            collect.getByRole("radio", { name: "Only the selected rows (1)" })
        ).toBeChecked();
        await expect(byValue).toBeChecked();
        await expect(
            collect.getByRole("radio", { name: "All part numbers (1)" })
        ).toHaveCount(2);
        await collect.getByRole("button", { name: "Start" }).click();
        await expect(summary("Mouser")).toContainText(
            "From the Value: 1 filled in · 0 to choose · 0 not found"
        );
        await expect(summary("DigiKey")).toContainText(
            "From the Value: 0 filled in · 0 to choose · 1 not found"
        );
        await collect.getByRole("button", { name: "Close" }).click();
        await expect(cell(page, U1, "pn:mouser")).toHaveText(/595-TPS54331DDA/);
        // R1 wasn't selected: its DigiKey cell stays empty.
        await expect(cell(page, R1, "pn:digikey")).toHaveText("");
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
