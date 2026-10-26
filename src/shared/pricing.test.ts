import { describe, expect, it } from "vitest";
import type {
    CollectedData,
    LookupResult,
    Project,
    SupplierId,
    SupplierOffer
} from "./model";
import {
    bestSupplier,
    bomTotals,
    foreignCurrencies,
    orderQuantity,
    priceAt,
    supplierLine
} from "./pricing";
import { addRow, createProject, createRow } from "./project-ops";

const AT = "2026-10-26T10:00:00Z";

function offer(fields: Partial<SupplierOffer>): SupplierOffer {
    return {
        supplierPartNumber: "X",
        manufacturer: "M",
        manufacturerPartNumber: "X",
        description: "",
        stockQty: 1000,
        moq: 1,
        orderMultiple: 1,
        priceBreaks: [{ qty: 1, unitPrice: 1 }],
        priceKind: "list",
        currency: "EUR",
        lifecycle: "active",
        lifecycleRaw: null,
        rohs: null,
        ...fields
    };
}

function found(fields: Partial<SupplierOffer>): LookupResult {
    return {
        status: "found",
        matchedBy: "supplierPartNumber",
        runId: "r",
        fetchedAt: AT,
        offer: offer(fields)
    };
}

/** One row with qty and the given part numbers and results. */
function setup(
    qty: number,
    results: Partial<Record<SupplierId, LookupResult>>
): Project {
    const partNumbers = Object.fromEntries(
        Object.keys(results).map(s => [s, `PN-${s}`])
    );
    const collected: CollectedData = {
        results: Object.fromEntries(
            Object.entries(results).map(([s, result]) => [
                s,
                { [`PN-${s.toUpperCase()}`]: result }
            ])
        ),
        runs: {}
    };
    return {
        ...addRow(createProject(), createRow({ qty, partNumbers })),
        suppliers: Object.keys(results) as SupplierId[],
        collected
    };
}

describe("order quantity", () => {
    it("raises the quantity to the MOQ and the multiple", () => {
        expect(orderQuantity(3, 10, 1)).toBe(10); // scope: Qty 3, MOQ 10 → 10
        expect(orderQuantity(25, 10, 1)).toBe(25);
        expect(orderQuantity(2, 50, 50)).toBe(50);
        expect(orderQuantity(60, 50, 50)).toBe(100);
        expect(orderQuantity(7, 1, 5)).toBe(10);
        expect(orderQuantity(0, 10, 1)).toBe(0);
    });
});

describe("price breaks", () => {
    const breaks = [
        { qty: 1, unitPrice: 0.1 },
        { qty: 10, unitPrice: 0.05 },
        { qty: 100, unitPrice: 0.02 }
    ];

    it("uses the tier for the order quantity", () => {
        expect(priceAt(breaks, 1)).toEqual({
            unitPrice: 0.1,
            belowFirstBreak: false
        });
        expect(priceAt(breaks, 99)).toEqual({
            unitPrice: 0.05,
            belowFirstBreak: false
        });
        expect(priceAt(breaks, 100)).toEqual({
            unitPrice: 0.02,
            belowFirstBreak: false
        });
        expect(priceAt([], 5)).toBeNull();
    });

    it("flags quantities below the first break", () => {
        expect(priceAt([{ qty: 10, unitPrice: 0.5 }], 4)).toEqual({
            unitPrice: 0.5,
            belowFirstBreak: true
        });
    });
});

describe("supplier line", () => {
    it("calculates order quantity, unit price, total and availability", () => {
        const project = setup(3, {
            mouser: found({
                moq: 10,
                stockQty: 50,
                priceBreaks: [
                    { qty: 1, unitPrice: 0.2 },
                    { qty: 10, unitPrice: 0.1 }
                ]
            })
        });
        const line = supplierLine(
            project.rows[0]!,
            "mouser",
            project.collected
        );
        expect(line).toMatchObject({
            orderQty: 10,
            unitPrice: 0.1,
            total: 1,
            availability: { kind: "in-stock" }
        });
    });

    it("reports partial stock, no stock and parts that can't be ordered", () => {
        const line = (fields: Partial<SupplierOffer>) => {
            const project = setup(20, { tme: found(fields) });
            return supplierLine(project.rows[0]!, "tme", project.collected)
                ?.availability;
        };
        expect(line({ stockQty: 10 })).toEqual({ kind: "partial", stock: 10 });
        expect(line({ stockQty: 0 })).toEqual({ kind: "out-of-stock" });
        expect(line({ lifecycle: "not-orderable" })).toEqual({
            kind: "not-orderable"
        });
    });

    it("has no total for prices in another currency", () => {
        const project = setup(1, { digikey: found({ currency: "USD" }) });
        const line = supplierLine(
            project.rows[0]!,
            "digikey",
            project.collected
        );
        expect(line).toMatchObject({
            unitPrice: 1,
            inBaseCurrency: false,
            total: null
        });
        expect(foreignCurrencies(project)).toEqual({ digikey: ["USD"] });
    });
});

describe("best supplier", () => {
    it("skips a cheaper supplier without enough stock (scope example)", () => {
        // Mouser €1 but only 10 in stock; DigiKey €1.20 with enough.
        const project = setup(20, {
            mouser: found({
                stockQty: 10,
                priceBreaks: [{ qty: 1, unitPrice: 1 }]
            }),
            digikey: found({
                stockQty: 100,
                priceBreaks: [{ qty: 1, unitPrice: 1.2 }]
            })
        });
        const best = bestSupplier(
            project.rows[0]!,
            project.collected,
            project.suppliers,
            ["digikey", "mouser", "tme"]
        );
        expect(best?.supplier).toBe("digikey");
        expect(best?.line.total).toBeCloseTo(24);
    });

    it("compares totals, including the MOQ", () => {
        // TME's unit price is lower, but its MOQ makes the total higher.
        const project = setup(5, {
            tme: found({
                moq: 100,
                priceBreaks: [{ qty: 100, unitPrice: 0.01 }]
            }),
            mouser: found({ priceBreaks: [{ qty: 1, unitPrice: 0.15 }] })
        });
        expect(
            bestSupplier(
                project.rows[0]!,
                project.collected,
                project.suppliers,
                []
            )?.supplier
        ).toBe("mouser");
    });

    it("breaks ties by the preferred supplier order", () => {
        const project = setup(1, { mouser: found({}), tme: found({}) });
        const row = project.rows[0]!;
        expect(
            bestSupplier(row, project.collected, project.suppliers, [
                "tme",
                "mouser"
            ])?.supplier
        ).toBe("tme");
        expect(
            bestSupplier(row, project.collected, project.suppliers, [
                "mouser",
                "tme"
            ])?.supplier
        ).toBe("mouser");
    });

    it("ignores other currencies and parts that can't be ordered", () => {
        const project = setup(1, {
            digikey: found({
                currency: "USD",
                priceBreaks: [{ qty: 1, unitPrice: 0.5 }]
            }),
            tme: found({ lifecycle: "not-orderable" })
        });
        expect(
            bestSupplier(
                project.rows[0]!,
                project.collected,
                project.suppliers,
                []
            )
        ).toBeNull();
        expect(bomTotals(project, [])).toEqual({
            total: 0,
            covered: 0,
            uncovered: 1
        });
    });

    it("totals the best prices", () => {
        const project = setup(4, {
            mouser: found({ priceBreaks: [{ qty: 1, unitPrice: 0.25 }] })
        });
        expect(bomTotals(project, [])).toEqual({
            total: 1,
            covered: 1,
            uncovered: 0
        });
    });
});
