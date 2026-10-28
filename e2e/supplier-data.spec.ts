import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
    SUPPLIER_DATA_FOLDER,
    readSupplierData
} from "../src/main/project/supplier-data";
import type { CollectedData, Project } from "../src/shared/model";
import { addRow, createProject, createRow } from "../src/shared/project-ops";
import { cell, answerOpenDialog, closeApp, launchApp } from "./helpers";

const collected: CollectedData = {
    results: {
        digikey: {
            "D-1": {
                status: "notFound",
                runId: "run-1",
                fetchedAt: "2026-10-01T10:00:00Z"
            }
        }
    },
    runs: {
        digikey: {
            id: "run-1",
            startedAt: "2026-10-01T10:00:00Z",
            endedAt: "2026-10-01T10:00:01Z",
            state: "complete"
        }
    }
};

/** A BOM file as saved before format 6, with its supplier data in it. */
function oldFile(): string {
    const project: Project = addRow(
        { ...createProject(), suppliers: ["digikey"] },
        createRow({
            reference: "R1",
            value: "10k",
            qty: 1,
            footprint: "R_0603",
            partNumbers: { digikey: "D-1" }
        })
    );
    return JSON.stringify({ ...project, schemaVersion: 5, collected });
}

test("keeps supplier data on the computer, not in the BOM file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "eez-supplier-data-"));
    const bom = join(folder, "old.eezbom");
    await writeFile(bom, oldFile());
    const badge = (page: Page) =>
        cell(page, 0, "pn:digikey").locator(".pn-badge");

    // An old file opens with its data and unsaved changes; saving removes
    // the data from the file.
    const { app, page, userData } = await launchApp();
    try {
        await answerOpenDialog(app, bom);
        await page.getByRole("button", { name: "Open BOM…" }).click();
        await expect(badge(page)).toHaveAttribute("aria-label", "Not found");
        await expect(page).toHaveTitle("*old - EEZ BOM checker");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page).toHaveTitle("old - EEZ BOM checker");
    } finally {
        await closeApp(app);
    }
    const text = await readFile(bom, "utf8");
    expect(text).not.toContain("collected");
    expect(text).not.toContain("run-1");
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 6 });
    expect(
        await readSupplierData(join(userData, SUPPLIER_DATA_FOLDER), bom)
    ).toEqual(collected);

    // Opened again, the data comes from the computer.
    const again = await launchApp({ userData });
    try {
        await answerOpenDialog(again.app, bom);
        await again.page.getByRole("button", { name: "Open BOM…" }).click();
        await expect(badge(again.page)).toHaveAttribute(
            "aria-label",
            "Not found"
        );
        await expect(again.page).toHaveTitle("old - EEZ BOM checker");
    } finally {
        await closeApp(again.app);
    }
});
