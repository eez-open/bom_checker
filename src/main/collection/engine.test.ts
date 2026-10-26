import { describe, expect, it } from "vitest";
import type { CollectEvent } from "../../shared/ipc";
import {
    partNumberKey,
    type LookupOutcome,
    type SupplierId
} from "../../shared/model";
import { fakeContext } from "../suppliers/fake-context";
import {
    AuthError,
    QuotaExceededError,
    SupplierError,
    ThrottledError,
    type SupplierPlugin
} from "../suppliers/types";
import { CollectionEngine } from "./engine";

/** A plugin that answers "notFound", or runs `behaviour` for a batch. */
function fakePlugin(
    id: SupplierId,
    batchSize: number,
    behaviour: (batch: readonly string[], call: number) => void = () =>
        undefined
): SupplierPlugin & { batches: string[][] } {
    const batches: string[][] = [];
    return {
        id,
        batchSize,
        requestsPerBatch: 1,
        requiredSecrets: [],
        testPartNumber: "T",
        batches,
        lookup: batch => {
            batches.push([...batch]);
            behaviour(batch, batches.length);
            return Promise.resolve(
                new Map(
                    batch.map((pn): [string, LookupOutcome] => [
                        partNumberKey(pn),
                        { status: "notFound" }
                    ])
                )
            );
        }
    };
}

function setup(plugins: Partial<Record<SupplierId, SupplierPlugin>>) {
    const events: CollectEvent[] = [];
    const slept: number[] = [];
    let time = Date.parse("2026-10-26T10:00:00Z");
    const engine = new CollectionEngine({
        plugins: plugins as Record<SupplierId, SupplierPlugin>,
        openSession: supplier =>
            Promise.resolve({
                context: fakeContext(supplier, {}, () => ({})),
                close: () => Promise.resolve()
            }),
        emit: event => events.push(event),
        clock: {
            now: () => (time += 1000),
            sleep: ms => {
                slept.push(ms);
                return Promise.resolve();
            }
        }
    });
    const runs = () =>
        Object.fromEntries(
            events.flatMap(e =>
                e.type === "supplier-done" ? [[e.supplier, e.run]] : []
            )
        );
    const results = (supplier: SupplierId) =>
        Object.assign(
            {},
            ...events.flatMap(e =>
                e.type === "results" && e.supplier === supplier
                    ? [e.results]
                    : []
            )
        ) as Record<string, { status: string; runId: string }>;
    return { engine, events, slept, runs, results };
}

describe("CollectionEngine", () => {
    it("collects in batches and reports every part number", async () => {
        const mouser = fakePlugin("mouser", 2);
        const tme = fakePlugin("tme", 50);
        const { engine, events, runs, results } = setup({ mouser, tme });
        await engine.run([
            { supplier: "mouser", runId: "m1", partNumbers: ["A", "B", "C"] },
            { supplier: "tme", runId: "t1", partNumbers: ["X"] }
        ]);
        expect(mouser.batches).toEqual([["A", "B"], ["C"]]);
        expect(Object.keys(results("mouser"))).toEqual(["A", "B", "C"]);
        expect(results("mouser").A).toMatchObject({
            status: "notFound",
            runId: "m1"
        });
        expect(runs()).toMatchObject({
            mouser: { id: "m1", state: "complete" },
            tme: { id: "t1", state: "complete" }
        });
        expect(events.at(-1)).toEqual({ type: "done" });
        const last = events
            .filter(e => e.type === "progress" && e.supplier === "mouser")
            .at(-1);
        expect(last).toMatchObject({ done: 3, total: 3 });
    });

    it("stops a supplier at its daily limit and keeps what it got", async () => {
        const mouser = fakePlugin("mouser", 1, (_batch, call) => {
            if (call === 2) {
                throw new QuotaExceededError(
                    "Mouser's daily request limit is reached."
                );
            }
        });
        const { engine, runs, results } = setup({ mouser });
        await engine.run([
            { supplier: "mouser", runId: "m1", partNumbers: ["A", "B", "C"] }
        ]);
        expect(Object.keys(results("mouser"))).toEqual(["A"]);
        expect(runs().mouser).toMatchObject({
            state: "interrupted",
            reason: "Mouser's daily request limit is reached."
        });
    });

    it("stops on rejected credentials", async () => {
        const digikey = fakePlugin("digikey", 1, () => {
            throw new AuthError("DigiKey rejected the client ID and secret.");
        });
        const { engine, runs } = setup({ digikey });
        await engine.run([
            { supplier: "digikey", runId: "d1", partNumbers: ["A"] }
        ]);
        expect(runs().digikey).toMatchObject({
            state: "interrupted",
            reason: "DigiKey rejected the client ID and secret."
        });
    });

    it("retries a throttled batch after the requested pause", async () => {
        const mouser = fakePlugin("mouser", 10, (_batch, call) => {
            if (call === 1) {
                throw new ThrottledError(
                    "Too many requests per minute.",
                    60_000
                );
            }
        });
        const { engine, slept, runs } = setup({ mouser });
        await engine.run([
            { supplier: "mouser", runId: "m1", partNumbers: ["A"] }
        ]);
        expect(slept).toEqual([60_000]);
        expect(mouser.batches).toHaveLength(2);
        expect(runs().mouser).toMatchObject({ state: "complete" });
    });

    it("marks failed batches and stops after three in a row", async () => {
        const tme = fakePlugin("tme", 1, batch => {
            if (batch[0] !== "OK") {
                throw new SupplierError("TME: HTTP 500");
            }
        });
        const { engine, runs, results } = setup({ tme });
        await engine.run([
            {
                supplier: "tme",
                runId: "t1",
                partNumbers: ["E1", "OK", "E2", "E3", "E4", "E5"]
            }
        ]);
        expect(results("tme")).toMatchObject({
            E1: { status: "error" },
            OK: { status: "notFound" },
            E4: { status: "error" }
        });
        expect(results("tme")).not.toHaveProperty("E5");
        expect(runs().tme).toMatchObject({
            state: "interrupted",
            reason: "Stopped after repeated errors: TME: HTTP 500"
        });
    });

    it("can be cancelled", async () => {
        const holder: { engine?: CollectionEngine } = {};
        const mouser = fakePlugin("mouser", 1, () => holder.engine?.cancel());
        const { engine, runs, results } = setup({ mouser });
        holder.engine = engine;
        await engine.run([
            { supplier: "mouser", runId: "m1", partNumbers: ["A", "B"] }
        ]);
        expect(Object.keys(results("mouser"))).toEqual(["A"]);
        expect(runs().mouser).toMatchObject({
            state: "interrupted",
            reason: "Cancelled."
        });
        expect(engine.running).toBe(false);
    });
});
