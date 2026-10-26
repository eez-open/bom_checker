// The contract between the renderer and the main process. The preload script
// exposes `Api` as `window.api`, and main registers one handler per channel.

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

export interface Api {
    app: {
        getInfo(): Promise<AppInfo>;
    };
}

export const IpcChannel = {
    AppGetInfo: "app:get-info"
} as const;
