import { app, BrowserWindow, dialog, shell } from "electron";
import { log } from "./logging";

export async function showAbout(): Promise<void> {
    const logFile = log.transports.file.getFile().path;
    const options: Electron.MessageBoxOptions = {
        type: "info",
        title: `About ${app.getName()}`,
        message: `${app.getName()} ${app.getVersion()}`,
        detail: [
            `Electron ${process.versions.electron}`,
            `Chromium ${process.versions.chrome}`,
            `Node.js ${process.versions.node}`,
            "",
            `Log file: ${logFile}`
        ].join("\n"),
        buttons: ["OK", "Show Log File"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    };
    const window = BrowserWindow.getFocusedWindow();
    const { response } = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
    if (response === 1) {
        shell.showItemInFolder(logFile);
    }
}
