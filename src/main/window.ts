import { join } from "node:path";
import { BrowserWindow } from "electron";
import { log } from "./logging";
import { devServerUrl } from "./security";

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

    window.once("ready-to-show", () => window.show());
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
