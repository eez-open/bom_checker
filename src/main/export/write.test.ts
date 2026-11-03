import { strFromU8, unzipSync } from "fflate";
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

    describe("formatting as in the template (#50)", () => {
        const TABLE: ExportSheet = {
            name: "BOM",
            table: true,
            rows: [
                ["Row", "Reference", "Qty", "Mouser_Unit price"],
                [1, "C1,C2", 2, 0.1234],
                [2, "R1", 1, null]
            ],
            numberFormats: { 3: "0.0000" },
            widths: [6, 20, 6, 12]
        };
        const files = (format: "xlsx" | "ods") =>
            Object.fromEntries(
                Object.entries(
                    unzipSync(
                        exportFile(format, [TABLE, INFO], {
                            title: "Board & co"
                        })
                    )
                ).map(([path, bytes]) => [path, strFromU8(bytes)])
            );

        it("writes xlsx with the header, row colours, widths and page", () => {
            const xlsx = files("xlsx");
            const styles = xlsx["xl/styles.xml"]!;
            const sheet = xlsx["xl/worksheets/sheet1.xml"]!;
            // Cell styles by row: header, white, blue gray.
            const cellXfs = /<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(styles)![1]!;
            const xfs = [...cellXfs.matchAll(/<xf [^>]*>.*?<\/xf>/g)].map(
                match => match[0]
            );
            const fills = [...styles.matchAll(/<fill>.*?<\/fill>/g)].map(
                match => /rgb="FF(\w+)"/.exec(match[0])?.[1] ?? null
            );
            const styleOf = (ref: string) => {
                const id = Number(
                    new RegExp(`<c r="${ref}" s="(\\d+)"`).exec(sheet)![1]
                );
                const xf = xfs[id]!;
                return {
                    fill: fills[Number(/fillId="(\d+)"/.exec(xf)![1])],
                    bold: /fontId="1"/.test(xf),
                    centred: xf.includes('horizontal="center"'),
                    format: /numFmtId="(\d+)"/.exec(xf)![1]
                };
            };
            expect(styleOf("B1")).toMatchObject({
                fill: "FFCC00",
                bold: true,
                centred: true
            });
            expect(styleOf("A2")).toMatchObject({
                fill: "FFFFFF",
                bold: false,
                centred: true
            });
            expect(styleOf("B2")).toMatchObject({
                fill: "FFFFFF",
                centred: false
            });
            expect(styleOf("B3")).toMatchObject({ fill: "E6E6FF" });
            // The empty cell is coloured too; its number format kept.
            expect(styleOf("D3")).toMatchObject({
                fill: "E6E6FF",
                format: "164"
            });
            expect(styles).toContain(
                '<numFmt numFmtId="164" formatCode="0.0000"/>'
            );
            // The template's widths: Reference 7.572 cm; others from
            // characters.
            expect(sheet).toContain(
                '<col min="2" max="2" width="40.88" customWidth="1"/>'
            );
            expect(sheet).toContain(
                '<sheetFormatPr defaultRowHeight="12.75"/>'
            );
            expect(sheet).toContain(
                '<pageSetup paperSize="9" scale="83" orientation="landscape"/>'
            );
            expect(sheet).toContain(
                "<oddHeader>&amp;CBoard &amp;&amp; co, Page &amp;P</oddHeader>"
            );
            expect(xlsx["xl/workbook.xml"]).toContain(
                `<definedName name="_xlnm.Print_Area" localSheetId="0">'BOM'!$A$1:$D$3</definedName>`
            );
            // The Info sheet isn't a table.
            expect(xlsx["xl/worksheets/sheet2.xml"]).not.toMatch(/ s="[1-9]/);
        });

        it("writes ods with the header, row colours, widths and page", () => {
            const ods = files("ods");
            const content = ods["content.xml"]!;
            const styles = ods["styles.xml"]!;
            expect(Object.keys(ods)[0]).toBe("mimetype");
            expect(content).toContain('table:print-ranges="BOM.A1:BOM.D3"');
            expect(content).toContain('style:column-width="7.572cm"');
            expect(content).toContain('style:column-width="1.085cm"');
            expect(content).toContain(
                'style:row-height="0.452cm" fo:break-before="auto" style:use-optimal-row-height="true"'
            );
            const cellStyle = (row: number, column: number) => {
                const rows = [
                    ...content.matchAll(
                        /<table:table-row [^>]*>(.*?)<\/table:table-row>/g
                    )
                ];
                const cell = [
                    ...rows[row]![1]!.matchAll(
                        /<table:table-cell table:style-name="(\w+)"/g
                    )
                ][column]![1]!;
                return new RegExp(
                    `<style:style style:name="${cell}".*?</style:style>`
                ).exec(content)![0];
            };
            expect(cellStyle(0, 1)).toContain('fo:background-color="#ffcc00"');
            expect(cellStyle(0, 1)).toContain('fo:font-weight="bold"');
            expect(cellStyle(0, 1)).toContain('fo:text-align="center"');
            expect(cellStyle(1, 0)).toContain('fo:background-color="#ffffff"');
            expect(cellStyle(1, 0)).toContain('fo:text-align="center"');
            expect(cellStyle(1, 1)).not.toContain("fo:text-align");
            expect(cellStyle(2, 1)).toContain('fo:background-color="#e6e6ff"');
            expect(cellStyle(2, 3)).toContain('style:data-style-name="N1"');
            expect(content).toContain(
                '<number:number number:decimal-places="4"'
            );
            expect(styles).toContain(
                'fo:page-width="29.7cm" fo:page-height="21cm" style:print-orientation="landscape"'
            );
            expect(styles).toContain('style:scale-to="83%"');
            expect(styles).toContain(
                "<text:p>Board &amp; co, Page <text:page-number>"
            );
        });
    });
});
