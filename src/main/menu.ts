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
    type MenuCommand,
    type MenuState
} from "../shared/ipc";
import { SUPPLIERS } from "../shared/suppliers";
import { showAbout } from "./about";
import { on } from "./ipc/handle";
import { log } from "./logging";
import { clearRecent, onRecentChange, recentDocuments } from "./recent";
import { sendMenuCommand } from "./window";

const USER_GUIDE_URL =
    "https://github.com/eez-open/bom_checker/blob/main/docs/user-guide.md";

function targetWindow(): BrowserWindow | undefined {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function command(
    label: string,
    name: MenuCommand,
    options: MenuItemConstructorOptions = {}
): MenuItemConstructorOptions {
    return {
        label,
        click: () => {
            const window = targetWindow();
            if (window) {
                sendMenuCommand(window, name);
            }
        },
        ...options
    };
}

let state: MenuState = {
    documentOpen: false,
    listOpen: false,
    editable: false,
    hasRows: false,
    fromKicad: false,
    availableColumns: [],
    hiddenColumns: [],
    tabs: false
};

/** A command that needs an open BOM. */
function documentCommand(
    label: string,
    name: MenuCommand,
    options: MenuItemConstructorOptions = {}
): MenuItemConstructorOptions {
    return command(label, name, { enabled: state.documentOpen, ...options });
}

/** A command that changes the open BOM. */
function editCommand(
    label: string,
    name: MenuCommand,
    options: MenuItemConstructorOptions = {}
): MenuItemConstructorOptions {
    return command(label, name, {
        enabled: state.documentOpen && state.editable,
        ...options
    });
}

/** A command that needs rows in the open BOM (#38). */
function rowsCommand(
    label: string,
    name: MenuCommand,
    options: MenuItemConstructorOptions = {}
): MenuItemConstructorOptions {
    return command(label, name, {
        enabled: state.documentOpen && state.hasRows,
        ...options
    });
}

/** A command of a BOM list (#35). */
function listCommand(
    label: string,
    name: MenuCommand,
    options: MenuItemConstructorOptions = {}
): MenuItemConstructorOptions {
    return command(label, name, { enabled: state.listOpen, ...options });
}

function recentItems(): MenuItemConstructorOptions[] {
    const documents = recentDocuments();
    if (documents.length === 0) {
        return [{ label: "No Recent Documents", enabled: false }];
    }
    return [
        ...documents.map((document, index) => ({
            // "&" would be taken as a mnemonic.
            label: `&${(index + 1) % 10}  ${document.path.replaceAll("&", "&&")}`,
            click: () =>
                targetWindow()?.webContents.send(
                    IpcChannel.MenuOpenRecent,
                    document.path
                )
        })),
        { type: "separator" },
        { label: "&Clear Recently Opened", click: clearRecent }
    ];
}

function columnItems(): MenuItemConstructorOptions[] {
    const { availableColumns, hiddenColumns, tabs } = state;
    const name = (group: ColumnGroup) =>
        group === "best" ? "Best Price" : SUPPLIERS[group].name;
    const hidden = hiddenColumns.filter(group =>
        availableColumns.includes(group)
    );
    return [
        command("Suppliers as &Tabs", "toggle-tabs", {
            id: "tabs",
            type: "checkbox",
            checked: tabs,
            enabled: state.documentOpen
        }),
        { type: "separator" },
        // With tabs, they choose the tab.
        ...COLUMN_GROUPS.map((group, index) =>
            command(`&${name(group)} Columns`, `toggle-columns:${group}`, {
                id: `columns:${group}`,
                type: tabs ? "radio" : "checkbox",
                checked: !hiddenColumns.includes(group),
                enabled: availableColumns.includes(group),
                accelerator: `CmdOrCtrl+${index + 1}`
            })
        ),
        command("Show &All Columns", "show-all-columns", {
            id: "columns:all",
            enabled: !tabs && hidden.length > 0
        })
    ];
}

const menuStateSchema = z.object({
    documentOpen: z.boolean(),
    listOpen: z.boolean(),
    editable: z.boolean(),
    hasRows: z.boolean(),
    fromKicad: z.boolean(),
    availableColumns: z.array(z.enum(COLUMN_GROUPS)),
    hiddenColumns: z.array(z.enum(COLUMN_GROUPS)),
    tabs: z.boolean()
});

// The menu is rebuilt on changes: changing items in place doesn't show on
// every Linux desktop.
function refreshMenu(): void {
    Menu.setApplicationMenu(createMenu());
}

export function registerMenuHandlers(): void {
    on(IpcChannel.WindowSetMenuState, (_context, next) => {
        state = menuStateSchema.parse(next);
        refreshMenu();
    });
    onRecentChange(refreshMenu);
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
                command("New BOM &List…", "new-list", { id: "new-list" }),
                command("&Open…", "open", { accelerator: "CmdOrCtrl+O" }),
                {
                    label: "Open &Recent",
                    id: "recent",
                    submenu: recentItems()
                },
                documentCommand("&Close", "close", {
                    id: "close",
                    accelerator: "CmdOrCtrl+W"
                }),
                { type: "separator" },
                editCommand("&Save", "save", {
                    accelerator: "CmdOrCtrl+S"
                }),
                command("Save &As…", "save-as", {
                    accelerator: "CmdOrCtrl+Shift+S",
                    // A list's BOMs keep their files.
                    enabled: state.documentOpen && !state.listOpen
                }),
                listCommand("Save A&ll", "save-all", {
                    id: "save-all",
                    accelerator: "CmdOrCtrl+Alt+S"
                }),
                listCommand("A&dd BOMs to List…", "add-boms", {
                    id: "add-boms"
                }),
                { type: "separator" },
                command("&Import CSV…", "import-csv", {
                    accelerator: "CmdOrCtrl+I"
                }),
                command("Import &KiCad Project…", "import-kicad", {
                    accelerator: "CmdOrCtrl+K"
                }),
                command("S&ync with KiCad Project…", "sync-kicad", {
                    id: "sync-kicad",
                    enabled: state.documentOpen && state.fromKicad
                }),
                { type: "separator" },
                rowsCommand("&Export…", "export", {
                    accelerator: "CmdOrCtrl+E"
                }),
                command("&Update KiCad Project…", "update-kicad", {
                    id: "update-kicad",
                    enabled: state.documentOpen && state.fromKicad
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
                editCommand("&Undo", "undo", {
                    accelerator: "CmdOrCtrl+Z",
                    registerAccelerator: false
                }),
                editCommand("&Redo", "redo", {
                    accelerator: "CmdOrCtrl+Y",
                    registerAccelerator: false
                }),
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { type: "separator" },
                editCommand("Add &Row", "add-row"),
                editCommand("&Delete Selected Rows", "delete-rows"),
                { type: "separator" },
                editCommand("&Columns…", "edit-columns"),
                { type: "separator" },
                documentCommand("&Find…", "find", {
                    id: "find",
                    accelerator: "CmdOrCtrl+F"
                })
            ]
        },
        {
            label: "&View",
            submenu: [
                ...columnItems(),
                { type: "separator" },
                documentCommand("Most &Expensive Parts…", "cost-chart", {
                    id: "cost-chart"
                }),
                listCommand("Cost by &BOM…", "bom-costs", {
                    id: "bom-costs"
                }),
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
                rowsCommand("C&ollect Supplier Data…", "collect"),
                rowsCommand(
                    "&Forget Supplier Data of Selected Rows…",
                    "forget-data",
                    { id: "forget-data" }
                ),
                listCommand("&Unify Part Numbers…", "unify", { id: "unify" }),
                command("Check &History…", "check-history", {
                    id: "check-history",
                    enabled: state.listOpen && state.editable && state.hasRows
                }),
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
