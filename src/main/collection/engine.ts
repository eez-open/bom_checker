// Runs data collection: one job per supplier, all suppliers in parallel,
// one batch at a time within a supplier ("BOM checker architecture.md", 8).
// Independent of Electron, so it's tested with fake plugins.

import type { CollectEvent, CollectJob } from "../../shared/ipc";
import {
    partNumberKey,
    type LookupOutcome,
    type LookupResult,
    type SupplierId
} from "../../shared/model";
import {
    AuthError,
    QuotaExceededError,
    ThrottledError,
    type SupplierContext,
    type SupplierPlugin
} from "../suppliers/types";
import type { Clock } from "./clock";

export interface SupplierSession {
    context: SupplierContext;
    /** Called when the job ends, e.g. to save request counters. */
    close(): Promise<void>;
    /** Called when the supplier answered a lookup, to remember when it was
     *  last used (#82). */
    connected?(): void;
}

export interface EngineDependencies {
    plugins: Record<SupplierId, SupplierPlugin>;
    /** Settings, credentials and an HTTP client for a job. Throws
     *  AuthError when the credentials are missing or locked. */
    openSession: (
        supplier: SupplierId,
        signal: AbortSignal
    ) => Promise<SupplierSession>;
    emit: (event: CollectEvent) => void;
    clock: Clock;
}

/** Retries of a batch the supplier refused with "too many requests". */
const THROTTLE_RETRIES = 3;
/** Failed batches in a row after which a job stops. */
const MAX_FAILED_BATCHES = 3;

class StopError extends Error {}

export class CollectionEngine {
    private controller: AbortController | null = null;

    constructor(private readonly dependencies: EngineDependencies) {}

    get running(): boolean {
        return this.controller !== null;
    }

    /** Resolves when every job has finished or stopped. */
    async run(jobs: readonly CollectJob[]): Promise<void> {
        if (this.controller) {
            throw new Error("Supplier data is already being collected.");
        }
        const controller = new AbortController();
        this.controller = controller;
        try {
            await Promise.all(
                jobs.map(job => this.runJob(job, controller.signal))
            );
        } finally {
            this.controller = null;
            this.dependencies.emit({ type: "done" });
        }
    }

    cancel(): void {
        this.controller?.abort();
    }

    private async runJob(
        { supplier, runId, partNumbers }: CollectJob,
        signal: AbortSignal
    ): Promise<void> {
        const { plugins, emit, clock } = this.dependencies;
        const plugin = plugins[supplier];
        const startedAt = new Date(clock.now()).toISOString();
        const total = partNumbers.length;
        let done = 0;
        let reason: string | undefined;
        let session: SupplierSession | undefined;
        emit({ type: "progress", supplier, done, total, current: null });

        try {
            session = await this.dependencies.openSession(supplier, signal);
            const batchSize = Math.max(
                1,
                plugin.batchSizeFor?.(session.context.config) ??
                    plugin.batchSize
            );
            let failedBatches = 0;
            for (let i = 0; i < total; i += batchSize) {
                signal.throwIfAborted();
                const batch = partNumbers.slice(i, i + batchSize);
                emit({
                    type: "progress",
                    supplier,
                    done,
                    total,
                    current: batch[0] ?? null
                });

                const answer = await this.lookup(
                    plugin,
                    batch,
                    session.context,
                    signal
                );
                if (!("failure" in answer)) {
                    session.connected?.();
                }
                const fetchedAt = new Date(clock.now()).toISOString();
                const results: Record<string, LookupResult> = {};
                for (const partNumber of batch) {
                    const key = partNumberKey(partNumber);
                    const outcome: LookupOutcome =
                        "failure" in answer
                            ? { status: "error", message: answer.failure }
                            : (answer.outcomes.get(key) ?? {
                                  status: "error",
                                  message:
                                      "The supplier didn't answer for this part number."
                              });
                    results[key] = { ...outcome, runId, fetchedAt };
                }
                emit({ type: "results", supplier, results });
                done += batch.length;
                emit({
                    type: "progress",
                    supplier,
                    done,
                    total,
                    current: null
                });

                failedBatches = "failure" in answer ? failedBatches + 1 : 0;
                if (
                    failedBatches >= MAX_FAILED_BATCHES &&
                    "failure" in answer
                ) {
                    throw new StopError(
                        `Stopped after repeated errors: ${answer.failure}`
                    );
                }
            }
        } catch (error) {
            reason = stopReason(error, signal);
        } finally {
            await session?.close().catch(() => undefined);
        }
        emit({
            type: "supplier-done",
            supplier,
            run: {
                id: runId,
                startedAt,
                endedAt: new Date(clock.now()).toISOString(),
                state: reason ? "interrupted" : "complete",
                ...(reason ? { reason } : {})
            }
        });
    }

    /** The plugin's outcomes, or why the batch failed. Errors that must stop
     *  the job are thrown. */
    private async lookup(
        plugin: SupplierPlugin,
        batch: string[],
        context: SupplierContext,
        signal: AbortSignal
    ): Promise<{ outcomes: Map<string, LookupOutcome> } | { failure: string }> {
        for (let attempt = 0; ; attempt++) {
            try {
                return { outcomes: await plugin.lookup(batch, context) };
            } catch (error) {
                if (signal.aborted) {
                    throw error;
                }
                if (
                    error instanceof ThrottledError &&
                    attempt < THROTTLE_RETRIES
                ) {
                    await this.dependencies.clock.sleep(
                        error.retryAfterMs,
                        signal
                    );
                    continue;
                }
                if (
                    error instanceof AuthError ||
                    error instanceof QuotaExceededError ||
                    error instanceof ThrottledError
                ) {
                    throw error;
                }
                return {
                    failure:
                        error instanceof Error ? error.message : String(error)
                };
            }
        }
    }
}

function stopReason(error: unknown, signal: AbortSignal): string {
    if (signal.aborted) {
        return "Cancelled.";
    }
    if (error instanceof ThrottledError) {
        return "The supplier kept refusing requests (too many requests). Try again later.";
    }
    return error instanceof Error ? error.message : String(error);
}
