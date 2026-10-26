import { describe, expect, it } from "vitest";
import { parseMouserResponse, parsePrice } from "./mouser";
import { AuthError, QuotaExceededError, ThrottledError } from "./types";

// Shapes follow the Mouser Search API v1 schema and real responses quoted
// in the research for "BOM checker architecture.md".
const TPS = {
    Availability: "1027 In Stock",
    AvailabilityInStock: "1027",
    LifecycleStatus: null,
    Manufacturer: "Texas Instruments",
    ManufacturerPartNumber: "TPS54331DDA",
    MouserPartNumber: "595-TPS54331DDA",
    Description: "Switching Voltage Regulators 3.5V-28V Inp 3A",
    Min: "1",
    Mult: "1",
    ROHSStatus: "RoHS Compliant",
    PriceBreaks: [
        { Quantity: 10, Price: "1,52 €", Currency: "EUR" },
        { Quantity: 1, Price: "2,10 €", Currency: "EUR" }
    ],
    ProductDetailUrl: "https://hr.mouser.com/ProductDetail/x",
    DataSheetUrl: "",
    ProductAttributes: [{ AttributeName: "Packaging", AttributeValue: "Tube" }]
};

const REEL = {
    ...TPS,
    MouserPartNumber: "595-TPS54331DDAR",
    ManufacturerPartNumber: "TPS54331DDAR",
    AvailabilityInStock: "",
    Min: "2500",
    Mult: "2500",
    LifecycleStatus: "End of Life"
};

function ok(parts: unknown[]) {
    return {
        Errors: [],
        SearchResults: { NumberOfResult: parts.length, Parts: parts }
    };
}

describe("Mouser responses", () => {
    it("maps parts to offers and matches each requested part number", () => {
        const outcomes = parseMouserResponse(
            ["595-tps54331dda ", "595-TPS54331DDAR", "TPS54331DDAR", "NOPE-1"],
            200,
            ok([TPS, REEL])
        );
        const first = outcomes.get("595-TPS54331DDA");
        expect(first).toMatchObject({
            status: "found",
            matchedBy: "supplierPartNumber",
            offer: {
                supplierPartNumber: "595-TPS54331DDA",
                manufacturer: "Texas Instruments",
                stockQty: 1027,
                moq: 1,
                orderMultiple: 1,
                priceBreaks: [
                    { qty: 1, unitPrice: 2.1 },
                    { qty: 10, unitPrice: 1.52 }
                ],
                currency: "EUR",
                priceKind: "unknown",
                lifecycle: "active",
                rohs: "RoHS Compliant",
                packaging: "Tube"
            }
        });
        expect(outcomes.get("595-TPS54331DDAR")).toMatchObject({
            status: "found",
            offer: {
                stockQty: 0,
                moq: 2500,
                orderMultiple: 2500,
                lifecycle: "eol"
            }
        });
        // A manufacturer part number in the cell.
        expect(outcomes.get("TPS54331DDAR")).toMatchObject({
            status: "found",
            matchedBy: "mpn",
            offer: { supplierPartNumber: "595-TPS54331DDAR" }
        });
        expect(outcomes.get("NOPE-1")).toEqual({ status: "notFound" });
    });

    it("reports several parts with the same manufacturer number as ambiguous", () => {
        const other = {
            ...TPS,
            MouserPartNumber: "534-5120",
            ManufacturerPartNumber: "5120"
        };
        const abb = {
            ...TPS,
            MouserPartNumber: "123-5120",
            ManufacturerPartNumber: "5120"
        };
        const outcome = parseMouserResponse(
            ["5120"],
            200,
            ok([other, abb])
        ).get("5120");
        expect(outcome).toMatchObject({ status: "ambiguous" });
    });

    it("ignores placeholder part numbers", () => {
        const outcomes = parseMouserResponse(
            ["X"],
            200,
            ok([
                { ...TPS, MouserPartNumber: "N/A", ManufacturerPartNumber: "X" }
            ])
        );
        expect(outcomes.get("X")).toEqual({ status: "notFound" });
    });

    it("recognises limits and bad keys", () => {
        const daily = {
            Errors: [
                {
                    Code: "TooManyRequests",
                    Message: "Maximum calls per day exceeded.",
                    ResourceKey: "MaxCallPerDay"
                }
            ]
        };
        expect(() => parseMouserResponse(["A"], 403, daily)).toThrow(
            QuotaExceededError
        );
        const minute = {
            Errors: [
                {
                    Code: "TooManyRequests",
                    Message: "Maximum calls per minute exceeded."
                }
            ]
        };
        expect(() => parseMouserResponse(["A"], 403, minute)).toThrow(
            ThrottledError
        );
        const badKey = {
            Errors: [
                {
                    Id: 0,
                    Code: "Invalid",
                    Message: "Invalid unique identifier.",
                    ResourceKey: "InvalidIdentifier",
                    PropertyName: "API Key"
                }
            ],
            SearchResults: null
        };
        expect(() => parseMouserResponse(["A"], 200, badKey)).toThrow(
            AuthError
        );
    });
});

describe("parsePrice", () => {
    it.each([
        ["6,85 €", "EUR", 6.85],
        ["€ 2,10", "EUR", 2.1],
        ["0,0123 €", "EUR", 0.0123],
        ["1.234,50 €", "EUR", 1234.5],
        ["$1,234.50", "USD", 1234.5],
        ["$0.452", "USD", 0.452],
        ["$1,234", "USD", 1234],
        ["¥18.6111", "CNY", 18.6111],
        [3.5, "EUR", 3.5],
        ["n/a", "EUR", null]
    ] as const)("%s (%s) → %s", (text, currency, expected) => {
        expect(parsePrice(text, currency)).toBe(expected);
    });
});
