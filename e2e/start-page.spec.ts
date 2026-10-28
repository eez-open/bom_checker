import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
    answerMessageBox,
    clickMenuItem,
    closeApp,
    launchApp
} from "./helpers";

const CSV = join(__dirname, "fixtures/calc-bom.csv");

test("opens recent documents, and forgets ones that are gone", async () => {
    const userData = await mkdtemp(join(tmpdir(), "eez-bom-checker-profile-"));
    const missing = join(userData, "gone.eezbom");
    await writeFile(
        join(userData, "recent-documents.json"),
        JSON.stringify([missing, CSV])
    );
    const { app, page } = await launchApp({ userData });
    try {
        const recent = page.getByRole("region", { name: "Recent documents" });
        await expect(recent.getByRole("listitem")).toHaveCount(2);
        await expect(recent.getByText("CSV", { exact: true })).toBeVisible();

        // A file that was deleted is reported and removed from the list.
        await app.evaluate(({ dialog }) => {
            const shown: string[] = [];
            (globalThis as { shown?: string[] }).shown = shown;
            dialog.showMessageBox = ((
                _window: unknown,
                options: { detail?: string }
            ) => {
                shown.push(options.detail ?? "");
                return Promise.resolve({ response: 0, checkboxChecked: false });
            }) as typeof dialog.showMessageBox;
        });
        await recent.getByRole("button", { name: /^gone\.eezbom/ }).click();
        await expect(recent.getByRole("listitem")).toHaveCount(1);
        expect(
            await app.evaluate(() => (globalThis as { shown?: string[] }).shown)
        ).toEqual([
            `${missing} doesn't exist any more, so it was removed from the recent documents.`
        ]);

        // A CSV file starts the import, as Import CSV… does.
        await recent.getByRole("button", { name: /^calc-bom\.csv/ }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();
        await expect(page.getByTestId("bom-summary")).toHaveText("4 rows");

        // Back on the start page, a document can be removed from the list.
        await answerMessageBox(app, 1); // "Don't Save" the imported BOM
        await clickMenuItem(app, "close");
        await expect(page).toHaveTitle("EEZ BOM checker");
        await recent
            .getByRole("button", { name: "Remove calc-bom.csv from the list" })
            .click();
        await expect(recent).toHaveCount(0);
    } finally {
        await closeApp(app);
    }
});
