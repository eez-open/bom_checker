// The contract between the renderer and the main process. The preload script
// exposes `Api` as `window.api`, and main registers one handler per channel.

import type { CsvTable } from "./csv-import";
import type { DocumentKind } from "./document-kind";
import type { ExportFormat, ExportSheet } from "./export";
import {
    SUPPLIER_IDS,
    type CollectionRun,
    type LookupResult,
    type Project,
    type SupplierId
} from "./model";
import type { AppSettings, GeneralSettings } from "./settings";
import type { SupplierConfig } from "./supplier-config";

export interface AppInfo {
    name: string;
    version: string;
    versions: {
        electron: string;
        chrome: string;
        node: string;
    };
    platform: string;
    logFile: string;
    /** The regional settings' locale, for numbers (#37), e.g. "hr-HR". */
    systemLocale: string;
}

/** Table columns that can be hidden together (View menu). */
export type ColumnGroup = SupplierId | "best";
export const COLUMN_GROUPS: readonly ColumnGroup[] = [...SUPPLIER_IDS, "best"];

/** What the renderer tells main for enabling menu items. */
export interface MenuState {
    /** False on the start page. */
    documentOpen: boolean;
    /** A BOM list is open (#35). */
    listOpen: boolean;
    /** False for a view that can't be edited, e.g. a list's Combined. */
    editable: boolean;
    /** The open BOM has rows, to collect and export (#38). */
    hasRows: boolean;
    /** The open BOM was imported from a KiCad project. */
    fromKicad: boolean;
    /** Column groups the table has now. */
    availableColumns: ColumnGroup[];
    hiddenColumns: ColumnGroup[];
    /** Column groups are on tabs (#41); then hiddenColumns are the tabs
     *  that aren't shown. */
    tabs: boolean;
}

/** Commands sent from the application menu (and the close prompt). */
export type MenuCommand =
    | "new"
    | "new-list"
    | "open"
    | "close"
    | "save"
    | "save-as"
    | "save-all"
    | "add-boms"
    | "unify"
    | "import-csv"
    | "import-kicad"
    | "export"
    | "update-kicad"
    | "sync-kicad"
    | "find"
    | "cost-chart"
    | "undo"
    | "redo"
    | "add-row"
    | "delete-rows"
    | "edit-columns"
    | `toggle-columns:${ColumnGroup}`
    | "show-all-columns"
    | "toggle-tabs"
    | "settings"
    | "lock"
    | "collect"
    | "forget-data"
    | "save-and-close";

export interface OpenedProject {
    filePath: string;
    project: Project;
    /** The file still has supplier data (saved before format 6); saving
     *  it again removes the data, which is kept on the computer now. */
    supplierDataInFile?: boolean;
}

export interface OpenedFile {
    filePath: string;
    fileName: string;
    bytes: Uint8Array;
}

export interface RecentDocument {
    path: string;
    /** File name with extension. */
    name: string;
    kind: DocumentKind;
}

/** A BOM of an opened list (#35); `project` is null when the file can't be
 *  read, and `error` says why. */
export interface OpenedListBom {
    path: string;
    project: Project | null;
    error?: string;
    /** As in `OpenedProject`. */
    supplierDataInFile?: boolean;
}

export interface OpenedList {
    filePath: string;
    boms: OpenedListBom[];
    /** The BOM with the parts used before; null if the list has none. */
    history: OpenedListBom | null;
}

/** A file opened by path: a BOM or a list, or a file to import. */
export type OpenedDocument =
    | { kind: "project"; opened: OpenedProject }
    | { kind: "list"; list: OpenedList }
    | { kind: "csv"; file: OpenedFile }
    | { kind: "kicad"; project: KicadProjectData };

export interface SaveOptions {
    /** Current file, or null for a BOM that was never saved. */
    filePath: string | null;
    /** Ask for a new file even when `filePath` is set. */
    saveAs: boolean;
    /** File name offered in the Save dialog when there's no `filePath`. */
    suggestedName?: string;
    /** Add the file to the recent documents (default); a list's BOMs
     *  aren't. */
    recent?: boolean;
}

export interface KicadVariantData {
    name: string;
    /** Rows grouped like KiCad's Symbol Fields Table. */
    table: CsvTable;
    partCount: number;
    warnings: string[];
}

/** A KiCad project's BOM, for each design variant. */
export interface KicadProjectData {
    name: string;
    path: string;
    variants: KicadVariantData[];
    warnings: string[];
    /** Fields the project's own BOM settings show; null if it has none. */
    bomFields: string[] | null;
}

/** A BOM column to write into the KiCad project it was imported from. */
export interface KicadUpdateColumn {
    /** "pn:<supplier>" or "custom:<column id>". */
    key: string;
    label: string;
    /** For a part-number column: its supplier's field is found by name. */
    supplier?: SupplierId;
    /** For a custom column: the KiCad field of the same name. */
    field?: string;
}

export interface KicadUpdateRequest {
    /** The .kicad_pro the BOM was imported from. */
    projectPath: string;
    variant: string;
    columns: KicadUpdateColumn[];
    rows: {
        reference: string;
        /** By column key; "" for an empty cell. */
        values: Record<string, string>;
    }[];
}

/** What updating the KiCad project would change. */
export interface KicadUpdatePlan {
    projectName: string;
    variant: string;
    /** Columns that can be written, and the KiCad field each goes to. */
    columns: {
        key: string;
        label: string;
        field: string;
        /** The field doesn't exist yet and is added to the symbols. */
        newField: boolean;
        changes: number;
    }[];
    /** One per BOM row and field. */
    changes: {
        key: string;
        references: string;
        field: string;
        from: string;
        to: string;
    }[];
    /** Rows whose references match a row of KiCad's BOM. */
    matchedRows: number;
    /** Rows left out, and why. */
    skipped: { references: string; reason: string }[];
    warnings: string[];
}

export interface KicadUpdateResult {
    changes: number;
    /** Changed files, relative to the project folder. */
    files: string[];
    /** Copies of the project's files from before the update. */
    backupFolder: string;
}

export interface ExportRequest {
    format: ExportFormat;
    /** File name offered in the Save dialog, without extension. */
    suggestedName: string;
    sheets: ExportSheet[];
    /** CSV: numbers with a decimal comma, and ";" between the values
     *  (#37). */
    decimalComma: boolean;
}

export type SaveChangesChoice = "save" | "discard" | "cancel";

export interface ConfirmOptions {
    message: string;
    detail?: string;
    confirmLabel: string;
}

export interface DocumentState {
    name: string;
    dirty: boolean;
}

/** "none": no password has been set yet. */
export type VaultState = "none" | "locked" | "unlocked";

/** Which secret fields have a value, by supplier and field key. */
export type SecretStatus = Record<SupplierId, Record<string, boolean>>;

/** New secret values by field key; null removes one. Others don't change. */
export type SecretChanges = Record<string, string | null>;

/** Whether a supplier can be collected now, and what it would cost. */
export interface SupplierReadiness {
    /** Why collecting isn't possible, or null. */
    problem: string | null;
    batchSize: number;
    requestsPerBatch: number;
    /** Requests left today; null without a daily limit. */
    remainingToday: number | null;
}

export interface CollectJob {
    supplier: SupplierId;
    runId: string;
    partNumbers: string[];
}

export type CollectEvent =
    | {
          type: "progress";
          supplier: SupplierId;
          done: number;
          total: number;
          current: string | null;
      }
    | {
          type: "results";
          supplier: SupplierId;
          /** By `partNumberKey()`. */
          results: Record<string, LookupResult>;
      }
    | { type: "supplier-done"; supplier: SupplierId; run: CollectionRun }
    | { type: "done" };

export interface ConnectionTest {
    ok: boolean;
    lines: string[];
}

export interface Api {
    app: {
        getInfo(): Promise<AppInfo>;
        /** Opens a supplier web page in the default browser. */
        openExternal(url: string): Promise<void>;
        copyText(text: string): Promise<void>;
        /** Puts a PNG image on the clipboard. */
        copyImage(png: Uint8Array): Promise<void>;
        /** The path of a file dropped on the window; "" if it has none. */
        pathForFile(file: File): string;
    };
    files: {
        /** Opens a BOM or reads a file to import, by its extension. Null
         *  when it can't (main has shown why). */
        openPath(path: string): Promise<OpenedDocument | null>;
    };
    recent: {
        list(): Promise<RecentDocument[]>;
        remove(path: string): Promise<void>;
        /** Called with the new list after every change. */
        onChange(listener: (documents: RecentDocument[]) => void): () => void;
    };
    settings: {
        get(): Promise<AppSettings>;
        saveGeneral(general: GeneralSettings): Promise<AppSettings>;
        /** `token` comes from `vault.create` or `vault.openSettings`. */
        saveSupplier(
            token: string,
            supplier: SupplierId,
            config: SupplierConfig,
            secrets: SecretChanges
        ): Promise<AppSettings>;
    };
    vault: {
        getState(): Promise<VaultState>;
        /** Sets the first password and opens supplier settings. */
        create(password: string): Promise<string>;
        /** Checks the password and opens supplier settings; returns a
         *  token, or null if the password is wrong. */
        openSettings(password: string): Promise<string | null>;
        closeSettings(token: string): void;
        getSecretStatus(token: string): Promise<SecretStatus>;
        /** A stored secret, for Show and Copy; null if it isn't set. */
        getSecret(
            token: string,
            supplier: SupplierId,
            key: string
        ): Promise<string | null>;
        /** False if the current password is wrong. */
        changePassword(
            currentPassword: string,
            newPassword: string
        ): Promise<boolean>;
        /** Asks for confirmation, then deletes all stored credentials and
         *  the password. True if it did. */
        reset(): Promise<boolean>;
        lock(): Promise<void>;
        /** Unlocks the credentials for this session; false if the password
         *  is wrong. */
        unlock(password: string): Promise<boolean>;
        /** Whether the password is right, without unlocking anything, e.g.
         *  to confirm exporting supplier data (#44). */
        checkPassword(password: string): Promise<boolean>;
    };
    collect: {
        prepare(): Promise<Record<SupplierId, SupplierReadiness>>;
        /** Starts collecting; progress and results arrive as events. */
        start(jobs: CollectJob[]): Promise<void>;
        cancel(): void;
        onEvent(listener: (event: CollectEvent) => void): () => void;
        /** Looks up the supplier's test part number with the saved
         *  settings. `token` is a supplier settings session. */
        testConnection(
            token: string,
            supplier: SupplierId
        ): Promise<ConnectionTest>;
    };
    project: {
        /** Opens a BOM or a BOM list. Null when cancelled, or when the
         *  file can't be opened (main has already shown the error). */
        open(): Promise<Extract<
            OpenedDocument,
            { kind: "project" | "list" }
        > | null>;
        /** Returns the saved file's path; null when cancelled or failed. */
        save(project: Project, options: SaveOptions): Promise<string | null>;
    };
    csv: {
        open(): Promise<OpenedFile | null>;
    };
    /** BOM lists (#35). */
    list: {
        /** Asks where to save a new list, and creates it with an empty
         *  history BOM next to it (or the one already there). */
        create(): Promise<OpenedList | null>;
        /** Writes the list file. Every path must be a BOM main has read. */
        save(
            filePath: string,
            boms: string[],
            history: string | null
        ): Promise<void>;
        /** Lets the user pick BOMs to add; the ones that could be read. */
        addBoms(): Promise<OpenedProject[]>;
        /** Lets the user pick another history BOM. */
        chooseHistory(): Promise<OpenedProject | null>;
        /** Copies the BOMs' files to a backup folder next to the list,
         *  then saves them; returns the backup folder. */
        saveBoms(
            listPath: string,
            boms: { filePath: string; project: Project }[]
        ): Promise<string>;
        showBackup(backupFolder: string): void;
    };
    export: {
        /** Asks where to save and writes the file; the path, or null. */
        save(request: ExportRequest): Promise<string | null>;
        /** Asks where to save a PNG image and writes it; the path, or
         *  null. */
        saveImage(
            png: Uint8Array,
            suggestedName: string
        ): Promise<string | null>;
        showInFolder(path: string): void;
    };
    kicad: {
        /** Lets the user pick a .kicad_pro and reads its BOM. Null when
         *  cancelled or the project can't be read (main shows why). */
        open(): Promise<KicadProjectData | null>;
        /** Reads the project and works out what updating it would change. */
        planUpdate(request: KicadUpdateRequest): Promise<KicadUpdatePlan>;
        /** Backs up the project, then writes the chosen columns. */
        applyUpdate(
            request: KicadUpdateRequest,
            columns: string[]
        ): Promise<KicadUpdateResult>;
        /** Asks for confirmation, then puts the backed-up files back; true
         *  if it did. */
        restoreBackup(backupFolder: string): Promise<boolean>;
        showBackup(backupFolder: string): void;
    };
    dialog: {
        askSaveChanges(documentName: string): Promise<SaveChangesChoice>;
        confirm(options: ConfirmOptions): Promise<boolean>;
    };
    window: {
        /** Tells main what's open, for the "Save changes?" prompt on close. */
        setDocumentState(state: DocumentState): void;
        /** Closes the window after a "save-and-close" command succeeded. */
        closeConfirmed(): void;
        /** Enables and checks menu items to match the UI. */
        setMenuState(state: MenuState): void;
    };
    /** Subscribes to menu commands; returns an unsubscribe function. */
    onMenuCommand(listener: (command: MenuCommand) => void): () => void;
    /** File → Open Recent; returns an unsubscribe function. */
    onOpenRecent(listener: (path: string) => void): () => void;
}

export const IpcChannel = {
    AppGetInfo: "app:get-info",
    AppOpenExternal: "app:open-external",
    AppCopyText: "app:copy-text",
    AppCopyImage: "app:copy-image",
    SettingsGet: "settings:get",
    SettingsSaveGeneral: "settings:save-general",
    SettingsSaveSupplier: "settings:save-supplier",
    VaultGetState: "vault:get-state",
    VaultCreate: "vault:create",
    VaultOpenSettings: "vault:open-settings",
    VaultCloseSettings: "vault:close-settings",
    VaultGetSecretStatus: "vault:get-secret-status",
    VaultGetSecret: "vault:get-secret",
    VaultChangePassword: "vault:change-password",
    VaultReset: "vault:reset",
    VaultLock: "vault:lock",
    VaultUnlock: "vault:unlock",
    VaultCheckPassword: "vault:check-password",
    CollectPrepare: "collect:prepare",
    CollectStart: "collect:start",
    CollectCancel: "collect:cancel",
    CollectEvent: "collect:event",
    CollectTestConnection: "collect:test-connection",
    ProjectOpen: "project:open",
    ProjectSave: "project:save",
    CsvOpen: "csv:open",
    ListCreate: "list:create",
    ListSave: "list:save",
    ListAddBoms: "list:add-boms",
    ListChooseHistory: "list:choose-history",
    ListSaveBoms: "list:save-boms",
    ListShowBackup: "list:show-backup",
    KicadOpen: "kicad:open",
    KicadPlanUpdate: "kicad:plan-update",
    KicadApplyUpdate: "kicad:apply-update",
    KicadRestoreBackup: "kicad:restore-backup",
    KicadShowBackup: "kicad:show-backup",
    ExportSave: "export:save",
    ExportSaveImage: "export:save-image",
    ExportShowInFolder: "export:show-in-folder",
    DialogAskSaveChanges: "dialog:ask-save-changes",
    DialogConfirm: "dialog:confirm",
    WindowSetDocumentState: "window:set-document-state",
    WindowCloseConfirmed: "window:close-confirmed",
    WindowSetMenuState: "window:set-menu-state",
    FilesOpenPath: "files:open-path",
    RecentList: "recent:list",
    RecentRemove: "recent:remove",
    RecentChanged: "recent:changed",
    MenuCommand: "menu:command",
    MenuOpenRecent: "menu:open-recent"
} as const;
