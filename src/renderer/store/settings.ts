import { create } from "zustand";
import { numberLocale, numbersFor, type Numbers } from "../../shared/numbers";
import { defaultSettings, type AppSettings } from "../../shared/settings";

/** Non-secret app settings, as last loaded or saved, and the system's
 *  locale for numbers. */
export const useAppSettings = create<{
    settings: AppSettings;
    systemLocale: string;
}>()(() => ({
    settings: defaultSettings(),
    systemLocale: navigator.language
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
    window.api.app
        .getInfo()
        .then(info =>
            useAppSettings.setState({ systemLocale: info.systemLocale })
        )
        .catch((error: unknown) =>
            console.error("Failed to get the system locale", error)
        );
}

function numbersOf(state: {
    settings: AppSettings;
    systemLocale: string;
}): Numbers {
    return numbersFor(
        numberLocale(
            state.settings.general.decimalSeparator,
            state.systemLocale
        )
    );
}

/** How numbers look, as chosen in Settings → General (#37). */
export function useNumbers(): Numbers {
    return useAppSettings(numbersOf);
}

/** The same outside components, e.g. for exports. */
export function currentNumbers(): Numbers {
    return numbersOf(useAppSettings.getState());
}
