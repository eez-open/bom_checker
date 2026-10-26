import { registerWindowHandlers } from "../window";
import { registerAppHandlers } from "./app";
import { registerDialogHandlers } from "./dialogs";
import { registerProjectHandlers } from "./project";

export function registerIpcHandlers(): void {
    registerAppHandlers();
    registerProjectHandlers();
    registerDialogHandlers();
    registerWindowHandlers();
}
