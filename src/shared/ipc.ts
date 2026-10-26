// The contract between the renderer and the main process. The preload script
// exposes `Api` as `window.api`, and main registers one handler per channel.

import type { CsvTable } from "./csv-import";
import type { ExportFormat, ExportSheet } from "./export";
import type { CollectionRun, LookupResult, Project, SupplierId } from "./model";
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
}

/** Commands sent from the application menu (and the close prompt). */
export type MenuCommand =
    | "new"
    | "open"
    | "save"
    | "save-as"
    | "import-csv"
    | "import-kicad"
    | "export"
    | "undo"
    | "redo"
    | "add-row"
    | "delete-rows"
    | "edit-columns"
    | "settings"
    | "lock"
    | "collect"
    | "save-and-close";

export interface OpenedProject {
    filePath: string;
    project: Project;
}

export interface OpenedFile {
    filePath: string;
    fileName: string;
    bytes: Uint8Array;
}

export interface SaveOptions {
    /** Current file, or null for a BOM that was never saved. */
    filePath: string | null;
    /** Ask for a new file even when `filePath` is set. */
    saveAs: boolean;
    /** File name offered in the Save dialog when there's no `filePath`. */
    suggestedName?: string;
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

export interface ExportRequest {
    format: ExportFormat;
    /** File name offered in the Save dialog, without extension. */
    suggestedName: string;
    sheets: ExportSheet[];
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
        /** False if the current password is wrong. */
        changePassword(
            token: string,
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
        /** Null when cancelled, or when the file can't be opened (main
         *  has already shown the error). */
        open(): Promise<OpenedProject | null>;
        /** Returns the saved file's path; null when cancelled or failed. */
        save(project: Project, options: SaveOptions): Promise<string | null>;
    };
    csv: {
        open(): Promise<OpenedFile | null>;
    };
    export: {
        /** Asks where to save and writes the file; the path, or null. */
        save(request: ExportRequest): Promise<string | null>;
        showInFolder(path: string): void;
    };
    kicad: {
        /** Lets the user pick a .kicad_pro and reads its BOM. Null when
         *  cancelled or the project can't be read (main shows why). */
        open(): Promise<KicadProjectData | null>;
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
    };
    /** Subscribes to menu commands; returns an unsubscribe function. */
    onMenuCommand(listener: (command: MenuCommand) => void): () => void;
}

export const IpcChannel = {
    AppGetInfo: "app:get-info",
    AppOpenExternal: "app:open-external",
    SettingsGet: "settings:get",
    SettingsSaveGeneral: "settings:save-general",
    SettingsSaveSupplier: "settings:save-supplier",
    VaultGetState: "vault:get-state",
    VaultCreate: "vault:create",
    VaultOpenSettings: "vault:open-settings",
    VaultCloseSettings: "vault:close-settings",
    VaultGetSecretStatus: "vault:get-secret-status",
    VaultChangePassword: "vault:change-password",
    VaultReset: "vault:reset",
    VaultLock: "vault:lock",
    VaultUnlock: "vault:unlock",
    CollectPrepare: "collect:prepare",
    CollectStart: "collect:start",
    CollectCancel: "collect:cancel",
    CollectEvent: "collect:event",
    CollectTestConnection: "collect:test-connection",
    ProjectOpen: "project:open",
    ProjectSave: "project:save",
    CsvOpen: "csv:open",
    KicadOpen: "kicad:open",
    ExportSave: "export:save",
    ExportShowInFolder: "export:show-in-folder",
    DialogAskSaveChanges: "dialog:ask-save-changes",
    DialogConfirm: "dialog:confirm",
    WindowSetDocumentState: "window:set-document-state",
    WindowCloseConfirmed: "window:close-confirmed",
    MenuCommand: "menu:command"
} as const;
