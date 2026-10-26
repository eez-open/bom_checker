import { app, clipboard, shell } from "electron";
import { z } from "zod";
import { IpcChannel, type AppInfo } from "../../shared/ipc";
import { isAllowedExternalUrl } from "../external-urls";
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

    handle(IpcChannel.AppOpenExternal, async (_context, url) => {
        const target = z.string().parse(url);
        if (!isAllowedExternalUrl(target)) {
            log.warn("Blocked opening", target);
            throw new Error("This address can't be opened.");
        }
        await shell.openExternal(target);
    });

    // The renderer's own clipboard access is denied with other permissions.
    handle(IpcChannel.AppCopyText, (_context, text) =>
        clipboard.writeText(z.string().max(100_000).parse(text))
    );
}
