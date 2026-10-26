import { ipcMain } from "electron";
import { log } from "../logging";
import { isAppUrl } from "../security";

/**
 * Registers an IPC handler that answers only the app's own pages. Arguments
 * arrive untyped from the renderer, so each handler validates its own.
 */
export function handle(
    channel: string,
    handler: (...args: unknown[]) => unknown
): void {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
        const senderUrl = event.senderFrame?.url ?? "";
        if (!isAppUrl(senderUrl)) {
            log.warn(`Rejected ${channel} from`, senderUrl);
            throw new Error(`${channel}: sender not allowed`);
        }
        return handler(...args);
    });
}
