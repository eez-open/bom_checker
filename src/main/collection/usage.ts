import { readFile } from "node:fs/promises";
import type { LastConnections } from "../../shared/inactivity";
import type { AccountId } from "../../shared/supplier-config";
import { isFileNotFound, writeFileAtomic } from "../files";
import type { DailyCounter } from "./rate-limiter";

interface AccountUsage {
    day?: string;
    count?: number;
    /** When the supplier last answered a lookup, as ISO time (#82). */
    lastConnected?: string;
}

type UsageData = Partial<Record<AccountId, AccountUsage>>;

/**
 * Requests sent per supplier today (usage.json). Daily limits apply to the
 * API key, across projects and app restarts. Days are counted in UTC; when
 * a supplier reports the remaining count, that is used instead. Also when
 * each supplier last answered, since LCSC disables API access that isn't
 * used (#82).
 */
export class UsageStore {
    private data: UsageData = {};
    private saving: Promise<void> = Promise.resolve();
    private dirty = false;

    constructor(
        private readonly path: string,
        private readonly today = () => new Date().toISOString().slice(0, 10)
    ) {}

    async load(): Promise<void> {
        try {
            const parsed: unknown = JSON.parse(
                await readFile(this.path, "utf8")
            );
            this.data =
                typeof parsed === "object" && parsed !== null ? parsed : {};
        } catch (error) {
            if (!isFileNotFound(error)) {
                this.data = {};
            }
        }
    }

    used(supplier: AccountId): number {
        const entry = this.data[supplier];
        return entry?.day === this.today() &&
            typeof entry.count === "number" &&
            Number.isFinite(entry.count)
            ? entry.count
            : 0;
    }

    counter(supplier: AccountId): DailyCounter {
        return {
            used: () => this.used(supplier),
            add: count => this.set(supplier, this.used(supplier) + count)
        };
    }

    /** Uses the supplier's own count of requests left today. */
    setRemaining(supplier: AccountId, remaining: number, perDay: number): void {
        if (perDay > 0) {
            this.set(supplier, Math.max(0, perDay - remaining));
        }
    }

    /** The supplier answered a lookup at `at` (ISO time). */
    connected(supplier: AccountId, at: string): void {
        this.data[supplier] = { ...this.data[supplier], lastConnected: at };
        this.dirty = true;
    }

    lastConnections(): LastConnections {
        const result: LastConnections = {};
        for (const [account, entry] of Object.entries(this.data) as [
            AccountId,
            AccountUsage | undefined
        ][]) {
            if (typeof entry?.lastConnected === "string") {
                result[account] = entry.lastConnected;
            }
        }
        return result;
    }

    /** Forgets when the supplier last answered, e.g. when its credentials
     *  are removed. */
    forgetConnection(supplier: AccountId): void {
        const entry = this.data[supplier];
        if (entry?.lastConnected !== undefined) {
            const rest = { ...entry };
            delete rest.lastConnected;
            this.data[supplier] = rest;
            this.dirty = true;
        }
    }

    /** Writes pending changes. */
    flush(): Promise<void> {
        if (this.dirty) {
            this.dirty = false;
            const text = JSON.stringify(this.data, null, 2) + "\n";
            this.saving = this.saving.then(() =>
                writeFileAtomic(this.path, text)
            );
        }
        return this.saving;
    }

    private set(supplier: AccountId, count: number): void {
        this.data[supplier] = {
            ...this.data[supplier],
            day: this.today(),
            count
        };
        this.dirty = true;
    }
}
