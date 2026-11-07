import { join } from "node:path";
import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipc";
import { initLogging, log } from "./logging";
import { createMenu } from "./menu";
import {
    SUPPLIER_DATA_FOLDER,
    pruneSupplierData
} from "./project/supplier-data";
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
        // Arrow's data is kept for 48 hours only (#62), also of BOMs that
        // aren't opened again.
        pruneSupplierData(
            join(app.getPath("userData"), SUPPLIER_DATA_FOLDER),
            Date.now()
        )
            .then(changed => {
                if (changed > 0) {
                    log.info(
                        `Removed expired supplier data of ${changed} BOMs`
                    );
                }
            })
            .catch((error: unknown) =>
                log.warn("Can't remove expired supplier data:", error)
            );
    })
    .catch((error: unknown) => {
        log.error("Startup failed:", error);
        app.exit(1);
    });
