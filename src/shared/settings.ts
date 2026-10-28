// App settings that aren't secret (settings.json). Secrets are in the vault.

import { exportPresetSchema, type ExportPreset } from "./export";
import { SUPPLIER_IDS, type SupplierId } from "./model";
import { DECIMAL_SEPARATORS, type DecimalSeparator } from "./numbers";
import {
    isSupplierId,
    normalizeSupplierConfig,
    type SupplierConfig
} from "./supplier-config";

export interface GeneralSettings {
    /** Preferred supplier first; decides between equal best prices. */
    supplierOrder: SupplierId[];
    /** Write supplier API responses to the log file, for troubleshooting. */
    logApiResponses: boolean;
    /** Export settings saved under a name. */
    exportPresets: ExportPreset[];
    /** How numbers are shown and written to CSV files (#37). */
    decimalSeparator: DecimalSeparator;
}

export interface AppSettings {
    general: GeneralSettings;
    suppliers: Record<SupplierId, SupplierConfig>;
}

export const SETTINGS_SCHEMA_VERSION = 1;

export function defaultSettings(): AppSettings {
    return normalizeSettings({});
}

/** Valid values from a settings file, defaults for anything missing or
 *  invalid, so a damaged or older file never stops the app. */
export function normalizeSettings(raw: unknown): AppSettings {
    const file = isRecord(raw) ? raw : {};
    const general = isRecord(file.general) ? file.general : {};
    const suppliers = isRecord(file.suppliers) ? file.suppliers : {};
    return {
        general: {
            supplierOrder: normalizeOrder(general.supplierOrder),
            logApiResponses: general.logApiResponses === true,
            exportPresets: Array.isArray(general.exportPresets)
                ? general.exportPresets.flatMap(preset => {
                      const parsed = exportPresetSchema.safeParse(preset);
                      return parsed.success ? [parsed.data] : [];
                  })
                : [],
            decimalSeparator: DECIMAL_SEPARATORS.includes(
                general.decimalSeparator as DecimalSeparator
            )
                ? (general.decimalSeparator as DecimalSeparator)
                : "system"
        },
        suppliers: Object.fromEntries(
            SUPPLIER_IDS.map(id => [
                id,
                normalizeSupplierConfig(id, suppliers[id])
            ])
        ) as Record<SupplierId, SupplierConfig>
    };
}

/** Each supplier exactly once; unknown or missing ones are fixed up. */
export function normalizeOrder(raw: unknown): SupplierId[] {
    const listed = Array.isArray(raw) ? raw.filter(isSupplierId) : [];
    return [...new Set([...listed, ...SUPPLIER_IDS])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
