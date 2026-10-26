import { registerWindowHandlers } from "../window";
import { registerAppHandlers } from "./app";
import { registerDialogHandlers } from "./dialogs";
import { registerProjectHandlers } from "./project";
import { registerSettingsHandlers } from "./settings";

export function registerIpcHandlers(): void {
    registerAppHandlers();
    registerProjectHandlers();
    registerDialogHandlers();
    registerSettingsHandlers();
    registerWindowHandlers();
}
