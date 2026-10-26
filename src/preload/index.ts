// Runs in the sandboxed preload context. Exposes only the typed `Api`; the
// renderer gets no direct access to Node.js or ipcRenderer.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannel, type Api, type MenuCommand } from "../shared/ipc";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: Api = {
    app: {
        getInfo: () => invoke(IpcChannel.AppGetInfo)
    },
    project: {
        open: () => invoke(IpcChannel.ProjectOpen),
        save: (project, options) =>
            invoke(IpcChannel.ProjectSave, project, options)
    },
    csv: {
        open: () => invoke(IpcChannel.CsvOpen)
    },
    dialog: {
        askSaveChanges: documentName =>
            invoke(IpcChannel.DialogAskSaveChanges, documentName),
        confirm: options => invoke(IpcChannel.DialogConfirm, options)
    },
    window: {
        setDocumentState: state =>
            ipcRenderer.send(IpcChannel.WindowSetDocumentState, state),
        closeConfirmed: () => ipcRenderer.send(IpcChannel.WindowCloseConfirmed)
    },
    onMenuCommand: listener => {
        const handler = (_event: IpcRendererEvent, command: MenuCommand) =>
            listener(command);
        ipcRenderer.on(IpcChannel.MenuCommand, handler);
        return () =>
            ipcRenderer.removeListener(IpcChannel.MenuCommand, handler);
    }
};

contextBridge.exposeInMainWorld("api", api);
