// Turns export sheets into file contents with SheetJS. SheetJS is used
// only here (see docs/upgrade-checklist.md).

import * as XLSX from "xlsx";
import type { ExportFormat, ExportSheet } from "../../shared/export";

const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

function toWorksheet(sheet: ExportSheet): XLSX.WorkSheet {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    worksheet["!cols"] = sheet.widths.map(wch => ({ wch }));
    for (const [column, format] of Object.entries(sheet.numberFormats)) {
        for (let row = 1; row < sheet.rows.length; row++) {
            const cell = worksheet[
                XLSX.utils.encode_cell({ r: row, c: Number(column) })
            ] as XLSX.CellObject | undefined;
            if (cell?.t === "n") {
                cell.z = format;
            }
        }
    }
    return worksheet;
}

/**
 * The file contents for `format`. A CSV file holds only the first sheet,
 * in UTF-8 with a byte order mark so Excel reads the text correctly.
 */
export function exportFile(
    format: ExportFormat,
    sheets: readonly ExportSheet[]
): Uint8Array {
    if (format === "csv") {
        const csv = XLSX.utils.sheet_to_csv(toWorksheet(sheets[0]!), {
            rawNumbers: true
        });
        return new TextEncoder().encode(`${BYTE_ORDER_MARK}${csv}\n`);
    }
    const book = XLSX.utils.book_new();
    for (const sheet of sheets) {
        XLSX.utils.book_append_sheet(book, toWorksheet(sheet), sheet.name);
    }
    const data = XLSX.write(book, {
        type: "array",
        bookType: format,
        compression: true
    }) as ArrayBuffer;
    return new Uint8Array(data);
}
