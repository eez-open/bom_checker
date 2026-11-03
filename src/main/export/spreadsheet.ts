// Writes export sheets as formatted .xlsx and .ods files (#50), laid out
// like the template attached to the issue: a bold header row on orange,
// rows alternating white and blue gray, Row and Qty centred, the template's
// column widths, rows of 0.45 cm (a 10 pt font's height; wrapped text makes
// a row taller), and printing on A4 landscape at 83 % with the print range
// covering all columns. SheetJS Community Edition can't write cell styles,
// so both formats are written here: Office Open XML (ECMA-376) and
// OpenDocument (ODF 1.2), zipped with fflate. Only main/export/ uses this.

import { strToU8, zipSync, type Zippable } from "fflate";
import type { ExportCell, ExportSheet } from "../../shared/export";

/** Column widths of the template, in cm, by header. */
const TEMPLATE_WIDTHS: Readonly<Record<string, number>> = {
    Row: 1.085,
    Reference: 7.572,
    Value: 2.99,
    Qty: 1.085,
    Footprint: 6.727,
    DigiKey: 3.214,
    Mouser: 4.549,
    TME: 3.625,
    LCSC: 2.152
};

/** Columns centred in the template. */
const CENTRED = new Set(["Row", "Qty"]);

const HEADER_FILL = "FFCC00";
const EVEN_FILL = "FFFFFF";
const ODD_FILL = "E6E6FF";

/** For widths given in characters. */
const CM_PER_CHARACTER = 0.2;
const FONT_SIZE_PT = 10;
/** A 10 pt font's row: 0.45 cm. */
const ROW_HEIGHT_PT = 12.75;
const ROW_HEIGHT_CM = 0.452;

/** A4 landscape, 1 cm margins, printed at 83 %. */
const PAGE = { widthCm: 29.7, heightCm: 21, marginCm: 1, scale: 83 };

export interface SpreadsheetOptions {
    /** In the page header, e.g. the file's name. */
    title?: string;
}

/** How a cell looks. */
interface CellStyle {
    fill: string | null;
    bold: boolean;
    centred: boolean;
    wrap: boolean;
    format: string | null;
}

/** Each cell's style, from the sheet's layout. */
function styleOf(sheet: ExportSheet, row: number, column: number): CellStyle {
    const format = row > 0 ? (sheet.numberFormats[column] ?? null) : null;
    const plain = format === "General" ? null : format;
    if (!sheet.table) {
        return {
            fill: null,
            bold: false,
            centred: false,
            wrap: false,
            format: plain
        };
    }
    const header = String(sheet.rows[0]?.[column] ?? "");
    return {
        // Rows are numbered from 1: the header is row 1, then even, odd…
        fill: row === 0 ? HEADER_FILL : row % 2 === 1 ? EVEN_FILL : ODD_FILL,
        bold: row === 0,
        centred: row === 0 || CENTRED.has(header),
        wrap: true,
        format: plain
    };
}

function styleKey(style: CellStyle): string {
    return JSON.stringify(style);
}

/** Column widths in cm. */
function widthsOf(sheet: ExportSheet): number[] {
    const columns = Math.max(
        sheet.widths.length,
        ...sheet.rows.map(row => row.length)
    );
    return Array.from({ length: columns }, (_, index) => {
        const header = String(sheet.rows[0]?.[index] ?? "");
        return (
            (sheet.table ? TEMPLATE_WIDTHS[header] : undefined) ??
            (sheet.widths[index] ?? 10) * CM_PER_CHARACTER
        );
    });
}

/** "A", "B", … "Z", "AA", … for a column index from 0. */
function columnName(index: number): string {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
}

/** The last used cell, e.g. "K126"; "A1" for an empty sheet. */
function lastCell(sheet: ExportSheet): { column: string; row: number } {
    return {
        column: columnName(Math.max(0, widthsOf(sheet).length - 1)),
        row: Math.max(1, sheet.rows.length)
    };
}

function escapeXml(text: string): string {
    return (
        text
            // Characters XML can't hold.
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
    );
}

const XML_DECLARATION =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function zip(files: Record<string, string>, stored: string[] = []): Uint8Array {
    const entries: Zippable = {};
    for (const [path, content] of Object.entries(files)) {
        // The OpenDocument mimetype must be the first file, uncompressed.
        entries[path] = [
            strToU8(content),
            { level: stored.includes(path) ? 0 : 6 }
        ];
    }
    return zipSync(entries);
}

// --- Office Open XML (.xlsx) -------------------------------------------------

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS =
    "http://schemas.openxmlformats.org/package/2006/relationships";

/** Built-in number formats; the others get ids from 164. */
const BUILT_IN_FORMATS: Readonly<Record<string, number>> = {
    "0": 1,
    "0.00": 2
};

/** Excel's width unit: the widest digit of the default font, 7 pixels
 *  for Arial 10 at 96 dpi. */
function excelWidth(cm: number): number {
    return Math.round(((cm / 2.54) * 96 * 100) / 7) / 100;
}

/** "&" starts a code in Excel's page header. */
function excelHeaderText(text: string): string {
    return text.replaceAll("&", "&&");
}

function xlsx(sheets: readonly ExportSheet[], title: string): Uint8Array {
    const styles: CellStyle[] = [
        { fill: null, bold: false, centred: false, wrap: false, format: null }
    ];
    const styleIds = new Map<string, number>([[styleKey(styles[0]!), 0]]);
    const styleId = (style: CellStyle) => {
        const key = styleKey(style);
        let id = styleIds.get(key);
        if (id === undefined) {
            id = styles.length;
            styles.push(style);
            styleIds.set(key, id);
        }
        return id;
    };

    const worksheets = sheets.map(sheet => {
        const cols = widthsOf(sheet)
            .map(
                (cm, index) =>
                    `<col min="${index + 1}" max="${index + 1}" width="${excelWidth(cm)}" customWidth="1"/>`
            )
            .join("");
        const rows = sheet.rows
            .map((cells, row) => {
                const width = sheet.table
                    ? widthsOf(sheet).length
                    : cells.length;
                const xml = Array.from({ length: width }, (_, column) => {
                    const ref = `${columnName(column)}${row + 1}`;
                    const s = styleId(styleOf(sheet, row, column));
                    const value: ExportCell = cells[column] ?? null;
                    if (typeof value === "number" && Number.isFinite(value)) {
                        return `<c r="${ref}" s="${s}"><v>${value}</v></c>`;
                    }
                    if (typeof value === "string" && value !== "") {
                        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
                    }
                    return s === 0 ? "" : `<c r="${ref}" s="${s}"/>`;
                }).join("");
                return `<row r="${row + 1}">${xml}</row>`;
            })
            .join("");
        const last = lastCell(sheet);
        const margin = PAGE.marginCm / 2.54;
        return (
            XML_DECLARATION +
            `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
            `<dimension ref="A1:${last.column}${last.row}"/>` +
            `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
            `<sheetFormatPr defaultRowHeight="${ROW_HEIGHT_PT}"/>` +
            (cols ? `<cols>${cols}</cols>` : "") +
            `<sheetData>${rows}</sheetData>` +
            `<pageMargins left="${margin}" right="${margin}" top="${margin}" bottom="${margin}" header="0.2" footer="0.2"/>` +
            `<pageSetup paperSize="9" scale="${PAGE.scale}" orientation="landscape"/>` +
            (title
                ? `<headerFooter><oddHeader>${escapeXml(`&C${excelHeaderText(title)}, Page &P`)}</oddHeader></headerFooter>`
                : "") +
            `</worksheet>`
        );
    });

    const formats = [
        ...new Set(
            styles.flatMap(style => (style.format ? [style.format] : []))
        )
    ];
    const formatIds = new Map(
        formats.map((format, index) => [
            format,
            BUILT_IN_FORMATS[format] ?? 164 + index
        ])
    );
    const custom = formats.filter(format => !(format in BUILT_IN_FORMATS));
    const fills = [
        ...new Set(styles.flatMap(style => (style.fill ? [style.fill] : [])))
    ];
    const xfs = styles
        .map(style => {
            const numFmtId = style.format ? formatIds.get(style.format)! : 0;
            const fillId = style.fill ? 2 + fills.indexOf(style.fill) : 0;
            const fontId = style.bold ? 1 : 0;
            const alignment =
                style.centred || style.wrap
                    ? `<alignment${style.centred ? ' horizontal="center"' : ""} vertical="top"${style.wrap ? ' wrapText="1"' : ""}/>`
                    : "";
            return (
                `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"` +
                ` applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1">${alignment}</xf>`
            );
        })
        .join("");
    const font = (bold: boolean) =>
        `<font>${bold ? "<b/>" : ""}<sz val="${FONT_SIZE_PT}"/><name val="Arial"/><family val="2"/></font>`;
    const stylesXml =
        XML_DECLARATION +
        `<styleSheet xmlns="${MAIN_NS}">` +
        (custom.length > 0
            ? `<numFmts count="${custom.length}">${custom
                  .map(
                      format =>
                          `<numFmt numFmtId="${formatIds.get(format)}" formatCode="${escapeXml(format)}"/>`
                  )
                  .join("")}</numFmts>`
            : "") +
        `<fonts count="2">${font(false)}${font(true)}</fonts>` +
        `<fills count="${2 + fills.length}">` +
        `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
        fills
            .map(
                fill =>
                    `<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill>`
            )
            .join("") +
        `</fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="${styles.length}">${xfs}</cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`;

    const sheetEntries = sheets
        .map(
            (sheet, index) =>
                `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
        )
        .join("");
    const printAreas = sheets
        .map((sheet, index) => {
            const last = lastCell(sheet);
            const name = `'${sheet.name.replaceAll("'", "''")}'`;
            return `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${escapeXml(`${name}!$A$1:$${last.column}$${last.row}`)}</definedName>`;
        })
        .join("");
    const workbook =
        XML_DECLARATION +
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
        `<bookViews><workbookView/></bookViews>` +
        `<sheets>${sheetEntries}</sheets>` +
        `<definedNames>${printAreas}</definedNames>` +
        `</workbook>`;
    const workbookRels =
        XML_DECLARATION +
        `<Relationships xmlns="${PACKAGE_REL_NS}">` +
        sheets
            .map(
                (_, index) =>
                    `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
            )
            .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        `</Relationships>`;
    const contentTypes =
        XML_DECLARATION +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets
            .map(
                (_, index) =>
                    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
            )
            .join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`;
    const rootRels =
        XML_DECLARATION +
        `<Relationships xmlns="${PACKAGE_REL_NS}">` +
        `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`;

    return zip({
        "[Content_Types].xml": contentTypes,
        "_rels/.rels": rootRels,
        "xl/workbook.xml": workbook,
        "xl/_rels/workbook.xml.rels": workbookRels,
        "xl/styles.xml": stylesXml,
        ...Object.fromEntries(
            worksheets.map((xml, index) => [
                `xl/worksheets/sheet${index + 1}.xml`,
                xml
            ])
        )
    });
}

// --- OpenDocument (.ods) -----------------------------------------------------

const ODS_NAMESPACES =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" ' +
    'office:version="1.2"';

const ODS_MIME_TYPE = "application/vnd.oasis.opendocument.spreadsheet";

/** Decimals of the number formats the export uses ("0", "0.00", …). */
function decimalsOf(format: string): number | null {
    const match = /^0(?:\.(0+))?$/.exec(format);
    return match ? (match[1]?.length ?? 0) : null;
}

/** A sheet name in a cell range address. */
function odsSheetName(name: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        ? name
        : `'${name.replaceAll("'", "''")}'`;
}

function ods(sheets: readonly ExportSheet[], title: string): Uint8Array {
    const automatic: string[] = [];
    const named = new Map<string, string>();
    const counts = new Map<string, number>();
    /** An automatic style's name, defined once. */
    const define = (
        prefix: string,
        key: string,
        xml: (name: string) => string
    ) => {
        const full = `${prefix}:${key}`;
        let name = named.get(full);
        if (!name) {
            const number = (counts.get(prefix) ?? 0) + 1;
            counts.set(prefix, number);
            name = `${prefix}${number}`;
            named.set(full, name);
            automatic.push(xml(name));
        }
        return name;
    };
    const dataStyle = (format: string) => {
        const decimals = decimalsOf(format);
        return decimals === null
            ? null
            : define(
                  "N",
                  format,
                  name =>
                      `<number:number-style style:name="${name}"><number:number number:decimal-places="${decimals}" number:min-integer-digits="1"/></number:number-style>`
              );
    };
    const cellStyle = (style: CellStyle) => {
        const data = style.format ? dataStyle(style.format) : null;
        return define(
            "ce",
            styleKey(style),
            name =>
                `<style:style style:name="${name}" style:family="table-cell" style:parent-style-name="Default"${data ? ` style:data-style-name="${data}"` : ""}>` +
                `<style:table-cell-properties${style.fill ? ` fo:background-color="#${style.fill.toLowerCase()}"` : ""}${style.centred ? ' style:text-align-source="fix" style:repeat-content="false"' : ""}${style.wrap ? ' fo:wrap-option="wrap" style:vertical-align="top"' : ""}/>` +
                (style.centred
                    ? '<style:paragraph-properties fo:text-align="center" fo:margin-left="0cm"/>'
                    : "") +
                (style.bold
                    ? '<style:text-properties fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/>'
                    : "") +
                `</style:style>`
        );
    };
    const columnStyle = (cm: number) =>
        define(
            "co",
            cm.toFixed(3),
            name =>
                `<style:style style:name="${name}" style:family="table-column"><style:table-column-properties fo:break-before="auto" style:column-width="${cm.toFixed(3)}cm"/></style:style>`
        );
    const rowStyle = define(
        "ro",
        "row",
        name =>
            `<style:style style:name="${name}" style:family="table-row"><style:table-row-properties style:row-height="${ROW_HEIGHT_CM}cm" fo:break-before="auto" style:use-optimal-row-height="true"/></style:style>`
    );
    const tableStyle = define(
        "ta",
        "table",
        name =>
            `<style:style style:name="${name}" style:family="table" style:master-page-name="mp1"><style:table-properties table:display="true" style:writing-mode="lr-tb"/></style:style>`
    );

    const tables = sheets.map(sheet => {
        const widths = widthsOf(sheet);
        const columns = widths
            .map(
                cm =>
                    `<table:table-column table:style-name="${columnStyle(cm)}"/>`
            )
            .join("");
        const rows = sheet.rows
            .map((cells, row) => {
                const width = sheet.table ? widths.length : cells.length;
                const xml = Array.from({ length: width }, (_, column) => {
                    const style = styleOf(sheet, row, column);
                    const name = cellStyle(style);
                    const value: ExportCell = cells[column] ?? null;
                    if (typeof value === "number" && Number.isFinite(value)) {
                        return `<table:table-cell table:style-name="${name}" office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
                    }
                    if (typeof value === "string" && value !== "") {
                        return `<table:table-cell table:style-name="${name}" office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
                    }
                    return `<table:table-cell table:style-name="${name}"/>`;
                }).join("");
                return `<table:table-row table:style-name="${rowStyle}">${xml}</table:table-row>`;
            })
            .join("");
        const last = lastCell(sheet);
        const sheetName = odsSheetName(sheet.name);
        return (
            `<table:table table:name="${escapeXml(sheet.name)}" table:style-name="${tableStyle}"` +
            ` table:print-ranges="${escapeXml(`${sheetName}.A1:${sheetName}.${last.column}${last.row}`)}">` +
            columns +
            rows +
            `</table:table>`
        );
    });

    const content =
        XML_DECLARATION +
        `<office:document-content ${ODS_NAMESPACES}>` +
        `<office:automatic-styles>${automatic.join("")}</office:automatic-styles>` +
        `<office:body><office:spreadsheet>${tables.join("")}</office:spreadsheet></office:body>` +
        `</office:document-content>`;
    const margin = `${PAGE.marginCm}cm`;
    const styles =
        XML_DECLARATION +
        `<office:document-styles ${ODS_NAMESPACES}>` +
        `<office:styles>` +
        `<style:default-style style:family="table-cell"><style:text-properties fo:font-size="${FONT_SIZE_PT}pt"/></style:default-style>` +
        `<style:style style:name="Default" style:family="table-cell"/>` +
        `</office:styles>` +
        `<office:automatic-styles>` +
        `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${PAGE.widthCm}cm" fo:page-height="${PAGE.heightCm}cm" style:print-orientation="landscape" fo:margin-top="${margin}" fo:margin-bottom="${margin}" fo:margin-left="${margin}" fo:margin-right="${margin}" style:scale-to="${PAGE.scale}%"/>` +
        `<style:header-style><style:header-footer-properties fo:min-height="0.3cm" fo:margin-bottom="0.2cm"/></style:header-style></style:page-layout>` +
        `</office:automatic-styles>` +
        `<office:master-styles><style:master-page style:name="mp1" style:page-layout-name="pm1">` +
        (title
            ? `<style:header><text:p>${escapeXml(title)}, Page <text:page-number>1</text:page-number></text:p></style:header>`
            : `<style:header style:display="false"/>`) +
        `<style:footer style:display="false"/>` +
        `</style:master-page></office:master-styles>` +
        `</office:document-styles>`;
    const manifest =
        XML_DECLARATION +
        `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
        `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODS_MIME_TYPE}"/>` +
        `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
        `<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>` +
        `</manifest:manifest>`;
    return zip(
        {
            mimetype: ODS_MIME_TYPE,
            "content.xml": content,
            "styles.xml": styles,
            "META-INF/manifest.xml": manifest
        },
        ["mimetype"]
    );
}

/** A formatted .xlsx or .ods file of the sheets. */
export function spreadsheetFile(
    format: "xlsx" | "ods",
    sheets: readonly ExportSheet[],
    { title = "" }: SpreadsheetOptions = {}
): Uint8Array {
    return format === "xlsx" ? xlsx(sheets, title) : ods(sheets, title);
}
