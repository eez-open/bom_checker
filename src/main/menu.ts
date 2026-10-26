import {
    app,
    BrowserWindow,
    Menu,
    type MenuItemConstructorOptions
} from "electron";
import type { MenuCommand } from "../shared/ipc";
import { showAbout } from "./about";
import { log } from "./logging";
import { sendMenuCommand } from "./window";

function command(
    label: string,
    name: MenuCommand,
    options: MenuItemConstructorOptions = {}
): MenuItemConstructorOptions {
    return {
        label,
        click: () => {
            const window =
                BrowserWindow.getFocusedWindow() ??
                BrowserWindow.getAllWindows()[0];
            if (window) {
                sendMenuCommand(window, name);
            }
        },
        ...options
    };
}

export function createMenu(): Menu {
    const development: MenuItemConstructorOptions[] = app.isPackaged
        ? []
        : [
              { type: "separator" },
              { role: "reload" },
              { role: "toggleDevTools" }
          ];

    return Menu.buildFromTemplate([
        {
            label: "&File",
            submenu: [
                command("&New", "new", { accelerator: "CmdOrCtrl+N" }),
                command("&Open…", "open", { accelerator: "CmdOrCtrl+O" }),
                { type: "separator" },
                command("&Save", "save", { accelerator: "CmdOrCtrl+S" }),
                command("Save &As…", "save-as", {
                    accelerator: "CmdOrCtrl+Shift+S"
                }),
                { type: "separator" },
                command("&Import CSV…", "import-csv", {
                    accelerator: "CmdOrCtrl+I"
                }),
                command("Import &KiCad Project…", "import-kicad", {
                    accelerator: "CmdOrCtrl+K"
                }),
                { type: "separator" },
                { role: "quit", label: "E&xit" }
            ]
        },
        {
            label: "&Edit",
            submenu: [
                // The renderer handles these keys itself, so that text fields
                // keep their own undo while typing.
                command("&Undo", "undo", {
                    accelerator: "CmdOrCtrl+Z",
                    registerAccelerator: false
                }),
                command("&Redo", "redo", {
                    accelerator: "CmdOrCtrl+Y",
                    registerAccelerator: false
                }),
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { type: "separator" },
                command("Add &Row", "add-row"),
                command("&Delete Selected Rows", "delete-rows"),
                { type: "separator" },
                command("&Columns…", "edit-columns")
            ]
        },
        {
            label: "&View",
            submenu: [
                { role: "zoomIn" },
                { role: "zoomOut" },
                { role: "resetZoom" },
                ...development
            ]
        },
        {
            label: "&Tools",
            submenu: [
                command("C&ollect Supplier Data…", "collect"),
                { type: "separator" },
                command("&Settings…", "settings", {
                    accelerator: "CmdOrCtrl+,"
                }),
                command("&Lock Credentials", "lock")
            ]
        },
        {
            label: "&Help",
            submenu: [
                {
                    label: `&About ${app.getName()}`,
                    click: () => {
                        showAbout().catch((error: unknown) =>
                            log.error("About dialog failed:", error)
                        );
                    }
                }
            ]
        }
    ]);
}
