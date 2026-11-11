import { join } from "node:path";
import { app } from "electron";
import type { LastConnections } from "../../shared/inactivity";
import type { ConnectionTest, SupplierReadiness } from "../../shared/ipc";
import { LIFECYCLE_LABELS } from "../../shared/lifecycle";
import {
    SUPPLIER_IDS,
    partNumberKey,
    type SupplierId
} from "../../shared/model";
import {
    SUPPLIER_SETTINGS,
    arrowSources,
    type AccountId
} from "../../shared/supplier-config";
import { ACCOUNT_NAMES, SUPPLIERS, accountOf } from "../../shared/suppliers";
import { log } from "../logging";
import { getSettings } from "../settings/settings-store";
import { PLUGINS, batchSizeOf } from "../suppliers";
import { AuthError, type SupplierContext } from "../suppliers/types";
import { getSupplierSecrets } from "../vault/vault";
import { apiUrlOverride } from "./api-urls";
import type { SupplierSession } from "./engine";
import { createHttp, Redactor } from "./http";
import { RateLimiter, type RateLimits } from "./rate-limiter";
import { UsageStore } from "./usage";

let usage: UsageStore | null = null;

async function usageStore(): Promise<UsageStore> {
    if (!usage) {
        usage = new UsageStore(join(app.getPath("userData"), "usage.json"));
        await usage.load();
    }
    return usage;
}

function limitsOf(config: Record<string, unknown>): RateLimits {
    return {
        minIntervalMs: Number(config.minIntervalMs) || 0,
        perMinute: Number(config.perMinute) || 0,
        perDay: Number(config.perDay) || 0
    };
}

/** Why `supplier` can't be collected now, or null. */
function problemOf(supplier: SupplierId): string | null {
    const account = accountOf(supplier);
    const secrets = getSupplierSecrets(account);
    if (!secrets) {
        return "The stored credentials are locked.";
    }
    const missing = PLUGINS[supplier].requiredSecrets.filter(
        key => !secrets[key]
    );
    if (missing.length === 0) {
        return null;
    }
    const labels = SUPPLIER_SETTINGS[account].fields
        .filter(field => missing.includes(field.key))
        .map(field => field.label);
    return `Not set up: enter the ${labels.join(" and ")} in Settings.`;
}

export async function getReadiness(): Promise<
    Record<SupplierId, SupplierReadiness>
> {
    const settings = await getSettings();
    const store = await usageStore();
    return Object.fromEntries(
        SUPPLIER_IDS.map(supplier => {
            const account = accountOf(supplier);
            const config = settings.suppliers[account];
            const { perDay } = limitsOf(config);
            const plugin = PLUGINS[supplier];
            const readiness: SupplierReadiness = {
                problem: problemOf(supplier),
                batchSize: batchSizeOf(plugin, config),
                requestsPerBatch: plugin.requestsPerBatch,
                remainingToday:
                    perDay > 0
                        ? Math.max(0, perDay - store.used(account))
                        : null
            };
            return [supplier, readiness];
        })
    ) as Record<SupplierId, SupplierReadiness>;
}

/** Everything a plugin needs for one job: settings, credentials and a
 *  rate-limited HTTP client. */
export async function openSupplierSession(
    supplier: SupplierId,
    signal: AbortSignal
): Promise<SupplierSession> {
    const problem = problemOf(supplier);
    if (problem) {
        throw new AuthError(problem);
    }
    const settings = await getSettings();
    const account = accountOf(supplier);
    const config = settings.suppliers[account];
    const secrets = getSupplierSecrets(account)!;
    const store = await usageStore();
    const limits = limitsOf(config);
    const redactor = new Redactor();
    Object.values(secrets).forEach(value => redactor.add(value));
    const http = createHttp({
        name: SUPPLIERS[supplier].name,
        // Arrow's sources count against Arrow's limits (#62).
        limiter: new RateLimiter(limits, store.counter(account)),
        signal,
        redactor,
        logBodies: settings.general.logApiResponses,
        log
    });
    const context: SupplierContext = {
        config,
        secrets,
        http,
        signal,
        baseUrl: defaultUrl => apiUrlOverride(account) ?? defaultUrl,
        addSecret: value => redactor.add(value),
        reportRemaining: remaining =>
            store.setRemaining(account, remaining, limits.perDay)
    };
    return {
        context,
        close: () => store.flush(),
        connected: () => store.connected(account, new Date().toISOString())
    };
}

/** When each supplier last answered a lookup (#82). */
export async function getLastConnections(): Promise<LastConnections> {
    return (await usageStore()).lastConnections();
}

/** Forgets when these suppliers last answered, e.g. when their credentials
 *  were removed, so the app stops warning that they aren't used (#82). */
export async function forgetConnections(
    accounts: readonly AccountId[]
): Promise<void> {
    const store = await usageStore();
    accounts.forEach(account => store.forgetConnection(account));
    await store.flush();
}

const PRICE_KINDS = {
    account: "your account's prices",
    list: "public list prices (the supplier returned no account prices)",
    unknown: "the supplier doesn't say whether these are your account's prices"
};

/** The supplier "Test connection" uses for an account: for Arrow, its
 *  first inventory source chosen (#62). */
async function testSupplier(account: AccountId): Promise<SupplierId> {
    if (account !== "arrow") {
        return account;
    }
    const settings = await getSettings();
    const code = arrowSources(settings.suppliers.arrow)[0];
    return (
        SUPPLIER_IDS.find(id => SUPPLIERS[id].source === code) ?? "arrow-europe"
    );
}

/** Looks up the plugin's test part number and describes what came back. */
export async function testConnection(
    account: AccountId
): Promise<ConnectionTest> {
    const supplier = await testSupplier(account);
    const plugin = PLUGINS[supplier];
    const name =
        account === "arrow" ? SUPPLIERS[supplier].name : ACCOUNT_NAMES[account];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let session: SupplierSession | undefined;
    try {
        session = await openSupplierSession(supplier, controller.signal);
        const outcome = (
            await plugin.lookup([plugin.testPartNumber], session.context)
        ).get(partNumberKey(plugin.testPartNumber));
        session.connected?.();
        if (outcome?.status !== "found") {
            return {
                ok: true,
                lines: [
                    `Connected to ${name}, but the test part number ${plugin.testPartNumber} ` +
                        (outcome?.status === "error"
                            ? `gave an error: ${outcome.message}`
                            : "wasn't found.")
                ]
            };
        }
        const { offer } = outcome;
        const firstBreak = offer.priceBreaks[0];
        return {
            ok: true,
            lines: [
                `Connected to ${name}.`,
                `Found ${offer.supplierPartNumber}: ${offer.manufacturer} ${offer.manufacturerPartNumber}`,
                `Stock: ${offer.stockQty.toLocaleString("en")}`,
                firstBreak
                    ? `Prices in ${offer.currency}, ${PRICE_KINDS[offer.priceKind]}; from ${firstBreak.qty} pcs: ${firstBreak.unitPrice} ${offer.currency}`
                    : "No prices were returned.",
                `Status: ${offer.lifecycle ? LIFECYCLE_LABELS[offer.lifecycle] : (offer.lifecycleRaw ?? "not reported")}`,
                ...(offer.notes ?? [])
            ]
        };
    } catch (error) {
        log.warn(`${name} connection test failed:`, error);
        return {
            ok: false,
            lines: [error instanceof Error ? error.message : String(error)]
        };
    } finally {
        clearTimeout(timeout);
        await session?.close().catch(() => undefined);
    }
}
