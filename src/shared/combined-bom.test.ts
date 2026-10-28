import { describe, expect, it } from "vitest";
import { combineBoms, SOURCE_BOM_COLUMN } from "./combined-bom";
import type { LookupResult, Project } from "./model";
import { addRow, createProject, createRow } from "./project-ops";

function bom(
    rows: [string, string, number, Record<string, string>][],
    buildQuantity = 1
): Project {
    return rows.reduce(
        (bom, [reference, value, qty, partNumbers]) =>
            addRow(bom, createRow({ reference, value, qty, partNumbers })),
        { ...createProject(), suppliers: ["digikey"], buildQuantity } as Project
    );
}

describe("combined BOM", () => {
    it("merges rows with the same part numbers, adding up quantities", () => {
        const psu = bom(
            [
                ["R1, R2", "10k", 2, { digikey: "D-1" }],
                ["C1", "100n", 1, {}]
            ],
            5
        );
        const mcu = bom([
            ["R1", "10K", 1, { digikey: " d-1 " }],
            ["R5", "10k", 3, { digikey: "D-2" }],
            ["C3", "100n", 2, {}]
        ]);
        const combined = combineBoms([
            { path: "psu.eezbom", name: "psu", project: psu },
            { path: "mcu.eezbom", name: "mcu", project: mcu }
        ]);
        const source = combined.customColumns.find(
            column => column.name === SOURCE_BOM_COLUMN
        )!;
        expect(
            combined.rows.map(row => [
                row.reference,
                row.value,
                row.qty,
                row.custom[source.id]
            ])
        ).toEqual([
            // Build quantity 5 for psu.
            ["R1, R2 (psu); R1 (mcu)", "10k", 11, "psu, mcu"],
            // No part numbers: by Value and Footprint.
            ["C1 (psu); C3 (mcu)", "100n", 7, "psu, mcu"],
            ["R5", "10k", 3, "mcu"]
        ]);
        expect(combined.buildQuantity).toBe(1);
        expect(combined.suppliers).toEqual(["digikey"]);
    });

    it("has the newest collected data of every BOM", () => {
        const result = (fetchedAt: string): LookupResult => ({
            status: "notFound",
            runId: "r",
            fetchedAt
        });
        const older = bom([["R1", "10k", 1, { digikey: "D-1" }]]);
        older.collected.results = { digikey: { "D-1": result("2026-01-01") } };
        const newer = bom([["R2", "10k", 1, { digikey: "D-1" }]]);
        newer.collected.results = { digikey: { "D-1": result("2026-02-01") } };
        const combined = combineBoms([
            { path: "a", name: "a", project: older },
            { path: "b", name: "b", project: newer }
        ]);
        expect(combined.collected.results.digikey?.["D-1"]?.fetchedAt).toBe(
            "2026-02-01"
        );
    });
});
