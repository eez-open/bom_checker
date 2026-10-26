import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipc";
import { initLogging, log } from "./logging";
import { createMenu } from "./menu";
import { denyPermissionRequests, hardenWebContents } from "./security";
import { createMainWindow } from "./window";

initLogging();

app.on("web-contents-created", (_event, contents) =>
    hardenWebContents(contents)
);

app.on("window-all-closed", () => app.quit());

app.whenReady()
    .then(() => {
        denyPermissionRequests();
        registerIpcHandlers();
        Menu.setApplicationMenu(createMenu());
        createMainWindow();
    })
    .catch((error: unknown) => {
        log.error("Startup failed:", error);
        app.exit(1);
    });
