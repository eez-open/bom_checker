import { app } from "electron";
import { IpcChannel, type AppInfo } from "../../shared/ipc";
import { log } from "../logging";
import { handle } from "./handle";

export function registerAppHandlers(): void {
    handle(IpcChannel.AppGetInfo, (): AppInfo => ({
        name: app.getName(),
        version: app.getVersion(),
        versions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node
        },
        platform: process.platform,
        logFile: log.transports.file.getFile().path
    }));
}
