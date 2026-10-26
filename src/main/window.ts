import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, screen } from "electron";
import { z } from "zod";
import { IpcChannel, type MenuCommand } from "../shared/ipc";
import { askSaveChanges } from "./dialogs";
import { on } from "./ipc/handle";
import { log } from "./logging";
import { devServerUrl } from "./security";
import { fitToScreens, type WindowState } from "./window-bounds";

/** What the renderer reported about the open BOM. */
interface WindowDocument {
    name: string;
    dirty: boolean;
    /** Set once the user agreed to close; the next close goes through. */
    closeConfirmed: boolean;
    prompting: boolean;
}

const documents = new WeakMap<BrowserWindow, WindowDocument>();

function windowStatePath(): string {
    return join(app.getPath("userData"), "window-state.json");
}

/** Size and position from last time, fitted to the screens now. */
function loadWindowState(): WindowState {
    let saved: unknown;
    try {
        saved = JSON.parse(readFileSync(windowStatePath(), "utf8"));
    } catch {
        saved = undefined; // first start, or unreadable: use the default
    }
    return fitToScreens(
        saved,
        screen.getAllDisplays().map(display => display.workArea)
    );
}

function saveWindowState(window: BrowserWindow): void {
    const state: WindowState = {
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized()
    };
    try {
        writeFileSync(windowStatePath(), JSON.stringify(state, null, 2));
    } catch (error) {
        log.warn("Can't save the window position:", error);
    }
}

export function createMainWindow(): BrowserWindow {
    const state = loadWindowState();
    const window = new BrowserWindow({
        ...state.bounds,
        minWidth: 800,
        minHeight: 500,
        show: false,
        title: "EEZ BOM checker",
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false
        }
    });
    documents.set(window, {
        name: "Untitled",
        dirty: false,
        closeConfirmed: false,
        prompting: false
    });

    window.once("ready-to-show", () => {
        if (state.maximized) {
            window.maximize();
        }
        window.show();
    });
    window.on("close", event => {
        saveWindowState(window);
        confirmClose(window, event);
    });
    window.webContents.on("render-process-gone", (_event, details) =>
        log.error("Renderer process gone:", details)
    );

    const devUrl = devServerUrl();
    const loading = devUrl
        ? window.loadURL(devUrl)
        : window.loadFile(join(__dirname, "../renderer/index.html"));
    loading.catch((error: unknown) => log.error("Failed to load UI:", error));

    return window;
}

export function sendMenuCommand(
    window: BrowserWindow,
    command: MenuCommand
): void {
    window.webContents.send(IpcChannel.MenuCommand, command);
}

/** Asks "Save changes?" when the BOM has unsaved changes. Saving is done by
 *  the renderer, which then calls `closeConfirmed`. */
function confirmClose(window: BrowserWindow, event: Electron.Event): void {
    const document = documents.get(window);
    if (!document?.dirty || document.closeConfirmed) {
        return;
    }
    event.preventDefault();
    if (document.prompting) {
        return;
    }
    document.prompting = true;
    askSaveChanges(window, document.name)
        .then(choice => {
            if (choice === "discard") {
                document.closeConfirmed = true;
                window.close();
            } else if (choice === "save") {
                sendMenuCommand(window, "save-and-close");
            }
        })
        .catch((error: unknown) => log.error("Close prompt failed:", error))
        .finally(() => (document.prompting = false));
}

const documentStateSchema = z.object({
    name: z.string(),
    dirty: z.boolean()
});

export function registerWindowHandlers(): void {
    on(IpcChannel.WindowSetDocumentState, ({ window }, state) => {
        const document = documents.get(window);
        if (document) {
            Object.assign(document, documentStateSchema.parse(state));
        }
    });
    on(IpcChannel.WindowCloseConfirmed, ({ window }) => {
        const document = documents.get(window);
        if (document) {
            document.closeConfirmed = true;
        }
        window.close();
    });
}
