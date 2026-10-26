import { app } from "electron";
import log from "electron-log/main";

export { log };

/**
 * Logs go to a file in the app's data folder (the path is shown by
 * `app:get-info`), so users can attach it to bug reports.
 */
export function initLogging(): void {
    log.transports.file.level = "info";
    log.transports.console.level = app.isPackaged ? false : "debug";
    log.errorHandler.startCatching({ showDialog: false });
    log.info(
        `Starting ${app.getName()} ${app.getVersion()}`,
        `(Electron ${process.versions.electron}, ${process.platform})`
    );
}
