import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    _electron as electron,
    type ElectronApplication,
    type Page
} from "@playwright/test";

// Processes started by VS Code extensions inherit ELECTRON_RUN_AS_NODE=1,
// which would make Electron run as plain Node.js instead of starting the app.
function electronEnv(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] =>
                entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined
        )
    );
}

/** Starts the built app (`npm run build`), or the packaged executable when
 *  E2E_APP_PATH is set; CI does the latter after electron-builder has run.
 *  Each launch gets an empty profile folder (settings, credentials, logs)
 *  unless `userData` names one. */
export async function launchApp(options: { userData?: string } = {}): Promise<{
    app: ElectronApplication;
    page: Page;
    userData: string;
}> {
    const userData =
        options.userData ??
        (await mkdtemp(join(tmpdir(), "eez-bom-checker-profile-")));
    const executablePath = process.env.E2E_APP_PATH;
    const app = await electron.launch({
        ...(executablePath ? { executablePath } : { args: ["."] }),
        env: { ...electronEnv(), EEZ_BOM_CHECKER_USER_DATA: userData }
    });
    const page = await app.firstWindow();
    return { app, page, userData };
}

/** Closes the app, answering "Don't Save" if it asks about unsaved changes,
 *  so a failed test never leaves a window waiting for an answer. */
export async function closeApp(app: ElectronApplication): Promise<void> {
    await answerMessageBox(app, 1).catch(() => undefined);
    await app.close();
}

// Native dialogs can't be clicked by Playwright, so tests replace them in
// the main process with functions that return the given answer.

export async function answerSaveDialog(
    app: ElectronApplication,
    filePath: string
): Promise<void> {
    await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = () =>
            Promise.resolve({ canceled: false, filePath });
    }, filePath);
}

export async function answerOpenDialog(
    app: ElectronApplication,
    filePath: string
): Promise<void> {
    await app.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, filePath);
}

/** Answers message boxes with the button at `response` (0 = first). */
export async function answerMessageBox(
    app: ElectronApplication,
    response: number
): Promise<void> {
    await app.evaluate(({ dialog }, response) => {
        dialog.showMessageBox = () =>
            Promise.resolve({ response, checkboxChecked: false });
    }, response);
}

export function cell(page: Page, rowIndex: number, columnId: string) {
    return page.locator(
        `.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${columnId}"]`
    );
}
