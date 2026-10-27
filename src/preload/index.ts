// Runs in the sandboxed preload context. Exposes only the typed `Api`; the
// renderer gets no direct access to Node.js or ipcRenderer.

import {
    contextBridge,
    ipcRenderer,
    webUtils,
    type IpcRendererEvent
} from "electron";
import { IpcChannel, type Api } from "../shared/ipc";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

/** Listens to events from main; returns an unsubscribe function. */
function subscribe<T>(
    channel: string,
    listener: (value: T) => void
): () => void {
    const handler = (_event: IpcRendererEvent, value: T) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

const api: Api = {
    app: {
        getInfo: () => invoke(IpcChannel.AppGetInfo),
        openExternal: url => invoke(IpcChannel.AppOpenExternal, url),
        copyText: text => invoke(IpcChannel.AppCopyText, text),
        pathForFile: file => webUtils.getPathForFile(file)
    },
    files: {
        openPath: path => invoke(IpcChannel.FilesOpenPath, path)
    },
    recent: {
        list: () => invoke(IpcChannel.RecentList),
        remove: path => invoke(IpcChannel.RecentRemove, path),
        onChange: listener => subscribe(IpcChannel.RecentChanged, listener)
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
        changePassword: (currentPassword, newPassword) =>
            invoke(
                IpcChannel.VaultChangePassword,
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
        onEvent: listener => subscribe(IpcChannel.CollectEvent, listener),
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
        open: () => invoke(IpcChannel.KicadOpen),
        planUpdate: request => invoke(IpcChannel.KicadPlanUpdate, request),
        applyUpdate: (request, columns) =>
            invoke(IpcChannel.KicadApplyUpdate, request, columns),
        restoreBackup: folder => invoke(IpcChannel.KicadRestoreBackup, folder),
        showBackup: folder =>
            ipcRenderer.send(IpcChannel.KicadShowBackup, folder)
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
        closeConfirmed: () => ipcRenderer.send(IpcChannel.WindowCloseConfirmed),
        setMenuState: state =>
            ipcRenderer.send(IpcChannel.WindowSetMenuState, state)
    },
    onMenuCommand: listener => subscribe(IpcChannel.MenuCommand, listener),
    onOpenRecent: listener => subscribe(IpcChannel.MenuOpenRecent, listener)
};

contextBridge.exposeInMainWorld("api", api);
