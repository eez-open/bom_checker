import { describe, expect, it } from "vitest";
import {
    hasAlternatives,
    isPartNumberDefined,
    normalizeCell
} from "./part-number";

// Values taken from "BOM example.csv".

describe("normalizeCell", () => {
    it("trims both sides", () => {
        expect(normalizeCell("732-7858-1-ND ")).toBe("732-7858-1-ND");
        expect(normalizeCell("  80-C0603C104M4R")).toBe("80-C0603C104M4R");
    });

    it("treats a missing value as empty", () => {
        expect(normalizeCell(undefined)).toBe("");
    });
});

describe("isPartNumberDefined", () => {
    it.each([
        ["", false],
        ["   ", false],
        ["-", false],
        [" - ", false],
        [undefined, false],
        ["587-1283-1-ND", true],
        ["SMD0805-3K9-1%", true]
    ])("%j -> %s", (value, expected) => {
        expect(isPartNumberDefined(value)).toBe(expected);
    });
});

describe("hasAlternatives", () => {
    it("detects 'or' between part numbers", () => {
        expect(hasAlternatives("1866-1644-ND or 1866-LOP-200-48-ND")).toBe(
            true
        );
        expect(hasAlternatives("EPP-150-48 OR LOP-200-48")).toBe(true);
    });

    it("ignores 'or' inside a part number", () => {
        expect(hasAlternatives("TBP03P2-350-03BEOR")).toBe(false);
        expect(hasAlternatives("B4PS-VH (LF)(SN)")).toBe(false);
    });
});
