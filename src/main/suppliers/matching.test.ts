import { describe, expect, it } from "vitest";
import type { SupplierOffer } from "../../shared/model";
import { matchOutcome } from "./matching";

function offer(
    supplierPartNumber: string,
    manufacturerPartNumber: string
): SupplierOffer {
    return {
        supplierPartNumber,
        manufacturer: "Molex",
        manufacturerPartNumber,
        description: "",
        stockQty: 100,
        moq: 1,
        orderMultiple: 1,
        priceBreaks: [{ qty: 1, unitPrice: 0.2 }],
        priceKind: "list",
        currency: "EUR",
        lifecycle: "active",
        lifecycleRaw: "Active",
        rohs: null
    };
}

describe("matchOutcome", () => {
    it("prefers the supplier part number, then the manufacturer's as written", () => {
        const offers = [
            offer("538-22-01-3037", "22-01-3037"),
            offer("22-01-3037", "0022013037")
        ];
        expect(matchOutcome("22-01-3037", offers)).toMatchObject({
            status: "found",
            matchedBy: "supplierPartNumber",
            offer: { supplierPartNumber: "22-01-3037" }
        });
        expect(matchOutcome("22-01-3037", offers.slice(0, 1))).toMatchObject({
            status: "found",
            matchedBy: "mpn",
            offer: { supplierPartNumber: "538-22-01-3037" }
        });
    });

    it("accepts a manufacturer part number written in another form", () => {
        // Molex 22-01-3037 and 08-50-0114, as DigiKey lists them.
        const offers = [
            offer("900-0022013037-ND", "0022013037"),
            offer("900-0022013027-ND", "0022013027"),
            offer("WM1114CT-ND", "0008500114")
        ];
        expect(matchOutcome("22-01-3037", offers)).toMatchObject({
            status: "found",
            matchedBy: "mpn",
            offer: { supplierPartNumber: "900-0022013037-ND" }
        });
        expect(matchOutcome("08-50-0114", offers)).toMatchObject({
            status: "found",
            offer: { supplierPartNumber: "WM1114CT-ND" }
        });
        expect(matchOutcome("22-01-3047", offers)).toEqual({
            status: "notFound"
        });
    });

    it("asks when several offers have the number, or none has it", () => {
        const packagings = [
            offer("WM1114CT-ND", "0008500114"),
            offer("WM1114TR-ND", "0008500114")
        ];
        expect(matchOutcome("08-50-0114", packagings)).toMatchObject({
            status: "ambiguous",
            candidates: packagings
        });
        expect(
            matchOutcome("08-50-0115", packagings, { askWhenUnsure: true })
        ).toMatchObject({ status: "ambiguous", candidates: packagings });
    });
});
