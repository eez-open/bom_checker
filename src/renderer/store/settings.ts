import { create } from "zustand";
import { defaultSettings, type AppSettings } from "../../shared/settings";

/** Non-secret app settings, as last loaded or saved. */
export const useAppSettings = create<{ settings: AppSettings }>()(() => ({
    settings: defaultSettings()
}));

export function setAppSettings(settings: AppSettings): void {
    useAppSettings.setState({ settings });
}

export function loadAppSettings(): void {
    window.api.settings
        .get()
        .then(setAppSettings)
        .catch((error: unknown) =>
            console.error("Failed to load settings", error)
        );
}
