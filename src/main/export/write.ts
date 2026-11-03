// Turns export sheets into file contents: CSV with SheetJS, which is used
// only here (see docs/upgrade-checklist.md), and formatted xlsx and ods
// files with spreadsheet.ts (#50).

import * as XLSX from "xlsx";
import type { ExportFormat, ExportSheet } from "../../shared/export";
import { spreadsheetFile } from "./spreadsheet";

const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

export interface ExportOptions {
    /** CSV: numbers with a decimal comma, and ";" between the values, as
     *  spreadsheets expect in regions that write numbers so (#37). */
    decimalComma?: boolean;
    /** xlsx and ods: in the page header, e.g. the file's name. */
    title?: string;
}

function withDecimalComma(sheet: ExportSheet): ExportSheet {
    return {
        ...sheet,
        rows: sheet.rows.map(row =>
            row.map(cell =>
                typeof cell === "number" ? String(cell).replace(".", ",") : cell
            )
        )
    };
}

/**
 * The file contents for `format`. A CSV file holds only the first sheet,
 * in UTF-8 with a byte order mark so Excel reads the text correctly.
 */
export function exportFile(
    format: ExportFormat,
    sheets: readonly ExportSheet[],
    { decimalComma = false, title }: ExportOptions = {}
): Uint8Array {
    if (format === "csv") {
        const sheet = decimalComma ? withDecimalComma(sheets[0]!) : sheets[0]!;
        const csv = XLSX.utils.sheet_to_csv(
            XLSX.utils.aoa_to_sheet(sheet.rows),
            {
                rawNumbers: true,
                FS: decimalComma ? ";" : ","
            }
        );
        return new TextEncoder().encode(`${BYTE_ORDER_MARK}${csv}\n`);
    }
    return spreadsheetFile(format, sheets, { title });
}
