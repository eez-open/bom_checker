import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
    answerMessageBox,
    answerOpenDialog,
    answerSaveDialog,
    cell,
    editor,
    closeApp,
    launchApp
} from "./helpers";

test("builds a BOM from scratch, saves, undoes and reopens it", async () => {
    const folder = await mkdtemp(join(tmpdir(), "eez-bom-checker-"));
    const filePath = join(folder, "test.eezbom");
    const { app, page } = await launchApp();
    try {
        // Add a row; its Reference cell starts editing right away, and Tab
        // moves on to the next cell.
        await page.getByRole("button", { name: "Add row" }).click();
        await expect(editor(page, "reference")).toBeFocused();
        await page.keyboard.type("C1, C2 ");
        await page.keyboard.press("Tab");
        await expect(editor(page, "value")).toBeFocused();
        await page.keyboard.type("100n");
        await page.keyboard.press("Tab");
        await expect(editor(page, "qty")).toBeFocused();
        await page.keyboard.press("Control+A");
        await page.keyboard.type("2");
        await page.keyboard.press("Tab");
        await expect(editor(page, "footprint")).toBeFocused();
        await page.keyboard.type("0603");
        await page.keyboard.press("Enter");

        await expect(cell(page, 0, "reference")).toHaveText("C1, C2");
        await expect(cell(page, 0, "value")).toHaveText("100n");
        await expect(cell(page, 0, "footprint")).toHaveText("0603");
        await expect(page.getByTestId("bom-summary")).toHaveText(
            "1 row · 2 parts"
        );
        await expect(page).toHaveTitle("*Untitled - EEZ BOM checker");

        // Add a Mouser part-number column and a custom column.
        await page.getByRole("button", { name: "Columns…" }).click();
        const dialog = page.getByRole("dialog", { name: "Columns" });
        await dialog.getByLabel("Mouser").check();
        await dialog.getByLabel("New column name").fill("Mouser_Price");
        await expect(dialog.getByText("reserved")).toBeVisible();
        await dialog.getByLabel("New column name").fill("Notes");
        await dialog.getByRole("button", { name: "Add column" }).click();
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(
            page.getByRole("columnheader", { name: "Notes" })
        ).toBeVisible();

        await cell(page, 0, "pn:mouser").dblclick();
        await expect(editor(page, "pn:mouser")).toBeFocused();
        await page.keyboard.type("80-C0603C104M4R or 81-X");
        await page.keyboard.press("Enter");
        await expect(cell(page, 0, "pn:mouser")).toHaveClass(/cell-invalid/);
        await cell(page, 0, "pn:mouser").dblclick();
        await expect(editor(page, "pn:mouser")).toBeFocused();
        await page.keyboard.press("Control+A");
        await page.keyboard.type("80-C0603C104M4R");
        await page.keyboard.press("Enter");
        await expect(cell(page, 0, "pn:mouser")).not.toHaveClass(
            /cell-invalid/
        );

        // Save.
        await answerSaveDialog(app, filePath);
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page).toHaveTitle("test - EEZ BOM checker");
        const saved = JSON.parse(await readFile(filePath, "utf8")) as {
            suppliers: string[];
            customColumns: { name: string }[];
            rows: Record<string, unknown>[];
        };
        expect(saved.suppliers).toEqual(["mouser"]);
        expect(saved.customColumns.map(c => c.name)).toEqual(["Notes"]);
        expect(saved.rows[0]).toMatchObject({
            reference: "C1, C2",
            value: "100n",
            qty: 2,
            footprint: "0603",
            partNumbers: { mouser: "80-C0603C104M4R" }
        });

        // Undo and redo the last edit.
        await cell(page, 0, "value").click();
        await page.keyboard.press("Control+Z");
        await expect(cell(page, 0, "pn:mouser")).toHaveText(
            "80-C0603C104M4R or 81-X"
        );
        await expect(page).toHaveTitle("*test - EEZ BOM checker");
        await page.keyboard.press("Control+Y");
        await expect(page).toHaveTitle("test - EEZ BOM checker");

        // Delete the row, start a new BOM without saving, reopen the file.
        await page
            .locator('.ag-row[row-index="0"] .ag-selection-checkbox input')
            .check();
        await page.getByRole("button", { name: "Delete row" }).click();
        await expect(page.getByTestId("bom-summary")).toHaveText(
            "0 rows · 0 parts"
        );
        await answerMessageBox(app, 1); // "Don't Save"
        await page.getByRole("button", { name: "New" }).click();
        await expect(page).toHaveTitle("Untitled - EEZ BOM checker");

        await answerOpenDialog(app, filePath);
        await page.getByRole("button", { name: "Open…" }).click();
        await expect(page).toHaveTitle("test - EEZ BOM checker");
        await expect(cell(page, 0, "pn:mouser")).toHaveText("80-C0603C104M4R");
    } finally {
        await closeApp(app);
    }
});

test("asks before closing with unsaved changes", async () => {
    const { app, page } = await launchApp();
    const closed = app.waitForEvent("close");
    try {
        await page.getByRole("button", { name: "Add row" }).click();
        await expect(editor(page, "reference")).toBeFocused();
        await page.keyboard.type("R1");
        await page.keyboard.press("Enter");
        await expect(page).toHaveTitle("*Untitled - EEZ BOM checker");

        const closeWindow = () =>
            app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0]?.close()
            );

        await answerMessageBox(app, 2); // "Cancel"
        await closeWindow();
        await expect(cell(page, 0, "reference")).toHaveText("R1");

        await answerMessageBox(app, 1); // "Don't Save"
        await closeWindow();
        await closed;
    } catch (error) {
        await closeApp(app).catch(() => undefined);
        throw error;
    }
});
