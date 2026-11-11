import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UsageStore } from "./usage";

async function store() {
    const path = join(
        await mkdtemp(join(tmpdir(), "eez-usage-")),
        "usage.json"
    );
    return { path, usage: new UsageStore(path, () => "2026-11-11") };
}

describe("UsageStore", () => {
    it("counts today's requests and remembers the last connection (#82)", async () => {
        const { path, usage } = await store();
        usage.counter("lcsc").add(3);
        usage.connected("lcsc", "2026-11-11T09:00:00.000Z");
        // Counting more keeps the last connection, and the other way round.
        usage.counter("lcsc").add(1);
        expect(usage.used("lcsc")).toBe(4);
        expect(usage.lastConnections()).toEqual({
            lcsc: "2026-11-11T09:00:00.000Z"
        });
        await usage.flush();

        const again = new UsageStore(path, () => "2026-11-12");
        await again.load();
        // A new day, so no requests yet; the connection stays.
        expect(again.used("lcsc")).toBe(0);
        expect(again.lastConnections()).toEqual({
            lcsc: "2026-11-11T09:00:00.000Z"
        });
        again.forgetConnection("lcsc");
        await again.flush();
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
            lcsc: { day: "2026-11-11", count: 4 }
        });
    });
});
