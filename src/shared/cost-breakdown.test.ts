import { describe, expect, it } from "vitest";
import { costBreakdown } from "./cost-breakdown";
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
            total: 0
        });
    });
});
