// The contract between the renderer and the main process. The preload script
// exposes `Api` as `window.api`, and main registers one handler per channel.

import type { Project } from "./model";

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
    | "undo"
    | "redo"
    | "add-row"
    | "delete-rows"
    | "edit-columns"
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

export interface Api {
    app: {
        getInfo(): Promise<AppInfo>;
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
    ProjectOpen: "project:open",
    ProjectSave: "project:save",
    CsvOpen: "csv:open",
    DialogAskSaveChanges: "dialog:ask-save-changes",
    DialogConfirm: "dialog:confirm",
    WindowSetDocumentState: "window:set-document-state",
    WindowCloseConfirmed: "window:close-confirmed",
    MenuCommand: "menu:command"
} as const;
