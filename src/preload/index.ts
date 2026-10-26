// Runs in the sandboxed preload context. Exposes only the typed `Api`; the
// renderer gets no direct access to Node.js or ipcRenderer.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
    IpcChannel,
    type Api,
    type CollectEvent,
    type MenuCommand
} from "../shared/ipc";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: Api = {
    app: {
        getInfo: () => invoke(IpcChannel.AppGetInfo),
        openExternal: url => invoke(IpcChannel.AppOpenExternal, url),
        copyText: text => invoke(IpcChannel.AppCopyText, text)
    },
    settings: {
        get: () => invoke(IpcChannel.SettingsGet),
        saveGeneral: general => invoke(IpcChannel.SettingsSaveGeneral, general),
        saveSupplier: (token, supplier, config, secrets) =>
            invoke(
                IpcChannel.SettingsSaveSupplier,
                token,
                supplier,
                config,
                secrets
            )
    },
    vault: {
        getState: () => invoke(IpcChannel.VaultGetState),
        create: password => invoke(IpcChannel.VaultCreate, password),
        openSettings: password =>
            invoke(IpcChannel.VaultOpenSettings, password),
        closeSettings: token =>
            ipcRenderer.send(IpcChannel.VaultCloseSettings, token),
        getSecretStatus: token =>
            invoke(IpcChannel.VaultGetSecretStatus, token),
        getSecret: (token, supplier, key) =>
            invoke(IpcChannel.VaultGetSecret, token, supplier, key),
        changePassword: (token, currentPassword, newPassword) =>
            invoke(
                IpcChannel.VaultChangePassword,
                token,
                currentPassword,
                newPassword
            ),
        reset: () => invoke(IpcChannel.VaultReset),
        lock: () => invoke(IpcChannel.VaultLock),
        unlock: password => invoke(IpcChannel.VaultUnlock, password)
    },
    collect: {
        prepare: () => invoke(IpcChannel.CollectPrepare),
        start: jobs => invoke(IpcChannel.CollectStart, jobs),
        cancel: () => ipcRenderer.send(IpcChannel.CollectCancel),
        onEvent: listener => {
            const handler = (_event: IpcRendererEvent, event: CollectEvent) =>
                listener(event);
            ipcRenderer.on(IpcChannel.CollectEvent, handler);
            return () =>
                ipcRenderer.removeListener(IpcChannel.CollectEvent, handler);
        },
        testConnection: (token, supplier) =>
            invoke(IpcChannel.CollectTestConnection, token, supplier)
    },
    project: {
        open: () => invoke(IpcChannel.ProjectOpen),
        save: (project, options) =>
            invoke(IpcChannel.ProjectSave, project, options)
    },
    csv: {
        open: () => invoke(IpcChannel.CsvOpen)
    },
    kicad: {
        open: () => invoke(IpcChannel.KicadOpen)
    },
    export: {
        save: request => invoke(IpcChannel.ExportSave, request),
        showInFolder: path =>
            ipcRenderer.send(IpcChannel.ExportShowInFolder, path)
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
