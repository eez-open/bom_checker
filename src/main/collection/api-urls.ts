import { SUPPLIER_IDS, type SupplierId } from "../../shared/model";
import { log } from "../logging";

// End-to-end tests point the plugins at a local fake server:
//   EEZ_BOM_CHECKER_API_URLS='{"mouser":"http://127.0.0.1:4567/mouser"}'

let overrides: Partial<Record<SupplierId, string>> | undefined;

export function apiUrlOverride(supplier: SupplierId): string | undefined {
    if (!overrides) {
        overrides = {};
        const text = process.env.EEZ_BOM_CHECKER_API_URLS;
        if (text) {
            try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                for (const id of SUPPLIER_IDS) {
                    if (typeof parsed[id] === "string") {
                        overrides[id] = parsed[id];
                    }
                }
                log.warn("Supplier API addresses overridden:", overrides);
            } catch {
                log.warn("Ignoring EEZ_BOM_CHECKER_API_URLS: not valid JSON");
            }
        }
    }
    return overrides[supplier];
}
