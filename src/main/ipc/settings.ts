import { z } from "zod";
import { exportPresetSchema } from "../../shared/export";
import { IpcChannel } from "../../shared/ipc";
import { SUPPLIER_IDS } from "../../shared/model";
import { normalizeOrder } from "../../shared/settings";
import { validateSupplierConfig } from "../../shared/supplier-config";
import { confirm } from "../dialogs";
import { updateSettings, getSettings } from "../settings/settings-store";
import {
    changePassword,
    closeSettings,
    createVaultWithPassword,
    getSecretStatus,
    getVaultState,
    lock,
    openSettings,
    resetVault,
    saveSecrets,
    unlock
} from "../vault/vault";
import { handle, on } from "./handle";

const supplierId = z.enum(SUPPLIER_IDS);
const token = z.string().min(1);
const password = z.string();
const generalSchema = z.object({
    supplierOrder: z.array(supplierId),
    logApiResponses: z.boolean(),
    exportPresets: z.array(exportPresetSchema).max(50)
});
const configSchema = z.record(z.string(), z.union([z.string(), z.number()]));
const secretChangesSchema = z.record(z.string(), z.string().nullable());

export function registerSettingsHandlers(): void {
    handle(IpcChannel.SettingsGet, () => getSettings());

    handle(IpcChannel.SettingsSaveGeneral, (_context, general) => {
        const { supplierOrder, logApiResponses, exportPresets } =
            generalSchema.parse(general);
        return updateSettings(settings => ({
            ...settings,
            general: {
                supplierOrder: normalizeOrder(supplierOrder),
                logApiResponses,
                exportPresets
            }
        }));
    });

    handle(
        IpcChannel.SettingsSaveSupplier,
        async (_context, sessionToken, supplier, config, secrets) => {
            const id = supplierId.parse(supplier);
            const values = configSchema.parse(config);
            const errors = validateSupplierConfig(id, values);
            if (Object.keys(errors).length > 0) {
                throw new Error(
                    `Invalid settings: ${Object.keys(errors).join(", ")}`
                );
            }
            // Secrets first: this also checks the settings session.
            await saveSecrets(
                token.parse(sessionToken),
                id,
                secretChangesSchema.parse(secrets)
            );
            return updateSettings(settings => ({
                ...settings,
                suppliers: { ...settings.suppliers, [id]: values }
            }));
        }
    );

    handle(IpcChannel.VaultGetState, () => getVaultState());
    handle(IpcChannel.VaultCreate, (_context, newPassword) =>
        createVaultWithPassword(password.parse(newPassword))
    );
    handle(IpcChannel.VaultOpenSettings, (_context, enteredPassword) =>
        openSettings(password.parse(enteredPassword))
    );
    on(IpcChannel.VaultCloseSettings, (_context, sessionToken) =>
        closeSettings(token.parse(sessionToken))
    );
    handle(IpcChannel.VaultGetSecretStatus, (_context, sessionToken) =>
        getSecretStatus(token.parse(sessionToken))
    );
    handle(
        IpcChannel.VaultChangePassword,
        (_context, sessionToken, currentPassword, newPassword) =>
            changePassword(
                token.parse(sessionToken),
                password.parse(currentPassword),
                password.parse(newPassword)
            )
    );
    // Main asks for confirmation itself, so this can't happen unnoticed.
    handle(IpcChannel.VaultReset, async ({ window }) => {
        const confirmed = await confirm(window, {
            message: "Delete the password and all stored API credentials?",
            detail:
                "You'll set a new password and enter the API credentials " +
                "of every supplier again. This can't be undone.",
            confirmLabel: "Delete"
        });
        if (confirmed) {
            await resetVault();
        }
        return confirmed;
    });
    handle(IpcChannel.VaultLock, () => lock());
    handle(IpcChannel.VaultUnlock, (_context, enteredPassword) =>
        unlock(password.parse(enteredPassword))
    );
}
