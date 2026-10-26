import { dialog, type BrowserWindow } from "electron";
import type { ConfirmOptions, SaveChangesChoice } from "../shared/ipc";

export async function askSaveChanges(
    window: BrowserWindow,
    documentName: string
): Promise<SaveChangesChoice> {
    const choices = ["save", "discard", "cancel"] as const;
    const { response } = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Save", "Don't Save", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        message: `Save changes to "${documentName}"?`,
        detail: "Your changes will be lost if you don't save them."
    });
    return choices[response] ?? "cancel";
}

export async function confirm(
    window: BrowserWindow,
    { message, detail, confirmLabel }: ConfirmOptions
): Promise<boolean> {
    const { response } = await dialog.showMessageBox(window, {
        type: "question",
        buttons: [confirmLabel, "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message,
        detail
    });
    return response === 0;
}

export async function showError(
    window: BrowserWindow,
    message: string,
    error: unknown
): Promise<void> {
    await dialog.showMessageBox(window, {
        type: "error",
        message,
        detail: error instanceof Error ? error.message : String(error)
    });
}
