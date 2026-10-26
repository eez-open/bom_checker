import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import {
    normalizeSettings,
    SETTINGS_SCHEMA_VERSION,
    type AppSettings
} from "../../shared/settings";
import { isFileNotFound, writeFileAtomic } from "../files";
import { log } from "../logging";

// settings.json in the app's data folder: everything that isn't secret.

let current: AppSettings | null = null;
let pending: Promise<unknown> = Promise.resolve();

function settingsPath(): string {
    return join(app.getPath("userData"), "settings.json");
}

export async function getSettings(): Promise<AppSettings> {
    if (!current) {
        try {
            const text = await readFile(settingsPath(), "utf8");
            current = normalizeSettings(JSON.parse(text));
        } catch (error) {
            if (!isFileNotFound(error)) {
                log.warn("Settings file unreadable; using defaults:", error);
            }
            current = normalizeSettings({});
        }
    }
    return current;
}

/** Applies a change and saves. Changes are written one at a time. */
export function updateSettings(
    change: (settings: AppSettings) => AppSettings
): Promise<AppSettings> {
    const result = pending.then(async () => {
        const next = change(await getSettings());
        const file = { schemaVersion: SETTINGS_SCHEMA_VERSION, ...next };
        await writeFileAtomic(
            settingsPath(),
            JSON.stringify(file, null, 2) + "\n"
        );
        current = next;
        return next;
    });
    pending = result.catch(() => undefined);
    return result;
}
