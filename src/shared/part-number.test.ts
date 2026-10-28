import { describe, expect, it } from "vitest";
import {
    hasAlternatives,
    isPartNumberDefined,
    normalizeCell,
    valueAsPartNumber
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

describe("valueAsPartNumber", () => {
    it("takes Values that look like manufacturer part numbers", () => {
        for (const value of [
            "TPS54331DDA",
            "1N4007",
            "2N7002",
            "LM358",
            "ESP32-S3-WROOM-1",
            " STM32F103C8T6 ",
            "22-01-3037",
            "08-50-0114",
            "1-640456-0",
            "1757242",
            "61300311121"
        ]) {
            expect(valueAsPartNumber(value)).toBe(value.trim());
        }
    });

    it("skips generic values, symbol names and text", () => {
        for (const value of [
            "100n",
            "4u7",
            "10k",
            "1k5",
            "0R010",
            "2.2uF",
            "100nF/50V",
            "10k 1%",
            "47pF",
            "1M",
            "100",
            "4700",
            "100000",
            "5-12",
            "2.5-3.3",
            "LED",
            "DNP",
            "Conn_01x04",
            "100nF 50V X7R",
            ""
        ]) {
            expect(valueAsPartNumber(value)).toBeNull();
        }
    });
});
