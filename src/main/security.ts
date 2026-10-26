import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, session, type WebContents } from "electron";
import { log } from "./logging";

const rendererFileUrl = pathToFileURL(join(__dirname, "../renderer/")).href;

/** The dev server URL; only honoured in unpackaged (development) builds. */
export function devServerUrl(): string | undefined {
    return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
}

/** True for pages that belong to the app itself. */
export function isAppUrl(url: string): boolean {
    const devUrl = devServerUrl();
    return (
        url.startsWith(rendererFileUrl) ||
        (devUrl !== undefined && url.startsWith(devUrl))
    );
}

/** Keeps every window on the app's own pages. */
export function hardenWebContents(contents: WebContents): void {
    contents.on("will-navigate", event => {
        if (!isAppUrl(event.url)) {
            event.preventDefault();
            log.warn("Blocked navigation to", event.url);
        }
    });
    contents.setWindowOpenHandler(({ url }) => {
        log.warn("Blocked new window for", url);
        return { action: "deny" };
    });
    contents.on("will-attach-webview", event => event.preventDefault());
}

/** The app needs no camera, microphone, notifications etc. */
export function denyPermissionRequests(): void {
    session.defaultSession.setPermissionRequestHandler(
        (_contents, permission, callback) => {
            log.warn("Denied permission request:", permission);
            callback(false);
        }
    );
}
