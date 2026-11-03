import { describe, expect, it } from "vitest";
import { combineBoms, SOURCE_BOM_COLUMN } from "./combined-bom";
import type { LookupResult, Project } from "./model";
import { bestSupplier } from "./pricing";
import {
    addManualSupplier,
    addRow,
    createProject,
    createRow
} from "./project-ops";

function bom(
    rows: [string, string, number, Record<string, string>][]
): Project {
    return rows.reduce(
        (bom, [reference, value, qty, partNumbers]) =>
            addRow(bom, createRow({ reference, value, qty, partNumbers })),
        // A BOM's own build quantity doesn't count in a list (#39).
        {
            ...createProject(),
            suppliers: ["digikey"],
            buildQuantity: 7
        } as Project
    );
}

describe("combined BOM", () => {
    it("merges rows with the same part numbers, adding up quantities", () => {
        const psu = bom([
            ["R1, R2", "10k", 2, { digikey: "D-1" }],
            ["C1", "100n", 1, {}]
        ]);
        const mcu = bom([
            ["R1", "10K", 1, { digikey: " d-1 " }],
            ["R5", "10k", 3, { digikey: "D-2" }],
            ["C3", "100n", 2, {}]
        ]);
        // 5 psu modules per device, 25 devices (#39).
        const combined = combineBoms(
            [
                { path: "psu.eezbom", name: "psu", project: psu, perDevice: 5 },
                { path: "mcu.eezbom", name: "mcu", project: mcu, perDevice: 1 }
            ],
            25
        );
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
            // Per device: 5 psu.
            ["R1, R2 (psu); R1 (mcu)", "10k", 11, "psu, mcu"],
            // No part numbers: by Value and Footprint.
            ["C1 (psu); C3 (mcu)", "100n", 7, "psu, mcu"],
            ["R5", "10k", 3, "mcu"]
        ]);
        expect(combined.buildQuantity).toBe(25);
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
            { path: "a", name: "a", project: older, perDevice: 1 },
            { path: "b", name: "b", project: newer, perDevice: 1 }
        ]);
        expect(combined.collected.results.digikey?.["D-1"]?.fetchedAt).toBe(
            "2026-02-01"
        );
    });

    it("has the suppliers without an API and what was typed for them (#48)", () => {
        const withShop = (project: Project, shop: string, prices: number[]) => {
            const { project: next, supplier } = addManualSupplier(
                project,
                shop
            );
            return {
                ...next,
                rows: next.rows.map((row, index) => ({
                    ...row,
                    manual: { [supplier.id]: { unitPrice: prices[index] } }
                }))
            };
        };
        const enclosure = withShop(
            bom([
                ["", "Bottom plate", 1, {}],
                ["", "Top cover", 1, {}]
            ]),
            "Metal shop",
            [12, 15]
        );
        // The same shop, written differently, and one more.
        const cm5 = withShop(
            withShop(bom([["", "Top cover", 1, {}]]), "metal shop", [99]),
            "Source BOM",
            [3]
        );
        const combined = combineBoms(
            [
                { path: "e", name: "e", project: enclosure, perDevice: 1 },
                { path: "c", name: "c", project: cm5, perDevice: 2 }
            ],
            10
        );
        expect(combined.manualSuppliers.map(s => s.name)).toEqual([
            "Metal shop",
            "Source BOM (2)"
        ]);
        const [shop, other] = combined.manualSuppliers.map(s => s.id);
        expect(
            combined.rows.map(row => [row.value, row.qty, row.manual])
        ).toEqual([
            ["Bottom plate", 1, { [shop!]: { unitPrice: 12 } }],
            // The first BOM's price is kept.
            [
                "Top cover",
                3,
                { [shop!]: { unitPrice: 15 }, [other!]: { unitPrice: 3 } }
            ]
        ]);
        const best = bestSupplier(
            combined.rows[1]!,
            combined.collected,
            combined.suppliers,
            [],
            combined.buildQuantity,
            combined.manualSuppliers
        );
        expect(best).toMatchObject({ supplier: other, line: { total: 90 } });
    });

    it("needs a one-time item once, however many of its BOM (#53)", () => {
        const { project, supplier } = addManualSupplier(
            bom([["", "Stencil", 1, {}]]),
            "Stencil maker"
        );
        project.rows[0]!.manual = {
            [supplier.id]: { unitPrice: 40, oneTime: true }
        };
        const combined = combineBoms(
            [{ path: "m", name: "m", project, perDevice: 2 }],
            25
        );
        expect(combined.rows[0]!.qty).toBe(1);
        const best = bestSupplier(
            combined.rows[0]!,
            combined.collected,
            combined.suppliers,
            [],
            combined.buildQuantity,
            combined.manualSuppliers
        );
        expect(best?.line).toMatchObject({ orderQty: 1, total: 40 });
    });
});
