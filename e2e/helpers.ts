import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect } from "@playwright/test";
import { FAKE_CREDENTIALS } from "./fake-suppliers";
import {
    _electron as electron,
    type ElectronApplication,
    type Locator,
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
export async function launchApp(
    options: { userData?: string; env?: Record<string, string> } = {}
): Promise<{
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
        env: {
            ...electronEnv(),
            // Numbers with a decimal point, whatever this machine's region.
            EEZ_BOM_CHECKER_SYSTEM_LOCALE: "en-US",
            ...options.env,
            EEZ_BOM_CHECKER_USER_DATA: userData
        }
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
    filePath: string | string[]
): Promise<void> {
    const filePaths = Array.isArray(filePath) ? filePath : [filePath];
    await app.evaluate(({ dialog }, filePaths) => {
        dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths });
    }, filePaths);
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

/** The text input of the cell being edited in column `columnId`; typing
 *  must wait until it has focus. */
export function editor(page: Page, columnId: string) {
    return page.locator(`.ag-cell-inline-editing[col-id="${columnId}"] input`);
}

/**
 * Enters `text` in the open cell editor of `columnId`. Right after an
 * editor opens it may still select or reset its content (on a slow machine
 * this swallowed typed characters), so this retries until the editor holds
 * the text.
 */
export async function fillEditor(
    page: Page,
    columnId: string,
    text: string
): Promise<void> {
    const input = editor(page, columnId);
    await expect(input).toBeFocused();
    await expect(async () => {
        await input.fill(text);
        await expect(input).toHaveValue(text, { timeout: 1000 });
    }).toPass();
}

/** `rowIndex` is "t-0" for the pinned Total row. */
export function cell(page: Page, rowIndex: number | string, columnId: string) {
    return page.locator(
        `.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${columnId}"]`
    );
}

/**
 * The grid's tooltip for `target`. It hovers again until the tooltip shows:
 * on a busy machine the grid sometimes misses a hover.
 */
export async function tooltipOf(page: Page, target: Locator): Promise<Locator> {
    const tooltip = page.locator(".ag-tooltip");
    await expect(async () => {
        await page.mouse.move(0, 0);
        await target.hover();
        await expect(tooltip).toBeVisible({ timeout: 2000 });
    }).toPass();
    return tooltip;
}

/** Sets a password and saves the fake suppliers' credentials. */
export async function setUpCredentials(page: Page) {
    await page.getByRole("button", { name: "Settings…" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("tab", { name: "Suppliers" }).click();
    await dialog.getByLabel("Password", { exact: true }).fill("correct horse");
    await dialog.getByLabel("Repeat password").fill("correct horse");
    await dialog.getByRole("button", { name: "Set password" }).click();
    const suppliers: [string, Record<string, string>][] = [
        [
            "DigiKey",
            {
                "Client ID": FAKE_CREDENTIALS.digikey.clientId,
                "Client secret": FAKE_CREDENTIALS.digikey.clientSecret
            }
        ],
        ["Mouser", { "Search API key": FAKE_CREDENTIALS.mouser.apiKey }],
        [
            "TME",
            {
                Token: FAKE_CREDENTIALS.tme.token,
                "App secret": FAKE_CREDENTIALS.tme.appSecret
            }
        ]
    ];
    for (const [supplier, fields] of suppliers) {
        await dialog
            .getByRole("button", { name: supplier, exact: true })
            .click();
        for (const [label, value] of Object.entries(fields)) {
            await dialog.getByLabel(label, { exact: true }).fill(value);
        }
        await dialog
            .getByRole("button", { name: `Save ${supplier} settings` })
            .click();
        await expect(dialog.getByText("Saved.")).toBeVisible();
    }
    await dialog.getByRole("button", { name: "Close" }).click();
}

/** Clicks an application menu item by its id (see main/menu.ts). */
export async function clickMenuItem(app: ElectronApplication, id: string) {
    await app.evaluate(({ Menu }, itemId) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
        if (!item) {
            throw new Error(`No menu item ${itemId}`);
        }
        // Typed as Function; the menu calls it the same way.
        const click = item.click as () => void;
        click();
    }, id);
}

export function menuItemChecked(
    app: ElectronApplication,
    id: string
): Promise<boolean | undefined> {
    return app.evaluate(
        ({ Menu }, itemId) =>
            Menu.getApplicationMenu()?.getMenuItemById(itemId)?.checked,
        id
    );
}

const KICAD_EXAMPLE = join(__dirname, "../test-fixtures/kicad/dib-dcp405plus");

/** Unpacks the gzipped example KiCad project into a temporary folder;
 *  returns the path of its .kicad_pro. */
export async function unpackExample(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "eez-kicad-"));
    for (const name of await readdir(KICAD_EXAMPLE)) {
        if (name.endsWith(".gz")) {
            const data = gunzipSync(await readFile(join(KICAD_EXAMPLE, name)));
            await writeFile(join(folder, name.slice(0, -3)), data);
        }
    }
    return join(folder, "EEZ DIB DCP405plus.kicad_pro");
}
