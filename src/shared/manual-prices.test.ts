import { describe, expect, it } from "vitest";
import { parsePriceBreaks, validPriceBreaks } from "./manual-prices";

/** Editor rows from [qty, price] pairs; the first is from 1. */
const rows = (...pairs: [string, string][]) =>
    pairs.map(([qty, price]) => ({ qty, price }));

describe("price breaks of suppliers without an API (#51)", () => {
    it("reads the typed prices, sorted by quantity", () => {
        expect(
            parsePriceBreaks(
                rows(["1", "1.10"], ["100", "0,8"], ["", ""], ["25", "1"])
            )
        ).toEqual({
            breaks: [
                { qty: 1, unitPrice: 1.1 },
                { qty: 25, unitPrice: 1 },
                { qty: 100, unitPrice: 0.8 }
            ]
        });
        expect(parsePriceBreaks(rows(["1", ""], ["", ""]))).toEqual({
            breaks: []
        });
    });

    it("says what's missing or wrong", () => {
        const error = (...pairs: [string, string][]) => {
            const parsed = parsePriceBreaks(rows(...pairs));
            return "error" in parsed ? parsed.error : null;
        };
        expect(error(["1", ""], ["25", "1"])).toBe(
            "Enter the unit price from 1 first."
        );
        expect(error(["1", "2"], ["", "1"])).toBe(
            "Enter the quantity for the price 1."
        );
        expect(error(["1", "2"], ["25", ""])).toBe(
            "Enter the unit price from 25."
        );
        expect(error(["1", "2"], ["1", "1.5"])).toBe(
            '"1" isn\'t a quantity above 1.'
        );
        expect(error(["1", "x"])).toBe('"x" isn\'t a price.');
        expect(error(["1", "-1"])).toBe('"-1" isn\'t a price.');
        expect(error(["1", "2"], ["25", "1"], ["25", "0.9"])).toBe(
            "There are two prices from 25."
        );
    });

    it("checks price breaks from the renderer", () => {
        expect(
            validPriceBreaks([
                { qty: 1, unitPrice: 2 },
                { qty: 10, unitPrice: 1 }
            ])
        ).toEqual([
            { qty: 1, unitPrice: 2 },
            { qty: 10, unitPrice: 1 }
        ]);
        expect(validPriceBreaks([])).toEqual([]);
        // Not from 1, not ascending, too many, not numbers.
        expect(validPriceBreaks([{ qty: 5, unitPrice: 1 }])).toBeNull();
        expect(
            validPriceBreaks([
                { qty: 1, unitPrice: 2 },
                { qty: 10, unitPrice: 1 },
                { qty: 10, unitPrice: 1 }
            ])
        ).toBeNull();
        expect(
            validPriceBreaks(
                [1, 2, 3, 4, 5].map(qty => ({ qty, unitPrice: 1 }))
            )
        ).toBeNull();
        expect(validPriceBreaks([{ qty: 1, unitPrice: "1" }])).toBeNull();
        expect(validPriceBreaks("1.5")).toBeNull();
    });
});
