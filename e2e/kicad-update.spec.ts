import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
    answerMessageBox,
    answerOpenDialog,
    cell,
    closeApp,
    fillEditor,
    launchApp,
    unpackExample
} from "./helpers";

const OLD = '"81-GRT1885C2A102JA2D"';
const NEW = '"81-NEW-PART"';

/** The project's schematics, by file name. */
async function schematics(folder: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const name of await readdir(folder)) {
        if (name.endsWith(".kicad_sch")) {
            files.set(name, await readFile(join(folder, name), "utf8"));
        }
    }
    return files;
}

function count(text: string, part: string): number {
    return text.split(part).length - 1;
}

test("writes changed part numbers back into the KiCad project", async () => {
    const projectPath = await unpackExample();
    const folder = dirname(projectPath);
    const before = await schematics(folder);
    const { app, page } = await launchApp();
    try {
        await answerOpenDialog(app, projectPath);
        await page.getByRole("button", { name: "Import KiCad…" }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();

        // Change the Mouser number of C1,C2,C3,C4,C32,C59.
        await expect(cell(page, 0, "reference")).toHaveText(
            "C1,C2,C3,C4,C32,C59"
        );
        await cell(page, 0, "pn:mouser").dblclick();
        await fillEditor(page, "pn:mouser", "81-NEW-PART");
        await page.keyboard.press("Enter");

        await page.getByRole("button", { name: "Update KiCad…" }).click();
        const dialog = page.getByRole("dialog", {
            name: "Update KiCad project"
        });
        await expect(
            dialog.getByText(/124 of 124 BOM rows match a row of KiCad's BOM/)
        ).toBeVisible();
        await expect(
            dialog.getByRole("checkbox", { name: /^Mouser → field "Mouser"/ })
        ).toBeChecked();
        await expect(dialog.getByRole("row")).toHaveText([
            "ReferencesFieldIn KiCadNew value",
            "C1,C2,C3,C4,C32,C59Mouser81-GRT1885C2A102JA2D81-NEW-PART"
        ]);
        await dialog
            .getByRole("button", { name: "Update KiCad project" })
            .click();
        await expect(dialog.getByRole("status")).toContainText(
            "Updated 1 value in"
        );

        // Only those six values changed; everything else is byte for byte
        // the same.
        const after = await schematics(folder);
        let written = 0;
        for (const [name, text] of after) {
            written += count(text, NEW);
            expect(text.replaceAll(NEW, OLD)).toBe(before.get(name));
        }
        expect(written).toBe(6);

        // The backup holds the files as they were.
        const backups = join(folder, "bom-checker-backups");
        const [backup] = await readdir(backups);
        const manifest = JSON.parse(
            await readFile(join(backups, backup!, "backup.json"), "utf8")
        ) as { files: { copy: string }[] };
        expect(manifest.files).toHaveLength(before.size + 1);
        for (const [name, text] of before) {
            expect(await readFile(join(backups, backup!, name), "utf8")).toBe(
                text
            );
        }

        // Restore puts them back.
        await answerMessageBox(app, 0); // "Restore"
        await dialog
            .getByRole("button", { name: "Restore the backup" })
            .click();
        await expect(dialog.getByRole("status")).toContainText(
            "The KiCad project is back as it was before the update."
        );
        expect(await schematics(folder)).toEqual(before);
    } finally {
        await closeApp(app);
    }
});
