import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { answerOpenDialog, closeApp, launchApp } from "./helpers";

const FIXTURE = join(__dirname, "../test-fixtures/kicad/dib-dcp405plus");

/** Unpacks the gzipped example project into a temporary folder. */
async function unpackExample(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "eez-kicad-"));
    for (const name of await readdir(FIXTURE)) {
        if (name.endsWith(".gz")) {
            const data = gunzipSync(await readFile(join(FIXTURE, name)));
            await writeFile(join(folder, name.slice(0, -3)), data);
        }
    }
    return join(folder, "EEZ DIB DCP405plus.kicad_pro");
}

test("imports a design variant of a KiCad 10 project", async () => {
    const projectPath = await unpackExample();
    const { app, page } = await launchApp();
    try {
        await answerOpenDialog(app, projectPath);
        await page.getByRole("button", { name: "Import KiCad…" }).click();

        const dialog = page.getByRole("dialog", {
            name: "Import EEZ DIB DCP405plus"
        });
        await expect(
            dialog.getByRole("radio", { name: /Default/ })
        ).toBeChecked();
        await expect(dialog.getByText("(366 parts)")).toBeVisible();
        await dialog.getByRole("radio", { name: /Basic/ }).check();
        await expect(dialog.getByText("(322 parts)")).toBeVisible();

        // Supplier fields are recognised; fields the project's own BOM hides
        // start as "Don't import".
        await expect(dialog.getByLabel('Import "DigiKey" as')).toHaveValue(
            "pn:digikey"
        );
        await expect(dialog.getByLabel('Import "LCSC" as')).toHaveValue(
            "pn:lcsc"
        );
        await expect(dialog.getByLabel('Import "Description" as')).toHaveValue(
            "ignore"
        );

        await dialog.getByRole("button", { name: "Import" }).click();
        await expect(page.getByTestId("bom-summary")).toHaveText(
            / · 322 parts$/
        );
        await expect(page).toHaveTitle("*Untitled - EEZ BOM checker");

        // Saving suggests the project and variant name.
        const savePath = join(tmpdir(), `eez-kicad-${Date.now()}.eezbom`);
        await app.evaluate(({ dialog: electronDialog }, filePath) => {
            electronDialog.showSaveDialog = ((
                _window: unknown,
                options: { defaultPath?: string }
            ) => {
                (globalThis as Record<string, unknown>).suggestedSavePath =
                    options.defaultPath;
                return Promise.resolve({ canceled: false, filePath });
            }) as unknown as typeof electronDialog.showSaveDialog;
        }, savePath);
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page).toHaveTitle(/^eez-kicad-/);
        const suggested = await app.evaluate(
            () => (globalThis as Record<string, unknown>).suggestedSavePath
        );
        expect(suggested).toBe("EEZ DIB DCP405plus (Basic).eezbom");
    } finally {
        await closeApp(app);
    }
});
