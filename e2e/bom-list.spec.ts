import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parseBomListFile } from "../src/shared/bom-list-file";
import type { Project } from "../src/shared/model";
import { parseProjectFile, serializeProject } from "../src/shared/project-file";
import { addRow, createProject, createRow } from "../src/shared/project-ops";
import {
    answerOpenDialog,
    answerSaveDialog,
    cell,
    clickMenuItem,
    closeApp,
    editor,
    fillEditor,
    launchApp
} from "./helpers";

/** Rows of [reference, value, qty, DigiKey part number]. */
function bom(rows: [string, string, number, string][]): Project {
    return rows.reduce(
        (project, [reference, value, qty, digikey]) =>
            addRow(
                project,
                createRow({
                    reference,
                    value,
                    qty,
                    footprint: "R_0603",
                    partNumbers: digikey ? { digikey } : {}
                })
            ),
        { ...createProject(), suppliers: ["digikey"] } as Project
    );
}

/** `project` with a result for D-1 fetched at `fetchedAt`. */
function withD1(project: Project, fetchedAt: string): Project {
    return {
        ...project,
        collected: {
            results: {
                digikey: {
                    "D-1": { status: "notFound", runId: "r", fetchedAt }
                }
            },
            runs: {}
        }
    };
}

async function readBom(path: string): Promise<Project> {
    return parseProjectFile(await readFile(path, "utf8"));
}

test("keeps BOMs in a list, with a history and a Combined BOM", async () => {
    const folder = await mkdtemp(join(tmpdir(), "eez-bom-list-"));
    const psu = join(folder, "psu.eezbom");
    const mcu = join(folder, "mcu.eezbom");
    await writeFile(
        psu,
        serializeProject(
            withD1(
                bom([
                    ["R1, R2", "10k", 2, "D-1"],
                    ["C1", "100n", 1, ""]
                ]),
                "2026-10-02T10:00:00Z"
            )
        )
    );
    await writeFile(
        mcu,
        serializeProject(
            withD1(
                bom([
                    ["R1", "10k", 1, "D-1"],
                    ["R5", "10k", 3, "D-2"]
                ]),
                "2026-10-01T10:00:00Z"
            )
        )
    );
    const { app, page } = await launchApp();
    try {
        // A new list gets a history BOM next to it.
        await answerSaveDialog(app, join(folder, "device.eezbom-list"));
        await page.getByRole("button", { name: "BOM list" }).click();
        const pane = page.getByRole("navigation", { name: "BOM list" });
        await expect(
            pane.getByRole("heading", { name: "device" })
        ).toBeVisible();
        await expect(
            pane.getByRole("button", { name: "device history" })
        ).toBeVisible();

        await answerOpenDialog(app, [psu, mcu]);
        await pane.getByRole("button", { name: "Add BOMs…" }).click();
        const psuItem = pane.getByRole("button", { name: /^psu/ });
        const mcuItem = pane.getByRole("button", { name: /^mcu/ });
        await expect(psuItem).toHaveAttribute("aria-current", "true");
        await expect(cell(page, 0, "reference")).toHaveText("R1, R2");
        await expect(page).toHaveTitle("device · psu - EEZ BOM checker");

        // The list names the BOMs relative to its folder.
        expect(
            parseBomListFile(
                await readFile(join(folder, "device.eezbom-list"), "utf8")
            )
        ).toEqual({
            schemaVersion: 1,
            boms: ["psu.eezbom", "mcu.eezbom"],
            history: "device history.eezbom"
        });
        // The history has each component and part number once.
        const history = await readBom(join(folder, "device history.eezbom"));
        expect(
            history.rows.map(row => [row.value, row.partNumbers.digikey])
        ).toEqual([
            ["10k", "D-1"],
            ["10k", "D-2"]
        ]);

        // Another BOM keeps unsaved changes and undo while it's not shown.
        await cell(page, 1, "value").dblclick();
        await fillEditor(page, "value", "220n");
        await page.keyboard.press("Enter");
        await mcuItem.click();
        await expect(cell(page, 1, "reference")).toHaveText("R5");
        await expect(psuItem.getByLabel("unsaved")).toBeVisible();
        await psuItem.click();
        await expect(cell(page, 1, "value")).toHaveText("220n");
        await page.keyboard.press("Control+Z");
        await expect(cell(page, 1, "value")).toHaveText("100n");
        await page.keyboard.press("Control+Y");
        await expect(cell(page, 1, "value")).toHaveText("220n");

        // Combined: the same part numbers in one row, with the BOMs.
        await pane.getByRole("button", { name: "Combined" }).click();
        // Showing it changes no BOM, although psu has newer data for D-1.
        await expect(mcuItem.getByLabel("unsaved")).toHaveCount(0);
        await expect(cell(page, 0, "reference")).toHaveText(
            "R1, R2 (psu); R1 (mcu)"
        );
        await expect(cell(page, 0, "qty")).toHaveText("3");
        await expect(
            page
                .locator('.ag-row[row-index="0"] .ag-cell[col-id^="custom:"]')
                .first()
        ).toHaveText("psu, mcu");
        await expect(cell(page, 2, "reference")).toHaveText("R5");
        // It can't be edited.
        await cell(page, 1, "value").dblclick();
        await expect(editor(page, "value")).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: "Save", exact: true })
        ).toHaveCount(0);

        // Save All writes the changed BOM.
        await clickMenuItem(app, "save-all");
        await expect(psuItem.getByLabel("unsaved")).toHaveCount(0);
        expect((await readBom(psu)).rows[1]?.value).toBe("220n");

        // Removed from the list, the file stays.
        await mcuItem.click();
        await pane.getByRole("button", { name: "Remove" }).click();
        await expect(mcuItem).toHaveCount(0);
        // The list is saved right after it shows the change.
        await expect
            .poll(
                async () =>
                    parseBomListFile(
                        await readFile(
                            join(folder, "device.eezbom-list"),
                            "utf8"
                        )
                    ).boms
            )
            .toEqual(["psu.eezbom"]);
        expect((await readBom(mcu)).rows).toHaveLength(2);
    } finally {
        await closeApp(app);
    }
});
