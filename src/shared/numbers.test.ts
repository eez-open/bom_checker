import { describe, expect, it } from "vitest";
import { numberLocale, numbersFor, parseDecimal } from "./numbers";

describe("number formats (#37)", () => {
    it("formats with a decimal point or a decimal comma", () => {
        const point = numbersFor(numberLocale("point", "hr-HR"));
        expect(point.decimalComma).toBe(false);
        expect(point.quantity(1234.5)).toBe("1,234.5");
        expect(point.unitPrice(0.095)).toBe("0.0950");
        expect(point.money(62.5)).toBe("62.50");
        expect(point.price(0.07123)).toBe("0.07123");
        expect(point.percent(0.125)).toBe("12.5%");
        expect(point.plain(1234.5)).toBe("1234.5");

        const comma = numbersFor(numberLocale("comma", "en-US"));
        expect(comma.decimalComma).toBe(true);
        expect(comma.quantity(1234.5)).toBe("1.234,5");
        expect(comma.unitPrice(0.095)).toBe("0,0950");
        expect(comma.money(62.5)).toBe("62,50");
        expect(comma.plain(1234.5)).toBe("1234,5");
    });

    it("follows the system's regional settings", () => {
        expect(numbersFor(numberLocale("system", "hr-HR")).money(1.5)).toBe(
            "1,50"
        );
        expect(numbersFor(numberLocale("system", "en-GB")).money(1.5)).toBe(
            "1.50"
        );
        // Latin digits, and decimal points for a locale that isn't one.
        expect(numbersFor("ar-EG").money(1.5)).toMatch(/^1.50$/);
        expect(numbersFor("not a locale").decimalComma).toBe(false);
    });

    it("reads typed numbers with either separator", () => {
        expect(parseDecimal("0,5")).toBe(0.5);
        expect(parseDecimal(" 0.004 ")).toBe(0.004);
        expect(parseDecimal("12")).toBe(12);
        expect(parseDecimal("-1,5")).toBe(-1.5);
        expect(parseDecimal(",5")).toBe(0.5);
        for (const text of ["", "abc", "1.234,5", "1,", "-", "1e3"]) {
            expect(parseDecimal(text)).toBeUndefined();
        }
    });
});
