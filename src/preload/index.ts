// Runs in the sandboxed preload context. Exposes only the typed `Api`; the
// renderer gets no direct access to Node.js or ipcRenderer.

import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type Api, type AppInfo } from "../shared/ipc";

const api: Api = {
    app: {
        getInfo: () =>
            ipcRenderer.invoke(IpcChannel.AppGetInfo) as Promise<AppInfo>
    }
};

contextBridge.exposeInMainWorld("api", api);
