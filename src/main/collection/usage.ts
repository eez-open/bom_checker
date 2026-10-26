import { readFile } from "node:fs/promises";
import type { SupplierId } from "../../shared/model";
import { isFileNotFound, writeFileAtomic } from "../files";
import type { DailyCounter } from "./rate-limiter";

type UsageData = Partial<Record<SupplierId, { day: string; count: number }>>;

/**
 * Requests sent per supplier today (usage.json). Daily limits apply to the
 * API key, across projects and app restarts. Days are counted in UTC; when
 * a supplier reports the remaining count, that is used instead.
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

    used(supplier: SupplierId): number {
        const entry = this.data[supplier];
        return entry?.day === this.today() && Number.isFinite(entry.count)
            ? entry.count
            : 0;
    }

    counter(supplier: SupplierId): DailyCounter {
        return {
            used: () => this.used(supplier),
            add: count => this.set(supplier, this.used(supplier) + count)
        };
    }

    /** Uses the supplier's own count of requests left today. */
    setRemaining(
        supplier: SupplierId,
        remaining: number,
        perDay: number
    ): void {
        if (perDay > 0) {
            this.set(supplier, Math.max(0, perDay - remaining));
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

    private set(supplier: SupplierId, count: number): void {
        this.data[supplier] = { day: this.today(), count };
        this.dirty = true;
    }
}
