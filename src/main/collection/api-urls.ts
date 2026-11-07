import { ACCOUNT_IDS, type AccountId } from "../../shared/supplier-config";
import { log } from "../logging";

// End-to-end tests point the plugins at a local fake server, by account
// (Arrow's inventory sources share "arrow"):
//   EEZ_BOM_CHECKER_API_URLS='{"mouser":"http://127.0.0.1:4567/mouser"}'

let overrides: Partial<Record<AccountId, string>> | undefined;

export function apiUrlOverride(account: AccountId): string | undefined {
    if (!overrides) {
        overrides = {};
        const text = process.env.EEZ_BOM_CHECKER_API_URLS;
        if (text) {
            try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                for (const id of ACCOUNT_IDS) {
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
    return overrides[account];
}
