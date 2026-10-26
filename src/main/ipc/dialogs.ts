import { z } from "zod";
import { IpcChannel } from "../../shared/ipc";
import { askSaveChanges, confirm } from "../dialogs";
import { handle } from "./handle";

const confirmOptionsSchema = z.object({
    message: z.string(),
    detail: z.string().optional(),
    confirmLabel: z.string()
});

export function registerDialogHandlers(): void {
    handle(IpcChannel.DialogAskSaveChanges, ({ window }, documentName) =>
        askSaveChanges(window, z.string().parse(documentName))
    );
    handle(IpcChannel.DialogConfirm, ({ window }, options) =>
        confirm(window, confirmOptionsSchema.parse(options))
    );
}
