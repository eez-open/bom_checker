import { join } from "node:path";
import { BrowserWindow } from "electron";
import { z } from "zod";
import { IpcChannel, type MenuCommand } from "../shared/ipc";
import { askSaveChanges } from "./dialogs";
import { on } from "./ipc/handle";
import { log } from "./logging";
import { devServerUrl } from "./security";

/** What the renderer reported about the open BOM. */
interface WindowDocument {
    name: string;
    dirty: boolean;
    /** Set once the user agreed to close; the next close goes through. */
    closeConfirmed: boolean;
    prompting: boolean;
}

const documents = new WeakMap<BrowserWindow, WindowDocument>();

export function createMainWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1280,
        height: 800,
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

    window.once("ready-to-show", () => window.show());
    window.on("close", event => confirmClose(window, event));
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
