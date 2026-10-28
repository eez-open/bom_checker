import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { ExportSheet } from "../../shared/export";
import { exportFile } from "./write";

/** A cell of a sheet read back, typed (SheetJS types cells as any). */
function cell(sheet: XLSX.WorkSheet | undefined, address: string) {
    return sheet?.[address] as XLSX.CellObject | undefined;
}

const BOM: ExportSheet = {
    name: "BOM",
    rows: [
        [
            "Reference",
            "Qty",
            "Mouser",
            "Mouser_Unit price",
            "Mouser_Availability"
        ],
        ["C1,C2", 2, "81-GRT1885C2A102JA2D", 0.1234, "In stock"],
        ["Ž1", 1, "-", null, "Not found"]
    ],
    numberFormats: { 3: "0.0000" },
    widths: [20, 6, 22, 12, 16]
};

const INFO: ExportSheet = {
    name: "Info",
    rows: [["BOM", "Board"]],
    numberFormats: {},
    widths: [20, 40]
};

describe("export files", () => {
    it.each(["xlsx", "ods"] as const)(
        "writes %s with numbers and both sheets",
        format => {
            const book = XLSX.read(exportFile(format, [BOM, INFO]));
            expect(book.SheetNames).toEqual(["BOM", "Info"]);
            const bom = book.Sheets.BOM;
            expect(cell(bom, "A2")?.v).toBe("C1,C2");
            expect(cell(bom, "B2")).toMatchObject({ t: "n", v: 2 });
            expect(cell(bom, "D2")).toMatchObject({ t: "n", v: 0.1234 });
            expect(cell(bom, "D3")).toBeUndefined(); // empty, not 0
            expect(cell(bom, "A3")?.v).toBe("Ž1");
            expect(cell(book.Sheets.Info, "B1")?.v).toBe("Board");
        }
    );

    it("keeps the number format in xlsx", () => {
        const book = XLSX.read(exportFile("xlsx", [BOM]), { cellNF: true });
        expect(cell(book.Sheets.BOM, "D2")?.z).toBe("0.0000");
    });

    it("writes the first sheet as UTF-8 CSV with a byte order mark", () => {
        const bytes = exportFile("csv", [BOM, INFO]);
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        const text = new TextDecoder().decode(bytes);
        expect(text.split("\n").slice(0, 3)).toEqual([
            "Reference,Qty,Mouser,Mouser_Unit price,Mouser_Availability",
            '"C1,C2",2,81-GRT1885C2A102JA2D,0.1234,In stock',
            "Ž1,1,-,,Not found"
        ]);
        expect(text).not.toContain("Board");
    });

    it("writes CSV with decimal commas and semicolons (#37)", () => {
        const text = new TextDecoder().decode(
            exportFile("csv", [BOM], { decimalComma: true })
        );
        expect(text.split("\n").slice(0, 3)).toEqual([
            "Reference;Qty;Mouser;Mouser_Unit price;Mouser_Availability",
            "C1,C2;2;81-GRT1885C2A102JA2D;0,1234;In stock",
            "Ž1;1;-;;Not found"
        ]);
    });
});
