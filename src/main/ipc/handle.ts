import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { log } from "../logging";
import { isAppUrl } from "../security";

export interface IpcContext {
    /** The window that sent the message; dialogs are attached to it. */
    window: BrowserWindow;
}

/**
 * Registers an IPC handler that answers only the app's own pages. Arguments
 * arrive untyped from the renderer, so each handler validates its own.
 */
export function handle(
    channel: string,
    handler: (context: IpcContext, ...args: unknown[]) => unknown
): void {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
        handler(checkSender(channel, event), ...args)
    );
}

/** Like `handle`, for one-way messages (`ipcRenderer.send`). */
export function on(
    channel: string,
    listener: (context: IpcContext, ...args: unknown[]) => void
): void {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
        try {
            listener(checkSender(channel, event), ...args);
        } catch (error) {
            log.error(`${channel} failed:`, error);
        }
    });
}

function checkSender(
    channel: string,
    event: Pick<IpcMainEvent, "sender" | "senderFrame">
): IpcContext {
    const senderUrl = event.senderFrame?.url ?? "";
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!isAppUrl(senderUrl) || !window) {
        log.warn(`Rejected ${channel} from`, senderUrl);
        throw new Error(`${channel}: sender not allowed`);
    }
    return { window };
}
