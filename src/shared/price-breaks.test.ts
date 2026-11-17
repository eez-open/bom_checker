import { describe, expect, it } from "vitest";
import type { LookupResult, PriceBreak, Project } from "./model";
import { breakOffers, setBuyToBreak } from "./price-breaks";
import { bomTotals } from "./pricing";
import { parseProjectFile, serializeProject } from "./project-file";
import { addRow, createProject, createRow } from "./project-ops";

function found(priceBreaks: PriceBreak[]): LookupResult {
    return {
        status: "found",
        matchedBy: "supplierPartNumber",
        runId: "r",
        fetchedAt: "2026-11-17",
        offer: {
            supplierPartNumber: "",
            manufacturer: "",
            manufacturerPartNumber: "",
            description: "",
            stockQty: 5000,
            moq: 1,
            orderMultiple: 1,
            priceBreaks,
            priceKind: "list",
            currency: "EUR",
            lifecycle: "active",
            lifecycleRaw: null,
            rohs: null
        }
    };
}

/** A resistor that costs less at Mouser's break of 10, a capacitor that
 *  doesn't, and a connector without data. */
function project(): Project {
    const rows = [
        createRow({
            reference: "R1-R5",
            value: "10k",
            qty: 5,
            partNumbers: { digikey: "D-R", mouser: "M-R" }
        }),
        createRow({
            reference: "C1",
            value: "100n",
            qty: 10,
            partNumbers: { digikey: "D-C" }
        }),
        createRow({ reference: "J1", value: "USB", qty: 1 })
    ];
    return {
        ...rows.reduce(addRow, createProject()),
        suppliers: ["digikey", "mouser"],
        collected: {
            results: {
                digikey: {
                    "D-R": found([{ qty: 1, unitPrice: 0.08 }]),
                    "D-C": found([
                        { qty: 1, unitPrice: 0.05 },
                        { qty: 100, unitPrice: 0.04 }
                    ])
                },
                mouser: {
                    "M-R": found([
                        { qty: 1, unitPrice: 0.1 },
                        { qty: 10, unitPrice: 0.02 }
                    ])
                }
            },
            runs: {}
        }
    };
}

describe("cheaper price breaks (#86)", () => {
    it("offers the rows that cost less when more is ordered", () => {
        const bom = project();
        const offers = breakOffers(bom, ["digikey", "mouser"]);
        expect(offers).toHaveLength(1);
        expect(offers[0]).toMatchObject({
            rowId: bom.rows[0]!.id,
            rowNumber: 1,
            reference: "R1-R5",
            value: "10k",
            needed: { supplier: "digikey", orderQty: 5, total: 0.4 },
            atBreak: {
                supplier: "mouser",
                orderQty: 10,
                unitPrice: 0.02,
                total: 0.2
            },
            confirmed: false
        });
        expect(offers[0]!.saving).toBeCloseTo(0.2);
    });

    it("orders the confirmed rows so, and offers them still", () => {
        const bom = project();
        const [resistor, capacitor] = bom.rows;
        const confirmed = setBuyToBreak(
            bom,
            new Map([
                [resistor!.id, true],
                [capacitor!.id, false]
            ])
        );
        expect(confirmed.rows.map(row => row.buyToBreak)).toEqual([
            true,
            undefined,
            undefined
        ]);
        // Rows that don't change keep their objects.
        expect(confirmed.rows[1]).toBe(capacitor);
        expect(setBuyToBreak(confirmed, new Map([[resistor!.id, true]]))).toBe(
            confirmed
        );

        expect(bomTotals(bom, []).total).toBeCloseTo(0.4 + 0.5);
        expect(bomTotals(confirmed, [])).toMatchObject({ cheaper: 0 });
        expect(bomTotals(confirmed, []).total).toBeCloseTo(0.2 + 0.5);
        // Still listed, to change it back: with what it would cost.
        expect(breakOffers(confirmed, [])).toMatchObject([
            {
                needed: { supplier: "digikey", orderQty: 5 },
                atBreak: { supplier: "mouser", orderQty: 10 },
                confirmed: true
            }
        ]);

        const back = setBuyToBreak(confirmed, new Map([[resistor!.id, false]]));
        expect("buyToBreak" in back.rows[0]!).toBe(false);
    });

    it("is saved with the BOM", () => {
        const bom = project();
        const confirmed = setBuyToBreak(
            bom,
            new Map([[bom.rows[0]!.id, true]])
        );
        const read = parseProjectFile(serializeProject(confirmed));
        expect(read.rows.map(row => row.buyToBreak)).toEqual([
            true,
            undefined,
            undefined
        ]);
        // A file from before has none.
        const version8 = JSON.stringify({
            ...JSON.parse(serializeProject(bom)),
            schemaVersion: 8
        });
        expect(parseProjectFile(version8).rows).toEqual(bom.rows);
    });
});
