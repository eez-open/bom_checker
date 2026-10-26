// App settings that aren't secret (settings.json). Secrets are in the vault.

import { SUPPLIER_IDS, type SupplierId } from "./model";
import {
    isSupplierId,
    normalizeSupplierConfig,
    type SupplierConfig
} from "./supplier-config";

export interface GeneralSettings {
    /** Preferred supplier first; decides between equal best prices. */
    supplierOrder: SupplierId[];
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
        general: { supplierOrder: normalizeOrder(general.supplierOrder) },
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
