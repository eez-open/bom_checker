import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
    answerOpenDialog,
    cell,
    closeApp,
    fillEditor,
    launchApp,
    unpackExample
} from "./helpers";

/** The table row whose Reference cell is exactly `references`. */
async function rowIndexOf(page: Page, references: string): Promise<number> {
    const row = page.locator(".ag-row", {
        has: page.locator(`.ag-cell[col-id="reference"]`, {
            hasText: new RegExp(`^${references}$`)
        })
    });
    return Number(await row.first().getAttribute("row-index"));
}

test("brings changes made in KiCad into the BOM", async () => {
    const projectPath = await unpackExample();
    const { app, page } = await launchApp();
    try {
        // Tall enough for the grid to render all 126 rows.
        await page.setViewportSize({ width: 1600, height: 5200 });
        await answerOpenDialog(app, projectPath);
        await page.getByRole("button", { name: "Import KiCad…" }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();

        // In the BOM: another Mouser number for C1,C2,C3,C4,C32,C59.
        await cell(page, 0, "pn:mouser").dblclick();
        await fillEditor(page, "pn:mouser", "81-BOM-CHOICE");
        await page.keyboard.press("Enter");

        // In KiCad: R112 gets another Mouser number than its row-mates.
        const file = join(
            dirname(projectPath),
            "Rsense_protection_power_output.kicad_sch"
        );
        const text = await readFile(file, "utf8");
        const r112 = text.indexOf('(property "Reference" "R112"');
        const mouser = text.indexOf(
            '(property "Mouser" "603-RC0805FR-071KL"',
            r112
        );
        await writeFile(
            file,
            text.slice(0, mouser) +
                text
                    .slice(mouser)
                    .replace('"603-RC0805FR-071KL"', '"603-NEW-1K"')
        );

        await page.getByRole("button", { name: "Sync KiCad…" }).click();
        const dialog = page.getByRole("dialog", {
            name: "Sync with the KiCad project"
        });
        // Only KiCad's change is offered; the BOM's own change isn't.
        const change = dialog.getByRole("checkbox", {
            name: "R112 · Mouser: 603-RC0805FR-071KL → 603-NEW-1K"
        });
        await expect(change).toBeChecked();
        await expect(dialog.getByRole("checkbox")).toHaveCount(1);
        await dialog.getByRole("button", { name: "Apply 1 change" }).click();
        await expect(dialog).toBeHidden();

        // R112 has a row of its own now; the others keep theirs.
        const r112Row = await rowIndexOf(page, "R112");
        await expect(cell(page, r112Row, "pn:mouser")).toHaveText("603-NEW-1K");
        await expect(cell(page, r112Row, "qty")).toHaveText("1");
        const rest = await rowIndexOf(
            page,
            "R41,R49,R55,R56,R60,R101,R107,R119,R134,R135,R137,R138"
        );
        await expect(cell(page, rest, "qty")).toHaveText("12");
        await expect(cell(page, 0, "pn:mouser")).toHaveText("81-BOM-CHOICE");

        // Syncing again finds nothing.
        await page.getByRole("button", { name: "Sync KiCad…" }).click();
        await expect(
            dialog.getByText(
                "Nothing changed in KiCad that the BOM doesn't have."
            )
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();

        // One undo step brings the BOM back.
        const r112Rows = page.locator('.ag-cell[col-id="reference"]', {
            hasText: /^R112$/
        });
        await page.keyboard.press("Control+Z");
        await expect(r112Rows).toHaveCount(0);
        await page.keyboard.press("Control+Y");
        await expect(r112Rows).toHaveCount(1);

        // R112 gets its row-mates' number back in KiCad: its row joins
        // theirs again (#55).
        await writeFile(file, text);
        await page.getByRole("button", { name: "Sync KiCad…" }).click();
        await expect(
            dialog.getByRole("checkbox", {
                name: "R112 · Mouser: 603-NEW-1K → 603-RC0805FR-071KL"
            })
        ).toBeChecked();
        const rowJoin = dialog.getByRole("checkbox", {
            name: /^R41, R49, .*R107, R112, R119, .*R138 · .* · 2 rows$/
        });
        await expect(rowJoin).toBeChecked();
        // Without the change, R112's row isn't the same component.
        await dialog
            .getByRole("checkbox", { name: /^R112 · Mouser/ })
            .uncheck();
        await expect(rowJoin).toHaveCount(0);
        await dialog.getByRole("checkbox", { name: /^R112 · Mouser/ }).check();
        await dialog.getByRole("button", { name: "Apply 2 changes" }).click();
        await expect(r112Rows).toHaveCount(0);
        const joined = await rowIndexOf(
            page,
            "R41,R49,R55,R56,R60,R101,R107,R112,R119,R134,R135,R137,R138"
        );
        await expect(cell(page, joined, "qty")).toHaveText("13");
    } finally {
        await closeApp(app);
    }
});
