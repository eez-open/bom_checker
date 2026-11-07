import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { serializeProject } from "../src/shared/project-file";
import { addRow, createProject, createRow } from "../src/shared/project-ops";
import {
    answerOpenDialog,
    answerSaveDialog,
    closeApp,
    launchApp
} from "./helpers";

/** Cancels the next file dialogs, keeping the folder they'd start in. */
async function watchDialogs(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ dialog }) => {
        // The options come last, after the window.
        const keep = (args: unknown[]) => {
            (globalThis as { startedIn?: string }).startedIn = (
                args.at(-1) as { defaultPath?: string }
            ).defaultPath;
        };
        dialog.showOpenDialog = (...args: unknown[]) => {
            keep(args);
            return Promise.resolve({ canceled: true, filePaths: [] });
        };
        dialog.showSaveDialog = (...args: unknown[]) => {
            keep(args);
            return Promise.resolve({ canceled: true, filePath: "" });
        };
    });
}

function startedIn(app: ElectronApplication): Promise<string | undefined> {
    return app.evaluate(() => (globalThis as { startedIn?: string }).startedIn);
}

test("file dialogs start where the last file was chosen (#59)", async () => {
    const boms = await mkdtemp(join(tmpdir(), "eez-boms-"));
    const exports = await mkdtemp(join(tmpdir(), "eez-exports-"));
    const bom = join(boms, "board.eezbom");
    await writeFile(
        bom,
        serializeProject(
            addRow(createProject(), createRow({ reference: "R1" }))
        )
    );
    const { app, page, userData } = await launchApp();
    try {
        await answerOpenDialog(app, bom);
        await page.getByRole("button", { name: "Open BOM…" }).click();
        await expect(page).toHaveTitle("board - EEZ BOM checker");

        // An export, to another folder.
        await page.getByRole("button", { name: "Export…" }).click();
        const dialog = page.getByRole("dialog", { name: "Export" });
        await dialog.getByRole("radio", { name: "CSV (.csv)" }).check();
        await answerSaveDialog(app, join(exports, "board.csv"));
        await dialog.getByRole("button", { name: "Export…" }).click();
        await expect(dialog.getByRole("status")).toContainText("Exported");

        await dialog.getByRole("button", { name: "Close" }).click();

        await watchDialogs(app);
        await page.getByRole("button", { name: "Export…" }).click();
        await dialog.getByRole("button", { name: "Export…" }).click();
        await expect
            .poll(async () => dirname((await startedIn(app)) ?? ""))
            .toBe(exports);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await page.getByRole("button", { name: "Open…" }).click();
        await expect.poll(() => startedIn(app)).toBe(boms);
    } finally {
        await closeApp(app);
    }

    // Also after a restart.
    const again = await launchApp({ userData });
    try {
        await watchDialogs(again.app);
        await again.page.getByRole("button", { name: "Open BOM…" }).click();
        await expect.poll(() => startedIn(again.app)).toBe(boms);
    } finally {
        await closeApp(again.app);
    }
});
