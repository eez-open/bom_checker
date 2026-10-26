import {
    app,
    BrowserWindow,
    Menu,
    shell,
    type MenuItemConstructorOptions
} from "electron";
import { z } from "zod";
import {
    COLUMN_GROUPS,
    IpcChannel,
    type ColumnGroup,
    type ColumnGroupState,
    type MenuCommand
} from "../shared/ipc";
import { SUPPLIERS } from "../shared/suppliers";
import { showAbout } from "./about";
import { on } from "./ipc/handle";
import { log } from "./logging";
import { sendMenuCommand } from "./window";

const USER_GUIDE_URL =
    "https://github.com/eez-open/bom_checker/blob/main/docs/user-guide.md";

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

let columns: ColumnGroupState = { available: [], hidden: [] };

function columnItems(): MenuItemConstructorOptions[] {
    const name = (group: ColumnGroup) =>
        group === "best" ? "Best Price" : SUPPLIERS[group].name;
    const hidden = columns.hidden.filter(group =>
        columns.available.includes(group)
    );
    return [
        ...COLUMN_GROUPS.map((group, index) =>
            command(`&${name(group)} Columns`, `toggle-columns:${group}`, {
                id: `columns:${group}`,
                type: "checkbox",
                checked: !columns.hidden.includes(group),
                enabled: columns.available.includes(group),
                accelerator: `CmdOrCtrl+${index + 1}`
            })
        ),
        command("Show &All Columns", "show-all-columns", {
            id: "columns:all",
            enabled: hidden.length > 0
        })
    ];
}

const columnGroupStateSchema = z.object({
    available: z.array(z.enum(COLUMN_GROUPS)),
    hidden: z.array(z.enum(COLUMN_GROUPS))
});

export function registerMenuHandlers(): void {
    // The menu is rebuilt: changing items in place doesn't show on every
    // Linux desktop.
    on(IpcChannel.WindowSetColumnGroups, (_context, state) => {
        columns = columnGroupStateSchema.parse(state);
        Menu.setApplicationMenu(createMenu());
    });
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
                command("&Export…", "export", { accelerator: "CmdOrCtrl+E" }),
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
                ...columnItems(),
                { type: "separator" },
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
                    label: "&User Guide",
                    click: () => {
                        shell
                            .openExternal(USER_GUIDE_URL)
                            .catch((error: unknown) =>
                                log.error("Can't open the user guide:", error)
                            );
                    }
                },
                { type: "separator" },
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
