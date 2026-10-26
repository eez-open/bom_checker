import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    decodeText,
    detectEncoding,
    importTable,
    parseCsv,
    suggestMapping,
    validateMapping,
    type ColumnTarget
} from "./csv-import";
import { hasAlternatives } from "./part-number";

const EXAMPLE = readFileSync(join(__dirname, "../../BOM example.csv"));
const SOURCE = {
    kind: "csv",
    path: "BOM example.csv",
    importedAt: "2026-10-26T10:00:00Z"
} as const;

function importExample() {
    const table = parseCsv(decodeText(EXAMPLE, detectEncoding(EXAMPLE)));
    return importTable(table, suggestMapping(table.headers), SOURCE);
}

describe("BOM example.csv", () => {
    it("is parsed with its header", () => {
        const table = parseCsv(decodeText(EXAMPLE, "utf-8"));
        expect(table.headers).toEqual([
            "#",
            "Reference",
            "Value",
            "Footprint",
            "Qty",
            "DigiKey",
            "Mouser",
            "TME",
            "LCSC"
        ]);
        expect(table.rows).toHaveLength(125);
    });

    it("gets a complete mapping suggestion", () => {
        const table = parseCsv(decodeText(EXAMPLE, "utf-8"));
        const mapping = suggestMapping(table.headers);
        expect(mapping).toEqual([
            { kind: "row" },
            { kind: "base", field: "reference" },
            { kind: "base", field: "value" },
            { kind: "base", field: "footprint" },
            { kind: "base", field: "qty" },
            { kind: "partNumber", supplier: "digikey" },
            { kind: "partNumber", supplier: "mouser" },
            { kind: "partNumber", supplier: "tme" },
            { kind: "partNumber", supplier: "lcsc" }
        ]);
        expect(validateMapping(mapping)).toEqual([]);
    });

    it("imports all rows with trimmed values", () => {
        const { project, warnings } = importExample();
        expect(warnings).toEqual([]);
        expect(project.suppliers).toEqual(["digikey", "mouser", "tme", "lcsc"]);
        expect(project.customColumns).toEqual([]);
        expect(project.rows).toHaveLength(125);
        expect(project.rows.reduce((sum, row) => sum + row.qty, 0)).toBe(367);
        expect(project.rows[0]).toMatchObject({
            reference: "C1,C2,C3,C4,C32,C59",
            value: "1n",
            qty: 6,
            footprint: "PCM_EEZ_passives:C_0603_1608Metric",
            partNumbers: {
                digikey: "732-7858-1-ND",
                mouser: "81-GRT1885C2A102JA2D",
                tme: "C0805C102J5GAC"
            }
        });
        expect(project.source).toEqual(SOURCE);
    });

    it("keeps '-' and flags alternatives", () => {
        const { project } = importExample();
        const tr1 = project.rows.find(row => row.reference === "TR1");
        expect(hasAlternatives(tr1?.partNumbers.digikey)).toBe(true);
        const r88 = project.rows.find(row => row.reference === "R88");
        expect(r88?.partNumbers.tme).toBe("-");
        expect(r88?.partNumbers.lcsc).toBe("-");
        const c5 = project.rows.find(
            row =>
                row.reference ===
                "C5,C7,C8,C10,C16,C28,C31,C36,C41,C42,C68,C70,C72,C126"
        );
        expect(c5?.partNumbers).not.toHaveProperty("lcsc");
    });
});

describe("encodings", () => {
    it("detects UTF-8 and falls back to Windows-1250", () => {
        const utf8 = new TextEncoder().encode("Value\nOtpornik čip\n");
        expect(detectEncoding(utf8)).toBe("utf-8");
        // "č" in Windows-1250 is 0xE8, which isn't valid UTF-8 here.
        const cp1250 = new Uint8Array([0x63, 0xe8, 0x0a]);
        expect(detectEncoding(cp1250)).toBe("windows-1250");
        expect(decodeText(cp1250, "windows-1250")).toBe("cč\n");
    });

    it("removes a UTF-8 byte order mark", () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
        expect(decodeText(bytes, "utf-8")).toBe("A");
    });
});

describe("parseCsv", () => {
    it("detects semicolons and pads short rows", () => {
        const table = parseCsv("Reference;Value;Qty\nR1;10k\n\nR2;1k;1\n");
        expect(table.headers).toEqual(["Reference", "Value", "Qty"]);
        expect(table.rows).toEqual([
            ["R1", "10k", ""],
            ["R2", "1k", "1"]
        ]);
    });
});

describe("mapping", () => {
    it("uses each mandatory column once and keeps the rest as custom", () => {
        expect(suggestMapping(["Value", "Value", "", "Manufacturer"])).toEqual([
            { kind: "base", field: "value" },
            { kind: "custom", type: "text" },
            { kind: "ignore" },
            { kind: "custom", type: "text" }
        ]);
    });

    it("reports missing and duplicate targets", () => {
        const qty: ColumnTarget = { kind: "base", field: "qty" };
        const mouser: ColumnTarget = { kind: "partNumber", supplier: "mouser" };
        expect(validateMapping([qty, qty, mouser, mouser])).toEqual([
            "Choose at least the Reference or the Value column.",
            '"Qty" is chosen for more than one column.',
            "Mouser part numbers are chosen for more than one column."
        ]);
    });
});

describe("importTable", () => {
    const mapping: ColumnTarget[] = [
        { kind: "base", field: "reference" },
        { kind: "base", field: "qty" },
        { kind: "custom", type: "number" }
    ];

    it("counts references when Qty is missing or invalid", () => {
        const table = parseCsv("Ref,Qty,Price\nR1 R2 R3,,\nR4,x,\n");
        const { project, warnings } = importTable(table, mapping, SOURCE);
        expect(project.rows.map(row => row.qty)).toEqual([3, 1]);
        expect(warnings).toEqual([
            "2 rows had no valid Qty; the number of references was used instead."
        ]);
    });

    it("converts numbers, including a decimal comma", () => {
        const table = parseCsv('Ref,Qty,Price\nR1,1,"0,25"\nR2,1,n/a\n');
        const { project, warnings } = importTable(table, mapping, SOURCE);
        const id = project.customColumns[0]!.id;
        expect(project.rows.map(row => row.custom[id])).toEqual([
            0.25,
            undefined
        ]);
        expect(warnings).toEqual([
            '1 value in "Price" wasn\'t a number and was left out.'
        ]);
    });

    it("skips rows where every mapped cell is empty", () => {
        const table = parseCsv("Ref,Qty,Price\n,,\nR1,1,\n");
        expect(importTable(table, mapping, SOURCE).project.rows).toHaveLength(
            1
        );
    });
});
