import { dialog, type BrowserWindow } from "electron";
import { inactivityWarnings } from "../shared/inactivity";
import { getLastConnections } from "./collection/session";
import { log } from "./logging";

/** Warns when the app starts that a supplier is about to disable API access
 *  that hasn't been used (#82): LCSC, 30 days before its 180. */
export async function warnAboutInactivity(
    window: BrowserWindow
): Promise<void> {
    const warnings = inactivityWarnings(await getLastConnections(), Date.now());
    if (warnings.length === 0 || window.isDestroyed()) {
        return;
    }
    log.info("Warned about unused API access:", warnings.join(" "));
    await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["OK"],
        noLink: true,
        message: "Supplier API access that isn't used is disabled",
        detail: warnings.join("\n\n")
    });
}
