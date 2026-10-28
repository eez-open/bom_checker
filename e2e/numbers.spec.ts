import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
    answerSaveDialog,
    cell,
    closeApp,
    fillEditor,
    launchApp
} from "./helpers";

test("shows numbers as the region does, or as chosen (#37)", async () => {
    // A region with decimal commas; numbers follow it by default.
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_SYSTEM_LOCALE: "hr-HR" }
    });
    try {
        await page.getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("button", { name: "Add row" }).click();
        await fillEditor(page, "reference", "TP1");
        await page.keyboard.press("Tab");
        await fillEditor(page, "value", "Tape");
        await page.keyboard.press("Tab");
        await fillEditor(page, "qty", "2,5");
        await page.keyboard.press("Enter");
        await expect(cell(page, 0, "qty")).toHaveText("2,5");

        // A supplier without an API, with a price typed with a point:
        // either separator works.
        await page.getByRole("button", { name: "Columns…" }).click();
        const columns = page.getByRole("dialog", { name: "Columns" });
        await columns.getByLabel("New supplier name").fill("Shop");
        await columns.getByRole("button", { name: "Add supplier" }).click();
        await columns.getByRole("button", { name: "Close" }).click();
        const unitPrice = page.locator(
            '.ag-row[row-index="0"] .ag-cell[col-id$=":unitPrice"]'
        );
        const unitPriceId = (await unitPrice.getAttribute("col-id"))!;
        await unitPrice.dblclick();
        await fillEditor(page, unitPriceId, "1234.5");
        await page.keyboard.press("Enter");
        await expect(unitPrice).toHaveText("1.234,5000");
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 3.703,50 EUR"
        );

        // CSV gets decimal commas and ";" between the values.
        await page.getByRole("button", { name: "Export…" }).click();
        const dialog = page.getByRole("dialog", { name: "Export" });
        await dialog.getByRole("radio", { name: "CSV (.csv)" }).check();
        const csvPath = join(tmpdir(), `eez-numbers-${Date.now()}.csv`);
        await answerSaveDialog(app, csvPath);
        await dialog.getByRole("button", { name: "Export…" }).click();
        await expect(dialog.getByRole("status")).toContainText(
            "Exported 1 row"
        );
        await dialog.getByRole("button", { name: "Close" }).click();
        const [header, row] = (await readFile(csvPath, "utf8"))
            .slice(1)
            .split("\n");
        expect(header).toMatch(/^Row;Reference;Value;Qty;/);
        expect(row).toMatch(/^1;TP1;Tape;2,5;/);
        expect(row).toContain(";1234,5;");
        expect(row).toContain(";3703,5;");

        // Decimal points, chosen in Settings.
        await page.getByRole("button", { name: "Settings…" }).click();
        const settings = page.getByRole("dialog", { name: "Settings" });
        await expect(
            settings.getByLabel(
                "As in the system's regional settings (1.234,56)"
            )
        ).toBeChecked();
        // Checked once saved.
        const point = settings.getByLabel("Decimal point (1,234.56)");
        await point.click();
        await expect(point).toBeChecked();
        await settings.getByRole("button", { name: "Close" }).click();
        await expect(cell(page, 0, "qty")).toHaveText("2.5");
        await expect(unitPrice).toHaveText("1,234.5000");
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 3,703.50 EUR"
        );
    } finally {
        await closeApp(app);
    }
});
