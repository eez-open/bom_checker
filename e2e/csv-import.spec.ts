import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { answerOpenDialog, cell, closeApp, launchApp } from "./helpers";

const EXAMPLE = join(__dirname, "../BOM example.csv");

test("imports BOM example.csv", async () => {
    const { app, page } = await launchApp();
    try {
        await answerOpenDialog(app, EXAMPLE);
        await page.getByRole("button", { name: "Import CSV…" }).click();

        const dialog = page.getByRole("dialog", {
            name: "Import BOM example.csv"
        });
        await expect(dialog.getByLabel('Import "LCSC" as')).toHaveValue(
            "custom:text"
        );
        await expect(dialog.getByText("125 rows")).toBeVisible();

        // Choosing Reference twice is reported and blocks the import.
        await dialog
            .getByLabel('Import "Value" as')
            .selectOption("base:reference");
        await expect(
            dialog.getByText('"Reference" is chosen for more than one column.')
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: "Import" })
        ).toBeDisabled();
        await dialog.getByLabel('Import "Value" as').selectOption("base:value");

        await dialog.getByRole("button", { name: "Import" }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("bom-summary")).toHaveText(
            "125 rows · 367 parts"
        );
        await expect(page).toHaveTitle("*Untitled - EEZ BOM checker");
        await expect(cell(page, 0, "pn:digikey")).toHaveText("732-7858-1-ND");
    } finally {
        await closeApp(app);
    }
});
