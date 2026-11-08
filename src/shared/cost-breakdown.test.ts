import { describe, expect, it } from "vitest";
import { bomCostBreakdown, costBreakdown } from "./cost-breakdown";
import type { LookupResult, Project } from "./model";
import { bomTotals } from "./pricing";
import {
    addManualSupplier,
    addRow,
    createProject,
    createRow
} from "./project-ops";

/** Rows with these unit prices at a shop without an API; null: no price. */
function bom(prices: (number | null)[], buildQuantity = 1) {
    const { project, supplier } = addManualSupplier(createProject(), "Shop");
    return prices.reduce(
        (bom, unitPrice, index) =>
            addRow(
                bom,
                createRow({
                    reference: `R${index + 1}`,
                    value: `${index + 1}k`,
                    qty: 2,
                    manual:
                        unitPrice === null
                            ? undefined
                            : { [supplier.id]: { unitPrice } }
                })
            ),
        { ...project, buildQuantity }
    );
}

describe("cost breakdown", () => {
    it("lists the most expensive rows first, the rest as Other", () => {
        const project = bom([1, 5, null, 3, 0, 2], 10);
        const breakdown = costBreakdown(project, [], 2);
        expect(breakdown.items).toMatchObject([
            { reference: "R2", value: "2k", supplier: "Shop", total: 100 },
            { reference: "R4", total: 60 }
        ]);
        // R6 and R1; R3 has no price and R5 costs nothing.
        expect(breakdown.other).toEqual({
            rows: 2,
            total: 60,
            share: 60 / 220
        });
        expect(breakdown.total).toBe(220);
        expect(breakdown.total).toBe(bomTotals(project, []).total);
        expect(breakdown.items[0]!.share).toBeCloseTo(100 / 220);
    });

    it("has no Other when all rows fit", () => {
        const breakdown = costBreakdown(bom([1, 1]), []);
        expect(breakdown.items.map(item => item.reference)).toEqual([
            "R1",
            "R2"
        ]);
        expect(breakdown.other).toBeNull();
        expect(costBreakdown(bom([null]), [])).toEqual({
            items: [],
            other: null,
            total: 0,
            partial: 0,
            uncovered: 0
        });
    });

    it("counts rows that no supplier has enough stock for (#49, #74)", () => {
        const project = bom([1, 2, 3, null]);
        const shop = project.manualSuppliers[0]!.id;
        // R2's shop has 3 of the 4 needed (2 per unit × 2 units), so R2 is
        // at the price of 3; R3's has none, so R3 is left out.
        project.rows[1]!.manual![shop]!.stock = 3;
        project.rows[2]!.manual![shop]!.stock = 0;
        project.buildQuantity = 2;
        const breakdown = costBreakdown(project, []);
        expect(
            breakdown.items.map(item => [item.reference, item.total])
        ).toEqual([
            ["R2", 6],
            ["R1", 4]
        ]);
        expect(breakdown).toMatchObject({
            total: 10,
            partial: 1,
            uncovered: 1
        });
        expect(bomTotals(project, [])).toEqual({
            total: 10,
            covered: 2,
            partial: 1,
            uncovered: 1
        });
    });
});

describe("cost by BOM (#54)", () => {
    /** A DigiKey part at 1 EUR each, with no price break. */
    const found: LookupResult = {
        status: "found",
        matchedBy: "supplierPartNumber",
        runId: "r",
        fetchedAt: "2026-11-01T10:00:00Z",
        offer: {
            supplierPartNumber: "D-1",
            manufacturer: "",
            manufacturerPartNumber: "",
            description: "",
            stockQty: 1_000_000,
            moq: 1,
            orderMultiple: 1,
            priceBreaks: [{ qty: 1, unitPrice: 1 }],
            priceKind: "list",
            currency: "EUR",
            lifecycle: "active",
            lifecycleRaw: null,
            rohs: null
        }
    };

    /** A part of its own at a shop (`value`, 2 per board, at `price`). */
    function shopBom(value: string, price: number): Project {
        const { project, supplier } = addManualSupplier(
            createProject(),
            "Shop"
        );
        return addRow(
            project,
            createRow({
                reference: "R1, R2",
                value,
                qty: 2,
                manual: { [supplier.id]: { unitPrice: price } }
            })
        );
    }

    /** `shopBom`, with D-1 `shared` times. */
    function module(value: string, shared: number, own: number): Project {
        return {
            ...addRow(
                shopBom(value, own),
                createRow({
                    reference: "R9",
                    qty: shared,
                    partNumbers: { digikey: "D-1" }
                })
            ),
            suppliers: ["digikey"],
            collected: { results: { digikey: { "D-1": found } }, runs: {} }
        };
    }

    const member = (name: string, project: Project, perDevice = 1) => ({
        path: `/${name}.eezbom`,
        name,
        project,
        perDevice
    });

    it("shares the Combined BOM's rows among the BOMs", () => {
        // D-1: 1 in psu, 2 × 3 in mcu, for 10 devices.
        const breakdown = bomCostBreakdown(
            [
                member("psu", module("psu part", 1, 5)),
                member("mcu", module("mcu part", 3, 1), 2),
                member("empty", createProject())
            ],
            10,
            []
        );
        // psu: 1 × 10 D-1, 2 × 10 at 5; mcu: 6 × 10 D-1, 2 × 2 × 10 at 1.
        expect(breakdown.items).toMatchObject([
            { name: "psu", perDevice: 1, total: 110 },
            { name: "mcu", perDevice: 2, total: 100 }
        ]);
        expect(breakdown.total).toBe(210);
        expect(breakdown.items[0]!.share).toBeCloseTo(110 / 210);
        expect(breakdown.other).toBeNull();
        expect(breakdown.uncovered).toBe(0);
    });

    it("groups the BOMs beyond the limit as Other", () => {
        const members = [3, 1, 4, 2].map((price, index) =>
            member(`m${index + 1}`, shopBom(`part ${index + 1}`, price))
        );
        const breakdown = bomCostBreakdown(members, 1, [], 2);
        expect(breakdown.items.map(item => item.name)).toEqual(["m3", "m1"]);
        // m4 and m2: 2 × 2 + 2 × 1.
        expect(breakdown.other).toEqual({
            boms: 2,
            total: 6,
            share: 6 / 20
        });
    });
});
