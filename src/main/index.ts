import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipc";
import { initLogging, log } from "./logging";
import { createMenu } from "./menu";
import { denyPermissionRequests, hardenWebContents } from "./security";
import { createMainWindow } from "./window";

// Lets tests (and anyone who wants a separate profile) use another folder
// for settings, credentials and logs.
const userDataFolder = process.env.EEZ_BOM_CHECKER_USER_DATA;
if (userDataFolder) {
    app.setPath("userData", userDataFolder);
    app.setAppLogsPath(`${userDataFolder}/logs`);
}

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
