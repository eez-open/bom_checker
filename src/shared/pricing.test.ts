import { describe, expect, it } from "vitest";
import type {
    CollectedData,
    LookupResult,
    Project,
    SupplierId,
    SupplierOffer
} from "./model";
import {
    anyInStock,
    bestSupplier,
    bomTotals,
    cheaperBreak,
    foreignCurrencies,
    matchesRowView,
    orderQuantity,
    priceAt,
    supplierLine,
    supplierTotal
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
    it("handles decimal quantities without rounding noise", () => {
        // 0.004 m of tape per device, sold in 5 m rolls (MOQ 5, multiple 5).
        expect(orderQuantity(0.004, 5, 5)).toBe(5);
        expect(orderQuantity(0.004 * 1250, 5, 5)).toBe(5);
        expect(orderQuantity(0.004 * 1251, 5, 5)).toBe(10);
    });

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
            project.collected,
            1
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
            return supplierLine(project.rows[0]!, "tme", project.collected, 1)
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
            project.collected,
            1
        );
        expect(line).toMatchObject({
            unitPrice: 1,
            inBaseCurrency: false,
            total: null
        });
        expect(foreignCurrencies(project)).toEqual({ digikey: ["USD"] });
    });

    it("doesn't count an offer without prices as another currency (#84)", () => {
        // Mouser takes the currency from the prices, so it has none here.
        const project = setup(1, {
            mouser: found({ currency: "", priceBreaks: [] })
        });
        expect(
            supplierLine(project.rows[0]!, "mouser", project.collected, 1)
        ).toMatchObject({ unitPrice: null, inBaseCurrency: true, total: null });
        expect(foreignCurrencies(project)).toEqual({});
    });

    it("names no currency when the supplier didn't (#84)", () => {
        const project = setup(1, { mouser: found({ currency: "" }) });
        expect(foreignCurrencies(project)).toEqual({ mouser: [""] });
    });
});

describe("build quantity", () => {
    it("multiplies Qty for order quantity, price break and stock", () => {
        const project = {
            ...setup(3, {
                mouser: found({
                    moq: 10,
                    stockQty: 50,
                    priceBreaks: [
                        { qty: 1, unitPrice: 0.2 },
                        { qty: 50, unitPrice: 0.1 }
                    ]
                }),
                tme: found({
                    stockQty: 1000,
                    priceBreaks: [{ qty: 1, unitPrice: 0.15 }]
                })
            }),
            buildQuantity: 25
        };
        const row = project.rows[0]!;
        expect(
            supplierLine(row, "mouser", project.collected, 25)
        ).toMatchObject({
            orderQty: 75,
            unitPrice: 0.1,
            total: 7.5,
            availability: { kind: "partial", stock: 50 }
        });
        // Mouser is cheaper but can't deliver 75.
        expect(
            bestSupplier(row, project.collected, project.suppliers, [], 25)
                ?.supplier
        ).toBe("tme");
        expect(bomTotals(project, []).total).toBeCloseTo(11.25);
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
            ["digikey", "mouser", "tme"],
            1
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
                [],
                1
            )?.supplier
        ).toBe("mouser");
    });

    it("breaks ties by the preferred supplier order", () => {
        const project = setup(1, { mouser: found({}), tme: found({}) });
        const row = project.rows[0]!;
        expect(
            bestSupplier(
                row,
                project.collected,
                project.suppliers,
                ["tme", "mouser"],
                1
            )?.supplier
        ).toBe("tme");
        expect(
            bestSupplier(
                row,
                project.collected,
                project.suppliers,
                ["mouser", "tme"],
                1
            )?.supplier
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
                [],
                1
            )
        ).toBeNull();
        expect(bomTotals(project, [])).toEqual({
            total: 0,
            covered: 0,
            partial: 0,
            uncovered: 1,
            cheaper: 0,
            saving: 0
        });
        // TME has it in stock, but can't sell it.
        expect(anyInStock(project.rows[0]!, project)).toBe(true);
    });

    it("totals the best prices", () => {
        const project = setup(4, {
            mouser: found({ priceBreaks: [{ qty: 1, unitPrice: 0.25 }] })
        });
        expect(bomTotals(project, [])).toEqual({
            total: 1,
            covered: 1,
            partial: 0,
            uncovered: 0,
            cheaper: 0,
            saving: 0
        });
    });
});

describe("best supplier without enough stock (#74)", () => {
    const best = (project: Project) =>
        bestSupplier(
            project.rows[0]!,
            project.collected,
            project.suppliers,
            ["digikey", "mouser", "tme"],
            project.buildQuantity
        );

    it("takes the supplier with the most in stock, for what it has", () => {
        // 50 needed: DigiKey has 44, Mouser only 10 at a lower price.
        const project = setup(50, {
            digikey: found({
                stockQty: 44,
                priceBreaks: [
                    { qty: 1, unitPrice: 1 },
                    { qty: 25, unitPrice: 0.9 }
                ]
            }),
            mouser: found({
                stockQty: 10,
                priceBreaks: [{ qty: 1, unitPrice: 0.5 }]
            }),
            tme: found({ stockQty: 0 })
        });
        const choice = best(project);
        expect(choice).toMatchObject({
            supplier: "digikey",
            partial: true,
            line: {
                orderQty: 44,
                unitPrice: 0.9,
                availability: { kind: "partial", stock: 44 }
            }
        });
        expect(choice?.line.total).toBeCloseTo(39.6);
        expect(bomTotals(project, [])).toMatchObject({
            covered: 1,
            partial: 1,
            uncovered: 0
        });
        expect(bomTotals(project, []).total).toBeCloseTo(39.6);
        const row = project.rows[0]!;
        expect(matchesRowView(row, project, [], "partial")).toBe(true);
        expect(matchesRowView(row, project, [], "best:digikey")).toBe(true);
        expect(matchesRowView(row, project, [], "none")).toBe(false);
    });

    it("still prefers a supplier with the whole quantity", () => {
        const project = setup(50, {
            digikey: found({
                stockQty: 44,
                priceBreaks: [{ qty: 1, unitPrice: 0.1 }]
            }),
            mouser: found({
                stockQty: 50,
                priceBreaks: [{ qty: 1, unitPrice: 2 }]
            })
        });
        expect(best(project)).toMatchObject({
            supplier: "mouser",
            partial: false,
            line: { orderQty: 50 }
        });
        expect(matchesRowView(project.rows[0]!, project, [], "partial")).toBe(
            false
        );
    });

    it("orders whole multiples, at least the MOQ", () => {
        // Mouser sells in tens: 40 of its 44. TME's 30 are below its MOQ.
        const project = setup(50, {
            mouser: found({ stockQty: 44, orderMultiple: 10 }),
            tme: found({ stockQty: 30, moq: 100 })
        });
        expect(best(project)).toMatchObject({
            supplier: "mouser",
            line: { orderQty: 40, total: 40 }
        });
        const tmeOnly = setup(50, { tme: found({ stockQty: 30, moq: 100 }) });
        expect(best(tmeOnly)).toBeNull();
        // Not "None in stock": TME has some, but can't sell them.
        expect(anyInStock(tmeOnly.rows[0]!, tmeOnly)).toBe(true);
        expect(matchesRowView(tmeOnly.rows[0]!, tmeOnly, [], "none")).toBe(
            true
        );
    });

    it("breaks equal quantities by unit price, then the preferred order", () => {
        const project = setup(50, {
            digikey: found({
                stockQty: 20,
                priceBreaks: [{ qty: 1, unitPrice: 2 }]
            }),
            mouser: found({
                stockQty: 20,
                priceBreaks: [{ qty: 1, unitPrice: 1 }]
            }),
            tme: found({
                stockQty: 20,
                priceBreaks: [{ qty: 1, unitPrice: 1 }]
            })
        });
        expect(best(project)?.supplier).toBe("mouser");
    });

    it("has no best price when nothing is in stock", () => {
        const project = setup(50, {
            digikey: found({ stockQty: 0 }),
            mouser: { status: "notFound", runId: "r", fetchedAt: AT }
        });
        expect(best(project)).toBeNull();
        expect(anyInStock(project.rows[0]!, project)).toBe(false);
        expect(bomTotals(project, [])).toMatchObject({
            partial: 0,
            uncovered: 1
        });
        // Several items match, one in stock: an item to choose, not "None
        // in stock".
        const choose = setup(50, {
            digikey: {
                status: "ambiguous",
                runId: "r",
                fetchedAt: AT,
                candidates: [offer({ stockQty: 0 }), offer({ stockQty: 500 })]
            }
        });
        expect(best(choose)).toBeNull();
        expect(anyInStock(choose.rows[0]!, choose)).toBe(true);
    });
});

describe("ordering up to a price break (#86)", () => {
    // 5 at 0.10 cost 0.50; 10 at 0.02 cost 0.20.
    const resistor = {
        priceBreaks: [
            { qty: 1, unitPrice: 0.1 },
            { qty: 10, unitPrice: 0.02 },
            { qty: 1000, unitPrice: 0.01 }
        ]
    };

    it("finds the quantity that costs the least in total", () => {
        expect(cheaperBreak(offer(resistor), 5)).toEqual({
            orderQty: 10,
            unitPrice: 0.02,
            total: 0.2
        });
        // 10 cost 0.20 already; 1000 would cost 10.
        expect(cheaperBreak(offer(resistor), 10)).toBeNull();
        // Not the next break, but the one after it.
        expect(
            cheaperBreak(
                offer({
                    priceBreaks: [
                        { qty: 1, unitPrice: 1 },
                        { qty: 10, unitPrice: 0.45 },
                        { qty: 20, unitPrice: 0.2 }
                    ]
                }),
                5
            )
        ).toEqual({ orderQty: 20, unitPrice: 0.2, total: 4 });
        // Savings below a cent aren't worth it.
        expect(
            cheaperBreak(
                offer({
                    priceBreaks: [
                        { qty: 1, unitPrice: 0.01 },
                        { qty: 10, unitPrice: 0.0049 }
                    ]
                }),
                5
            )
        ).toBeNull();
    });

    it("needs the larger quantity in stock, in whole packages", () => {
        expect(cheaperBreak(offer({ ...resistor, stockQty: 9 }), 5)).toBeNull();
        // Sold by 5, at least 5: the break at 10 is two packages.
        expect(
            cheaperBreak(
                offer({
                    ...resistor,
                    priceBreaks: [
                        { qty: 5, unitPrice: 0.5 },
                        { qty: 10, unitPrice: 0.02 }
                    ],
                    moq: 5,
                    orderMultiple: 5
                }),
                5
            )
        ).toEqual({ orderQty: 10, unitPrice: 0.02, total: 0.2 });
        expect(
            cheaperBreak(
                offer({
                    priceBreaks: [
                        { qty: 3, unitPrice: 1 },
                        { qty: 4, unitPrice: 0.5 }
                    ],
                    orderMultiple: 3
                }),
                3
            )
        ).toBeNull(); // 6 at 0.50 cost as much as 3 at 1.00
    });

    it("tells of it, and raises the quantity of a confirmed row", () => {
        const project = setup(5, { mouser: found(resistor) });
        const row = project.rows[0]!;
        expect(supplierLine(row, "mouser", project.collected, 1)).toMatchObject(
            {
                orderQty: 5,
                total: 0.5,
                cheaper: { orderQty: 10, unitPrice: 0.02, total: 0.2 },
                raisedFrom: null
            }
        );
        expect(bomTotals(project, [])).toEqual({
            total: 0.5,
            covered: 1,
            partial: 0,
            uncovered: 0,
            cheaper: 1,
            saving: 0.3
        });

        const confirmed = { ...row, buyToBreak: true as const };
        expect(
            supplierLine(confirmed, "mouser", project.collected, 1)
        ).toMatchObject({
            orderQty: 10,
            unitPrice: 0.02,
            total: 0.2,
            availability: { kind: "in-stock" },
            cheaper: null,
            raisedFrom: 5
        });
        // Nothing to gain for 4 boards: 20 are at 0.02 already.
        expect(
            supplierLine(confirmed, "mouser", project.collected, 4)
        ).toMatchObject({ orderQty: 20, raisedFrom: null });
        expect(bomTotals({ ...project, rows: [confirmed] }, [])).toMatchObject({
            total: 0.2,
            cheaper: 0,
            saving: 0
        });
    });

    it("leaves rows alone that aren't in stock as needed", () => {
        const project = setup(5, {
            mouser: found({ ...resistor, stockQty: 3 })
        });
        const row = { ...project.rows[0]!, buyToBreak: true as const };
        expect(supplierLine(row, "mouser", project.collected, 1)).toMatchObject(
            {
                orderQty: 5,
                availability: { kind: "partial", stock: 3 },
                cheaper: null,
                raisedFrom: null
            }
        );
    });

    it("compares the suppliers' price breaks for the best price", () => {
        // DigiKey is the best for 5 (0.40), Mouser at its break (0.20).
        const project = setup(5, {
            digikey: found({ priceBreaks: [{ qty: 1, unitPrice: 0.08 }] }),
            mouser: found(resistor)
        });
        const best = (row = project.rows[0]!) =>
            bestSupplier(
                row,
                project.collected,
                project.suppliers,
                ["digikey", "mouser"],
                1
            );
        expect(best()).toMatchObject({
            supplier: "digikey",
            line: { orderQty: 5, total: 0.4 },
            cheaper: {
                supplier: "mouser",
                orderQty: 10,
                unitPrice: 0.02,
                total: 0.2
            }
        });
        expect(best({ ...project.rows[0]!, buyToBreak: true })).toMatchObject({
            supplier: "mouser",
            line: { orderQty: 10, total: 0.2, raisedFrom: 5 },
            cheaper: null
        });

        // A break that costs more than the best isn't offered.
        const dear = setup(5, {
            digikey: found({ priceBreaks: [{ qty: 1, unitPrice: 0.03 }] }),
            mouser: found(resistor)
        });
        expect(
            bestSupplier(dear.rows[0]!, dear.collected, dear.suppliers, [], 1)
        ).toMatchObject({ supplier: "digikey", cheaper: null });
    });
});

describe("supplier total", () => {
    it("sums the total prices and counts the rows that have one", () => {
        const project = addRow(
            setup(4, {
                mouser: found({ priceBreaks: [{ qty: 1, unitPrice: 0.25 }] }),
                digikey: found({ currency: "USD" })
            }),
            createRow({ qty: 2, partNumbers: { mouser: "PN-mouser" } })
        );
        expect(supplierTotal(project, "mouser")).toEqual({
            total: 1.5,
            priced: 2
        });
        expect(supplierTotal(project, "digikey")).toEqual({
            total: 0,
            priced: 0
        });
    });
});
